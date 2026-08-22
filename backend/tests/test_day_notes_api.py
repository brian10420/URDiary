"""鎖定 /calendar/day-notes API 與 crud.upsert_day_note (v2.5 Spec A)。

day_notes 沒有公開 POST——寫入只發生在 /chat/end 管線 (test_day_stamp.py 覆蓋)，
這裡直接用 crud 造資料。
"""
from datetime import date

from database import crud, db_session


def _seed_note(user_id, note_date, stamp="cake", phrase="小語", diary_id=None):
    with db_session() as db:
        return crud.upsert_day_note(db, user_id, note_date, stamp, phrase, source_diary_id=diary_id)


def test_upsert_overwrites_same_day(client, auth_header):
    _, user_id = auth_header
    _seed_note(user_id, date(2026, 8, 12), stamp="cake", phrase="第一版")
    _seed_note(user_id, date(2026, 8, 12), stamp="star", phrase="第二版")
    with db_session() as db:
        rows = crud.get_day_notes(db, user_id, date(2026, 8, 1), date(2026, 8, 31))
        assert len(rows) == 1
        assert rows[0].stamp == "star"
        assert rows[0].phrase == "第二版"


def test_get_day_notes_range_and_isolation(client, auth_header):
    headers, user_id = auth_header
    _seed_note(user_id, date(2026, 8, 12))
    _seed_note(user_id, date(2026, 9, 2), stamp="moon")
    resp = client.get("/calendar/day-notes?start=2026-08-01&end=2026-08-31", headers=headers)
    assert resp.status_code == 200
    notes = resp.json()["notes"]
    assert [n["date"] for n in notes] == ["2026-08-12"]
    assert notes[0]["stamp"] == "cake"


def test_get_day_notes_rejects_wide_range(client, auth_header):
    headers, _ = auth_header
    resp = client.get("/calendar/day-notes?start=2026-01-01&end=2026-12-31", headers=headers)
    assert resp.status_code == 400


def test_delete_day_note(client, auth_header):
    headers, user_id = auth_header
    _seed_note(user_id, date(2026, 8, 12))
    resp = client.delete("/calendar/day-notes/2026-08-12", headers=headers)
    assert resp.status_code == 200
    resp2 = client.delete("/calendar/day-notes/2026-08-12", headers=headers)
    assert resp2.status_code == 404


def test_delete_other_users_day_note_returns_404(client, auth_header, other_auth_header):
    """不能刪除別人某天的印章，即使日期相同 (比照 test_calendar_api.py 的
    test_delete_other_users_event_returns_404 慣例)。"""
    headers, _ = auth_header
    _, other_user_id = other_auth_header
    _seed_note(other_user_id, date(2026, 8, 12))

    resp = client.delete("/calendar/day-notes/2026-08-12", headers=headers)
    assert resp.status_code == 404

    with db_session() as db:
        rows = crud.get_day_notes(db, other_user_id, date(2026, 8, 1), date(2026, 8, 31))
        assert len(rows) == 1
