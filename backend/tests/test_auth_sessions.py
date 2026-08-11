"""v2.3 task 1.3 認證強化：token 類型檢查、刷新輪替 + 重用偵測、
工作階段撤銷 (logout / 裝置清單)、以及認證錯誤訊息的 zh/en 對等。

每個 test 前的註解標出它對應 task-1.3-brief.md 缺陷表的哪一項 (A~F)。
"""
import uuid
from datetime import datetime, timedelta

import pytest
from jose import jwt

from conftest import TEST_PASSWORD
from config import SECRET_KEY
from utils.security import ALGORITHM, create_access_token


# --- 輔助 ---------------------------------------------------------------------

def _new_username():
    return f"sess_{uuid.uuid4().hex[:10]}"


def _register_and_login(client, headers=None):
    """建帳號 + 登入，回傳含 access/refresh token 的 dict。"""
    username = _new_username()
    created = client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})
    assert created.status_code == 200, created.text
    user_id = created.json()["user_id"]

    login = client.post(
        "/users/login",
        data={"username": username, "password": TEST_PASSWORD},
        headers=headers or {},
    )
    assert login.status_code == 200, login.text
    body = login.json()
    return {
        "username": username,
        "user_id": user_id,
        "access": body["access_token"],
        "refresh": body.get("refresh_token"),
        "body": body,
    }


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _claims(token):
    """不驗簽章地讀出 payload (測試觀察用)。"""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM],
                      options={"verify_exp": False, "verify_aud": False})


def _assert_english(text):
    """英文訊息不得殘留中日韓字元 (不能用 isascii()：本專案英文訊息用 em dash)。"""
    cjk = [ch for ch in text if '　' <= ch <= '鿿' or '＀' <= ch <= '￯']
    assert cjk == [], f"英文訊息殘留中文字元 {cjk}: {text}"


# --- 缺陷 A：decode_token 不檢查 type / iss ------------------------------------

def test_refresh_token_is_rejected_as_access_token(client):
    """刷新令牌不得當成訪問令牌使用 (utils/security.decode_token 必須檢查 type)。"""
    sess = _register_and_login(client)

    resp = client.get(f"/users/{sess['user_id']}", headers=_bearer(sess["refresh"]))

    assert resp.status_code == 401, f"刷新令牌被當成訪問令牌接受了: {resp.text}"


