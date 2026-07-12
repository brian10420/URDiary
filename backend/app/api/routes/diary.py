from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional, List
from pydantic import BaseModel

from api.deps import get_db, get_current_user, get_llm_config, get_language
from database.models import User
from utils.messages import msg
from providers.base import LLMConfig, LLMError
from utils.api_exceptions import BadRequestError, ForbiddenError, NotFoundError, ServerError, ServiceUnavailableError
from utils.error_codes import ErrorCode
from utils.logger import api_logger, log_error
from database import crud, SessionLocal
from services.diary_service import save_diary_for_user
from services.interaction_service import (
    generate_enhanced_diary,
    process_interaction_note_update,
    get_latest_interaction_note
)
from services.analytics_service import analyze_emotion_trends

router = APIRouter()

# 身分一律由 JWT 導出（get_current_user），body 內的 user_id/numeric_user_id
# 僅為相容舊客戶端而保留欄位，伺服器端一律忽略
class UserDiaryCreate(BaseModel):
    user_id: Optional[str] = None  # 已忽略，身分取自 token
    numeric_user_id: Optional[int] = None  # 已忽略，身分取自 token
    exclude_interaction_notes: bool = False

class DiaryUpdate(BaseModel):
    content: Optional[str] = None
    title: Optional[str] = None
    valence: Optional[float] = None
    arousal: Optional[float] = None

@router.post("/generate", response_model=Dict[str, Any],
            summary="生成日記",
            description="根據用戶的對話歷史自動生成日記")
def generate_diary(user_input: UserDiaryCreate,
                   current_user: User = Depends(get_current_user),
                   llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                   lang: str = Depends(get_language)):
    """根據用戶的對話歷史自動生成日記"""
    # 身分由 token 導出，不信任 body
    user_id = str(current_user.id)
    api_logger.info(f"開始為用戶生成日記: {user_id}")

    try:
        diary = save_diary_for_user(user_id, current_user.id, llm_config, lang=lang)
        api_logger.info(f"日記生成成功: user_id={user_id}")
        return {
            "message": "日記生成成功",
            "diary": diary
        }
    except LLMError as e:
        # AI 服務失敗 —— 回 503 而非把錯誤訊息存成日記內容
        log_error(e, {"user_id": user_id, "action": "generate_diary"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("diary_not_generated", lang, error=e)
        )
    except Exception as e:
        log_error(e, {"user_id": user_id, "action": "generate_diary"})
        raise ServerError(
            error_code=ErrorCode.DIARY_CREATION_FAILED,
            detail=msg("diary_create_failed", lang, error=str(e))
        )

@router.get("/diaries/{user_id}", response_model=Dict[str, Any],
           summary="獲取用戶日記列表",
           description="查詢某個用戶的日記列表，支持分頁")
def get_user_diaries(user_id: int, skip: int = 0, limit: int = 100,
                     db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user),
                     lang: str = Depends(get_language)):
    """查詢某個 user 的日記列表（僅限本人）"""
    api_logger.info(f"獲取用戶日記列表: user_id={user_id}, skip={skip}, limit={limit}")

    if user_id != current_user.id:
        api_logger.warning(f"拒絕跨用戶存取日記列表: token_user={current_user.id}, requested={user_id}")
        raise ForbiddenError(
            error_code=ErrorCode.FORBIDDEN,
            detail=msg("forbidden_diaries", lang)
        )

    diaries = crud.get_user_diaries(db, user_id, skip, limit)
    
    results = []
    for d in diaries:
        results.append({
            "diary_id": d.id,
            "title": d.title,
            "summary": d.summary,
            "content": d.content,
            "valence": d.valence,
            "arousal": d.arousal,
            "diary_date": d.diary_date.isoformat(),
            "created_at": d.created_at.isoformat()
        })
    
    api_logger.info(f"成功獲取日記列表: user_id={user_id}, count={len(results)}")
    return {"user_id": user_id, "diaries": results}

