"""鎖定 /calendar/events 系列 API 的行為 (api/routes/calendar.py)。

不需要 mock_llm：行事曆路徑完全不碰 LLM。造測試資料優先走 HTTP POST
(貼近真實使用路徑)；需要直接核對落地資料時才用 database.crud 讀 DB。
"""
from datetime import date, timedelta

import pytest


def _create_event(client, headers, **overrides):
    payload = {
        "title": "事件",
        "event_date": "2026-08-04",
        "category": "other",
        "recurrence": "none",
    }
    payload.update(overrides)
    return client.post("/calendar/events", json=payload, headers=headers)


# --- POST /calendar/events ---------------------------------------------------

def test_create_event_persists_row_with_expected_fields(client, auth_header):
    headers, user_id = auth_header

    resp = _create_event(
        client, headers,
        title="牙醫回診", note="記得帶健保卡", category="health",
        event_date="2026-08-10", event_time="14:30",
        recurrence="weekly", recurrence_until="2026-09-10",
        reminder_minutes=30,
    )

    assert resp.status_code in (200, 201)
    body = resp.json()
    event = body["event"]
    assert event["title"] == "牙醫回診"
    assert event["category"] == "health"
    assert event["recurrence"] == "weekly"
    assert event["reminder_minutes"] == 30

    from database import SessionLocal, crud
    db = SessionLocal()
    try:
        row = crud.get_calendar_event(db, event["event_id"])
        assert row is not None
        assert row.user_id == user_id
        assert row.title == "牙醫回診"
        assert row.note == "記得帶健保卡"
        assert row.category == "health"
        assert row.event_date == date(2026, 8, 10)
        assert row.event_time == "14:30"
        assert row.recurrence == "weekly"
        assert row.recurrence_until == date(2026, 9, 10)
        assert row.reminder_minutes == 30
    finally:
        db.close()


def test_create_event_invalid_category_returns_422(client, auth_header):
    headers, _ = auth_header

    resp = _create_event(client, headers, category="not-a-real-category")

    assert resp.status_code == 422


def test_create_event_invalid_event_time_format_returns_422(client, auth_header):
    headers, _ = auth_header

    resp = _create_event(client, headers, event_time="25:99")

    assert resp.status_code == 422


def test_create_event_empty_title_returns_422(client, auth_header):
    headers, _ = auth_header

    resp = _create_event(client, headers, title="")

    assert resp.status_code == 422


# --- recurrence_until 不可早於 event_date（否則展開不出任何 occurrence，事件永遠不可見）---

def test_create_event_recurrence_until_before_event_date_returns_422(client, auth_header):
    headers, _ = auth_header

    resp = _create_event(client, headers, event_date="2026-08-10",
                         recurrence="weekly", recurrence_until="2026-08-01")

    assert resp.status_code == 422


def test_create_event_recurrence_until_equal_event_date_succeeds(client, auth_header):
    headers, _ = auth_header

    resp = _create_event(client, headers, event_date="2026-08-10",
                         recurrence="weekly", recurrence_until="2026-08-10")

    assert resp.status_code in (200, 201)


# --- GET /calendar/events ------------------------------------------------------

def test_get_events_expands_weekly_three_times_and_none_once_in_three_week_window(
    client, auth_header
):
    headers, _ = auth_header
    _create_event(client, headers, title="每週會議", event_date="2026-09-01",
                  recurrence="weekly")
    _create_event(client, headers, title="單次事件", event_date="2026-09-10",
                  recurrence="none")

    resp = client.get(
        "/calendar/events",
        params={"start": "2026-09-01", "end": "2026-09-21"},
        headers=headers,
    )

    assert resp.status_code == 200
    occurrences = resp.json()["occurrences"]
    weekly_dates = [o["date"] for o in occurrences if o["title"] == "每週會議"]
    none_dates = [o["date"] for o in occurrences if o["title"] == "單次事件"]
    assert weekly_dates == ["2026-09-01", "2026-09-08", "2026-09-15"]
    assert none_dates == ["2026-09-10"]


def test_get_events_span_over_62_days_returns_400(client, auth_header):
    headers, _ = auth_header

    resp = client.get(
        "/calendar/events",
        params={"start": "2026-01-01", "end": "2026-03-05"},  # 63 天
        headers=headers,
    )

    assert resp.status_code == 400
    from utils.messages import msg
    assert resp.json()["detail"] == msg("invalid_date_range", "zh-TW")


def test_get_events_start_after_end_returns_400(client, auth_header):
    headers, _ = auth_header

    resp = client.get(
        "/calendar/events",
        params={"start": "2026-01-10", "end": "2026-01-05"},
        headers=headers,
    )

    assert resp.status_code == 400


# --- PUT /calendar/events/{event_id} --------------------------------------------

