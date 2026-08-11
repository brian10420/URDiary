from database import SessionLocal
from sqlalchemy.orm import Session
from fastapi import Depends, Header
from fastapi.security import OAuth2PasswordBearer
from typing import Optional

from providers.base import LLMConfig
from utils.security import decode_token
from utils.api_exceptions import BadRequestError, UnauthorizedError
from utils.error_codes import ErrorCode
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

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    獲取當前認證用戶的依賴項
    """
    credentials_exception = UnauthorizedError(
        error_code=ErrorCode.UNAUTHORIZED,
        detail="無法驗證憑證",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # 解碼令牌
    token_data = decode_token(token)
    if token_data is None:
        raise credentials_exception

    # 獲取用戶
    user = crud.get_user(db, user_id=token_data.user_id)
    if user is None:
        raise credentials_exception

    return user


async def get_language(
    x_language: Optional[str] = Header(None, description="介面/對話語言: zh-TW 或 en"),
) -> str:
    """讀取 X-Language 標頭並正規化 (預設 zh-TW)。

    決定提示詞語言 (prompts/{lang}/)、危機資源與使用者可見錯誤訊息的語言。
    """
    from services.prompt_loader import normalize_lang
    return normalize_lang(x_language)


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
) -> Optional[LLMConfig]:
    """從 X-LLM-* 標頭讀取請求範圍的 LLM 設定。

    - 未帶 X-LLM-Provider 時回 None，服務層改用 .env 的 Grok 後備（llm.default_config）
    - 金鑰只存在於本次請求的 LLMConfig，不寫入資料庫、不落地、不記入日誌
    """
    if not x_llm_provider:
        return None

    provider = x_llm_provider.strip().lower()

    # 本地自架端點通常不驗金鑰，其餘供應商必須帶 Key
    if not x_llm_api_key and provider != "local":
        from services.prompt_loader import normalize_lang
        from utils.messages import msg
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("missing_api_key", normalize_lang(x_language), provider=x_llm_provider)
        )

    return LLMConfig(
        provider=provider,
        model=(x_llm_model or "").strip(),
        api_key=x_llm_api_key or "",
        base_url=(x_llm_base_url or "").strip() or None,
    )