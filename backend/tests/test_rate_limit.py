"""鎖定 middleware/rate_limit.py 的限流行為 (v2.3 task 1.5：對外開放前的
安全閘門後半)。

`config.RATE_LIMIT_ENABLED` 在 conftest 環境區塊被強制關閉 (見
conftest.py 的 env 區塊)，其餘既有測試因此完全不受影響，不必逐一等視窗
過期。這裡每個要測「限制生效」的測試自行對 `config`/`rate_limit` 的模組
屬性 monkeypatch (與 tests/test_invite_codes.py 對 REQUIRE_INVITE 同一套
模式)：打開 `config.RATE_LIMIT_ENABLED`，並把要測的桶的上限/視窗調小，
不必真的送出成千上百次請求或真的 sleep。

`client` fixture是 session 共用；conftest.py 的 autouse `_reset_rate_limits`
fixture 會在每個測試前後清空 `rate_limit._counters`，這裡不用自己處理。
"""
import uuid

import config
from conftest import TEST_PASSWORD
from middleware import rate_limit


def _username() -> str:
    return f"ratelimit_{uuid.uuid4().hex[:10]}"


# --- 停用旗標：關閉時，就算把每個桶都調到 1，也完全不生效 ----------------------

def test_disabled_flag_bypasses_every_bucket(client, monkeypatch):
    """`config.RATE_LIMIT_ENABLED` 維持 conftest 預設的關閉狀態 (刻意不打開)；
    上限被調到 1 之後，連續打多次也不該出現任何一個 429。"""
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)
    monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 1)

    for _ in range(5):
        assert client.get("/openapi.json").status_code == 200

    username = _username()
    for _ in range(5):
        resp = client.post("/users/login", data={"username": username, "password": "x"})
        assert resp.status_code != 429


# --- /health 豁免：監控探針不能被打斷 -----------------------------------------

def test_health_exempt_even_when_global_bucket_saturated(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    for _ in range(5):
        assert client.get("/health").status_code == 200


# --- global 桶：per-IP，套用到所有非豁免路徑 -----------------------------------

def test_global_bucket_under_limit_passes_at_limit_429_with_retry_after(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 3)

    for _ in range(3):
        assert client.get("/openapi.json").status_code == 200

    blocked = client.get("/openapi.json")
    assert blocked.status_code == 429
    body = blocked.json()
    assert body["code"] == "E1006"
    assert body["error"] == "http_error"
    assert "request_id" in body

    retry_after = blocked.headers.get("retry-after")
    assert retry_after is not None
    assert int(retry_after) > 0


def test_global_bucket_resets_after_window_elapses(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)
    monkeypatch.setattr(rate_limit, "GLOBAL_WINDOW_SECONDS", 60)

    fake_now = [1_000.0]
    monkeypatch.setattr(rate_limit, "_now", lambda: fake_now[0])

    assert client.get("/openapi.json").status_code == 200
    assert client.get("/openapi.json").status_code == 429

    fake_now[0] += 61  # 視窗過期，不必真的 sleep
    assert client.get("/openapi.json").status_code == 200


def test_global_bucket_applies_even_to_unmatched_paths(client, monkeypatch):
    """限流中間件在路由之前就攔截，404 一樣要算進 global 桶——否則掃描式
    的探測流量可以靠打不存在的路徑繞過限流。"""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 2)

    assert client.get("/this-path-does-not-exist").status_code == 404
    assert client.get("/this-path-does-not-exist").status_code == 404
    assert client.get("/this-path-does-not-exist").status_code == 429


# --- 429 回應形狀與雙語 (與 exception_handlers.http_exception_handler 一致) -----

