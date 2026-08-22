"""記憶管理端點 (v2.5 Spec C)：/users/me/memory 路由組。

治理邏輯全部在 services/memory_review (自管短交易)；本層只做驗證、
錯誤碼對映與 i18n 訊息。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.deps import get_db, get_current_user, get_language
from database import crud
from database.models import User
from services import memory_files
from services import memory_review
from utils.api_exceptions import NotFoundError
from utils.error_codes import ErrorCode
from utils.messages import msg

router = APIRouter()


class MemoryFileIn(BaseModel):
    content: str = Field(max_length=4000)  # 粗防呆；真正上限由 memory_files 判定


class MemorySettingsIn(BaseModel):
    write_mode: str = Field(pattern="^(auto|approval)$")


@router.get("", response_model=dict, summary="記憶總覽")
def get_memory(current_user: User = Depends(get_current_user)):
    return memory_review.get_memory_overview(current_user.id)


@router.put("/files/{file_key}", response_model=dict, summary="全文編輯記憶檔")
def put_memory_file(file_key: str, body: MemoryFileIn,
                    current_user: User = Depends(get_current_user),
                    lang: str = Depends(get_language)):
    if file_key not in memory_files.FILE_KEYS:
        raise NotFoundError(error_code=ErrorCode.RESOURCE_NOT_FOUND,
                            detail=msg("memory_file_not_found", lang))
    result = memory_review.save_user_edit(current_user.id, file_key, body.content)
    if not result["ok"]:
        raise HTTPException(status_code=422, detail=msg(
            "memory_file_too_long", lang, limit=memory_files.FILE_LIMITS[file_key]))
    return result


@router.put("/settings", response_model=dict, summary="記憶治理模式")
def put_memory_settings(body: MemorySettingsIn,
                        current_user: User = Depends(get_current_user)):
    return memory_review.set_write_mode(current_user.id, body.write_mode)


@router.get("/ops", response_model=dict, summary="記憶帳本")
def list_memory_ops(limit: int = 100, offset: int = 0,
                    db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    ops = crud.get_memory_ops(db, current_user.id, limit=min(limit, 200), offset=offset)
    diary_ids = {o.source_diary_id for o in ops if o.source_diary_id}
    titles = {}
    for diary_id in diary_ids:
        diary = crud.get_diary(db, diary_id)
        if diary and diary.user_id == current_user.id:
            titles[diary_id] = diary.title
    return {"ops": [{
        "id": o.id, "file_key": o.file_key, "batch_id": o.batch_id,
        "action": o.action, "section": o.section,
        "target_text": o.target_text, "new_text": o.new_text,
        "status": o.status, "source": o.source,
        "source_diary_id": o.source_diary_id,
        "source_diary_title": titles.get(o.source_diary_id),
        "error": o.error,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "decided_at": o.decided_at.isoformat() if o.decided_at else None,
    } for o in ops]}


_OP_ACTIONS = {
    "approve": memory_review.approve_op,
    "reject": memory_review.reject_op,
    "undo": memory_review.undo_op,
}


@router.post("/ops/{op_id}/{action}", response_model=dict, summary="單筆帳本操作")
def act_on_op(op_id: int, action: str,
              current_user: User = Depends(get_current_user),
              lang: str = Depends(get_language)):
    handler = _OP_ACTIONS.get(action)
    if handler is None:
        raise NotFoundError(error_code=ErrorCode.RESOURCE_NOT_FOUND, detail="unknown action")
    result = handler(current_user.id, op_id)
    if result["ok"]:
        return result
    if result.get("error") == "not_found":
        raise NotFoundError(error_code=ErrorCode.RESOURCE_NOT_FOUND,
                            detail=msg("memory_op_not_found", lang))
    if result.get("status") == "stale":
        return result  # 核可時發現過期：200 回報狀態，前端渲染「已失效」
    raise HTTPException(status_code=409, detail=msg(
        "memory_op_conflict", lang, reason=result.get("error") or "conflict"))


@router.post("/batches/{batch_id}/{action}", response_model=dict, summary="批次帳本操作")
def act_on_batch(batch_id: str, action: str,
                 current_user: User = Depends(get_current_user)):
    if action == "approve":
        return memory_review.approve_batch(current_user.id, batch_id)
    if action == "reject":
        return memory_review.reject_batch(current_user.id, batch_id)
    raise NotFoundError(error_code=ErrorCode.RESOURCE_NOT_FOUND, detail="unknown action")
