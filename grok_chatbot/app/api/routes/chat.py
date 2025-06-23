from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from pydantic import BaseModel

from api.deps import get_db
from grok_client import send_to_grok, MODELS
from memory_manager import clear_chat_history
from services.diary_service import check_sensitive_content, get_support_message
from services.interaction_service import (
    enhanced_chat_with_context,
    generate_enhanced_diary,
    process_interaction_note_update
)
from database import SessionLocal, crud
from config import DEFAULT_MODEL

router = APIRouter()

class ChatInput(BaseModel):
    user_id: str
    message: str
    model: Optional[str] = None

class EnhancedChatInput(BaseModel):
    user_id: str  # Redis用的字符串ID
    numeric_user_id: int  # 數據庫用的數字ID
    message: str
    model: Optional[str] = None
    
class UserDiaryCreate(BaseModel):
    user_id: str
    numeric_user_id: int
    exclude_interaction_notes: bool = False  # 添加新參數，默認為False
    model: Optional[str] = None

@router.post("/", response_model=Dict[str, str],
           summary="發送聊天消息",
           description="發送聊天消息給AI並獲取回應")
def chat_with_ai(user_input: ChatInput):
    """對話 API，調用 Grok AI 進行回應"""
    user_id = user_input.user_id
    message = user_input.message
    # 使用指定模型或默認模型
    model = user_input.model or DEFAULT_MODEL
    
    # 檢查模型是否有效
    if model not in MODELS:
        model = DEFAULT_MODEL
        
    # 檢查敏感內容
    if check_sensitive_content(message):
        support_message = get_support_message()
        # 依然發送給 AI，但會附上關懷訊息
        ai_response = send_to_grok(user_id, message, model)
        return {"response": f"{ai_response}\n\n{support_message}", "model_used": model}
    
    # 正常對話
    response = send_to_grok(user_id, message, model)
    return {"response": response, "model_used": model}

@router.delete("/clear/",
             summary="清除聊天歷史",
             description="清除指定用戶的聊天歷史記錄")
def clear_chat(user_id: str):
    """清除使用者對話記錄"""
    clear_chat_history(user_id)
    return {"message": f"已清除 {user_id} 的對話記錄"}

@router.post("/enhanced/", response_model=Dict[str, str],
           summary="增強版聊天消息",
           description="使用互動筆記增強的AI對話體驗")
def enhanced_chat_with_ai(user_input: EnhancedChatInput):
    """使用互動筆記增強的對話API"""
    user_id = user_input.user_id
    numeric_user_id = user_input.numeric_user_id
    message = user_input.message
    # 使用指定模型或默認模型
    model = user_input.model or DEFAULT_MODEL
    
    # 檢查模型是否有效
    if model not in MODELS:
        model = DEFAULT_MODEL

    # 檢查敏感內容
    if check_sensitive_content(message):
        support_message = get_support_message()
        # 使用增強對話但附上關懷訊息
        ai_response = enhanced_chat_with_context(user_id, numeric_user_id, message, model)
        return {"response": f"{ai_response}\n\n{support_message}", "model_used": model}
    
    # 增強對話
    response = enhanced_chat_with_context(user_id, numeric_user_id, message, model)
    return {"response": response, "model_used": model}

@router.post("/end/", response_model=Dict[str, Any],
           summary="結束對話並生成摘要",
           description="結束當前對話，生成日記並更新互動筆記")
def end_chat_session(user_input: UserDiaryCreate):
    """結束當前對話，生成日記並更新互動筆記"""
    try:
        # 使用指定模型或默認模型
        model = user_input.model or DEFAULT_MODEL
        
        # 檢查模型是否有效
        if model not in MODELS:
            model = DEFAULT_MODEL
            
        # 1. 生成今日對話筆記
        diary_content, emotion_scores = generate_enhanced_diary(
            user_input.user_id, 
            user_input.numeric_user_id,
            user_input.exclude_interaction_notes,  # 傳遞參數
            model  # 傳遞模型參數
        )
        
        # 2. 保存日記到數據庫
        db = SessionLocal()
        try:
            # 生成日記標題
            from services.diary_service import generate_diary_title
            diary_title = generate_diary_title(diary_content)
            
            diary = crud.create_diary(
                db=db,
                user_id=user_input.numeric_user_id,
                title=diary_title,
                content=diary_content,
                valence=emotion_scores.get("valence"),
                arousal=emotion_scores.get("arousal")
            )
            
            # 3. 更新互動筆記
            note_result = process_interaction_note_update(
                user_input.user_id, 
                user_input.numeric_user_id,
                diary_content,
                model  # 傳遞模型參數
            )
            
            # 4. 清除 Redis 中的當前對話歷史
            clear_chat_history(user_input.user_id)
            
            return {
                "message": "對話已結束並生成摘要",
                "model_used": model,
                "diary": {
                    "diary_id": diary.id,
                    "content": diary.content,
                    "valence": diary.valence,
                    "arousal": diary.arousal,
                    "created_at": diary.created_at.isoformat()
                },
                "interaction_note": note_result
            }
        finally:
            db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"結束對話失敗: {str(e)}") 