"""pytest 共用設定與 fixtures。

匯入順序是這份檔案最關鍵的部分：`config.py` 在 **import 時**就會讀取
`URDIARY_DATA_DIR` 環境變數並 mkdir、產生/讀取 `data/secrets.json`。
若任何 app 模組 (database/services/main…) 搶在這段程式碼之前被 import，
測試就會意外把資料寫進 repo 的 `data/` 目錄，汙染真實日記資料庫。

因此：env 變數與 sys.path 設定必須是這個檔案「第一批」執行的程式碼，
且早於任何 `import pytest` 之後的 app 匯入。conftest.py 保證先於所有
測試模組被 pytest 載入，這個順序才有意義。
"""
import os
import sys
import tempfile
from pathlib import Path

# --- 任何 app 模組 import 之前：先隔離資料目錄、設好匯入路徑 -----------------
_TMP_DATA = tempfile.mkdtemp(prefix="urdiary-test-data-")
os.environ["URDIARY_DATA_DIR"] = _TMP_DATA
# 開放註冊 (conftest._create_and_login 等) 是絕大多數認證測試的前提；明確關閉
# 而不是依賴 config.py 自己的預設值，這樣未來就算那個預設值改了，測試套件也
# 不會被意外打斷。要測「旗標開啟」行為的測試自行對 config 模組屬性 monkeypatch
# (見 tests/test_invite_codes.py)。
os.environ["URDIARY_REQUIRE_INVITE"] = "0"

APP_DIR = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))

import random
import string

import pytest


# --- 共用常數 -----------------------------------------------------------------

# LLM 標頭：假值即可，llm.chat 一律被 mock_llm 攔截，不會真的打網路。
# 注意：測試絕不設 X-Memory-Semantic，讓 fastembed 語意軌保持冷。
LLM_HEADERS = {"X-LLM-Provider": "claude", "X-LLM-Api-Key": "sk-test"}

# 測試帳號共用密碼，需符合 utils/password_validator 的強度規則
# (長度>=8、大寫、小寫、數字、特殊字元)。
TEST_PASSWORD = "Test1234!x"


# --- TestClient (session-scope：startup 會生排程 daemon thread，整個 session 只建一次) --

@pytest.fixture(scope="session")
def client():
    """啟動一份 FastAPI TestClient，整個測試 session 共用同一個。

    `main` 延遲到 fixture 內才 import：此時 URDIARY_DATA_DIR 與 sys.path
    都已就緒。用 context manager 形式包 TestClient 以觸發 startup event
    (Base.metadata.create_all + ensure_schema + schedule_cleanup)。
    """
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app) as c:
        yield c


# --- 認證輔助：每個測試各自造一個新帳號，避免互相污染 --------------------------

def _unique_username() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
    return f"testuser_{suffix}"


def _create_and_login(client, username: str):
    """建帳號 + 登入，回傳 (headers, user_id)。"""
    resp = client.post(
        "/users/create",
        json={"username": username, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 200, f"造測試用戶失敗: {resp.status_code} {resp.text}"
    user_id = resp.json()["user_id"]

    # OAuth2PasswordRequestForm 吃 form-urlencoded，不是 JSON
    login_resp = client.post(
        "/users/login",
        data={"username": username, "password": TEST_PASSWORD},
    )
    assert login_resp.status_code == 200, f"測試用戶登入失敗: {login_resp.status_code} {login_resp.text}"
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, user_id


@pytest.fixture
def auth_header(client):
    """建一個全新使用者並登入。回傳 (headers, user_id)。"""
    return _create_and_login(client, _unique_username())


@pytest.fixture
def other_auth_header(client):
    """第二個獨立使用者，供跨用戶權限 (403/404) 測試使用。"""
    return _create_and_login(client, _unique_username())


@pytest.fixture
def llm_headers():
    """`llm_headers` fixture 形式 (常數 LLM_HEADERS 的拷貝，避免測試互相污染)。"""
    return dict(LLM_HEADERS)


# --- mock_llm：monkeypatch `llm.chat`，所有服務層一律經 `import llm; llm.chat(...)` --
# --- 呼叫模型，patch 這一處就能攔截 interaction_service / diary_service /   --
# --- analytics_service / llm_compat.send_to_grok 的全部 LLM 呼叫。          --

class _LLMRecorder:
    """`llm.chat` 的替身：記錄每次呼叫，並可腳本化回覆或模擬失敗。"""

    def __init__(self):
        self.calls = []  # [{"messages": [...], "cfg": LLMConfig|None}, ...]
        self._queue = []
        self._fail_next = False
        self.default_reply = "這是一個無害的模擬回覆。"

    def respond(self, fn_or_str):
        """佇列一則回覆：字串直接回傳；callable 則以 (messages, cfg) 呼叫取值。

        依呼叫順序消耗 (FIFO)；佇列空了就回傳 default_reply。
        """
        self._queue.append(fn_or_str)

    def fail(self):
        """讓下一次呼叫拋出 providers.base.LLMError (一次性，用完重置)。"""
        self._fail_next = True

    def __call__(self, messages, cfg=None):
        self.calls.append({"messages": messages, "cfg": cfg})
        if self._fail_next:
            self._fail_next = False
            from providers.base import LLMError
            raise LLMError("mock_llm: 模擬供應商呼叫失敗")
        item = self._queue.pop(0) if self._queue else self.default_reply
        return item(messages, cfg) if callable(item) else item


@pytest.fixture
def mock_llm(monkeypatch):
    """monkeypatch `llm.chat`（單點攔截全部 LLM 呼叫路徑）。"""
    import llm as llm_module
    recorder = _LLMRecorder()
    monkeypatch.setattr(llm_module, "chat", recorder)
    return recorder
