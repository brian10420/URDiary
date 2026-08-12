"""鎖定邀請碼註冊閘門 (v2.3 task 1.4：對外開放前的安全閘門一半)。

`REQUIRE_INVITE` 在 conftest 環境區塊被強制設為關閉 (見 conftest.py 的
env 區塊)，開放註冊 (test_auth_api.py) 因此不受影響。這裡每個要測「開啟」
行為的測試都用 monkeypatch 對 `config` 模組屬性下手 —— 路由層必須以
`import config; config.REQUIRE_INVITE` 這種**模組屬性、請求當下讀取**的
方式讀旗標 (而不是 `from config import REQUIRE_INVITE`)，否則這裡的
monkeypatch 不會被路由看到 (global-constraints / task-1.4-brief 明確要求)。

CLI (`backend/scripts/urdiary_admin.py`) 的 mint/list/revoke 由獨立的
test_urdiary_admin_cli.py 覆蓋；這裡只造測試用的邀請碼列 (直接經 crud，
略過 CLI) 來測 /users/create 的路由邏輯。
"""
import hashlib
import uuid
from datetime import datetime, timedelta

import config
import database.crud as crud
from database import SessionLocal
from conftest import TEST_PASSWORD


def _username():
    return f"invitetest_{uuid.uuid4().hex[:10]}"


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _mint_invite(*, max_uses=1, note=None, expires_at=None, revoked=False):
    """直接經 crud 造一組邀請碼 (略過 CLI，測路由邏輯用)。回傳 (明文, InviteCode)。"""
    plaintext = f"testcode-{uuid.uuid4().hex}"
    db = SessionLocal()
    try:
        invite = crud.create_invite_code(db, code_hash=_hash(plaintext), max_uses=max_uses,
                                          note=note, expires_at=expires_at)
        if revoked:
            crud.revoke_invite_code(db, invite.id)
            db.refresh(invite)
        return plaintext, invite
    finally:
        db.close()


# --- 旗標關閉：現行開放註冊行為不變 (Electron 本機首次啟動流程的保護線) --------

def test_create_user_ignores_invite_code_field_when_flag_off(client):
    """REQUIRE_INVITE 關閉時 (conftest 預設)，就算帶了 invite_code 欄位也無視，
    行為與現行開放註冊完全一致。"""
    username = _username()
    resp = client.post("/users/create", json={
        "username": username, "password": TEST_PASSWORD, "invite_code": "whatever-junk",
    })
    assert resp.status_code == 200
    assert resp.json()["username"] == username


# --- 旗標開啟：缺碼 / 未知碼 ----------------------------------------------------

def test_create_user_requires_invite_code_when_flag_on(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)

    resp = client.post("/users/create", json={"username": _username(), "password": TEST_PASSWORD})

    assert resp.status_code == 400
    assert resp.json()["code"] == "E2003"  # ErrorCode.INVITE_CODE_REQUIRED


def test_create_user_requires_invite_code_rejects_blank_string(client, monkeypatch):
    """空白字串等同沒帶碼 (trim 後為空)，不能繞過「必填」檢查。"""
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": "   ",
    })

    assert resp.status_code == 400
    assert resp.json()["code"] == "E2003"


def test_create_user_rejects_unknown_invite_code_when_flag_on(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": "this-code-was-never-minted",
    })

    assert resp.status_code == 400
    assert resp.json()["code"] == "E2004"  # ErrorCode.INVITE_CODE_INVALID


# --- 旗標開啟：正確碼會被消費，且真的能拿去登入 ---------------------------------

def test_create_user_accepts_and_consumes_valid_invite_code(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, invite = _mint_invite(max_uses=1)

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })

    assert resp.status_code == 200
    body = resp.json()
    # 回應形狀不外洩邀請碼內部欄位 (hash、id 等)
    assert set(body.keys()) == {"message", "user_id", "username"}

    db = SessionLocal()
    try:
        assert crud.get_invite_code(db, invite.id).used_count == 1
    finally:
        db.close()