def test_token_with_foreign_issuer_is_rejected(client):
    """別的系統用同一把密鑰簽的 token 不得通過 (必須檢查 iss == ai_diary)。"""
    sess = _register_and_login(client)
    now = datetime.utcnow()
    forged = jwt.encode(
        {
            "sub": sess["username"],
            "id": sess["user_id"],
            "iat": now,
            "exp": now + timedelta(minutes=30),
            "iss": "some_other_service",
            "jti": str(uuid.uuid4()),
            "type": "access",
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    resp = client.get(f"/users/{sess['user_id']}", headers=_bearer(forged))

    assert resp.status_code == 401, f"非本系統簽發者的 token 被接受了: {resp.text}"


def test_access_token_carries_type_access_claim(client):
    """訪問令牌必須帶 type=access，才有可能被 decode_token 區分。"""
    sess = _register_and_login(client)
    assert _claims(sess["access"])["type"] == "access"


# --- 缺陷 B：refresh 端點 verify_exp=False，過期訪問令牌可無限續命 --------------

def test_expired_access_token_cannot_refresh_itself(client):
    """已過期的訪問令牌不得用來換新令牌 (必須 verify_exp=True + type=refresh)。"""
    sess = _register_and_login(client)
    expired_access = create_access_token(
        data={"sub": sess["username"], "id": sess["user_id"]},
        expires_delta=timedelta(minutes=-1),
    )

    resp = client.post("/users/token/refresh", json={"refresh_token": expired_access})

    assert resp.status_code == 401, f"過期訪問令牌換到了新令牌: {resp.text}"


def test_valid_access_token_cannot_be_used_as_refresh_token(client):
    """未過期的訪問令牌同樣不得當刷新令牌用。"""
    sess = _register_and_login(client)

    resp = client.post("/users/token/refresh", json={"refresh_token": sess["access"]})

    assert resp.status_code == 401, f"訪問令牌被當成刷新令牌接受了: {resp.text}"


def test_expired_refresh_token_is_rejected(client):
    """JWT 本身過期的刷新令牌一律拒絕。"""
    from utils.security import create_refresh_token
    sess = _register_and_login(client)
    expired_refresh = create_refresh_token(
        data={"sub": sess["username"], "id": sess["user_id"]},
        expires_delta=timedelta(days=-1),
    )

    resp = client.post("/users/token/refresh", json={"refresh_token": expired_refresh})

    assert resp.status_code == 401


# --- 缺陷 C：沒有輪替與重用偵測 ------------------------------------------------

def test_refresh_returns_a_rotated_refresh_token(client):
    """每次刷新都要換發新的刷新令牌 (rotation)。"""
    sess = _register_and_login(client)

    resp = client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["refresh_token"], "刷新回應沒有帶新的刷新令牌"
    assert body["refresh_token"] != sess["refresh"], "刷新令牌沒有輪替"
    assert _claims(body["refresh_token"])["jti"] != _claims(sess["refresh"])["jti"]


def test_reusing_an_old_refresh_token_revokes_the_whole_family(client):
    """重用已輪替過的刷新令牌 = 疑似外洩：撤銷該使用者全部工作階段並回 401。"""
    first = _register_and_login(client)
    second_login = client.post(
        "/users/login",
        data={"username": first["username"], "password": TEST_PASSWORD},
    )
    assert second_login.status_code == 200
    other_device_refresh = second_login.json()["refresh_token"]

    rotated = client.post("/users/token/refresh", json={"refresh_token": first["refresh"]})
    assert rotated.status_code == 200, rotated.text
    new_refresh = rotated.json()["refresh_token"]

    replay = client.post("/users/token/refresh", json={"refresh_token": first["refresh"]})
    assert replay.status_code == 401, f"重用舊刷新令牌沒有被擋: {replay.text}"

    # 整條鏈與同使用者的其他裝置都要一起失效
    assert client.post("/users/token/refresh", json={"refresh_token": new_refresh}).status_code == 401
    assert client.post("/users/token/refresh", json={"refresh_token": other_device_refresh}).status_code == 401


def test_refresh_token_unknown_to_the_server_is_rejected(client):
    """簽章有效但伺服器沒有對應工作階段列 (例如已被清掉) 也要拒絕。"""
    from utils.security import create_refresh_token
    sess = _register_and_login(client)
    orphan = create_refresh_token(data={"sub": sess["username"], "id": sess["user_id"]})

    resp = client.post("/users/token/refresh", json={"refresh_token": orphan})

    assert resp.status_code == 401


def test_session_row_expiry_invalidates_a_still_valid_jwt(client):
    """工作階段列的 expires_at 過了，即使 JWT 本身還沒過期也不能刷新。"""
    from database import SessionLocal
    from database.models import AuthSession

    sess = _register_and_login(client)
    jti = _claims(sess["refresh"])["jti"]

    db = SessionLocal()
    try:
        row = db.query(AuthSession).filter(AuthSession.refresh_jti == jti).one()
        row.expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    finally:
        db.close()

    resp = client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]})
    assert resp.status_code == 401


# --- 缺陷 D：令牌有效期 (30 分鐘 access / 30 天 refresh) ------------------------

def test_login_access_token_expires_in_30_minutes(client):
    sess = _register_and_login(client)
    assert sess["body"]["expires_in"] == 30 * 60


def test_login_refresh_token_lives_30_days(client):
    sess = _register_and_login(client)
    claims = _claims(sess["refresh"])
    lifetime = datetime.utcfromtimestamp(claims["exp"]) - datetime.utcfromtimestamp(claims["iat"])
    assert abs(lifetime - timedelta(days=30)) < timedelta(minutes=1)


def test_refreshed_access_token_expires_in_30_minutes(client):
    sess = _register_and_login(client)
    resp = client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["expires_in"] == 30 * 60


def test_token_ttls_come_from_config(client):
    """有效期必須讀 config (可用環境變數調整)，不是寫死在路由裡。"""
    import config
    assert config.ACCESS_TOKEN_MINUTES == 30
    assert config.REFRESH_TOKEN_DAYS == 30


# --- 缺陷 E：bare except 吞掉 API 例外並洩漏 str(e) -----------------------------

