from fastapi import APIRouter, Depends
from typing import Dict, Any, Optional
from pydantic import BaseModel

import llm
from api.deps import get_current_user, get_llm_config, get_memory_prefs, get_language
from api.schemas import UserDiaryCreate
from middleware.rate_limit import enforce_llm_rate_limit
from utils.messages import msg
from database.models import User
from providers.base import LLMConfig, LLMError
from llm_compat import send_to_grok
from memory_manager import clear_chat_history
from services.diary_service import check_sensitive_content, get_support_message, run_end_of_chat_pipeline
from services.interaction_service import enhanced_chat_with_context, daily_checkin
from utils.api_exceptions import ServiceUnavailableError
from utils.error_codes import ErrorCode
from utils.logger import log_error

router = APIRouter()

# 身分一律由 JWT 導出（get_current_user），body 內的 user_id/numeric_user_id
# 僅為相容舊客戶端而保留欄位，伺服器端一律忽略
# 模型/供應商設定改由 X-LLM-* 標頭提供（deps.get_llm_config）；
# body 的 model 欄位僅為相容舊客戶端而保留，伺服器端一律忽略
class ChatInput(BaseModel):
    user_id: Optional[str] = None  # 已忽略，身分取自 token
    message: str
    model: Optional[str] = None  # 已忽略，模型取自 X-LLM-Model 標頭

class EnhancedChatInput(BaseModel):
    user_id: Optional[str] = None  # 已忽略，身分取自 token
    numeric_user_id: Optional[int] = None  # 已忽略，身分取自 token
    message: str
    model: Optional[str] = None  # 已忽略，模型取自 X-LLM-Model 標頭

# UserDiaryCreate 與 diary.py 共用，定義移至 api/schemas.py

@router.post("/", response_model=Dict[str, str],
           summary="發送聊天消息",
           description="發送聊天消息給AI並獲取回應")