def test_put_own_event_updates_fields_and_bumps_updated_at(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers, title="原標題")
    event = create_resp.json()["event"]
    original_updated_at = event["updated_at"]

    resp = client.put(
        f"/calendar/events/{event['event_id']}",
        json={"title": "新標題", "category": "work"},
        headers=headers,
    )

    assert resp.status_code == 200
    updated = resp.json()["event"]
    assert updated["title"] == "新標題"
    assert updated["category"] == "work"
    assert updated["updated_at"] >= original_updated_at


def test_put_recurrence_until_before_event_date_when_both_present_returns_422(client, auth_header):
    """schema 的交叉驗證只在 event_date 與 recurrence_until 兩者都真的出現在
    這次請求裡才生效（partial update 的已知限制，見 schemas.py 的註解）——
    這裡兩者都送，驗證應該生效並拒絕。"""
    headers, _ = auth_header
    create_resp = _create_event(client, headers, event_date="2026-08-10", recurrence="weekly")
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(
        f"/calendar/events/{event_id}",
        json={"event_date": "2026-08-10", "recurrence_until": "2026-08-01"},
        headers=headers,
    )

    assert resp.status_code == 422


def test_put_empty_body_returns_400(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers)
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={}, headers=headers)

    assert resp.status_code == 400


def test_put_other_users_event_returns_404(client, auth_header, other_auth_header):
    headers, _ = auth_header
    other_headers, _ = other_auth_header
    other_event_id = _create_event(client, other_headers).json()["event"]["event_id"]

    resp = client.put(
        f"/calendar/events/{other_event_id}",
        json={"title": "偷改標題"},
        headers=headers,
    )

    assert resp.status_code == 404


# --- PUT 明確清空欄位 (explicit-clear semantics) ---------------------------------
# 四個可清空欄位：event_time / recurrence_until / reminder_minutes / note。
# 語意：欄位完全不出現在 body → 維持原值；出現且為 null → 寫 NULL。

