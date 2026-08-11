"""LLM 憑證的解析與管理 (v2.3 task 1.6：雙軌金鑰儲存)。

**為什麼需要這一層**：Electron 桌面版把金鑰放在系統金鑰鏈、每次請求用
X-LLM-* 標頭送來，手機瀏覽器沒有 safeStorage 可用 (js/secure_store.js
在非 Electron 環境會拋錯)，所以那些使用者需要一個「存在伺服器上」的地方。
再加上「家人零設定就能用」的需求 → 伺服器預設憑證 (user_id IS NULL)。

**解析順序** (api/deps.get_llm_config 呼叫這裡的 resolve_stored_config)：

    1. X-LLM-Api-Key 標頭（Electron 本機，最高優先，不碰資料庫）
    2. 使用者自己存的憑證
    3. 伺服器預設憑證
    4. .env 的 XAI_API_KEY（既有的 Grok 後備）
    5. 與改版前完全相同的 400 / 503

**每一層都是一組完整設定**：provider / model / api_key / base_url 必須
同源。混用是真實的金鑰外洩路徑——若採用「標頭的 base_url + 伺服器預設的
金鑰」，任何登入者只要塞一個 X-LLM-Base-Url 指向自己的伺服器，就能把
伺服器的金鑰騙出來。所以這裡一律整組回傳，呼叫端也不得再拼裝。

**鐵律**：這個模組自己用 `db_session()` 開短交易，讀完立刻關閉，回傳的
是純資料快照 (dataclass) 而不是 ORM 物件——絕不把 session 或 detached
ORM 物件交給呼叫端，session 才不會活過後續的 llm.chat 呼叫。
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Tuple

import config
from database import crud, db_session
from providers.base import LLMConfig
from providers.factory import KNOWN_PROVIDERS
from utils.key_vault import decrypt_secret, encrypt_secret, mask_secret

# 解析來源標記（GET /users/me/llm 的 source 欄位）
SOURCE_USER = "user"
SOURCE_SERVER = "server"
SOURCE_ENV = "env"


@dataclass(frozen=True)
class CredentialSnapshot:
    """一列憑證的純資料快照 (session 關閉後仍可安全使用)。"""
    provider: str
    api_key_enc: str
    base_url: Optional[str]
    model: Optional[str]
    updated_at: Optional[datetime]


def _snapshot(row) -> Optional[CredentialSnapshot]:
    if row is None:
        return None
    return CredentialSnapshot(
        provider=row.provider,
        api_key_enc=row.api_key_enc,
        base_url=row.base_url,
        model=row.model,
        updated_at=row.updated_at,
    )


def _load_snapshots(user_id: int) -> Tuple[Optional[CredentialSnapshot], Optional[CredentialSnapshot]]:
    """在**單一短 session** 內把兩列憑證都讀出來，回傳前 session 已關閉。

    即使使用者有自己的憑證也一併讀伺服器預設：使用者那列可能解不開
    (SECRET_KEY 輪換)，此時要能立刻降級到下一層，不能為此再開一次 session。
    """
    with db_session() as db:
        user_snapshot = _snapshot(crud.get_user_llm_credential(db, user_id))
        server_snapshot = _snapshot(crud.get_server_llm_credential(db))
    return user_snapshot, server_snapshot


def _to_config(snapshot: Optional[CredentialSnapshot]) -> Optional[LLMConfig]:
    """快照 → LLMConfig；解密失敗一律回 None（呼叫端當成「沒有這組憑證」）。"""
    if snapshot is None:
        return None
    api_key = decrypt_secret(snapshot.api_key_enc)
    if api_key is None:
        return None
    return LLMConfig(
        provider=snapshot.provider,
        model=snapshot.model or "",
        api_key=api_key,
        base_url=snapshot.base_url,
    )


def resolve_stored_config(user_id: int) -> Tuple[Optional[LLMConfig], Optional[str]]:
    """解析「資料庫層」的兩層憑證：使用者 → 伺服器預設。

    回傳 (設定, 來源)；兩層都沒有 (或都解不開) 時回 (None, None)，
    由呼叫端接手 .env 後備與既有的錯誤行為。
    """
    user_snapshot, server_snapshot = _load_snapshots(user_id)

    for snapshot, source in ((user_snapshot, SOURCE_USER), (server_snapshot, SOURCE_SERVER)):
        cfg = _to_config(snapshot)
        if cfg is not None:
            return cfg, source
    return None, None


# --- 狀態描述 (GET /users/me/llm、CLI show-server-key) --------------------------

def _describe(snapshot: CredentialSnapshot, api_key: str) -> dict:
    """一列憑證的可公開描述。**永遠不含明文金鑰，也不含密文。**"""
    return {
        "provider": snapshot.provider,
        "model": snapshot.model,
        "base_url": snapshot.base_url,
        "key_masked": mask_secret(api_key),
        "updated_at": snapshot.updated_at.isoformat() if snapshot.updated_at else None,
    }


def describe_for_user(user_id: int) -> dict:
    """這個使用者「不帶任何 X-LLM-* 標頭時」實際會用到的設定。

    最外層是生效中的那一層 (user / server / env / 都沒有)；另外附上
    user_credential —— 使用者自己存的那組 (沒有則 None)，讓設定面板能
    區分「我有自己的金鑰」與「我在用伺服器共用的」。

    env 那層讀 `config.XAI_API_KEY` 模組屬性 (呼叫當下讀)。注意 llm.py 是
    `from config import XAI_API_KEY`，值綁在該模組 import 當下——正常執行
    兩者一致，測試要模擬「沒有 .env 後備」時兩邊都要蓋掉。
    """
    user_snapshot, server_snapshot = _load_snapshots(user_id)

    user_key = decrypt_secret(user_snapshot.api_key_enc) if user_snapshot else None
    server_key = decrypt_secret(server_snapshot.api_key_enc) if server_snapshot else None

    user_block = _describe(user_snapshot, user_key) if user_key is not None else None

    if user_key is not None:
        effective, source = _describe(user_snapshot, user_key), SOURCE_USER
    elif server_key is not None:
        effective, source = _describe(server_snapshot, server_key), SOURCE_SERVER
    elif config.XAI_API_KEY:
        effective, source = {
            "provider": "grok",
            "model": config.FALLBACK_GROK_MODEL,
            # base_url 不落地在設定裡：factory 會補上 Grok 官方端點
            "base_url": None,
            "key_masked": mask_secret(config.XAI_API_KEY),
            "updated_at": None,
        }, SOURCE_ENV
    else:
        effective, source = {
            "provider": None, "model": None, "base_url": None,
            "key_masked": "", "updated_at": None,
        }, None

    return {
        "configured": source is not None,
        "source": source,
        **effective,
        "user_credential": user_block,
    }


def describe_server_credential() -> Optional[dict]:
    """伺服器預設憑證的狀態 (CLI show-server-key 用)；沒有設定時回 None。

    解不開時仍回一個描述 (key_masked 為空字串)，好讓管理者看得出
    「有一列存在但解不開」——那正是 SECRET_KEY 被輪換過的徵兆。
    """
    with db_session() as db:
        snapshot = _snapshot(crud.get_server_llm_credential(db))
    if snapshot is None:
        return None
    api_key = decrypt_secret(snapshot.api_key_enc)
    described = _describe(snapshot, api_key or "")
    described["decryptable"] = api_key is not None
    return described


# --- 寫入 / 刪除 ----------------------------------------------------------------

def is_known_provider(provider: str) -> bool:
    return (provider or "").strip().lower() in KNOWN_PROVIDERS


def store_credential(user_id: Optional[int], provider: str, api_key: str,
                     base_url: Optional[str] = None, model: Optional[str] = None) -> dict:
    """加密後寫入 (user_id=None 即伺服器預設)，回傳可公開的描述。

    呼叫端負責先驗證 provider 與必填欄位 (見 api/routes/user.py 與
    scripts/urdiary_admin.py)——那裡才有使用者語言可以回訊息。
    """
    with db_session() as db:
        row = crud.set_llm_credential(
            db,
            user_id=user_id,
            provider=(provider or "").strip().lower(),
            api_key_enc=encrypt_secret(api_key or ""),
            base_url=(base_url or "").strip() or None,
            model=(model or "").strip() or None,
        )
        described = _describe(_snapshot(row), api_key or "")
    return described


def delete_user_credential(user_id: int) -> int:
    """刪除該使用者的憑證 (回傳刪掉幾列；冪等)。永遠不會動到伺服器預設。"""
    with db_session() as db:
        return crud.delete_llm_credentials(db, user_id=user_id)
