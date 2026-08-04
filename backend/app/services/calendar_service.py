"""行事曆服務：重複事件展開 (純函式) + 給 AI 用的脈絡格式化。

日期基準的決策 (重要)：行事曆一律使用「真實本地牆上日期」
(utils.time_utils.get_local_now().date())，**不是**日記的「凌晨 5 點換日」
日 (utils.time_utils.get_diary_date())。

理由：使用者若在凌晨 2 點新增「明天 9 點看牙醫」，這件事在行事曆上就該歸在
真實世界的「明天」——行事曆是對齊時鐘與日曆顯示的外部約會/提醒，跟「日記
可以寫到凌晨都算前一天」的敘事時間語意不是同一套規則，硬套 5am 規則只會讓
凌晨新增的事件被誤判成「今天」的事而提早一天出現，或延後一天才提醒。
為了不讓「日記日」與「行事曆日」這兩套『今天』在凌晨互相打架、讓 AI 誤判，
build_calendar_context 產生的每一行都明確印出 MM/DD，不依賴模型自行推斷
「今天」是哪一天。

Session 紀律：LLM 呼叫期間不可持有 DB session (鐵律)。build_calendar_context
自己開關 session：session 內用 crud 取原始事件並用 snapshot_event() 複製欄位，
session 關閉後才展開 (expand_occurrences) 與格式化——比照
services.memory_retrieval 的守讀→關→處理模式。
"""
import calendar as _calendar
import logging
from collections import namedtuple
from datetime import date, timedelta

from database import crud, db_session
from services.prompt_loader import normalize_lang

logger = logging.getLogger(__name__)

CATEGORIES = ("work", "study", "health", "family", "anniversary", "other")
RECURRENCES = ("none", "daily", "weekly", "monthly", "yearly")
MAX_OCCURRENCES = 500      # 展開防禦上限
CONTEXT_MAX_LINES = 10
NO_EVENTS_PLACEHOLDER = {
    "zh-TW": "（近期沒有行事曆事件）",
    "en": "(no calendar events in the coming days)",
}

# 事件的欄位快照：與 models.CalendarEvent 同名屬性，讓 expand_occurrences
# 不必區分「還在 session 內的 ORM 物件」或「session 已關閉的純資料」。
EventSnapshot = namedtuple(
    "EventSnapshot",
    "id title note category event_date event_time recurrence recurrence_until reminder_minutes",
)

_CATEGORY_LABELS_ZH = {
    "work": "工作", "study": "學業", "health": "健康",
    "family": "家人", "anniversary": "紀念日", "other": "其他",
}
_WEEKDAY_ZH = ("週一", "週二", "週三", "週四", "週五", "週六", "週日")
_WEEKDAY_EN = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_STEP_DAYS = {"daily": 1, "weekly": 7}
_NOTE_PREVIEW_CHARS = 40


def snapshot_event(ev) -> EventSnapshot:
    """把 ORM CalendarEvent 列複製成不依賴 session 的純資料物件。

    session 關閉後才能安全存取的欄位都在這裡先讀出來，避免任何
    DetachedInstanceError 或延遲載入風險。
    """
    return EventSnapshot(
        id=ev.id, title=ev.title, note=ev.note, category=ev.category,
        event_date=ev.event_date, event_time=ev.event_time,
        recurrence=ev.recurrence, recurrence_until=ev.recurrence_until,
        reminder_minutes=ev.reminder_minutes,
    )


# --- 純函式：重複事件展開 ------------------------------------------------------

