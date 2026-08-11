from database import SessionLocal
from sqlalchemy.orm import Session
from fastapi import Depends, Header
from fastapi.security import OAuth2PasswordBearer
from typing import Optional

from database.models import User
from providers.base import LLMConfig
from utils.security import decode_token, TokenData
from utils.api_exceptions import BadRequestError, UnauthorizedError
from utils.error_codes import ErrorCode
from utils.messages import msg
import database.crud as crud

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="users/token")

def get_db():
    """
    數據庫會話依賴項，用於注入到路由函數中
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_language(
    x_language: Optional[str] = Header(None, description="介面/對話語言: zh-TW 或 en"),
) -> str:
    """讀取 X-Language 標頭並正規化 (預設 zh-TW)。

    決定提示詞語言 (prompts/{lang}/)、危機資源與使用者可見錯誤訊息的語言。
    """
    from services.prompt_loader import normalize_lang
    return normalize_lang(x_language)


async def get_current_token_data(
    token: str = Depends(oauth2_scheme),
    lang: str = Depends(get_language),
) -> TokenData:
    """驗證 Bearer 訪問令牌並回傳其聲明 (含工作階段參照 sid)。

    decode_token 只接受 type=access 的令牌 —— 刷新令牌走不到這裡。
    需要知道「請求來自哪個工作階段」的端點 (logout / 裝置清單) 依賴這個
    而不是 get_current_user。
    """
    token_data = decode_token(token)
    if token_data is None:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("invalid_token", lang),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return token_data


async def get_current_user(
    token_data: TokenData = Depends(get_current_token_data),
    db: Session = Depends(get_db),
    lang: str = Depends(get_language),
):
    """
    獲取當前認證用戶的依賴項
    """
    user = crud.get_user(db, user_id=token_data.user_id)
    if user is None:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("invalid_token", lang),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_memory_prefs(
    x_memory_semantic: Optional[str] = Header(None, description="語意記憶檢索開關: 1/0"),
) -> bool:
    """讀取 X-Memory-Semantic 標頭 (語意檢索選配，預設關)。

    開啟且 fastembed 可用時，記憶檢索走「關鍵字+語意」雙軌；
    不可用時服務層自動降級純關鍵字，不報錯。
    """
    return (x_memory_semantic or "").strip().lower() in ("1", "true", "yes")


async def get_llm_config(
    x_llm_provider: Optional[str] = Header(None, description="LLM 供應商: claude/openai/grok/gemini/local"),
    x_llm_model: Optional[str] = Header(None, description="模型名稱（未填用供應商預設）"),
    x_llm_api_key: Optional[str] = Header(None, description="該供應商的 API Key（僅存在於請求範圍）"),
    x_llm_base_url: Optional[str] = Header(None, description="自訂端點 Base URL（local/自架用）"),
    x_language: Optional[str] = Header(None, description="錯誤訊息語言"),
    current_user: User = Depends(get_current_user),
) -> Optional[LLMConfig]:
    """解析本次請求要用的 LLM 設定 (v2.3 task 1.6：雙軌金鑰儲存)。

    順序固定為：

        1. X-LLM-Api-Key 標頭 —— Electron 桌面版把金鑰放在系統金鑰鏈，
           解密後隨請求送來；這一層完全不碰資料庫，桌面版行為與改版前相同。
        2. 使用者存在伺服器上的憑證 —— 手機瀏覽器沒有 safeStorage 可用
           (js/secure_store.js 在非 Electron 環境會拋錯)，金鑰改存資料庫。
        3. 伺服器預設憑證 (llm_credentials.user_id IS NULL) —— 家人零設定即可用。
        4. .env 的 XAI_API_KEY Grok 後備 (回 None 讓 llm.default_config 接手)。
        5. 都沒有 → 與改版前完全相同的 400 / 503。

    **每一層都是一組完整設定**：provider / model / api_key / base_url 一律
    同源，絕不把某層的金鑰配上另一層的 base_url —— 那等於讓任何登入者
    塞一個 X-LLM-Base-Url 就能把伺服器預設金鑰送去自己的伺服器。

    **金鑰的落地位置**：標頭來的金鑰仍然只活在本次請求的 LLMConfig 裡；
    存在資料庫的那兩層是 Fernet 密文 (utils/key_vault)，解密後同樣只活在
    這個 LLMConfig 內。任何情況都不寫進日誌。

    **鐵律 (database.db_session 的說明)**：查資料庫的 session 由
    llm_credential_service 自己開、讀完立刻關，回傳純資料快照。這個依賴項
    絕不可以宣告 `db: Session = Depends(get_db)` —— FastAPI 的 yield 依賴
    會活到整個請求結束，那就等於在等模型回應的數十秒內一直釘著一條連線。
    """
    provider = (x_llm_provider or "").strip().lower()

    # 1. 標頭層：本地端點通常免金鑰，所以「provider=local」也算這一層
    #    (不這樣寫的話，Electron 既有的 Ollama/LM Studio 設定會被往下踢，
    #    改用資料庫憑證——那是行為回歸)。
    if provider and (x_llm_api_key or provider == "local"):
        return LLMConfig(
            provider=provider,
            model=(x_llm_model or "").strip(),
            api_key=x_llm_api_key or "",
            base_url=(x_llm_base_url or "").strip() or None,
        )

    # 2 & 3. 資料庫層 (短 session，函式回傳前已關閉)
    from services.llm_credential_service import resolve_stored_config
    stored_config, _source = resolve_stored_config(current_user.id)
    if stored_config is not None:
        return stored_config

    # 5. 帶了供應商卻沒有任何金鑰可用：維持改版前那句明確的 400
    if provider:
        from services.prompt_loader import normalize_lang
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("missing_api_key", normalize_lang(x_language), provider=x_llm_provider)
        )

    # 4. 回 None → llm.resolve_config 走 .env Grok 後備 (沒設就拋 LLMError → 503)
    return None