def test_429_response_shape_matches_exception_handler_and_is_bilingual(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    client.get("/openapi.json")  # 燒掉唯一的名額

    zh = client.get("/openapi.json")
    assert zh.status_code == 429
    assert set(zh.json().keys()) == {"error", "detail", "request_id", "code"}
    assert zh.json()["detail"] == "請求過於頻繁，請稍後再試"

    en = client.get("/openapi.json", headers={"X-Language": "en"})
    assert en.status_code == 429
    assert en.json()["detail"] == "Too many requests — please try again later"


# --- login 桶：per-IP，涵蓋 /users/login 與其 OAuth2 別名 /users/token ----------

def test_login_ip_bucket_blocks_after_limit(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 3)

    username = _username()
    for _ in range(3):
        resp = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
        assert resp.status_code == 401

    blocked = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "E1006"
    assert blocked.headers.get("retry-after") is not None


def test_users_token_alias_shares_login_bucket_with_users_login(client, monkeypatch):
    """`/users/token` 是 OAuth2PasswordBearer 的標準別名，內部直接呼叫
    `login()` (見 api/routes/user.py 的 get_token())——沒有共用同一個桶的話，
    單純換一條路徑打就能繞過 login 限流。"""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 2)

    username = _username()
    assert client.post("/users/login", data={"username": username, "password": "x"}).status_code == 401
    assert client.post("/users/token", data={"username": username, "password": "x"}).status_code == 401

    blocked = client.post("/users/login", data={"username": username, "password": "x"})
    assert blocked.status_code == 429


# --- 使用者名稱鎖定：只計失敗次數，成功即清空，不外洩帳號是否存在 --------------

def test_username_lockout_blocks_further_attempts_even_with_correct_password(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LOGIN_LOCKOUT_LIMIT", 3)
    monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 100)  # 避免跟 IP 桶打架

    username = _username()
    client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    for _ in range(3):
        resp = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
        assert resp.status_code == 401

    # 第 4 次就算密碼正確，也已經因為前 3 次失敗被鎖定
    blocked = client.post("/users/login", data={"username": username, "password": TEST_PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "E1006"


def test_username_lockout_only_counts_failures_and_clears_on_success(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LOGIN_LOCKOUT_LIMIT", 3)
    monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 100)

    username = _username()
    client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    # 2 次失敗：還沒到門檻 3
    for _ in range(2):
        resp = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
        assert resp.status_code == 401

    # 成功登入一次，應該清空剛剛累積的 2 次失敗
    ok = client.post("/users/login", data={"username": username, "password": TEST_PASSWORD})
    assert ok.status_code == 200

    # 再 3 次失敗：門檻的檢查發生在「這次嘗試之前」，所以第 3 次失敗本身仍會
    # 被放行 (跟其他桶「上限 N 次都放行、第 N+1 次才擋」的語意一致，
    # test_username_lockout_blocks_further_attempts_even_with_correct_password
    # 已經鎖定這個行為)。如果成功登入沒有清空計數，累積次數會提早到 3
    # (2 舊 + 1 新)，第 2 次就會被擋——這裡逐次斷言 401 就能抓到這個差異。
    for _ in range(3):
        resp = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
        assert resp.status_code == 401  # 尚未被鎖，證明成功登入確實把計數歸零了

    # 歸零後累積滿 3 次失敗，第 4 次 (不管密碼對不對) 才真正踩到門檻
    blocked = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
    assert blocked.status_code == 429


def test_username_lockout_does_not_leak_whether_account_exists(client, monkeypatch):
    """鎖定行為對「真實帳號打錯密碼」與「從未註冊過的帳號」必須完全一致
    (次數、狀態碼、回應內容)，否則鎖定速度本身就變成能拿來探測帳號是否
    存在的側路 (task 1.5 self-review 明確點名的風險)。"""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LOGIN_LOCKOUT_LIMIT", 3)
    monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 100)

    real_username = _username()
    client.post("/users/create", json={"username": real_username, "password": TEST_PASSWORD})
    fake_username = _username()  # 從未註冊過

    for username in (real_username, fake_username):
        for _ in range(3):
            resp = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
            assert resp.status_code == 401

        blocked = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})
        assert blocked.status_code == 429
        assert blocked.json() == {
            "error": "http_error",
            "detail": "請求過於頻繁，請稍後再試",
            "request_id": blocked.json()["request_id"],
            "code": "E1006",
        }


# --- create 桶：per-IP -----------------------------------------------------------