def test_put_event_time_null_clears_timed_event_to_all_day(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers, event_time="14:30")
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={"event_time": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["event"]["event_time"] is None

    from database import SessionLocal, crud
    db = SessionLocal()
    try:
        row = crud.get_calendar_event(db, event_id)
        assert row.event_time is None
    finally:
        db.close()

    # GET 展開也要反映清空後的全天狀態
    get_resp = client.get(
        "/calendar/events",
        params={"start": "2026-08-01", "end": "2026-08-10"},
        headers=headers,
    )
    occ = next(o for o in get_resp.json()["occurrences"] if o["event_id"] == event_id)
    assert occ["time"] is None


def test_put_reminder_minutes_null_clears_reminder(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers, reminder_minutes=30)
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={"reminder_minutes": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["event"]["reminder_minutes"] is None

    from database import SessionLocal, crud
    db = SessionLocal()
    try:
        row = crud.get_calendar_event(db, event_id)
        assert row.reminder_minutes is None
    finally:
        db.close()


def test_put_recurrence_until_null_clears_series_end_date(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers, recurrence="weekly",
                                event_date="2026-08-04", recurrence_until="2026-08-20")
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={"recurrence_until": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["event"]["recurrence_until"] is None

    from database import SessionLocal, crud
    db = SessionLocal()
    try:
        row = crud.get_calendar_event(db, event_id)
        assert row.recurrence_until is None
    finally:
        db.close()

    # until 清空後，展開不再受它截斷 —— 原本 08-20 之後就沒有的 occurrence 現在會有
    get_resp = client.get(
        "/calendar/events",
        params={"start": "2026-08-01", "end": "2026-08-31"},
        headers=headers,
    )
    dates = [o["date"] for o in get_resp.json()["occurrences"] if o["event_id"] == event_id]
    assert "2026-08-25" in dates


def test_put_note_null_clears_note(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers, note="舊備註")
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={"note": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["event"]["note"] is None


def test_put_mixes_real_change_and_explicit_clear_in_one_request(client, auth_header):
    """全狀態送出時，「真的改了的欄位」與「明確清空的欄位」要能在同一次 PUT
    中一起生效 —— 對齊前端「送出表單完整狀態」的新策略 (CDP 驗證步驟 1 的情境:
    改標題 + 全天 + 取消提醒 一次儲存)。"""
    headers, _ = auth_header
    create_resp = _create_event(client, headers, title="舊標題",
                                event_time="14:30", reminder_minutes=30)
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(
        f"/calendar/events/{event_id}",
        json={"title": "新標題", "event_time": None, "reminder_minutes": None},
        headers=headers,
    )

    assert resp.status_code == 200
    updated = resp.json()["event"]
    assert updated["title"] == "新標題"
    assert updated["event_time"] is None
    assert updated["reminder_minutes"] is None


# --- PUT 不可清空欄位 (title/category/recurrence/event_date) ---------------------
# 這四個欄位業務邏輯上不允許為 NULL；出現在 body 且為 null 時整個請求都要被拒絕
# (400)，而不是「靜靜濾掉該欄位、其餘欄位照常套用」的舊行為。

@pytest.mark.parametrize("field", ["title", "category", "recurrence", "event_date"])
def test_put_non_clearable_field_explicit_null_returns_400_with_specific_message(
    client, auth_header, field
):
    headers, _ = auth_header
    create_resp = _create_event(client, headers)
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={field: None}, headers=headers)

    assert resp.status_code == 400
    from utils.messages import msg
    assert resp.json()["detail"] == msg("field_not_clearable", "zh-TW", fields=field)


@pytest.mark.parametrize("field", ["title", "category", "recurrence", "event_date"])
def test_put_non_clearable_field_null_rejects_whole_mixed_request(
    client, auth_header, field
):
    """混一個真正想改的欄位 (note) 進去：舊語意下 (`.dict()` 濾掉 None) 這種
    請求會「靜靜地」把 note 更新成功、null 的那個不可清空欄位被過濾掉、整體回
    200 —— 這正是本任務要堵住的洞。新語意下整個請求必須被拒絕，note 也不能
    被套用 (all-or-nothing，不是部分套用)。"""
    headers, _ = auth_header
    create_resp = _create_event(client, headers, note="原備註")
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(
        f"/calendar/events/{event_id}",
        json={field: None, "note": "混合請求-不該套用"},
        headers=headers,
    )

    assert resp.status_code == 400

    from database import SessionLocal, crud
    db = SessionLocal()
    try:
        row = crud.get_calendar_event(db, event_id)
        assert row.note == "原備註"
    finally:
        db.close()


# --- PUT exclude_unset 語意：缺席欄位維持原值 -------------------------------------

def test_put_title_only_leaves_other_fields_untouched(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(
        client, headers, title="原標題", event_time="14:30",
        category="health", reminder_minutes=30, note="備註",
    )
    event_id = create_resp.json()["event"]["event_id"]

    resp = client.put(f"/calendar/events/{event_id}", json={"title": "新標題"}, headers=headers)

    assert resp.status_code == 200
    updated = resp.json()["event"]
    assert updated["title"] == "新標題"
    assert updated["event_time"] == "14:30"
    assert updated["category"] == "health"
    assert updated["reminder_minutes"] == 30
    assert updated["note"] == "備註"


def test_put_title_only_on_weekly_event_does_not_move_anchor_date(client, auth_header):
    """編輯 weekly 事件只改標題，不能連帶把系列的錨定日 (event_date) 或展開
    出來的發生日期組移動掉 —— exclude_unset 語意下 event_date 沒出現在 body
    裡，理應完全不動。"""
    headers, _ = auth_header
    create_resp = _create_event(client, headers, title="每週會議",
                                event_date="2026-09-01", recurrence="weekly")
    event_id = create_resp.json()["event"]["event_id"]

    get_before = client.get(
        "/calendar/events",
        params={"start": "2026-09-01", "end": "2026-09-21"},
        headers=headers,
    )
    dates_before = [o["date"] for o in get_before.json()["occurrences"]]

    resp = client.put(f"/calendar/events/{event_id}", json={"title": "每週會議（改名）"}, headers=headers)
    assert resp.status_code == 200

    get_after = client.get(
        "/calendar/events",
        params={"start": "2026-09-01", "end": "2026-09-21"},
        headers=headers,
    )
    occurrences_after = get_after.json()["occurrences"]
    dates_after = [o["date"] for o in occurrences_after]

    assert dates_after == dates_before
    assert all(o["event_date"] == "2026-09-01" for o in occurrences_after)
    assert all(o["title"] == "每週會議（改名）" for o in occurrences_after)


# --- DELETE /calendar/events/{event_id} -----------------------------------------

def test_delete_other_users_event_returns_404(client, auth_header, other_auth_header):
    headers, _ = auth_header
    other_headers, _ = other_auth_header
    other_event_id = _create_event(client, other_headers).json()["event"]["event_id"]

    resp = client.delete(f"/calendar/events/{other_event_id}", headers=headers)

    assert resp.status_code == 404


def test_delete_own_event_then_get_range_excludes_it(client, auth_header):
    headers, _ = auth_header
    create_resp = _create_event(client, headers, title="要刪除的事件",
                                event_date="2026-08-04")
    event_id = create_resp.json()["event"]["event_id"]

    del_resp = client.delete(f"/calendar/events/{event_id}", headers=headers)
    assert del_resp.status_code == 200

    get_resp = client.get(
        "/calendar/events",
        params={"start": "2026-08-01", "end": "2026-08-10"},
        headers=headers,
    )
    ids = [o["event_id"] for o in get_resp.json()["occurrences"]]
    assert event_id not in ids


# --- 未帶 token -------------------------------------------------------------------

def test_all_endpoints_without_token_return_401(client):
    assert client.post("/calendar/events", json={"title": "x", "event_date": "2026-08-04"}).status_code == 401
    assert client.get("/calendar/events", params={"start": "2026-08-01", "end": "2026-08-02"}).status_code == 401
    assert client.put("/calendar/events/1", json={"title": "x"}).status_code == 401
    assert client.delete("/calendar/events/1").status_code == 401
