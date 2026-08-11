"""鎖定 LLM 金鑰儲存（雙軌：伺服器預設 + 個人覆寫）—— v2.3 task 1.6。

解析順序（api/deps.get_llm_config）必須恰好是：

    X-LLM-Api-Key 標頭（Electron 本機） → 使用者自己存的憑證
    → 伺服器預設憑證（user_id IS NULL） → .env 的 XAI_API_KEY → 400/503

三個不可退讓的性質：

1. **每一層都是一組完整設定**（provider/model/api_key/base_url 同源）。
   絕不可把某一層的金鑰配上另一層的 base_url —— 那等於讓任何人只要塞一個
   X-LLM-Base-Url 標頭，就能把伺服器預設金鑰送到自己的伺服器上（金鑰外洩）。
2. **明文金鑰永遠不出現在任何回應**（只回最後 4 碼的遮罩）。
3. **鐵律**：get_llm_config 讀資料庫用的 session 必須在回傳前就關閉，
   不得跨越 llm.chat 呼叫（見 database.db_session 的說明）。
"""
import pytest

import config
import database.crud as crud
import llm as llm_module
from conftest import LLM_HEADERS
from sqlalchemy import event

from database import SessionLocal, engine
from database.models import LLMCredential
from utils.key_vault import encrypt_secret

USER_KEY = "sk-user-personal-key-1111"
SERVER_KEY = "sk-server-shared-key-2222"
HEADER_KEY = "sk-header-electron-key-3333"
ENV_KEY = "sk-env-fallback-key-4444"


# --- 輔助 ---------------------------------------------------------------------

def _store_credential(user_id, provider, api_key, base_url=None, model=None):
    """直接寫一列憑證（user_id=None 代表伺服器預設）。"""
    db = SessionLocal()
    try:
        return crud.set_llm_credential(
            db, user_id=user_id, provider=provider,
            api_key_enc=encrypt_secret(api_key), base_url=base_url, model=model,
        )
    finally:
        db.close()


def _rows(user_id):
    db = SessionLocal()
    try:
        query = db.query(LLMCredential)
        query = (query.filter(LLMCredential.user_id.is_(None)) if user_id is None
                 else query.filter(LLMCredential.user_id == user_id))
        return query.all()
    finally:
        db.close()


def _chat(client, headers, message="今天過得還可以"):
    return client.post("/chat/", json={"message": message}, headers=headers)


@pytest.fixture(autouse=True)
def _clean_server_credential():
    """伺服器預設憑證是「全域一列」，測試資料庫又是整個 session 共用——
    沒有這個清理，任何一個測試留下的伺服器預設會讓其他檔案裡「沒設定金鑰
    應該 503」之類的測試莫名其妙變綠。前後各清一次。"""
    def purge():
        db = SessionLocal()
        try:
            crud.delete_llm_credentials(db, user_id=None)
        finally:
            db.close()

    purge()
    yield
    purge()


@pytest.fixture
def no_env_fallback(monkeypatch):
    """關掉 .env 的 Grok 後備。

    llm.py 是 `from config import XAI_API_KEY`（import 當下綁值），
    describe/狀態查詢則讀 `config.XAI_API_KEY` 模組屬性——兩邊都要蓋掉，
    才不會因為開發機的 backend/.env 剛好有金鑰而讓測試結果飄移。
    """
    monkeypatch.setattr(llm_module, "XAI_API_KEY", None)
    monkeypatch.setattr(config, "XAI_API_KEY", None)


@pytest.fixture
def env_fallback(monkeypatch):
    monkeypatch.setattr(llm_module, "XAI_API_KEY", ENV_KEY)
    monkeypatch.setattr(config, "XAI_API_KEY", ENV_KEY)


# --- 解析順序：四層 ------------------------------------------------------------

