"""鎖定 services/calendar_service.py 的重複事件展開與行事曆脈絡格式化行為。

expand_occurrences 是純函式，測試一律用 EventSnapshot 直接構造假事件，
不碰 DB／session，維持「純函式」的測試意義。build_calendar_context 才需要
真的造資料進 DB (走 crud)，因此那組測試用 auth_header 拿一個隔離的
user_id，直接用 database.crud 造事件。
"""
from datetime import date, timedelta

from services.calendar_service import (
    CONTEXT_MAX_LINES,
    NO_EVENTS_PLACEHOLDER,
    EventSnapshot,
    build_calendar_context,
    expand_occurrences,
)


def _ev(event_id=1, title="事件", note=None, category="other",
        event_date=date(2026, 8, 1), event_time=None,
        recurrence="none", recurrence_until=None, reminder_minutes=None):
    """建一個 EventSnapshot 假事件，只需要指定測試在意的欄位。"""
    return EventSnapshot(
        id=event_id, title=title, note=note, category=category,
        event_date=event_date, event_time=event_time,
        recurrence=recurrence, recurrence_until=recurrence_until,
        reminder_minutes=reminder_minutes,
    )


# --- expand_occurrences: recurrence="none" ----------------------------------

def test_none_recurrence_appears_once_when_inside_range():
    ev = _ev(event_date=date(2026, 8, 5))

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    assert len(occ) == 1
    assert occ[0]["date"] == "2026-08-05"


def test_none_recurrence_absent_when_outside_range():
    ev = _ev(event_date=date(2026, 8, 20))

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    assert occ == []


def test_none_recurrence_included_at_range_start_boundary():
    ev = _ev(event_date=date(2026, 8, 1))

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    assert len(occ) == 1
    assert occ[0]["date"] == "2026-08-01"


def test_none_recurrence_included_at_range_end_boundary():
    ev = _ev(event_date=date(2026, 8, 10))

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    assert len(occ) == 1
    assert occ[0]["date"] == "2026-08-10"


# --- daily + recurrence_until 中段：until 當天含、之後無 ----------------------

def test_daily_recurrence_until_includes_until_day_excludes_after():
    ev = _ev(event_date=date(2026, 8, 1), recurrence="daily",
              recurrence_until=date(2026, 8, 5))

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    dates = [o["date"] for o in occ]
    assert dates == ["2026-08-01", "2026-08-02", "2026-08-03",
                      "2026-08-04", "2026-08-05"]
    assert "2026-08-06" not in dates


# --- weekly 跨月邊界：步進 7 天 -----------------------------------------------

def test_weekly_steps_by_seven_days_across_month_boundary():
    ev = _ev(event_date=date(2026, 7, 20), recurrence="weekly")

    occ = expand_occurrences([ev], date(2026, 7, 1), date(2026, 8, 15))

    dates = [o["date"] for o in occ]
    assert dates == ["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"]


def test_weekly_event_date_long_before_range_start_stays_phase_aligned():
    """event_date 遠早於 range_start 時，仍要落在同一組「星期幾」上 (不能只是
    找到 >= range_start 的任意日期，相位必須跟 event_date 對齊)。"""
    ev = _ev(event_date=date(2026, 1, 5), recurrence="weekly")  # 2026-01-05 是週一

    occ = expand_occurrences([ev], date(2026, 8, 4), date(2026, 8, 20))

    dates = [o["date"] for o in occ]
    assert dates == ["2026-08-10", "2026-08-17"]  # range 內最早/次早的週一
    assert all(date.fromisoformat(d).weekday() == 0 for d in dates)  # 全部週一


# --- monthly 錨定 31 號：短月跳過 ---------------------------------------------

def test_monthly_anchor_31_skips_short_months():
    ev = _ev(event_date=date(2026, 1, 31), recurrence="monthly")

    occ = expand_occurrences([ev], date(2026, 1, 1), date(2026, 12, 31))

    dates = [o["date"] for o in occ]
    # 有 31 號的月份：1,3,5,7,8,10,12；4,6,9,11 月與 2 月（沒有 31 號）跳過
    assert dates == ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31",
                      "2026-08-31", "2026-10-31", "2026-12-31"]


