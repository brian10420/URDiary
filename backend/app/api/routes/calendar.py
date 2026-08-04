"""行事曆事件 API：新增 / 區間查詢 (展開重複規則) / 更新 / 刪除。

所有端點皆為單一使用者的私有資料，所有權規則比照 diary.py 的
get_diary：不是自己的事件一律回 404，不對外洩漏「事件是否存在」。
"""
from datetime import date
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db, get_language
from api.schemas import CalendarEventCreate, CalendarEventUpdate
from database import crud, db_session
from database.models import User
from services.calendar_service import expand_occurrences, snapshot_event
from utils.api_exceptions import BadRequestError, NotFoundError
from utils.error_codes import ErrorCode
from utils.logger import api_logger
from utils.messages import msg

router = APIRouter()

# GET /calendar/events 查詢區間上限 (天)；超過視為濫用/前端誤用，直接拒絕
MAX_RANGE_DAYS = 62


def _serialize_event(event) -> Dict[str, Any]:
    return {
        "event_id": event.id,
        "title": event.title,
        "note": event.note,
        "category": event.category,
        "event_date": event.event_date.isoformat(),
        "event_time": event.event_time,
        "recurrence": event.recurrence,
        "recurrence_until": event.recurrence_until.isoformat() if event.recurrence_until else None,
        "reminder_minutes": event.reminder_minutes,
        "created_at": event.created_at.isoformat(),
        "updated_at": event.updated_at.isoformat(),
    }


@router.post("/events", response_model=Dict[str, Any],
            summary="新增行事曆事件",
            description="建立一筆行事曆事件 (支援分類、重複規則與提醒分鐘數)")
def create_event(payload: CalendarEventCreate,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user),
                 lang: str = Depends(get_language)):
    """新增行事曆事件 (擁有者為目前登入者，身分由 token 導出)"""
    api_logger.info(f"新增行事曆事件: user_id={current_user.id}, title={payload.title!r}")

    event = crud.create_calendar_event(
        db, current_user.id, payload.title, payload.event_date,
        note=payload.note,
        category=payload.category,
        event_time=payload.event_time,
        recurrence=payload.recurrence,
        recurrence_until=payload.recurrence_until,
        reminder_minutes=payload.reminder_minutes,
    )

    return {"message": msg("event_created", lang), "event": _serialize_event(event)}


@router.get("/events", response_model=Dict[str, Any],
           summary="查詢行事曆事件 (展開重複規則)",
           description="查詢 [start, end] 區間內的行事曆事件 occurrences，跨度上限 62 天")
def list_events(start: date, end: date,
                current_user: User = Depends(get_current_user),
                lang: str = Depends(get_language)):
    """查詢區間內的 occurrences (僅限本人的事件)

    先讀資料、關閉 session，才在 session 外做 expand_occurrences 的展開運算
    (比照 services.calendar_service.build_calendar_context 的守讀→關→處理紀律，
    不必要地占用 DB 連線)。
    """
    if start > end or (end - start).days > MAX_RANGE_DAYS:
        api_logger.warning(f"行事曆查詢區間無效: start={start}, end={end}, user_id={current_user.id}")
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("invalid_date_range", lang)
        )

    with db_session() as db:
        raw_events = crud.get_calendar_events(db, current_user.id, start, end)
        events = [snapshot_event(ev) for ev in raw_events]

    occurrences = expand_occurrences(events, start, end)

    return {"start": start.isoformat(), "end": end.isoformat(), "occurrences": occurrences}


@router.put("/events/{event_id}", response_model=Dict[str, Any],
           summary="更新行事曆事件",
           description="更新自己的行事曆事件欄位 (至少一個欄位有值)")
def update_event(event_id: int, payload: CalendarEventUpdate,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user),
                 lang: str = Depends(get_language)):
    """更新行事曆事件 (僅限本人的事件；不是自己的一律回 404，不洩漏存在性)"""
    existing = crud.get_calendar_event(db, event_id)
    if not existing or existing.user_id != current_user.id:
        api_logger.warning(f"行事曆事件不存在或無權更新: event_id={event_id}, token_user={current_user.id}")
        raise NotFoundError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            detail=msg("event_not_found", lang)
        )

    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    if not update_data:
        api_logger.warning(f"未提供任何更新數據: event_id={event_id}")
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("no_update_data", lang)
        )

    event = crud.update_calendar_event(db, event_id, **update_data)

    return {"message": msg("event_updated", lang), "event": _serialize_event(event)}


@router.delete("/events/{event_id}", response_model=Dict[str, str],
              summary="刪除行事曆事件",
              description="刪除自己的行事曆事件")
def delete_event(event_id: int, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user),
                 lang: str = Depends(get_language)):
    """刪除行事曆事件 (僅限本人的事件；不是自己的一律回 404，不洩漏存在性)"""
    existing = crud.get_calendar_event(db, event_id)
    if not existing or existing.user_id != current_user.id:
        api_logger.warning(f"行事曆事件不存在或無權刪除: event_id={event_id}, token_user={current_user.id}")
        raise NotFoundError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            detail=msg("event_not_found", lang)
        )

    crud.delete_calendar_event(db, event_id)

    return {"message": msg("event_deleted", lang)}