def test_header_key_wins_over_stored_user_credential(client, auth_header, mock_llm, no_env_fallback):
    """第一層：Electron 送來的 X-LLM-Api-Key 永遠優先（本機金鑰鏈的金鑰）。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY)

    resp = _chat(client, {**headers, "X-LLM-Provider": "claude", "X-LLM-Api-Key": HEADER_KEY})

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == HEADER_KEY
    assert cfg.provider == "claude"


def test_user_stored_credential_used_when_no_header(client, auth_header, mock_llm, no_env_fallback):
    """第二層：沒帶標頭（手機瀏覽器）時用使用者自己存在伺服器的憑證。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY, model="gpt-test-model")

    resp = _chat(client, headers)

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == USER_KEY
    assert cfg.provider == "openai"
    assert cfg.model == "gpt-test-model"


def test_server_default_used_when_user_has_no_credential(client, auth_header, mock_llm, no_env_fallback):
    """第三層：家人不必自己設定金鑰——伺服器預設憑證接手。"""
    headers, _ = auth_header
    _store_credential(None, "grok", SERVER_KEY)

    resp = _chat(client, headers)

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == SERVER_KEY
    assert cfg.provider == "grok"


def test_user_credential_overrides_server_default(client, auth_header, mock_llm, no_env_fallback):
    headers, user_id = auth_header
    _store_credential(None, "grok", SERVER_KEY)
    _store_credential(user_id, "claude", USER_KEY)

    resp = _chat(client, headers)

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == USER_KEY
    assert cfg.provider == "claude"


def test_env_fallback_used_when_nothing_is_stored(client, auth_header, mock_llm, env_fallback):
    """第四層：兩種憑證都沒有時，維持既有的 .env XAI_API_KEY 後備行為。"""
    headers, _ = auth_header

    resp = _chat(client, headers)

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == ENV_KEY
    assert cfg.provider == "grok"


def test_no_credential_anywhere_still_returns_503(client, auth_header, mock_llm, no_env_fallback):
    """全部四層都沒有 → 與改版前完全相同的失敗行為（503，不是 500）。"""
    headers, _ = auth_header

    resp = _chat(client, headers)

    assert resp.status_code == 503, resp.text
    assert mock_llm.calls == []


def test_provider_header_without_key_falls_through_to_stored_credential(
    client, auth_header, mock_llm, no_env_fallback
):
    """只帶 X-LLM-Provider、沒帶金鑰：改版前一律 400，現在往下找存起來的憑證。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY)

    resp = _chat(client, {**headers, "X-LLM-Provider": "claude"})

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == USER_KEY
    assert cfg.provider == "openai"   # 用存起來那一層的供應商，不是標頭說的


def test_provider_header_without_key_and_nothing_stored_still_returns_400(
    client, auth_header, mock_llm, no_env_fallback
):
    """沒有任何憑證可用時，錯誤行為與改版前一模一樣（400 + missing_api_key）。"""
    headers, _ = auth_header

    resp = _chat(client, {**headers, "X-LLM-Provider": "claude"})

    assert resp.status_code == 400, resp.text
    assert "claude" in resp.json()["detail"]


def test_local_provider_header_without_key_still_uses_the_header(
    client, auth_header, mock_llm, no_env_fallback
):
    """回歸防護：本地端點（Ollama/LM Studio）本來就不需要金鑰，
    這條 Electron 既有路徑不可以被新的解析順序改掉。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY)

    resp = _chat(client, {
        **headers,
        "X-LLM-Provider": "local",
        "X-LLM-Model": "llama3",
        "X-LLM-Base-Url": "http://localhost:11434/v1",
    })

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.provider == "local"
    assert cfg.base_url == "http://localhost:11434/v1"
    assert cfg.api_key != USER_KEY


# --- 一組設定必須同源（金鑰外洩防線） -------------------------------------------

