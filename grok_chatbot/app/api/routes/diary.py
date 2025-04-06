from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional, List
from pydantic import BaseModel

from api.deps import get_db
from utils.api_exceptions import BadRequestError, NotFoundError, ServerError
from utils.error_codes import ErrorCode
from utils.logger import api_logger, log_error
from database import crud, SessionLocal
from services.diary_service import save_diary_for_user
from services.interaction_service import (
    generate_enhanced_diary,
    process_interaction_note_update,
    get_latest_interaction_note
)

router = APIRouter()

class UserDiaryCreate(BaseModel):
    user_id: str
    numeric_user_id: int
    exclude_interaction_notes: bool = False

class DiaryUpdate(BaseModel):
    content: Optional[str] = None
    valence: Optional[float] = None
    arousal: Optional[float] = None

@router.post("/generate", response_model=Dict[str, Any],
            summary="生成日記",
            description="根據用戶的對話歷史自動生成日記")
def generate_diary(user_input: UserDiaryCreate):
    """根據用戶的對話歷史自動生成日記"""
    api_logger.info(f"開始為用戶生成日記: {user_input.user_id}")
    
    try:
        diary = save_diary_for_user(user_input.user_id, user_input.numeric_user_id)
        api_logger.info(f"日記生成成功: user_id={user_input.user_id}")
        return {
            "message": "日記生成成功",
            "diary": diary
        }
    except Exception as e:
        log_error(e, {"user_id": user_input.user_id, "action": "generate_diary"})
        raise ServerError(
            error_code=ErrorCode.DIARY_CREATION_FAILED,
            detail=f"日記生成失敗: {str(e)}"
        )

@router.get("/diaries/{user_id}", response_model=Dict[str, Any],
           summary="獲取用戶日記列表",
           description="查詢某個用戶的日記列表，支持分頁")
def get_user_diaries(user_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """查詢某個 user 的日記列表"""
    api_logger.info(f"獲取用戶日記列表: user_id={user_id}, skip={skip}, limit={limit}")
    
    user = crud.get_user(db, user_id)
    if not user:
        api_logger.warning(f"用戶不存在: user_id={user_id}")
        raise NotFoundError(
            error_code=ErrorCode.USER_NOT_FOUND,
            detail="用戶不存在"
        )
        
    diaries = crud.get_user_diaries(db, user_id, skip, limit)
    
    results = []
    for d in diaries:
        results.append({
            "diary_id": d.id,
            "content": d.content,
            "valence": d.valence,
            "arousal": d.arousal,
            "diary_date": d.diary_date.isoformat(),
            "created_at": d.created_at.isoformat()
        })
    
    api_logger.info(f"成功獲取日記列表: user_id={user_id}, count={len(results)}")
    return {"user_id": user_id, "diaries": results}

@router.get("/{diary_id}", response_model=Dict[str, Any],
          summary="獲取日記詳情",
          description="獲取特定日記的詳細內容")
def get_diary(diary_id: int, db: Session = Depends(get_db)):
    """獲取特定日記內容"""
    api_logger.info(f"獲取日記詳情: diary_id={diary_id}")
    
    diary = crud.get_diary(db, diary_id)
    if not diary:
        api_logger.warning(f"日記不存在: diary_id={diary_id}")
        raise NotFoundError(
            error_code=ErrorCode.DIARY_NOT_FOUND,
            detail="日記不存在"
        )
        
    api_logger.info(f"成功獲取日記: diary_id={diary_id}")
    return {
        "diary_id": diary.id,
        "user_id": diary.user_id,
        "content": diary.content,
        "valence": diary.valence,
        "arousal": diary.arousal,
        "diary_date": diary.diary_date.isoformat(),
        "created_at": diary.created_at.isoformat()
    }

@router.put("/{diary_id}", response_model=Dict[str, Any],
          summary="更新日記",
          description="更新指定日記的內容或情緒評分")
def update_diary(diary_id: int, diary_update: DiaryUpdate, db: Session = Depends(get_db)):
    """更新日記內容"""
    api_logger.info(f"更新日記: diary_id={diary_id}")
    
    # 檢查日記是否存在
    existing_diary = crud.get_diary(db, diary_id)
    if not existing_diary:
        api_logger.warning(f"日記不存在: diary_id={diary_id}")
        raise NotFoundError(
            error_code=ErrorCode.DIARY_NOT_FOUND,
            detail="日記不存在"
        )
    
    # 執行更新
    update_data = {k: v for k, v in diary_update.dict().items() if v is not None}
    
    if not update_data:
        api_logger.warning(f"未提供任何更新數據: diary_id={diary_id}")
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail="未提供任何更新數據"
        )
    
    try:
        diary = crud.update_diary(db, diary_id, **update_data)
        
        api_logger.info(f"日記更新成功: diary_id={diary_id}")
        return {
            "message": "日記更新成功",
            "diary": {
                "diary_id": diary.id,
                "content": diary.content,
                "valence": diary.valence,
                "arousal": diary.arousal,
                "updated_at": diary.created_at.isoformat()
            }
        }
    except Exception as e:
        log_error(e, {"diary_id": diary_id, "action": "update_diary"})
        raise ServerError(
            error_code=ErrorCode.DIARY_UPDATE_FAILED,
            detail=f"日記更新失敗: {str(e)}"
        )