def test_create_bucket_blocks_after_limit_per_ip(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "CREATE_LIMIT", 2)

    for _ in range(2):
        resp = client.post("/users/create", json={"username": _username(), "password": TEST_PASSWORD})
        assert resp.status_code == 200

    blocked = client.post("/users/create", json={"username": _username(), "password": TEST_PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "E1006"


# --- refresh 桶：per-IP ----------------------------------------------------------

def test_refresh_bucket_blocks_after_limit_per_ip(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "REFRESH_LIMIT", 2)

    for _ in range(2):
        resp = client.post("/users/token/refresh", json={"refresh_token": "not-a-real-token"})
        assert resp.status_code == 401

    blocked = client.post("/users/token/refresh", json={"refresh_token": "not-a-real-token"})
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "E1006"


# --- LLM 桶：per-user，且必須在真的花掉 LLM 額度之前就擋下 ----------------------

def test_llm_bucket_blocks_after_limit_without_spending_budget(client, auth_header, mock_llm, llm_headers, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LLM_LIMIT", 2)

    headers, _ = auth_header
    combined = {**headers, **llm_headers}

    for _ in range(2):
        assert client.post("/chat/", json={"message": "hi"}, headers=combined).status_code == 200

    blocked = client.post("/chat/", json={"message": "hi"}, headers=combined)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "E1006"
    assert blocked.headers.get("retry-after") is not None

    # 關鍵：第三次呼叫沒有真的打到 LLM——證明是「先擋、後花錢」而不是
    # 「先花錢、後 429」(task 1.5 self-review 明確點名的風險)
    assert len(mock_llm.calls) == 2


def test_llm_bucket_is_per_user_not_shared_across_users(client, auth_header, other_auth_header,
                                                          mock_llm, llm_headers, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LLM_LIMIT", 1)

    headers_a, _ = auth_header
    headers_b, _ = other_auth_header

    assert client.post("/chat/", json={"message": "hi"}, headers={**headers_a, **llm_headers}).status_code == 200
    assert client.post("/chat/", json={"message": "hi"}, headers={**headers_a, **llm_headers}).status_code == 429

    # 不同使用者：獨立額度，不受 A 用戶額度用盡影響
    assert client.post("/chat/", json={"message": "hi"}, headers={**headers_b, **llm_headers}).status_code == 200


def test_llm_bucket_shared_across_llm_endpoints_for_same_user(client, auth_header, mock_llm, llm_headers, monkeypatch):
    """桶鍵是「使用者 id」，不是「使用者 id + 端點」——同一人在 /chat/ 用掉的
    額度會影響 /chat/enhanced/。"""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LLM_LIMIT", 1)

    headers, _ = auth_header
    combined = {**headers, **llm_headers}

    assert client.post("/chat/", json={"message": "hi"}, headers=combined).status_code == 200
    blocked = client.post("/chat/enhanced/", json={"message": "hi"}, headers=combined)
    assert blocked.status_code == 429


def test_all_llm_backed_endpoints_are_wired_to_the_dependency(client, auth_header, mock_llm, llm_headers, monkeypatch):
    """真的會呼叫 LLM 供應商的 8 個端點都必須掛 enforce_llm_rate_limit——
    用掉唯一的 1 次額度後，其餘每一個不管打哪一個都該立即 429，不能有
    漏網之魚 (純 CRUD、不花 LLM 額度的端點如 GET /diaries/{id}、
    DELETE /chat/clear/ 則刻意不掛，不在這份清單裡)。"""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "LLM_LIMIT", 1)

    headers, user_id = auth_header
    combined = {**headers, **llm_headers}

    assert client.post("/chat/", json={"message": "hi"}, headers=combined).status_code == 200

    calls = [
        ("POST", "/chat/", {"message": "hi"}),
        ("POST", "/chat/enhanced/", {"message": "hi"}),
        ("POST", "/chat/checkin/", None),
        ("POST", "/chat/end/", {}),
        ("POST", "/generate", {}),
        ("POST", "/enhanced-generate", {}),
        ("GET", f"/analytics/emotion/{user_id}", None),
        ("POST", "/interaction-notes/update", {}),
    ]
    for method, path, body in calls:
        resp = client.request(method, path, json=body, headers=combined)
        assert resp.status_code == 429, f"{method} {path} 未被限流擋下: {resp.status_code} {resp.text}"
        assert resp.json()["code"] == "E1006"

    # 上面 9 次呼叫 (含燒額度那次) 只有第一次真的打到 LLM
    assert len(mock_llm.calls) == 1


# --- 信任代理標頭：僅在 URDIARY_TRUSTED_PROXY 開啟時才讀 -----------------------

def test_spoofed_proxy_headers_ignored_when_trusted_proxy_unset(client, monkeypatch):
    """`config.TRUSTED_PROXY` 維持預設關閉，不去動它——偽造的 IP 標頭
    必須完全不影響桶鍵，全部算在同一個真實 IP (TestClient 的 "testclient")
    上。"""
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 2)

    assert client.get("/openapi.json", headers={"CF-Connecting-IP": "1.1.1.1"}).status_code == 200
    assert client.get("/openapi.json", headers={"CF-Connecting-IP": "2.2.2.2"}).status_code == 200
    blocked = client.get("/openapi.json", headers={"CF-Connecting-IP": "3.3.3.3"})
    assert blocked.status_code == 429


def test_trusted_proxy_honors_cf_connecting_ip_as_separate_buckets(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(config, "TRUSTED_PROXY", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    assert client.get("/openapi.json", headers={"CF-Connecting-IP": "1.1.1.1"}).status_code == 200
    assert client.get("/openapi.json", headers={"CF-Connecting-IP": "1.1.1.1"}).status_code == 429

    # 不同的信任 IP：獨立的桶，不受剛剛那個 IP 用盡額度影響
    assert client.get("/openapi.json", headers={"CF-Connecting-IP": "2.2.2.2"}).status_code == 200


def test_trusted_proxy_prefers_cf_connecting_ip_over_x_forwarded_for(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(config, "TRUSTED_PROXY", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    headers = {"CF-Connecting-IP": "9.9.9.9", "X-Forwarded-For": "8.8.8.8, testclient"}
    assert client.get("/openapi.json", headers=headers).status_code == 200
    assert client.get("/openapi.json", headers=headers).status_code == 429

    # 換一個不同的 CF-Connecting-IP、但 X-Forwarded-For 沿用同一個值：
    # 應被視為不同的鍵 (CF-Connecting-IP 優先於 XFF)，不受剛剛那個影響
    other = client.get(
        "/openapi.json",
        headers={"CF-Connecting-IP": "7.7.7.7", "X-Forwarded-For": "8.8.8.8, testclient"},
    )
    assert other.status_code == 200


def test_trusted_proxy_uses_first_x_forwarded_for_value_when_no_cf_header(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(config, "TRUSTED_PROXY", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    headers_a = {"X-Forwarded-For": "5.5.5.5, 10.0.0.1"}
    assert client.get("/openapi.json", headers=headers_a).status_code == 200
    assert client.get("/openapi.json", headers=headers_a).status_code == 429

    headers_b = {"X-Forwarded-For": "6.6.6.6, 10.0.0.1"}
    assert client.get("/openapi.json", headers=headers_b).status_code == 200


def test_trusted_proxy_falls_back_to_client_host_without_headers(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(config, "TRUSTED_PROXY", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    assert client.get("/openapi.json").status_code == 200
    assert client.get("/openapi.json").status_code == 429


# --- reset()：清空所有計數器 ------------------------------------------------------

def test_reset_clears_all_counters(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "GLOBAL_LIMIT", 1)

    assert client.get("/openapi.json").status_code == 200
    assert client.get("/openapi.json").status_code == 429

    rate_limit.reset()

    assert client.get("/openapi.json").status_code == 200


# --- 記憶體：過期視窗要被機會性清理，不能無止盡增長 ----------------------------

def test_expired_entries_are_pruned_opportunistically(monkeypatch):
    rate_limit.reset()
    fake_now = [0.0]
    monkeypatch.setattr(rate_limit, "_now", lambda: fake_now[0])
    monkeypatch.setattr(rate_limit, "GLOBAL_WINDOW_SECONDS", 60)

    for i in range(10):
        rate_limit._check_and_increment("global", f"ip-{i}")
    assert len(rate_limit._counters) == 10

    # 時間跳過視窗長度：任何一次新的存取都該順便清掉全部已過期的舊項目，
    # 不需要背景執行緒
    fake_now[0] += 61
    rate_limit._check_and_increment("global", "ip-new")

    assert len(rate_limit._counters) == 1
    assert ("global", "ip-new") in rate_limit._counters