@router.get("/diary/{diary_id}", response_model=Dict[str, Any],
          summary="獲取日記詳情",
          description="獲取特定日記的詳細內容")
def get_diary(diary_id: int, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user),
              lang: str = Depends(get_language)):
    """獲取特定日記內容（僅限本人的日記）"""
    api_logger.info(f"獲取日記詳情: diary_id={diary_id}")

    diary = crud.get_diary(db, diary_id)
    # 不是自己的日記一律回 404，不洩漏日記是否存在
    if not diary or diary.user_id != current_user.id:
        api_logger.warning(f"日記不存在或無權存取: diary_id={diary_id}, token_user={current_user.id}")
        raise NotFoundError(
            error_code=ErrorCode.DIARY_NOT_FOUND,
            detail=msg("diary_not_found", lang)
        )

    api_logger.info(f"成功獲取日記: diary_id={diary_id}")
    return {
        "diary_id": diary.id,
        "user_id": diary.user_id,
        "title": diary.title,
        "summary": diary.summary,
        "content": diary.content,
        "valence": diary.valence,
        "arousal": diary.arousal,
        "diary_date": diary.diary_date.isoformat(),
        "created_at": diary.created_at.isoformat()
    }

@router.get("/analytics/emotion/{user_id}", response_model=Dict[str, Any],
          summary="獲取情緒分析數據",
          description="分析用戶日記中的情緒變化趨勢")
def get_emotion_analytics(user_id: int, time_range: str = "month",
                          current_user: User = Depends(get_current_user),
                          llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                          lang: str = Depends(get_language)):
    """獲取用戶情緒分析數據（僅限本人）"""
    if user_id != current_user.id:
        api_logger.warning(f"拒絕跨用戶存取情緒分析: token_user={current_user.id}, requested={user_id}")
        raise ForbiddenError(
            error_code=ErrorCode.FORBIDDEN,
            detail=msg("forbidden_analytics", lang)
        )

    api_logger.info(f"獲取情緒分析: user_id={user_id}, time_range={time_range}")

    try:
        result = analyze_emotion_trends(user_id, time_range, llm_config, lang=lang)
        return result
    except LLMError as e:
        log_error(e, {"user_id": user_id, "time_range": time_range, "action": "emotion_analytics"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("analytics_unavailable", lang, error=e)
        )
    except Exception as e:
        log_error(e, {"user_id": user_id, "time_range": time_range, "action": "emotion_analytics"})
        raise ServerError(
            error_code=ErrorCode.OPERATION_FAILED,
            detail=msg("analytics_failed", lang, error=str(e))
        )
    
@router.put("/diary/{diary_id}", response_model=Dict[str, Any],
          summary="更新日記",
          description="更新指定日記的內容或情緒評分")
def update_diary(diary_id: int, diary_update: DiaryUpdate, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user),
                 lang: str = Depends(get_language)):
    """更新日記內容（僅限本人的日記）"""
    api_logger.info(f"更新日記: diary_id={diary_id}")

    # 檢查日記是否存在且屬於目前登入者（不是自己的一律回 404，不洩漏存在性）
    existing_diary = crud.get_diary(db, diary_id)
    if not existing_diary or existing_diary.user_id != current_user.id:
        api_logger.warning(f"日記不存在或無權更新: diary_id={diary_id}, token_user={current_user.id}")
        raise NotFoundError(
            error_code=ErrorCode.DIARY_NOT_FOUND,
            detail=msg("diary_not_found", lang)
        )

    # 執行更新
    update_data = {k: v for k, v in diary_update.dict().items() if v is not None}

    if not update_data:
        api_logger.warning(f"未提供任何更新數據: diary_id={diary_id}")
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("no_update_data", lang)
        )
    
    try:
        diary = crud.update_diary(db, diary_id, **update_data)
        
        api_logger.info(f"日記更新成功: diary_id={diary_id}")
        return {
            "message": "日記更新成功",
            "diary": {
                "diary_id": diary.id,
                "title": diary.title,
                "summary": diary.summary,
                "content": diary.content,
                "valence": diary.valence,
                "arousal": diary.arousal,
                # Diary 模型沒有 updated_at 欄位，原本回傳 created_at 卻取名
                # updated_at，讓前端誤以為「最後編輯時間」有更新。據實回報。
                "diary_date": diary.diary_date.isoformat(),
                "created_at": diary.created_at.isoformat()
            }
        }
    except Exception as e:
        log_error(e, {"diary_id": diary_id, "action": "update_diary"})
        raise ServerError(
            error_code=ErrorCode.DIARY_UPDATE_FAILED,
            detail=msg("diary_update_failed", lang, error=str(e))
        )

