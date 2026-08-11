"""鎖定 utils/time_utils.py 的日記換日規則 (預設凌晨 5 點為界)。

monkeypatch `utils.time_utils.get_local_now`：get_diary_date()/get_diary_datetime()
內部呼叫的是模組自己的全域名稱 get_local_now()，patch 同一個模組屬性即可攔截。
"""
from datetime import datetime

import utils.time_utils as time_utils


def _set_fake_now(monkeypatch, hour, minute, day=15):
    fake_now = time_utils.LOCAL_TZ.localize(datetime(2026, 3, day, hour, minute))
    monkeypatch.setattr(time_utils, "get_local_now", lambda: fake_now)
    return fake_now


def test_diary_date_before_boundary_is_previous_day(monkeypatch):
    """04:59 早於 5 點界線 -> 歸屬昨天。"""
    _set_fake_now(monkeypatch, 4, 59)
    assert time_utils.get_diary_date() == datetime(2026, 3, 14).date()


def test_diary_date_at_boundary_is_today(monkeypatch):
    """05:00 剛好在界線上 -> 歸屬今天 (< 5 才算前一天，等於不算)。"""
    _set_fake_now(monkeypatch, 5, 0)
    assert time_utils.get_diary_date() == datetime(2026, 3, 15).date()


def test_diary_date_midnight_is_previous_day(monkeypatch):
    """00:00 屬於 < 5 點的區間 -> 歸屬昨天。"""
    _set_fake_now(monkeypatch, 0, 0)
    assert time_utils.get_diary_date() == datetime(2026, 3, 14).date()


def test_diary_date_late_night_before_midnight_is_today(monkeypatch):
    """23:59 已過凌晨 5 點界線 -> 歸屬今天。"""
    _set_fake_now(monkeypatch, 23, 59)
    assert time_utils.get_diary_date() == datetime(2026, 3, 15).date()


def test_diary_datetime_is_naive_and_consistent_with_diary_date(monkeypatch):
    fake_now = _set_fake_now(monkeypatch, 10, 30)
    diary_dt = time_utils.get_diary_datetime()

    assert diary_dt.tzinfo is None
    assert diary_dt.date() == time_utils.get_diary_date()
    assert diary_dt.date() == fake_now.date()
    assert diary_dt.time() == fake_now.time()


def test_diary_datetime_naive_across_boundary(monkeypatch):
    """04:59 (歸屬昨天) 的 get_diary_datetime() 日期部分也要落在昨天，
    時間部分維持實際的當下時刻 (04:59)，而非被歸零。"""
    fake_now = _set_fake_now(monkeypatch, 4, 59)
    diary_dt = time_utils.get_diary_datetime()

    assert diary_dt.tzinfo is None
    assert diary_dt.date() == datetime(2026, 3, 14).date()
    assert diary_dt.hour == 4
    assert diary_dt.minute == 59
