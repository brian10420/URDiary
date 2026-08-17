"""共用的請求 schema (Pydantic model)。

chat.py 與 diary.py 原本各自宣告一份幾乎相同的 UserDiaryCreate，合併到
這裡供兩個 router 共用。行事曆的 CalendarEventCreate/Update 目前只有
calendar.py 一個 router 使用，仍放在這裡集中管理 request schema。
"""
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator


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
_CalendarCategory = Literal["work", "study", "health", "family", "anniversary", "travel", "other"]
_CalendarRecurrence = Literal["none", "daily", "weekly", "monthly", "yearly"]
_EVENT_TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"
_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


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
    end_date: Optional[date] = None
    color: Optional[str] = Field(default=None, pattern=_COLOR_PATTERN)

    @model_validator(mode="after")
    def _check_recurrence_until_not_before_event_date(self):
        """recurrence_until 早於 event_date 的事件，expand_occurrences 永遠展開不出
        任何 occurrence（起點就在查詢範圍能到達之前）——等於悄悄建立一筆使用者永遠
        看不到的事件。event_date 是必填欄位一定有值，只需檢查 recurrence_until。"""
        if self.recurrence_until is not None and self.recurrence_until < self.event_date:
            raise ValueError("recurrence_until must not be before event_date")
        return self

    @model_validator(mode="after")
    def _check_multi_day_rules(self):
        """跨天事件 (v2.5 Spec A) 是「整天型」專屬：帶 end_date 就不可帶
        event_time，也不可與重複規則並用 (spec §1 非目標)。end_date 早於
        event_date 的事件展開不出任何 occurrence，一併在入口擋下。"""
        if self.end_date is not None:
            if self.end_date < self.event_date:
                raise ValueError("end_date must not be before event_date")
            if self.event_time is not None:
                raise ValueError("multi-day events must be all-day (event_time must be null)")
            if self.recurrence != "none":
                raise ValueError("multi-day events cannot repeat (recurrence must be 'none')")
        return self


class CalendarEventUpdate(BaseModel):
    """PUT /calendar/events/{event_id} 的請求 body：全部欄位 Optional。

    路由層用 `model_dump(exclude_unset=True)` (本端點的特化寫法，PATCH
    語意的標準作法；不影響 diary PUT 沿用的 `.model_dump()` + `is not None`
    慣例) 取得請求裡「實際出現過」的欄位，藉此區分兩種情況：
    - 欄位完全不出現在 body 裡 → 維持原值。
    - 欄位出現且值為 null → 依欄位分兩類：
      - 可清空欄位 (event_time/recurrence_until/reminder_minutes/note)：
        寫入 NULL (例如把定時事件改成全天、取消提醒、移除重複截止日、
        清空備註)。
      - 不可清空欄位 (title/category/recurrence/event_date)：這幾個在
        業務邏輯上不允許為 NULL，路由層會回 400 invalid_input (見
        api/routes/calendar.py 的 update_event)。

    body 完全沒有任何欄位 (exclude_unset 後為空 dict) → 路由層回 400
    no_update_data (比照 diary PUT 慣例)。
    """
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=2000)
    category: Optional[_CalendarCategory] = None
    event_date: Optional[date] = None
    event_time: Optional[str] = Field(default=None, pattern=_EVENT_TIME_PATTERN)
    recurrence: Optional[_CalendarRecurrence] = None
    recurrence_until: Optional[date] = None
    reminder_minutes: Optional[int] = Field(default=None, ge=0, le=10080)
    end_date: Optional[date] = None
    color: Optional[str] = Field(default=None, pattern=_COLOR_PATTERN)

    @model_validator(mode="after")
    def _check_recurrence_until_not_before_event_date(self):
        """partial update：event_date / recurrence_until 都可能整個不出現在這次請求裡
        (exclude_unset 語意)，只有當兩者都真的出現在請求裡、且皆非 null 時，才有足夠
        資訊比較新舊順序，因此只在這個交集情況下驗證。已知限制：只送其中一個欄位
        (例如只改 recurrence_until、event_date 沿用資料庫既有值) 時這裡驗證不到——
        要擋下那種情況得先查出另一欄的現值，不在 schema 驗證的職責範圍內，刻意不做，
        維持簡單。"""
        fields_set = self.model_fields_set
        if ('event_date' in fields_set and 'recurrence_until' in fields_set
                and self.event_date is not None and self.recurrence_until is not None
                and self.recurrence_until < self.event_date):
            raise ValueError("recurrence_until must not be before event_date")
        return self

    @model_validator(mode="after")
    def _check_multi_day_rules_partial(self):
        """partial update：只有欄位真的出現在請求裡才驗得到 (exclude_unset 語意，
        比照上面 recurrence_until 的已知限制)。跨庫存值的完整不變量由路由層
        update_event 以「合併後狀態」檢查 (multi_day_invalid)，這裡只擋
        「同一請求內自相矛盾」的組合。"""
        fs = self.model_fields_set
        if 'end_date' in fs and self.end_date is not None:
            if ('event_date' in fs and self.event_date is not None
                    and self.end_date < self.event_date):
                raise ValueError("end_date must not be before event_date")
            if 'event_time' in fs and self.event_time is not None:
                raise ValueError("multi-day events must be all-day (event_time must be null)")
            if 'recurrence' in fs and self.recurrence is not None and self.recurrence != "none":
                raise ValueError("multi-day events cannot repeat (recurrence must be 'none')")
        return self


# companion 客製化設定的合法值 (v2.4 spec ①)。三個列舉欄位額外接受 ""——
# PUT 的「送空字串＝清空該欄」語意 (見 CompanionSettingsIn 說明) 對文字欄位
# 與列舉欄位一致適用，若 Literal 不含 ""，空字串在 Pydantic 驗證階段就會被
# 直接拒收 (422)，路由層那句 `value.strip() or None` 永遠等不到執行。
_StyleReplyLength = Literal["short", "natural", "chatty", ""]
_StyleEmoji = Literal["none", "low", "high", ""]
_StyleFormality = Literal["casual", "polite", ""]

_NO_CTRL_PATTERN = r"^[^\r\n\t\x00-\x1f\x7f]*$"


class CompanionSettingsIn(BaseModel):
    """PUT /users/me/companion 的請求 body：全部 Optional (partial update)。

    exclude_unset 語意 (比照 CalendarEventUpdate)：欄位不出現＝維持原值；
    出現且為空字串＝清空該欄 (寫 NULL)。名字欄拒收控制字元與換行——這段
    文字會進 system prompt，乾淨輸入是唯一防線。
    """
    companion_name: Optional[str] = Field(default=None, max_length=20,
                                          pattern=_NO_CTRL_PATTERN)
    user_nickname: Optional[str] = Field(default=None, max_length=20,
                                         pattern=_NO_CTRL_PATTERN)
    style_reply_length: Optional[_StyleReplyLength] = None
    style_emoji: Optional[_StyleEmoji] = None
    style_formality: Optional[_StyleFormality] = None