def chat_with_ai(user_input: ChatInput,
                 current_user: User = Depends(get_current_user),
                 llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                 lang: str = Depends(get_language),
                 _rate_limit: None = Depends(enforce_llm_rate_limit)):
    """對話 API，調用所選的 LLM 供應商進行回應"""
    # 對話歷史鍵以 token 導出的使用者 id 命名，不信任 body
    user_id = str(current_user.id)
    message = user_input.message

    # 危機雙保險：級別>=1 在 system prompt 附危機模式讓模型正確回應；
    # 級別>=2 (急性語彙) 另在回覆後機械附上求助資源，不依賴模型自覺
    crisis_level = check_sensitive_content(message)

    try:
        # 補齊供應商設定（未帶標頭 → .env Grok 後備；缺金鑰在此就會給出明確錯誤）
        cfg = llm.resolve_config(llm_config)
        response = send_to_grok(user_id, message, cfg, crisis=crisis_level > 0, lang=lang)
    except LLMError as e:
        # 不可把錯誤字串當成 AI 回應回傳 (前端會存進本地歷史)，改回 503
        log_error(e, {"user_id": user_id, "action": "chat",
                      "provider": llm_config.provider if llm_config else "fallback"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("ai_unavailable", lang, error=e)
        )

    if crisis_level >= 2:
        return {"response": f"{response}\n\n{get_support_message(lang)}", "model_used": cfg.model}

    return {"response": response, "model_used": cfg.model}

@router.delete("/clear/",
             summary="清除聊天歷史",
             description="清除目前登入用戶自己的聊天歷史記錄")
def clear_chat(current_user: User = Depends(get_current_user)):
    """清除使用者對話記錄（只能清自己的）"""
    clear_chat_history(str(current_user.id))
    return {"message": f"已清除 {current_user.username} 的對話記錄"}

@router.post("/enhanced/", response_model=Dict[str, str],
           summary="增強版聊天消息",
           description="使用互動筆記增強的AI對話體驗")
def enhanced_chat_with_ai(user_input: EnhancedChatInput,
                          current_user: User = Depends(get_current_user),
                          llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                          memory_semantic: bool = Depends(get_memory_prefs),
                          lang: str = Depends(get_language),
                          _rate_limit: None = Depends(enforce_llm_rate_limit)):
    """使用互動筆記增強的對話API"""
    # 身分由 token 導出：對話歷史與 DB 查詢共用同一個 id
    user_id = str(current_user.id)
    numeric_user_id = current_user.id
    message = user_input.message

    # 危機雙保險：級別>=1 附危機模式提示；級別>=2 另機械附求助資源
    crisis_level = check_sensitive_content(message)

    try:
        cfg = llm.resolve_config(llm_config)
        response = enhanced_chat_with_context(user_id, numeric_user_id, message, cfg,
                                              semantic=memory_semantic,
                                              crisis=crisis_level > 0,
                                              lang=lang)
    except LLMError as e:
        log_error(e, {"user_id": user_id, "action": "enhanced_chat",
                      "provider": llm_config.provider if llm_config else "fallback"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("ai_unavailable", lang, error=e)
        )

    if crisis_level >= 2:
        return {"response": f"{response}\n\n{get_support_message(lang)}", "model_used": cfg.model}

    return {"response": response, "model_used": cfg.model}

@router.post("/checkin/", response_model=Dict[str, Any],
           summary="每日開場問候",
           description="今日首次開啟 App 時，由 AI 主動生成個人化問候（依昨日日記與時段）")
def daily_checkin_route(current_user: User = Depends(get_current_user),
                        llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                        lang: str = Depends(get_language),
                        _rate_limit: None = Depends(enforce_llm_rate_limit)):
    """每日 check-in：今日已問候過或 LLM 不可用時回 checkin:false（不報錯）。

    開場問候失敗不值得一個錯誤彈窗——全新安裝尚未設定金鑰時，
    首開體驗必須保持乾淨，由前端顯示靜態歡迎詞即可。
    """
    user_id = str(current_user.id)

    try:
        cfg = llm.resolve_config(llm_config)
        greeting = daily_checkin(user_id, current_user.id, cfg, lang=lang)
    except LLMError as e:
        log_error(e, {"user_id": user_id, "action": "daily_checkin"})
        return {"checkin": False}

    if greeting is None:
        return {"checkin": False}

    return {"checkin": True, "message": greeting, "model_used": cfg.model}


@router.post("/end/", response_model=Dict[str, Any],
           summary="結束對話並生成摘要",
           description="結束當前對話，生成日記並更新互動筆記")
def end_chat_session(user_input: UserDiaryCreate,
                     current_user: User = Depends(get_current_user),
                     llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                     lang: str = Depends(get_language),
                     _rate_limit: None = Depends(enforce_llm_rate_limit)):
    """結束當前對話，生成日記並更新互動筆記"""
    # 身分由 token 導出，不信任 body
    user_id = str(current_user.id)
    numeric_user_id = current_user.id

    # 補齊供應商設定（缺金鑰時在任何 LLM 呼叫前就給出明確錯誤，對話記錄不受影響）
    try:
        cfg = llm.resolve_config(llm_config)
    except LLMError as e:
        log_error(e, {"user_id": user_id, "action": "end_chat_resolve_llm"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("ai_unavailable", lang, error=e)
        )
    model = cfg.model

    # 生成日記 → 短交易存檔 → 更新互動筆記 (與 /diary/enhanced-generate 共用管線)。
    # 失敗時直接回 503 —— 絕不可把 "Error: ..." 當成日記內容寫進資料庫，
    # 也不清除對話歷史，讓使用者可以重試。
    try:
        result = run_end_of_chat_pipeline(
            user_id,
            numeric_user_id,
            user_input.exclude_interaction_notes,
            cfg,
            lang=lang,
            enable_day_note=user_input.enable_day_note,
        )
    except LLMError as e:
        log_error(e, {"user_id": user_id, "action": "end_chat_generate_diary"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("diary_failed_retry", lang, error=e)
        )

    # 清除目前對話歷史 (SQLite chat_messages 表；日記已安全存檔) —— /chat/end/ 特有尾段
    clear_chat_history(user_id)

    return {
        "message": "對話已結束並生成摘要" if result["interaction_note_error"] is None else "日記已生成，但互動筆記更新失敗",
        "model_used": model,
        "diary": result["diary"],
        "interaction_note": result["interaction_note"],
        "interaction_note_error": result["interaction_note_error"],
    }