def expand_occurrences(events, range_start, range_end, cap=MAX_OCCURRENCES) -> list:
    """把原始事件展開為 [range_start, range_end] (含兩端) 內的 occurrences。

    純函式：不觸碰 DB，`events` 只要是暴露 id/title/note/category/event_date/
    event_time/recurrence/recurrence_until/reminder_minutes 屬性的物件即可
    (EventSnapshot 或 models.CalendarEvent 皆可)。

    規則：
    - recurrence="none"：event_date 落在範圍內才出現
    - daily/weekly：從 event_date 起算，步進 1 天 / 7 天
    - monthly：每月同「日」；短月沒有該日 (29/30/31) 則該月跳過，不順延
    - yearly：每年同月日；2/29 只在閏年出現
    - recurrence_until 含當日 (<= until 的 occurrence 才收)
    - event_date 之前不展開 (首次發生日即 event_date 本身)
    - 輸出依 (date, time is None 排前, time) 排序；總數達 cap 即停

    每筆 occurrence dict：
    {event_id, title, note, category, date:"YYYY-MM-DD", time (None 或
    "HH:MM"), recurrence, reminder_minutes}
    """
    occurrences = []
    for ev in events:
        occurrences.extend(_expand_one(ev, range_start, range_end))
    occurrences.sort(key=_sort_key)
    return occurrences[:cap]


def _expand_one(ev, range_start, range_end) -> list:
    recurrence = ev.recurrence
    event_date = ev.event_date
    until = ev.recurrence_until

    # recurrence_until 早於查詢範圍起點：這筆事件已經結束，不會有任何 occurrence
    if recurrence != "none" and until is not None and until < range_start:
        return []

    if recurrence == "none":
        dates = [event_date] if range_start <= event_date <= range_end else []
    elif recurrence in _STEP_DAYS:
        dates = _step_dates(event_date, until, range_start, range_end, _STEP_DAYS[recurrence])
    elif recurrence == "monthly":
        dates = _monthly_dates(event_date, until, range_start, range_end)
    elif recurrence == "yearly":
        dates = _yearly_dates(event_date, until, range_start, range_end)
    else:
        logger.warning(f"未知的 recurrence 值，視為不展開: {recurrence!r} (event_id={getattr(ev, 'id', None)})")
        dates = []

    return [_occurrence_dict(ev, d) for d in dates]