def test_header_base_url_is_never_attached_to_the_server_default_key(
    client, auth_header, mock_llm, no_env_fallback
):
    """攻擊情境：使用者塞一個 X-LLM-Base-Url 指向自己的伺服器，但不帶金鑰，
    想騙後端把「伺服器預設金鑰」送到那個網址去。解析必須整組換成伺服器那層，
    base_url 一起換掉，絕不可只採用標頭的 base_url。"""
    headers, _ = auth_header
    _store_credential(None, "openai", SERVER_KEY, base_url="https://api.openai.com/v1")

    resp = _chat(client, {
        **headers,
        "X-LLM-Provider": "openai",
        "X-LLM-Base-Url": "https://attacker.example.com/v1",
    })

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == SERVER_KEY
    assert cfg.base_url == "https://api.openai.com/v1"
    assert "attacker.example.com" not in (cfg.base_url or "")


def test_header_model_is_never_mixed_into_a_stored_credential(
    client, auth_header, mock_llm, no_env_fallback
):
    """同源原則不只 base_url：連 model 都必須來自被選中的那一層。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY, model="stored-model")

    resp = _chat(client, {**headers, "X-LLM-Provider": "openai", "X-LLM-Model": "header-model"})

    assert resp.status_code == 200, resp.text
    assert mock_llm.calls[-1]["cfg"].model == "stored-model"


def test_user_base_url_is_never_attached_to_the_server_default_key(
    client, auth_header, mock_llm, no_env_fallback
):
    """使用者存了自己的 base_url，但那組憑證解不開（SECRET_KEY 輪換）時，
    降級到伺服器預設**不可以**沿用使用者的 base_url。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY, base_url="https://user-endpoint.example.com/v1")
    _store_credential(None, "grok", SERVER_KEY, base_url="https://api.x.ai/v1")

    # 把使用者那一列的密文換成解不開的內容（模擬 SECRET_KEY 輪換後的舊密文）
    db = SessionLocal()
    try:
        row = crud.get_user_llm_credential(db, user_id)
        row.api_key_enc = "gAAAAABmangled-not-a-valid-token"
        db.commit()
    finally:
        db.close()

    resp = _chat(client, headers)

    assert resp.status_code == 200, resp.text
    cfg = mock_llm.calls[-1]["cfg"]
    assert cfg.api_key == SERVER_KEY
    assert cfg.base_url == "https://api.x.ai/v1"
    assert "user-endpoint" not in (cfg.base_url or "")


# --- 解密失敗 → 降級，不是 500 --------------------------------------------------

def test_undecryptable_credential_degrades_to_no_credential(
    client, auth_header, mock_llm, no_env_fallback
):
    """SECRET_KEY 輪換後舊密文解不開：視為「沒有這組憑證」，
    最終回既有的 503（AI 不可用），不是 500、也不是每次請求都爆炸。"""
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY)

    db = SessionLocal()
    try:
        crud.get_user_llm_credential(db, user_id).api_key_enc = "totally-not-a-fernet-token"
        db.commit()
    finally:
        db.close()

    first = _chat(client, headers)
    second = _chat(client, headers)   # 連續兩次都要是同樣乾淨的失敗，不是崩潰迴圈

    assert first.status_code == 503, first.text
    assert second.status_code == 503, second.text


# --- 鐵律：session 不得跨 llm.chat ----------------------------------------------

ALL_LLM_CONSUMERS = [
    ("POST", "/chat/", {"message": "測試"}),
    ("POST", "/chat/enhanced/", {"message": "測試"}),
    ("POST", "/chat/checkin/", None),
    ("POST", "/chat/end/", {}),
    ("POST", "/generate", {}),
    ("GET", "/analytics/emotion/{user_id}", None),
    ("POST", "/enhanced-generate", {}),
    ("POST", "/interaction-notes/update", {}),
]


def _call_consumer(client, headers, method, path, body, user_id):
    path = path.format(user_id=user_id)
    if method == "GET":
        return client.get(path, headers=headers)
    return client.post(path, json=body, headers=headers) if body is not None else client.post(path, headers=headers)