def test_create_user_can_login_after_invite_gated_registration(client, monkeypatch):
    """驗證整條路徑真的可用：邀請碼註冊後照樣能登入 (不是回 200 但帳號半殘)。"""
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, _ = _mint_invite(max_uses=1)

    username = _username()
    created = client.post("/users/create", json={
        "username": username, "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert created.status_code == 200

    login = client.post("/users/login", data={"username": username, "password": TEST_PASSWORD})
    assert login.status_code == 200


def test_create_user_accepts_invite_code_with_future_expiry(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, _ = _mint_invite(expires_at=datetime.utcnow() + timedelta(days=1))

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert resp.status_code == 200


# --- 過期 / 撤銷 / 用盡：統一回同一句話 (無 per-cause oracle) -------------------

def test_create_user_rejects_invite_code_expiring_exactly_now(client, monkeypatch):
    """expires_at 邊界：crud.invite_code_is_usable 用 `expires_at <=
    datetime.utcnow()` 判過期、crud.claim_invite_code_use 的 CAS 用
    `expires_at > now` 才算可用——兩處都要求「嚴格晚於現在」，卡在「現在」
    這一刻本身就該視為已過期，不是還有效的最後一刻。

    不必模擬時間：把 expires_at 設成造碼當下的 utcnow()，等到底下這個
    HTTP 請求真正送達、伺服器再呼叫一次 utcnow() 比較時，真實時鐘必然已經
    往前走了 (即使只有幾微秒)，足以穩定重現「等於或早於現在都算過期」。
    """
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, _ = _mint_invite(expires_at=datetime.utcnow())

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "E2004"


def test_create_user_rejects_expired_invite_code(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, _ = _mint_invite(expires_at=datetime.utcnow() - timedelta(days=1))

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "E2004"


def test_create_user_rejects_revoked_invite_code(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, _ = _mint_invite(revoked=True)

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "E2004"


def test_create_user_rejects_exhausted_invite_code(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, invite = _mint_invite(max_uses=1)
    db = SessionLocal()
    try:
        assert crud.claim_invite_code_use(db, invite.id) is True  # 模擬已經被用過一次
    finally:
        db.close()

    resp = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "E2004"


# --- 併發正確性：CAS 不會超用、輸家不留殘帳號、失敗的建立不燒名額 ---------------

def test_claim_invite_code_use_is_a_cas_never_exceeds_max_uses():
    """條件式 UPDATE：連續呼叫 10 次、max_uses=3，只有前 3 次算數。

    同一個 session 依序呼叫已足以檢驗 WHERE used_count < max_uses 這個
    守門條件本身是對的 (併發下的正確性來自「同一列同一時間只有一個 UPDATE
    能命中該 WHERE」)；HTTP 層真正的競態情境由下一個測試涵蓋
    (比照 crud.claim_auth_session_rotation 的測試方式)。
    """
    _, invite = _mint_invite(max_uses=3)
    db = SessionLocal()
    try:
        results = [crud.claim_invite_code_use(db, invite.id) for _ in range(10)]
        assert results == [True, True, True] + [False] * 7
        assert crud.get_invite_code(db, invite.id).used_count == 3
    finally:
        db.close()


def test_losing_the_invite_claim_race_deletes_the_new_user_and_burns_nothing(client, monkeypatch):
    """CAS 認領失敗 (查表時還有名額、認領當下名額已被別人拿走)：
    - 剛建立的帳號要被刪除 (不留下「帳號建立了但邀請碼沒被扣」的孤兒帳號)
    - used_count 不會因為這次失敗的請求而改變
    - 邀請碼本身沒壞掉：拿掉假的 CAS 之後，同一支明文碼還能正常用一次
    """
    import api.routes.user as user_routes

    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, invite = _mint_invite(max_uses=1)

    # 模擬「另一個請求早一步用掉了最後一個名額」：CAS 比對 0 列
    # (先存一份真正的函式參照——user_routes.crud 與這裡的 crud 是同一個模組
    # 物件，patch 之後再從 crud.claim_invite_code_use 讀只會讀回同一個假的)
    real_claim_invite_code_use = crud.claim_invite_code_use
    monkeypatch.setattr(user_routes.crud, "claim_invite_code_use", lambda db, iid: False)

    username = _username()
    resp = client.post("/users/create", json={
        "username": username, "password": TEST_PASSWORD, "invite_code": plaintext,
    })

    assert resp.status_code == 400
    assert resp.json()["code"] == "E2004"

    db = SessionLocal()
    try:
        assert crud.get_user_by_username(db, username) is None, "輸掉競態的帳號沒有被刪除"
        assert crud.get_invite_code(db, invite.id).used_count == 0
    finally:
        db.close()

    # 只還原這一個 patch (config.REQUIRE_INVITE 繼續維持 True)
    monkeypatch.setattr(user_routes.crud, "claim_invite_code_use", real_claim_invite_code_use)
    retry = client.post("/users/create", json={
        "username": username, "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert retry.status_code == 200


def test_duplicate_username_with_valid_invite_code_does_not_burn_a_use(client, monkeypatch):
    """使用者建立失敗 (帳號重複) 不能燒掉邀請碼名額 —— 否則使用者會白白損失
    一次珍貴的邀請額度，卻什麼也沒得到。"""
    username = _username()
    # 先在旗標關閉時佔用這個帳號名稱 (開放註冊路徑，不需要邀請碼)
    first = client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})
    assert first.status_code == 200

    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, invite = _mint_invite(max_uses=1)

    dup = client.post("/users/create", json={
        "username": username, "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert dup.status_code == 400
    assert dup.json()["code"] == "E2001"  # ErrorCode.USER_ALREADY_EXISTS，不是邀請碼錯誤

    db = SessionLocal()
    try:
        assert crud.get_invite_code(db, invite.id).used_count == 0, "重複帳號不該燒掉邀請碼名額"
    finally:
        db.close()

    # 邀請碼還在，換個新帳號名稱應該能正常用掉這次名額
    success = client.post("/users/create", json={
        "username": _username(), "password": TEST_PASSWORD, "invite_code": plaintext,
    })
    assert success.status_code == 200


def test_weak_password_with_valid_invite_code_does_not_burn_a_use(client, monkeypatch):
    """同一條防線，換一種「建立失敗」的原因 (密碼強度不足) 再驗一次。"""
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)
    plaintext, invite = _mint_invite(max_uses=1)

    resp = client.post("/users/create", json={
        "username": _username(), "password": "weak", "invite_code": plaintext,
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "E1001"  # ErrorCode.INVALID_INPUT (密碼強度)

    db = SessionLocal()
    try:
        assert crud.get_invite_code(db, invite.id).used_count == 0
    finally:
        db.close()


# --- /system/capabilities：require_invite 即時反映旗標現況 ----------------------

def test_system_capabilities_reports_require_invite_false_by_default(client):
    resp = client.get("/system/capabilities")
    assert resp.status_code == 200
    assert resp.json()["require_invite"] is False


def test_system_capabilities_reports_require_invite_true_when_flag_on(client, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_INVITE", True)

    resp = client.get("/system/capabilities")

    assert resp.status_code == 200
    assert resp.json()["require_invite"] is True