def test_malformed_token_error_does_not_leak_exception_text(client):
    """壞掉的令牌只回制式訊息，不把 jose 的內部錯誤字串回給呼叫端。

    判準：不同的壞法必須得到「完全相同」的 detail —— 只要訊息會隨內部
    例外變動，就代表 str(e) 被拼進了回應。
    """
    details = set()
    for bad in ("garbage", "not.a.real.jwt", "aaa.bbb.ccc"):
        resp = client.post("/users/token/refresh", json={"refresh_token": bad})
        assert resp.status_code == 401
        details.add(resp.json()["detail"])

    assert len(details) == 1, f"錯誤訊息隨內部例外變動 (洩漏 str(e)): {details}"
    detail = details.pop()
    for leaked in ("Not enough segments", "Signature verification failed",
                   "Invalid header string", "codec can't decode", "Traceback"):
        assert leaked not in detail, f"回應洩漏了內部錯誤訊息: {detail}"


def test_refresh_reraises_api_errors_instead_of_swallowing_them(client, monkeypatch):
    """內層丟出的 NotFoundError 必須原樣往外傳 (404)，不能被 bare except 吞成 401。"""
    import api.routes.user as user_routes
    from utils.api_exceptions import NotFoundError
    from utils.error_codes import ErrorCode

    sess = _register_and_login(client)

    def _boom(db, user_id):
        raise NotFoundError(error_code=ErrorCode.USER_NOT_FOUND, detail="使用者不存在")

    monkeypatch.setattr(user_routes.crud, "get_user", _boom)

    resp = client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]})

    assert resp.status_code == 404, f"API 例外被吞掉了: {resp.status_code} {resp.text}"


# --- 缺陷 F：沒有登出 / 撤銷，jti 從沒被讀取 -----------------------------------

def test_logout_revokes_only_the_current_session(client):
    sess = _register_and_login(client)
    other = client.post("/users/login", data={"username": sess["username"], "password": TEST_PASSWORD})
    other_refresh = other.json()["refresh_token"]

    resp = client.post("/users/logout", headers=_bearer(sess["access"]))
    assert resp.status_code == 200, resp.text

    # 另一台裝置不受影響 (先驗它：拿被撤銷的令牌去刷新會觸發下面那條家族撤銷規則)
    assert client.post("/users/token/refresh", json={"refresh_token": other_refresh}).status_code == 200
    assert client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]}).status_code == 401


def test_presenting_a_revoked_refresh_token_revokes_the_whole_account(client):
    """契約 (task-1.3-brief)：jti 對應的列已撤銷 **或** 已輪替都算重用，
    一律撤光該帳號的工作階段。已登出的令牌又冒出來，無法分辨是使用者
    自己的殘留副本還是別人偷走的，所以一律 fail-closed。"""
    sess = _register_and_login(client)
    other = client.post("/users/login", data={"username": sess["username"], "password": TEST_PASSWORD})
    other_refresh = other.json()["refresh_token"]

    assert client.post("/users/logout", headers=_bearer(sess["access"])).status_code == 200

    replay = client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]})
    assert replay.status_code == 401

    assert client.post("/users/token/refresh", json={"refresh_token": other_refresh}).status_code == 401


def test_logout_after_rotation_still_revokes_the_live_session(client):
    """用輪替前的舊訪問令牌登出，仍要撤銷目前活著的那個工作階段。"""
    sess = _register_and_login(client)
    rotated = client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]})
    new_refresh = rotated.json()["refresh_token"]

    assert client.post("/users/logout", headers=_bearer(sess["access"])).status_code == 200
    assert client.post("/users/token/refresh", json={"refresh_token": new_refresh}).status_code == 401


def test_logout_requires_authentication(client):
    assert client.post("/users/logout").status_code == 401


def test_sessions_lists_devices_and_marks_the_current_one(client):
    sess = _register_and_login(client, headers={"User-Agent": "URDiaryTest/1.0 (device-a)"})
    client.post(
        "/users/login",
        data={"username": sess["username"], "password": TEST_PASSWORD},
        headers={"User-Agent": "URDiaryTest/1.0 (device-b)"},
    )

    resp = client.get("/users/sessions", headers=_bearer(sess["access"]))

    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 2, rows
    current = [r for r in rows if r["is_current"]]
    assert len(current) == 1
    row = current[0]
    assert isinstance(row["id"], int)
    assert row["created_at"] and row["last_used_at"] and row["expires_at"]
    assert "device-a" in (row["user_agent"] or "")
    assert "refresh_jti" not in row and "token" not in row


def test_sessions_only_lists_the_callers_own_devices(client):
    mine = _register_and_login(client)
    _register_and_login(client)  # 另一個使用者的工作階段不該出現

    rows = client.get("/users/sessions", headers=_bearer(mine["access"])).json()

    assert len(rows) == 1