@router.delete("/diary/{diary_id}", response_model=Dict[str, str],
             summary="刪除日記",
             description="刪除指定的日記")
def delete_diary(diary_id: int, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user),
                 lang: str = Depends(get_language)):
    """删除日記（僅限本人的日記）"""
    api_logger.info(f"刪除日記: diary_id={diary_id}")

    # 先驗證擁有權，再刪除（不是自己的一律回 404，不洩漏存在性）
    diary = crud.get_diary(db, diary_id)
    if not diary or diary.user_id != current_user.id:
        api_logger.warning(f"日記不存在或無權刪除: diary_id={diary_id}, token_user={current_user.id}")
        raise NotFoundError(
            error_code=ErrorCode.DIARY_NOT_FOUND,
            detail=msg("diary_not_found", lang)
        )

    try:
        crud.delete_diary(db, diary_id)
        api_logger.info(f"日記刪除成功: diary_id={diary_id}")
        return {"message": "日記刪除成功"}
    except NotFoundError:
        raise
    except Exception as e:
        log_error(e, {"diary_id": diary_id, "action": "delete_diary"})
        raise ServerError(
            error_code=ErrorCode.DIARY_DELETE_FAILED,
            detail=msg("diary_delete_failed", lang, error=str(e))
        )

@router.post("/enhanced-generate", response_model=Dict[str, Any],
            summary="增強版日記生成",
            description="使用互動筆記增強的日記生成功能")