def _step_dates(event_date, until, range_start, range_end, step_days) -> list:
    """daily/weekly 共用：從 event_date 起，每 step_days 天一次。"""
    if event_date > range_end:
        return []

    if event_date >= range_start:
        first = event_date
    else:
        # 找到 >= range_start、且與 event_date 同相位 (間隔為 step_days 倍數) 的第一個候選日
        delta_days = (range_start - event_date).days
        steps = -(-delta_days // step_days)  # ceil division
        first = event_date + timedelta(days=steps * step_days)

    dates = []
    current = first
    while current <= range_end and (until is None or current <= until):
        dates.append(current)
        current += timedelta(days=step_days)
    return dates


def _monthly_dates(event_date, until, range_start, range_end) -> list:
    """每月同一「日」；短月沒有該日就跳過該月 (不順延到下個有效月份)。"""
    dates = []
    anchor_day = event_date.day
    year, month = event_date.year, event_date.month

    while True:
        month_start = date(year, month, 1)
        if month_start > range_end:
            break
        if until is not None and month_start > until:
            break

        days_in_month = _calendar.monthrange(year, month)[1]
        if anchor_day <= days_in_month:
            candidate = date(year, month, anchor_day)
            if (candidate >= event_date and range_start <= candidate <= range_end
                    and (until is None or candidate <= until)):
                dates.append(candidate)
        # else：短月沒有該日，這個月沒有 occurrence，直接前進到下個月

        year, month = (year + 1, 1) if month == 12 else (year, month + 1)

    return dates


def _yearly_dates(event_date, until, range_start, range_end) -> list:
    """每年同月日；2/29 錨定的事件只在閏年出現。"""
    dates = []
    month, day = event_date.month, event_date.day
    year = event_date.year

    while True:
        year_start = date(year, 1, 1)
        if year_start > range_end:
            break
        if until is not None and year_start > until:
            break

        if not (month == 2 and day == 29 and not _calendar.isleap(year)):
            candidate = date(year, month, day)
            if (candidate >= event_date and range_start <= candidate <= range_end
                    and (until is None or candidate <= until)):
                dates.append(candidate)
        # else：非閏年沒有 2/29，這一年沒有 occurrence

        year += 1

    return dates


def _sort_key(occ: dict):
    # date 由小到大；同一天全天事件 (time=None) 排在有時間的事件之前；
    # 有時間的再依 "HH:MM" 字串排序 (zero-padded 24 小時制，字串序即時間序)
    return (occ["date"], occ["time"] is not None, occ["time"] or "")


def _occurrence_dict(ev, d: date) -> dict:
    return {
        "event_id": ev.id,
        "title": ev.title,
        "note": ev.note,
        "category": ev.category,
        "date": d.isoformat(),
        "time": ev.event_time,
        "recurrence": ev.recurrence,
        "reminder_minutes": ev.reminder_minutes,
    }


# --- 面向 AI 的脈絡格式化 (會碰 DB) ---------------------------------------------

def build_calendar_context(user_id: int, today: date, lang: str = "zh-TW") -> str:
    """給兩個 AI 入口 (check-in 與對話) 共用的行事曆脈絡區塊。

    視窗 = 昨天 ~ today+7 (含兩端)。session 內用 crud 取原始事件並用
    snapshot_event() 複製欄位，關閉 session 後才展開與格式化 (守讀→關→處理，
    LLM 呼叫期間絕不持有 DB session)。

    永遠回傳非空字串：無事件回置底句 (.format 永不炸，比照
    memory_retrieval.NO_MEMORY_PLACEHOLDER 的模式)；任何內部例外都在這裡
    吞掉並回退置底句 (比照 get_relevant_memories 的防禦寫法)，行事曆脈絡是
    加分項，絕不該讓 check-in / 對話主流程掛掉。
    """
    norm_lang = "zh-TW"
    try:
        norm_lang = normalize_lang(lang)
    except Exception:
        pass  # lang 型別異常等極端情況：至少保底用 zh-TW 佔位字串

    try:
        range_start = today - timedelta(days=1)
        range_end = today + timedelta(days=7)

        with db_session() as db:
            raw_events = crud.get_calendar_events(db, user_id, range_start, range_end)
            events = [snapshot_event(ev) for ev in raw_events]
        # session 已關閉：以下純 Python 運算，不再持有任何 DB 連線

        occurrences = expand_occurrences(events, range_start, range_end)
        if not occurrences:
            return NO_EVENTS_PLACEHOLDER[norm_lang]

        lines = [_format_line(occ, today, norm_lang) for occ in occurrences[:CONTEXT_MAX_LINES]]
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"行事曆脈絡建置失敗 (user_id={user_id})，改用佔位字串: {e}")
        return NO_EVENTS_PLACEHOLDER.get(norm_lang, NO_EVENTS_PLACEHOLDER["zh-TW"])


def _format_line(occ: dict, today: date, lang: str) -> str:
    """單行格式：`- [MM/DD(週幾) HH:MM]《title》(分類標籤) note前40字`

    全天事件的時間位置寫「整天」/"all day"；昨天的事件行尾加註記。
    """
    occ_date = date.fromisoformat(occ["date"])
    md = occ_date.strftime("%m/%d")
    weekday_label = (_WEEKDAY_ZH if lang == "zh-TW" else _WEEKDAY_EN)[occ_date.weekday()]

    if occ["time"] is None:
        time_label = "整天" if lang == "zh-TW" else "all day"
    else:
        time_label = occ["time"]

    if lang == "zh-TW":
        category_label = _CATEGORY_LABELS_ZH.get(occ["category"], occ["category"])
    else:
        category_label = occ["category"]

    line = f"- [{md}({weekday_label}) {time_label}]《{occ['title']}》({category_label})"

    if occ["note"]:
        line += f" {occ['note'][:_NOTE_PREVIEW_CHARS]}"

    if occ_date == today - timedelta(days=1):
        line += "（昨天）" if lang == "zh-TW" else " (yesterday)"

    return line