def _prepare_consumer_preconditions(user_id):
    """讓八個端點「這次真的會呼叫模型」的前置條件。

    - 沒有對話記錄時 generate_enhanced_diary 直接回固定草稿、不呼叫模型
      (/generate 會整個跳過 LLM)
    - /analytics/emotion 沒有日記就直接回傳
    - /chat/checkin/ 今天已問候過就回 checkin:false
    """
    from memory_manager import append_chat_messages

    append_chat_messages(str(user_id), [
        {"role": "user", "content": "今天上班有點累"},
        {"role": "assistant", "content": "聽起來今天很不容易。"},
    ])

    db = SessionLocal()
    try:
        crud.create_diary(db, user_id=user_id, content="今天還可以。", valence=0.5, arousal=0.5)
        user = crud.get_user(db, user_id)
        user.last_checkin_date = None
        db.commit()
    finally:
        db.close()


class _CheckoutTracker:
    """追蹤「這次請求期間新借出、而且到現在都還沒還回去」的連線數。

    為什麼不直接讀 `engine.pool.checkedout()`：那是整個行程的全域計數，
    會被背景執行緒污染 —— crud.create_diary 會丟一個背景執行緒去做語意
    索引 (services.memory_retrieval.schedule_index_diary)，它自己也會開
    session。實測整套測試一起跑時，這個背景寫入偶爾正好落在探針取樣的
    瞬間，讓斷言變成擲骰子。

    改成掛 pool 的 checkout/checkin 事件、記錄「還在外面」的連線集合，
    再以請求開始前的快照做差集：請求開始前就已經在外面的連線 (別的測試
    留下的背景工作) 被排除，只算這次請求自己造成的。連線歸還可能發生在
    別的執行緒 (垃圾回收)，所以用集合而不是計數器 —— 加減不會錯配。
    """

    def __init__(self, target_engine):
        self._engine = target_engine
        self._outstanding = set()

    def _on_checkout(self, dbapi_connection, connection_record, connection_proxy):
        self._outstanding.add(connection_record)

    def _on_checkin(self, dbapi_connection, connection_record):
        self._outstanding.discard(connection_record)

    def __enter__(self):
        event.listen(self._engine, "checkout", self._on_checkout)
        event.listen(self._engine, "checkin", self._on_checkin)
        return self

    def __exit__(self, *exc_info):
        event.remove(self._engine, "checkout", self._on_checkout)
        event.remove(self._engine, "checkin", self._on_checkin)
        return False

    def snapshot(self):
        return set(self._outstanding)

    def new_since(self, baseline_snapshot):
        return len(self._outstanding - baseline_snapshot)