def test_revoked_sessions_disappear_from_the_list(client):
    sess = _register_and_login(client)
    client.post("/users/logout", headers=_bearer(sess["access"]))

    second = client.post("/users/login", data={"username": sess["username"], "password": TEST_PASSWORD})
    rows = client.get("/users/sessions", headers=_bearer(second.json()["access_token"])).json()

    assert len(rows) == 1


def test_delete_session_revokes_that_device(client):
    sess = _register_and_login(client)
    other = client.post("/users/login", data={"username": sess["username"], "password": TEST_PASSWORD})
    other_refresh = other.json()["refresh_token"]

    rows = client.get("/users/sessions", headers=_bearer(sess["access"])).json()
    target = [r for r in rows if not r["is_current"]][0]

    resp = client.delete(f"/users/sessions/{target['id']}", headers=_bearer(sess["access"]))
    assert resp.status_code == 200, resp.text

    # 先驗自己還活著 (被撤銷的令牌一旦重放會連自己一起撤掉，見上面的家族撤銷契約)
    assert client.post("/users/token/refresh", json={"refresh_token": sess["refresh"]}).status_code == 200
    assert client.post("/users/token/refresh", json={"refresh_token": other_refresh}).status_code == 401


def test_delete_another_users_session_returns_404(client):
    mine = _register_and_login(client)
    theirs = _register_and_login(client)

    their_rows = client.get("/users/sessions", headers=_bearer(theirs["access"])).json()
    their_session_id = their_rows[0]["id"]

    resp = client.delete(f"/users/sessions/{their_session_id}", headers=_bearer(mine["access"]))

    assert resp.status_code == 404, resp.text
    # 對方的工作階段必須完好
    assert client.post("/users/token/refresh", json={"refresh_token": theirs["refresh"]}).status_code == 200


def test_delete_missing_session_returns_404(client):
    mine = _register_and_login(client)
    assert client.delete("/users/sessions/99999999", headers=_bearer(mine["access"])).status_code == 404


# --- 訊息 i18n (缺陷表最後一段) -----------------------------------------------

EN = {"X-Language": "en"}


def test_login_wrong_password_message_is_localized(client):
    sess = _register_and_login(client)

    zh = client.post("/users/login", data={"username": sess["username"], "password": "WrongPass1!"})
    en = client.post("/users/login", data={"username": sess["username"], "password": "WrongPass1!"}, headers=EN)

    assert zh.status_code == en.status_code == 401
    assert zh.json()["detail"] != en.json()["detail"]
    _assert_english(en.json()["detail"])


def test_duplicate_username_message_is_localized(client):
    username = _new_username()
    client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    en = client.post("/users/create", json={"username": username, "password": TEST_PASSWORD}, headers=EN)

    assert en.status_code == 400
    _assert_english(en.json()["detail"])


def test_weak_password_message_is_localized(client):
    en = client.post("/users/create", json={"username": _new_username(), "password": "weak"}, headers=EN)

    assert en.status_code == 400
    _assert_english(en.json()["detail"])


def test_forbidden_other_user_message_is_localized(client):
    mine = _register_and_login(client)
    theirs = _register_and_login(client)

    en = client.get(f"/users/{theirs['user_id']}", headers={**_bearer(mine["access"]), **EN})

    assert en.status_code == 403
    _assert_english(en.json()["detail"])


def test_invalid_credentials_message_from_deps_is_localized(client):
    zh = client.get("/users/1", headers=_bearer("garbage"))
    en = client.get("/users/1", headers={**_bearer("garbage"), **EN})

    assert zh.status_code == en.status_code == 401
    assert zh.json()["detail"] != en.json()["detail"]
    _assert_english(en.json()["detail"])


def test_refresh_errors_are_localized(client):
    zh = client.post("/users/token/refresh", json={"refresh_token": "not.a.real.jwt"})
    en = client.post("/users/token/refresh", json={"refresh_token": "not.a.real.jwt"}, headers=EN)

    assert zh.status_code == en.status_code == 401
    assert zh.json()["detail"] != en.json()["detail"]
    _assert_english(en.json()["detail"])


def test_password_validator_returns_english_when_asked():
    from utils.password_validator import validate_password_and_get_errors

    zh_errors = validate_password_and_get_errors("weak")
    en_errors = validate_password_and_get_errors("weak", lang="en")

    assert len(zh_errors) == len(en_errors) == 4
    for e in en_errors:
        _assert_english(e)
    assert zh_errors != en_errors