def generate_enhanced_diary_api(user_input: UserDiaryCreate,
                                current_user: User = Depends(get_current_user),
                                llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                                lang: str = Depends(get_language)):
    """使用互動筆記增強的日記生成"""
    # 身分由 token 導出，不信任 body
    user_id = str(current_user.id)
    numeric_user_id = current_user.id
    api_logger.info(f"開始生成增強版日記: user_id={user_id}")

    try:
        # 使用增強版日記生成 (LLM 呼叫，期間不持有 DB 連線)
        draft = generate_enhanced_diary(
            user_id,
            numeric_user_id,
            user_input.exclude_interaction_notes,
            llm_config,
            lang=lang
        )
    except LLMError as e:
        log_error(e, {"user_id": user_id, "action": "enhanced_diary_generate"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("diary_not_generated", lang, error=e)
        )

    # 保存日記 (短交易；絕不可在持有 session 時做下面的互動筆記 LLM 呼叫)
    db = SessionLocal()
    try:
        diary = crud.create_diary(
            db=db,
            user_id=numeric_user_id,
            content=draft.content,
            valence=draft.valence,
            arousal=draft.arousal,
            title=draft.title,
            summary=draft.summary,
        )
        diary_payload = {
            "diary_id": diary.id,
            "title": diary.title,
            "summary": diary.summary,
            "content": diary.content,
            "valence": diary.valence,
            "arousal": diary.arousal,
            "created_at": diary.created_at.isoformat()
        }
    except Exception as e:
        db.rollback()
        log_error(e, {"user_id": user_id, "action": "enhanced_diary_generate"})
        raise ServerError(
            error_code=ErrorCode.DIARY_CREATION_FAILED,
            detail=msg("diary_create_failed", lang, error=str(e))
        )
    finally:
        db.close()

    # 更新互動筆記 (又一次 LLM 呼叫，自行管理連線)。
    # 日記此時已存檔成功，筆記失敗回報部分成功，與 /chat/end/ 語意一致。
    note_result = None
    note_error = None
    try:
        note_result = process_interaction_note_update(
            user_id,
            numeric_user_id,
            draft.content,
            llm_config,
            lang=lang
        )
    except LLMError as e:
        note_error = str(e)
        log_error(e, {"user_id": user_id, "action": "enhanced_diary_update_note"})

    api_logger.info(f"增強版日記生成成功: user_id={user_id}, diary_id={diary_payload['diary_id']}")
    return {
        "message": "增強版日記生成成功" if note_error is None else "日記已生成，但互動筆記更新失敗",
        "diary": diary_payload,
        "interaction_note": note_result,
        "interaction_note_error": note_error
    }

@router.get("/interaction-notes/{user_id}", response_model=Dict[str, Any],
          summary="獲取互動筆記",
          description="獲取用戶最新的互動筆記")
def get_interaction_note(user_id: int, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user),
                         lang: str = Depends(get_language)):
    """獲取最新的互動筆記（僅限本人）"""
    api_logger.info(f"獲取互動筆記: user_id={user_id}")

    if user_id != current_user.id:
        api_logger.warning(f"拒絕跨用戶存取互動筆記: token_user={current_user.id}, requested={user_id}")
        raise ForbiddenError(
            error_code=ErrorCode.FORBIDDEN,
            detail=msg("forbidden_notes", lang)
        )

    note = get_latest_interaction_note(db, user_id)
    if not note:
        api_logger.warning(f"尚未有互動筆記: user_id={user_id}")
        raise NotFoundError(
            error_code=ErrorCode.NOTE_NOT_FOUND,
            detail=msg("note_not_found", lang)
        )
        
    api_logger.info(f"成功獲取互動筆記: user_id={user_id}, note_id={note.id}")
    return {
        "note_id": note.id,
        "user_id": note.user_id,
        "content": note.content,
        "version": note.version,
        "updated_at": note.updated_at.isoformat(),
        "created_at": note.created_at.isoformat()
    }

@router.post("/interaction-notes/update", response_model=Dict[str, Any],
            summary="更新互動筆記",
            description="根據今日日記更新互動筆記")
def update_interaction_notes(user_input: UserDiaryCreate,
                             current_user: User = Depends(get_current_user),
                             llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                             lang: str = Depends(get_language)):
    """根據今日日記更新互動筆記"""
    # 身分由 token 導出，不信任 body
    user_id = str(current_user.id)
    numeric_user_id = current_user.id
    api_logger.info(f"開始更新互動筆記: user_id={user_id}")

    try:
        # 先生成今日日記
        diary_result = save_diary_for_user(user_id, numeric_user_id, llm_config, lang=lang)

        # 基於今日日記更新互動筆記
        note_result = process_interaction_note_update(
            user_id,
            numeric_user_id,
            diary_result["content"],
            llm_config,
            lang=lang
        )

        api_logger.info(f"互動筆記更新成功: user_id={user_id}")
        return {
            "message": "互動筆記更新成功",
            "diary": diary_result,
            "interaction_note": note_result
        }
    except LLMError as e:
        log_error(e, {"user_id": user_id, "action": "update_interaction_notes"})
        raise ServiceUnavailableError(
            error_code=ErrorCode.CHAT_SERVICE_UNAVAILABLE,
            detail=msg("note_unavailable", lang, error=e)
        )
    except Exception as e:
        log_error(e, {"user_id": user_id, "action": "update_interaction_notes"})
        raise ServerError(
            error_code=ErrorCode.NOTE_UPDATE_FAILED,
            detail=msg("note_update_failed", lang, error=str(e))
        )