@pytest.mark.parametrize("method,path,body", ALL_LLM_CONSUMERS)
def test_no_extra_db_connection_is_held_during_the_llm_call(
    client, auth_header, mock_llm, no_env_fallback, monkeypatch, method, path, body
):
    """八個 LLM 端點逐一驗證：改用資料庫憑證之後，llm.chat 進行中還握著的
    連線數不可以比「走標頭那條路（deps 完全不碰資料庫）」還多。

    這是差分斷言而不是「必須為 0」：目前的基線是 1，來自 get_current_user
    依賴的 get_db —— FastAPI 的 yield 依賴會活到整個請求結束，這是本任務
    之前就存在的行為 (見 task-1.6 報告的「鐵律逐一驗證」段)。這裡要釘死的
    是「get_llm_config 自己開的那個 session 有沒有在回傳前關掉」。
    """
    from services import memory_retrieval

    # 背景語意索引執行緒會自己開 session，讓量測變成擲骰子；本測試不需要它
    monkeypatch.setattr(memory_retrieval, "schedule_index_diary", lambda *a, **k: None)

    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY)

    observed = []

    with _CheckoutTracker(engine) as tracker:
        before = {"snapshot": tracker.snapshot()}

        def probe(messages, cfg=None):
            observed.append(tracker.new_since(before["snapshot"]))
            return "模擬回覆"

        for _ in range(4):   # 有些端點一次請求會呼叫模型兩次
            mock_llm.respond(probe)

        # 基線：走標頭那層，get_llm_config 根本不會碰資料庫
        _prepare_consumer_preconditions(user_id)
        before["snapshot"] = tracker.snapshot()
        baseline_resp = _call_consumer(
            client, {**headers, **LLM_HEADERS}, method, path, body, user_id)
        assert baseline_resp.status_code == 200, baseline_resp.text
        assert observed, f"{path} 這次請求沒有真的呼叫到 llm.chat，這個測試就沒有意義"
        baseline = max(observed)

        observed.clear()
        for _ in range(4):
            mock_llm.respond(probe)

        # 走資料庫憑證那層（deps 會開一個 session 讀憑證）
        _prepare_consumer_preconditions(user_id)
        before["snapshot"] = tracker.snapshot()
        stored_resp = _call_consumer(client, headers, method, path, body, user_id)
        assert stored_resp.status_code == 200, stored_resp.text
        assert observed, f"{path} 走憑證路徑時沒有呼叫到 llm.chat"

    assert max(observed) == baseline, (
        f"{path}: 走資料庫憑證時 llm.chat 期間多握著連線 "
        f"({max(observed)} > {baseline}) —— get_llm_config 的 session 沒關掉"
    )
    assert baseline <= 1, f"{path}: 基線就已經握著 {baseline} 條連線"


# --- 端點：GET /users/me/llm ----------------------------------------------------

def test_get_llm_status_requires_authentication(client):
    assert client.get("/users/me/llm").status_code == 401


def test_get_llm_status_with_nothing_configured(client, auth_header, no_env_fallback):
    headers, _ = auth_header

    body = client.get("/users/me/llm", headers=headers).json()

    assert body["configured"] is False
    assert body["source"] is None
    assert body["provider"] is None
    assert body["user_credential"] is None


def test_get_llm_status_reports_server_default(client, auth_header, no_env_fallback):
    headers, _ = auth_header
    _store_credential(None, "grok", SERVER_KEY, model="grok-x")

    body = client.get("/users/me/llm", headers=headers).json()

    assert body["configured"] is True
    assert body["source"] == "server"
    assert body["provider"] == "grok"
    assert body["model"] == "grok-x"
    assert body["user_credential"] is None


def test_get_llm_status_reports_env_fallback(client, auth_header, env_fallback):
    headers, _ = auth_header

    body = client.get("/users/me/llm", headers=headers).json()

    assert body["configured"] is True
    assert body["source"] == "env"
    assert body["provider"] == "grok"


def test_get_llm_status_masks_the_key_to_last_four_only(client, auth_header, no_env_fallback):
    headers, user_id = auth_header
    _store_credential(user_id, "openai", USER_KEY)

    resp = client.get("/users/me/llm", headers=headers)
    body = resp.json()

    assert body["source"] == "user"
    assert body["key_masked"].endswith(USER_KEY[-4:])
    assert USER_KEY not in resp.text
    assert USER_KEY[:-4] not in resp.text
    assert body["user_credential"]["provider"] == "openai"
    assert body["user_credential"]["key_masked"] == body["key_masked"]
    assert "api_key" not in body["user_credential"]
    assert "api_key_enc" not in resp.text


def test_get_llm_status_never_leaks_another_users_key(client, auth_header, other_auth_header, no_env_fallback):
    headers_a, user_a = auth_header
    headers_b, _ = other_auth_header
    _store_credential(user_a, "openai", USER_KEY)

    resp = client.get("/users/me/llm", headers=headers_b)

    assert USER_KEY not in resp.text
    assert resp.json()["user_credential"] is None


# --- 端點：PUT /users/me/llm ----------------------------------------------------