@router.delete("/{diary_id}", response_model=Dict[str, str],
             summary="刪除日記",
             description="刪除指定的日記")
def delete_diary(diary_id: int, db: Session = Depends(get_db)):
    """删除日記"""
    api_logger.info(f"刪除日記: diary_id={diary_id}")
    
    try:
        success = crud.delete_diary(db, diary_id)
        if not success:
            api_logger.warning(f"日記不存在: diary_id={diary_id}")
            raise NotFoundError(
                error_code=ErrorCode.DIARY_NOT_FOUND,
                detail="日記不存在"
            )
            
        api_logger.info(f"日記刪除成功: diary_id={diary_id}")
        return {"message": "日記刪除成功"}
    except NotFoundError:
        raise
    except Exception as e:
        log_error(e, {"diary_id": diary_id, "action": "delete_diary"})
        raise ServerError(
            error_code=ErrorCode.DIARY_DELETE_FAILED,
            detail=f"日記刪除失敗: {str(e)}"
        )

@router.post("/enhanced-generate", response_model=Dict[str, Any],
            summary="增強版日記生成",
            description="使用互動筆記增強的日記生成功能")
def generate_enhanced_diary_api(user_input: UserDiaryCreate):
    """使用互動筆記增強的日記生成"""
    api_logger.info(f"開始生成增強版日記: user_id={user_input.user_id}")
    
    try:
        # 使用增強版日記生成
        diary_content, emotion_scores = generate_enhanced_diary(
            user_input.user_id, 
            user_input.numeric_user_id,
            user_input.exclude_interaction_notes
        )
        
        # 保存到數據庫
        db = SessionLocal()
        try:
            diary = crud.create_diary(
                db=db,
                user_id=user_input.numeric_user_id,
                content=diary_content,
                valence=emotion_scores.get("valence"),
                arousal=emotion_scores.get("arousal")
            )
            
            # 更新互動筆記
            note_result = process_interaction_note_update(
                user_input.user_id, 
                user_input.numeric_user_id,
                diary_content
            )
            
            api_logger.info(f"增強版日記生成成功: user_id={user_input.user_id}, diary_id={diary.id}")
            return {
                "message": "增強版日記生成成功",
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
        log_error(e, {"user_id": user_input.user_id, "action": "enhanced_diary_generate"})
        raise ServerError(
            error_code=ErrorCode.DIARY_CREATION_FAILED,
            detail=f"增強版日記生成失敗: {str(e)}"
        )

@router.get("/interaction-notes/{user_id}", response_model=Dict[str, Any],
          summary="獲取互動筆記",
          description="獲取用戶最新的互動筆記")
def get_interaction_note(user_id: int, db: Session = Depends(get_db)):
    """獲取最新的互動筆記"""
    api_logger.info(f"獲取互動筆記: user_id={user_id}")
    
    user = crud.get_user(db, user_id)
    if not user:
        api_logger.warning(f"用戶不存在: user_id={user_id}")
        raise NotFoundError(
            error_code=ErrorCode.USER_NOT_FOUND,
            detail="用戶不存在"
        )
        
    note = get_latest_interaction_note(db, user_id)
    if not note:
        api_logger.warning(f"尚未有互動筆記: user_id={user_id}")
        raise NotFoundError(
            error_code=ErrorCode.NOTE_NOT_FOUND,
            detail="尚未有互動筆記"
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
def update_interaction_notes(user_input: UserDiaryCreate):
    """根據今日日記更新互動筆記"""
    api_logger.info(f"開始更新互動筆記: user_id={user_input.user_id}")
    
    try:
        # 先生成今日日記
        diary_result = save_diary_for_user(user_input.user_id, user_input.numeric_user_id)
        
        # 基於今日日記更新互動筆記
        note_result = process_interaction_note_update(
            user_input.user_id, 
            user_input.numeric_user_id,
            diary_result["content"]
        )
        
        api_logger.info(f"互動筆記更新成功: user_id={user_input.user_id}")
        return {
            "message": "互動筆記更新成功",
            "diary": diary_result,
            "interaction_note": note_result
        }
    except Exception as e:
        log_error(e, {"user_id": user_input.user_id, "action": "update_interaction_notes"})
        raise ServerError(
            error_code=ErrorCode.NOTE_UPDATE_FAILED,
            detail=f"互動筆記更新失敗: {str(e)}"
        ) 