def test_monthly_anchor_15_occurs_every_month():
    ev = _ev(event_date=date(2026, 1, 15), recurrence="monthly")

    occ = expand_occurrences([ev], date(2026, 1, 1), date(2026, 6, 30))

    dates = [o["date"] for o in occ]
    assert dates == ["2026-01-15", "2026-02-15", "2026-03-15",
                      "2026-04-15", "2026-05-15", "2026-06-15"]


# --- yearly ---------------------------------------------------------------------

def test_yearly_regular_date_occurs_every_year():
    ev = _ev(event_date=date(2024, 3, 10), recurrence="yearly")

    occ = expand_occurrences([ev], date(2024, 1, 1), date(2027, 12, 31))

    dates = [o["date"] for o in occ]
    assert dates == ["2024-03-10", "2025-03-10", "2026-03-10", "2027-03-10"]


def test_yearly_feb_29_only_in_leap_years():
    ev = _ev(event_date=date(2024, 2, 29), recurrence="yearly")

    occ = expand_occurrences([ev], date(2024, 1, 1), date(2027, 12, 31))

    dates = [o["date"] for o in occ]
    # 2024 閏年出現；2025-2027 非閏年跳過
    assert dates == ["2024-02-29"]


# --- recurrence_until < range_start → 空 --------------------------------------

def test_recurrence_until_before_range_start_yields_empty():
    ev = _ev(event_date=date(2026, 1, 1), recurrence="daily",
              recurrence_until=date(2026, 1, 5))

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    assert occ == []


# --- cap 防禦上限 ---------------------------------------------------------------

def test_daily_large_range_triggers_cap():
    ev = _ev(event_date=date(2020, 1, 1), recurrence="daily")

    occ = expand_occurrences([ev], date(2020, 1, 1), date(2030, 12, 31), cap=50)

    assert len(occ) == 50


# --- 排序：同日全天排在有時間之前；跨日按日期 -----------------------------------

def test_sort_all_day_before_timed_on_same_day_then_by_date():
    ev_timed = _ev(event_id=1, event_date=date(2026, 8, 5), event_time="09:00")
    ev_allday = _ev(event_id=2, event_date=date(2026, 8, 5), event_time=None)
    ev_earlier = _ev(event_id=3, event_date=date(2026, 8, 4), event_time="23:00")

    occ = expand_occurrences([ev_timed, ev_allday, ev_earlier],
                              date(2026, 8, 1), date(2026, 8, 10))

    assert [o["event_id"] for o in occ] == [3, 2, 1]


# --- occurrence 欄位齊全 ---------------------------------------------------------

def test_occurrence_dict_has_all_expected_fields():
    ev = _ev(event_id=42, title="牙醫", note="記得帶健保卡", category="health",
              event_date=date(2026, 8, 5), event_time="14:30",
              recurrence="none", reminder_minutes=30)

    occ = expand_occurrences([ev], date(2026, 8, 1), date(2026, 8, 10))

    assert occ[0] == {
        "event_id": 42, "title": "牙醫", "note": "記得帶健保卡",
        "category": "health", "date": "2026-08-05", "time": "14:30",
        "recurrence": "none", "reminder_minutes": 30,
    }


# ==============================================================================
# build_calendar_context：走真的 DB (crud)，用 auth_header 隔離的 user_id
# ==============================================================================

def _seed_event(user_id, **kwargs):
    from database import SessionLocal, crud
    defaults = dict(title="事件", event_date=date(2026, 8, 4), category="other",
                     recurrence="none")
    defaults.update(kwargs)
    db = SessionLocal()
    try:
        event = crud.create_calendar_event(db, user_id=user_id, **defaults)
        return event.id
    finally:
        db.close()


def test_build_calendar_context_no_events_returns_placeholder_both_languages(auth_header):
    _, user_id = auth_header
    today = date(2026, 8, 4)

    assert build_calendar_context(user_id, today, "zh-TW") == NO_EVENTS_PLACEHOLDER["zh-TW"]
    assert build_calendar_context(user_id, today, "en") == NO_EVENTS_PLACEHOLDER["en"]


def test_build_calendar_context_today_event_includes_title_time_and_category(auth_header):
    _, user_id = auth_header
    today = date(2026, 8, 4)
    _seed_event(user_id, title="牙醫回診", event_date=today, event_time="14:30",
                category="health")

    result = build_calendar_context(user_id, today, "zh-TW")

    assert "《牙醫回診》" in result
    assert "14:30" in result
    assert "健康" in result