def test_put_requires_authentication(client):
    resp = client.put("/users/me/llm", json={"provider": "openai", "api_key": USER_KEY})
    assert resp.status_code == 401


def test_put_stores_the_key_encrypted_and_never_echoes_it(client, auth_header, no_env_fallback):
    headers, user_id = auth_header

    resp = client.put("/users/me/llm", headers=headers,
                      json={"provider": "openai", "api_key": USER_KEY, "model": "gpt-test"})

    assert resp.status_code == 200, resp.text
    assert USER_KEY not in resp.text
    assert resp.json()["source"] == "user"
    assert resp.json()["key_masked"].endswith(USER_KEY[-4:])

    rows = _rows(user_id)
    assert len(rows) == 1
    assert USER_KEY not in rows[0].api_key_enc      # 資料庫裡是密文
    assert rows[0].provider == "openai"
    assert rows[0].model == "gpt-test"


def test_put_then_the_stored_key_is_actually_used_for_chat(client, auth_header, mock_llm, no_env_fallback):
    headers, _ = auth_header
    client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": USER_KEY})

    resp = _chat(client, headers)

    assert resp.status_code == 200, resp.text
    assert mock_llm.calls[-1]["cfg"].api_key == USER_KEY


def test_put_replaces_any_existing_credential(client, auth_header, no_env_fallback):
    """一個使用者只保留一組憑證：換供應商時舊的那組要消失，
    不可以留下兩列讓解析順序變得無法預測。"""
    headers, user_id = auth_header
    client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": USER_KEY})
    client.put("/users/me/llm", headers=headers, json={"provider": "claude", "api_key": "sk-second-key-5555"})

    rows = _rows(user_id)
    assert len(rows) == 1
    assert rows[0].provider == "claude"


def test_put_rejects_unknown_provider_bilingually(client, auth_header):
    headers, user_id = auth_header

    zh = client.put("/users/me/llm", headers=headers,
                    json={"provider": "definitely-not-a-provider", "api_key": USER_KEY})
    en = client.put("/users/me/llm", headers={**headers, "X-Language": "en"},
                    json={"provider": "definitely-not-a-provider", "api_key": USER_KEY})

    assert zh.status_code == 400, zh.text
    assert en.status_code == 400, en.text
    assert zh.json()["detail"] != en.json()["detail"]
    assert _rows(user_id) == []


def test_put_rejects_empty_api_key(client, auth_header):
    headers, user_id = auth_header

    resp = client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": "   "})

    assert resp.status_code == 400, resp.text
    assert _rows(user_id) == []


def test_put_local_provider_requires_base_url_and_model(client, auth_header):
    headers, user_id = auth_header

    missing_base_url = client.put("/users/me/llm", headers=headers,
                                  json={"provider": "local", "api_key": "", "model": "llama3"})
    assert missing_base_url.status_code == 400, missing_base_url.text

    missing_model = client.put("/users/me/llm", headers=headers,
                               json={"provider": "local", "api_key": "",
                                     "base_url": "http://localhost:11434/v1"})
    assert missing_model.status_code == 400, missing_model.text
    assert _rows(user_id) == []


def test_put_local_provider_accepts_empty_key_with_base_url_and_model(client, auth_header):
    headers, user_id = auth_header

    resp = client.put("/users/me/llm", headers=headers,
                      json={"provider": "local", "api_key": "",
                            "base_url": "http://localhost:11434/v1", "model": "llama3"})

    assert resp.status_code == 200, resp.text
    assert len(_rows(user_id)) == 1


def test_put_does_not_touch_the_server_default_row(client, auth_header, no_env_fallback):
    headers, _ = auth_header
    _store_credential(None, "grok", SERVER_KEY)

    client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": USER_KEY})

    server_rows = _rows(None)
    assert len(server_rows) == 1
    assert server_rows[0].provider == "grok"


