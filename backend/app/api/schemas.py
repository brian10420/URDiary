"""共用的請求 schema (Pydantic model)。

chat.py 與 diary.py 原本各自宣告一份幾乎相同的 UserDiaryCreate，合併到
這裡供兩個 router 共用。行事曆的 CalendarEventCreate/Update 目前只有
calendar.py 一個 router 使用，仍放在這裡集中管理 request schema。
"""
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, Field


class UserDiaryCreate(BaseModel):
    """`/chat/end/`、`/diary/generate`、`/diary/enhanced-generate`、
    `/diary/interaction-notes/update` 共用的請求 body。

    身分一律由 JWT 導出 (見各路由的 get_current_user 依賴)，user_id/
    numeric_user_id/model 這幾個欄位僅為相容舊客戶端而保留，伺服器端
    一律忽略。
    """
    user_id: Optional[str] = None  # 已忽略，身分取自 token
    numeric_user_id: Optional[int] = None  # 已忽略，身分取自 token
    exclude_interaction_notes: bool = False
    model: Optional[str] = None  # 已忽略，模型取自 X-LLM-Model 標頭


# 行事曆分類/重複規則的合法值；與 services.calendar_service.CATEGORIES /
# RECURRENCES 對應 (schema 端獨立列出以取得 Pydantic/OpenAPI 的列舉驗證與文件)。
_CalendarCategory = Literal["work", "study", "health", "family", "anniversary", "other"]
_CalendarRecurrence = Literal["none", "daily", "weekly", "monthly", "yearly"]
_EVENT_TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


class CalendarEventCreate(BaseModel):
    """POST /calendar/events 的請求 body。"""
    title: str = Field(min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=2000)
    category: _CalendarCategory = "other"
    event_date: date
    event_time: Optional[str] = Field(default=None, pattern=_EVENT_TIME_PATTERN)
    recurrence: _CalendarRecurrence = "none"
    recurrence_until: Optional[date] = None
    reminder_minutes: Optional[int] = Field(default=None, ge=0, le=10080)


class CalendarEventUpdate(BaseModel):
    """PUT /calendar/events/{event_id} 的請求 body：全部 Optional。

    至少要有一個欄位有值，否則路由層回 400 (比照 diary PUT 的
    no_update_data 慣例；未設值的欄位一律代表「維持原值」，因此無法用
    這個 schema 把某欄位明確清成 None，跟現行 diary PUT 是同一種限制)。
    """
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=2000)
    category: Optional[_CalendarCategory] = None
    event_date: Optional[date] = None
    event_time: Optional[str] = Field(default=None, pattern=_EVENT_TIME_PATTERN)
    recurrence: Optional[_CalendarRecurrence] = None
    recurrence_until: Optional[date] = None
    reminder_minutes: Optional[int] = Field(default=None, ge=0, le=10080)