def test_build_calendar_context_yesterday_event_has_yesterday_suffix(auth_header):
    _, user_id = auth_header
    today = date(2026, 8, 4)
    yesterday = today - timedelta(days=1)
    _seed_event(user_id, title="昨天的事", event_date=yesterday)

    zh_result = build_calendar_context(user_id, today, "zh-TW")
    en_result = build_calendar_context(user_id, today, "en")

    assert "（昨天）" in zh_result
    assert " (yesterday)" in en_result


def test_build_calendar_context_truncates_to_max_lines(auth_header):
    _, user_id = auth_header
    today = date(2026, 8, 4)
    # 全部落在同一天 (window 內)，用不同 event_time 製造 > CONTEXT_MAX_LINES
    # 筆 occurrences，避免事件日期跨出 build_calendar_context 的 9 天視窗
    for i in range(CONTEXT_MAX_LINES + 5):
        _seed_event(user_id, title=f"事件{i}", event_date=today,
                    event_time=f"{i:02d}:00")

    result = build_calendar_context(user_id, today, "zh-TW")

    assert len(result.split("\n")) == CONTEXT_MAX_LINES


def test_build_calendar_context_truncates_note_to_40_chars(auth_header):
    _, user_id = auth_header
    today = date(2026, 8, 4)
    long_note = "A" * 40 + "OVERFLOW-SHOULD-NOT-APPEAR"
    _seed_event(user_id, title="長筆記事件", event_date=today, note=long_note)

    result = build_calendar_context(user_id, today, "zh-TW")

    assert "A" * 40 in result
    assert "OVERFLOW-SHOULD-NOT-APPEAR" not in result


def test_build_calendar_context_multiline_note_renders_as_single_line(auth_header):
    """note 內的換行 (\\n) 不可讓一個 occurrence 撐成多個物理行——否則續行
    會缺少 `- [MM/DD...]` 前綴，且會撐爆 CONTEXT_MAX_LINES 的行數契約
    (下一個任務直接把這段文字嵌進 prompt，格式必須守住)。"""
    _, user_id = auth_header
    today = date(2026, 8, 4)
    _seed_event(user_id, title="看牙醫", event_date=today,
                note="帶健保卡\n順便領藥")

    result = build_calendar_context(user_id, today, "zh-TW")

    lines = result.split("\n")
    assert len(lines) == 1  # 一筆事件恆為一個物理行
    assert "帶健保卡 順便領藥" in lines[0]  # 換行以空白接續兩段


def test_build_calendar_context_crlf_note_also_renders_as_single_line(auth_header):
    """\\r\\n (CRLF) 換行同樣要處理，不可留下裸 \\r。"""
    _, user_id = auth_header
    today = date(2026, 8, 4)
    _seed_event(user_id, title="打掃", event_date=today,
                note="拖地\r\n倒垃圾")

    result = build_calendar_context(user_id, today, "zh-TW")

    lines = result.split("\n")
    assert len(lines) == 1
    assert "拖地 倒垃圾" in lines[0]
    assert "\r" not in result


def test_build_calendar_context_multiline_notes_do_not_exceed_max_lines(auth_header):
    """就算每一筆事件的 note 都帶換行，總行數仍不可超過 CONTEXT_MAX_LINES
    (換行消毒必須發生在「數行數」的截斷邏輯之前，不能讓換行偷渡出額外行)。"""
    _, user_id = auth_header
    today = date(2026, 8, 4)
    for i in range(CONTEXT_MAX_LINES + 5):
        _seed_event(user_id, title=f"事件{i}", event_date=today,
                    event_time=f"{i:02d}:00", note=f"第一行{i}\n第二行{i}")

    result = build_calendar_context(user_id, today, "zh-TW")

    assert len(result.split("\n")) == CONTEXT_MAX_LINES


def test_build_calendar_context_normalizes_lang_en_us_variant(auth_header):
    _, user_id = auth_header
    today = date(2026, 8, 4)
    _seed_event(user_id, title="Team Meeting", event_date=today, category="work")

    result_en = build_calendar_context(user_id, today, "en")
    result_en_us = build_calendar_context(user_id, today, "en-US")
    result_zh = build_calendar_context(user_id, today, "zh-TW")

    assert result_en_us == result_en
    assert result_en_us != result_zh
    assert "(work)" in result_en_us
