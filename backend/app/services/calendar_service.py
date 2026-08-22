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
import re
from collections import namedtuple
from datetime import date, timedelta

from database import crud, db_session
from services.prompt_loader import normalize_lang

logger = logging.getLogger(__name__)

CATEGORIES = ("work", "study", "health", "family", "anniversary", "travel", "other")
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
    "id title note category event_date event_time recurrence recurrence_until reminder_minutes end_date color",
    defaults=(None, None),
)

_CATEGORY_LABELS_ZH = {
    "work": "工作", "study": "學業", "health": "健康",
    "family": "家人", "anniversary": "紀念日", "travel": "出遊", "other": "其他",
}
_WEEKDAY_ZH = ("週一", "週二", "週三", "週四", "週五", "週六", "週日")
_WEEKDAY_EN = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_STEP_DAYS = {"daily": 1, "weekly": 7}
_NOTE_PREVIEW_CHARS = 40
# note 是最長 2000 字的自由文字 (Text 欄位)，換行是正常輸入、不是攻擊。
# 一個 occurrence 在 build_calendar_context 的輸出裡必須恆為一個物理行——
# 否則換行會撐爆 CONTEXT_MAX_LINES 的行數上限，且續行沒有 `- [MM/DD…]`
# 前綴，模型會把它誤讀成獨立、不明來源的文字混進 prompt。涵蓋 \n / \r\n /
# \r，並把連續多個換行 (例如空行) 合併成一個空白，不留下多餘的雙空白。
_NOTE_NEWLINE_RE = re.compile(r"[\r\n]+")


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
        end_date=getattr(ev, "end_date", None), color=getattr(ev, "color", None),
    )


# --- 純函式：重複事件展開 ------------------------------------------------------

def expand_occurrences(events, range_start, range_end, cap=MAX_OCCURRENCES) -> list:
    """把原始事件展開為 [range_start, range_end] (含兩端) 內的 occurrences。

    純函式：不觸碰 DB，`events` 只要是暴露 id/title/note/category/event_date/
    event_time/recurrence/recurrence_until/reminder_minutes 屬性的物件即可
    (EventSnapshot 或 models.CalendarEvent 皆可)。

    規則：
    - recurrence="none"：event_date 落在範圍內才出現；若帶 end_date (v2.5 跨天
      事件，僅 recurrence="none" 適用) 則逐日展開，裁剪到查詢範圍
    - daily/weekly：從 event_date 起算，步進 1 天 / 7 天
    - monthly：每月同「日」；短月沒有該日 (29/30/31) 則該月跳過，不順延
    - yearly：每年同月日；2/29 只在閏年出現
    - recurrence_until 含當日 (<= until 的 occurrence 才收)
    - event_date 之前不展開 (首次發生日即 event_date 本身)
    - 輸出先展開再整體排序，最後才截斷到 cap 筆（不是展開途中數量一到 cap
      就提前停止）；依 (date, time is None 排前, time) 排序後再截斷，結果具
      決定性，且保留的必為全域最早的 occurrences，不受各事件展開順序影響

    每筆 occurrence dict：
    {event_id, title, note, category, date:"YYYY-MM-DD", time (None 或
    "HH:MM"), recurrence, event_date:"YYYY-MM-DD" (系列錨定日——同一系列
    展開出的每個 occurrence 都相同，跟 date 不是同一件事；供前端編輯表單
    預填，讓「編輯」動到的是整個系列而不是被點開的那一次發生日),
    recurrence_until:"YYYY-MM-DD" 或 None (系列結束日), reminder_minutes,
    end_date:"YYYY-MM-DD" 或 None (v2.5 跨天事件結束日；None=單日), color
    (自選色 "#rrggbb" 或 None), span_day (此 occurrence 是跨天事件的第幾天，
    1-indexed；單日事件為 None), span_total (跨天事件總天數；單日事件恆為 1)}
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
        end_date = getattr(ev, "end_date", None)
        if end_date is not None and end_date >= event_date:
            # 跨天事件：逐日展開 (裁剪到查詢範圍)；span 欄位由 _occurrence_dict 依
            # 事件自身起訖算，不受查詢窗影響
            first = max(event_date, range_start)
            last = min(end_date, range_end)
            dates = []
            current = first
            while current <= last:
                dates.append(current)
                current += timedelta(days=1)
        else:
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
    end_date = getattr(ev, "end_date", None)
    color = getattr(ev, "color", None)
    span_total = 1
    span_day = None
    if end_date is not None and ev.recurrence == "none" and end_date >= ev.event_date:
        span_total = (end_date - ev.event_date).days + 1
        span_day = (d - ev.event_date).days + 1
    return {
        "event_id": ev.id,
        "title": ev.title,
        "note": ev.note,
        "category": ev.category,
        "date": d.isoformat(),
        "time": ev.event_time,
        "recurrence": ev.recurrence,
        # 系列的原始欄位 (與 date 不同：date 是這一筆 occurrence 的展開發生日，
        # event_date 是整個系列的錨定日，同一系列所有 occurrence 皆相同)。
        # 前端編輯表單靠這兩個欄位預填，不必再另外快取 POST/PUT 的完整回應。
        "event_date": ev.event_date.isoformat(),
        "recurrence_until": ev.recurrence_until.isoformat() if ev.recurrence_until else None,
        "reminder_minutes": ev.reminder_minutes,
        # v2.5 Spec A：跨天欄位。單日事件 span_day=None、span_total=1；
        # 前端以 span_total > 1 判斷要不要畫橫槓。
        "end_date": end_date.isoformat() if end_date else None,
        "color": color,
        "span_day": span_day,
        "span_total": span_total,
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
    note 一律先去除換行才截斷 (見 _NOTE_NEWLINE_RE)，確保回傳值恆為一個
    物理行——即使換行剛好落在第 40 字邊界上也不會有殘留的裸換行字元。
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
        # 先消毒換行、再截斷：即使原始 note 前 40 字剛好在換行處被切斷，
        # 輸出也保證不含任何裸 \n/\r (單一 occurrence 恆為單一物理行)。
        note_preview = _NOTE_NEWLINE_RE.sub(" ", occ["note"])[:_NOTE_PREVIEW_CHARS]
        line += f" {note_preview}"

    if occ_date == today - timedelta(days=1):
        line += "（昨天）" if lang == "zh-TW" else " (yesterday)"

    return line