def test_put_by_one_user_does_not_affect_another(client, auth_header, other_auth_header, no_env_fallback):
    headers_a, user_a = auth_header
    headers_b, user_b = other_auth_header

    client.put("/users/me/llm", headers=headers_a, json={"provider": "openai", "api_key": USER_KEY})

    assert _rows(user_b) == []
    assert len(_rows(user_a)) == 1


# --- 端點：DELETE /users/me/llm -------------------------------------------------

def test_delete_removes_the_user_credential_and_falls_back(client, auth_header, mock_llm, no_env_fallback):
    headers, user_id = auth_header
    _store_credential(None, "grok", SERVER_KEY)
    client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": USER_KEY})

    resp = client.delete("/users/me/llm", headers=headers)

    assert resp.status_code == 200, resp.text
    assert _rows(user_id) == []
    assert resp.json()["source"] == "server"

    chat_resp = _chat(client, headers)
    assert chat_resp.status_code == 200
    assert mock_llm.calls[-1]["cfg"].api_key == SERVER_KEY


def test_delete_is_idempotent(client, auth_header, no_env_fallback):
    headers, _ = auth_header
    assert client.delete("/users/me/llm", headers=headers).status_code == 200
    assert client.delete("/users/me/llm", headers=headers).status_code == 200


def test_delete_requires_authentication(client):
    assert client.delete("/users/me/llm").status_code == 401


def test_delete_never_removes_the_server_default(client, auth_header, no_env_fallback):
    headers, _ = auth_header
    _store_credential(None, "grok", SERVER_KEY)

    client.delete("/users/me/llm", headers=headers)

    assert len(_rows(None)) == 1


# --- 明文金鑰不得出現在任何回應（含錯誤路徑） -----------------------------------

def test_no_endpoint_response_ever_contains_a_stored_plaintext_key(
    client, auth_header, mock_llm, no_env_fallback
):
    headers, user_id = auth_header
    _store_credential(None, "grok", SERVER_KEY)
    client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": USER_KEY})

    responses = [
        client.get("/users/me/llm", headers=headers),
        client.put("/users/me/llm", headers=headers,
                   json={"provider": "openai", "api_key": USER_KEY}),
        # 錯誤路徑一：未知供應商
        client.put("/users/me/llm", headers=headers,
                   json={"provider": "nope", "api_key": USER_KEY}),
        # 錯誤路徑二：空金鑰
        client.put("/users/me/llm", headers=headers, json={"provider": "openai", "api_key": ""}),
        # 錯誤路徑三：模型呼叫失敗 → 503 的錯誤訊息會夾帶供應商錯誤字串
        None,
        client.delete("/users/me/llm", headers=headers),
    ]

    mock_llm.fail()
    responses[4] = _chat(client, headers)

    for resp in responses:
        assert USER_KEY not in resp.text, f"{resp.request.url} 的回應含有明文金鑰"
        assert SERVER_KEY not in resp.text, f"{resp.request.url} 的回應含有伺服器明文金鑰"


def test_pydantic_validation_error_does_not_echo_the_submitted_key(client, auth_header):
    """欄位長度驗證失敗走的是 FastAPI 的 422 路徑，不是我們自己的 400。

    Pydantic v2 的 error dict 裡本來就帶著 `input`（也就是使用者送上來的
    那串金鑰）；這裡能安全，是因為 middleware/exception_handlers 的驗證
    處理器只挑 loc/msg/type 三個欄位。這個測試把那件事釘住 —— 哪天有人
    「順手」把整個 error dict 原封不動回傳，就會在這裡變紅。
    """
    headers, _ = auth_header
    too_long_key = "sk-" + "z" * 600

    resp = client.put("/users/me/llm", headers=headers,
                      json={"provider": "openai", "api_key": too_long_key})

    assert resp.status_code == 422, resp.text
    assert too_long_key not in resp.text
    assert "z" * 40 not in resp.text
