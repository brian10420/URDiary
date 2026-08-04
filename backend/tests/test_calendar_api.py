"""鎖定 /calendar/events 系列 API 的行為 (api/routes/calendar.py)。

不需要 mock_llm：行事曆路徑完全不碰 LLM。造測試資料優先走 HTTP POST
(貼近真實使用路徑)；需要直接核對落地資料時才用 database.crud 讀 DB。
"""
from datetime import date, timedelta


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
