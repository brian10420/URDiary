"""日記 API 帶出當日 AI 印章 (v2.5 日記可愛化)。

列表 (GET /diaries/{user_id}) 與詳情 (GET /diary/{diary_id}) 各附
stamp / stamp_phrase：由 day_notes.source_diary_id 反查，無章＝None。
造數據比照 test_diary_api.py——crud 直造，不走 LLM。
"""
from datetime import date


def _seed_diary(user_id, title="測試日記", content="內容", summary="摘要"):
    from database import crud, SessionLocal
    db = SessionLocal()
    try:
        diary = crud.create_diary(db, user_id=user_id, content=content, title=title,
                                  summary=summary, valence=0.7, arousal=0.4)
        return diary.id
    finally:
        db.close()


def _seed_note(user_id, diary_id, note_date, stamp="food", phrase="牛肉湯的一天"):
    from database import crud, SessionLocal
    db = SessionLocal()
    try:
        crud.upsert_day_note(db, user_id, note_date, stamp, phrase,
                             source_diary_id=diary_id)
    finally:
        db.close()


def test_diary_list_includes_stamp_fields(client, auth_header):
    headers, user_id = auth_header
    stamped_id = _seed_diary(user_id, title="有章")
    plain_id = _seed_diary(user_id, title="無章")
    _seed_note(user_id, stamped_id, date(2026, 8, 22))

    resp = client.get(f"/diaries/{user_id}", headers=headers)
    assert resp.status_code == 200
    by_id = {d["diary_id"]: d for d in resp.json()["diaries"]}
    assert by_id[stamped_id]["stamp"] == "food"
    assert by_id[stamped_id]["stamp_phrase"] == "牛肉湯的一天"
    assert by_id[plain_id]["stamp"] is None
    assert by_id[plain_id]["stamp_phrase"] is None


def test_diary_detail_includes_stamp_fields(client, auth_header):
    headers, user_id = auth_header
    diary_id = _seed_diary(user_id)
    _seed_note(user_id, diary_id, date(2026, 8, 23), stamp="sun", phrase="晴朗有勁的一天")

    resp = client.get(f"/diary/{diary_id}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stamp"] == "sun"
    assert body["stamp_phrase"] == "晴朗有勁的一天"


def test_diary_detail_without_note_has_null_stamp(client, auth_header):
    headers, user_id = auth_header
    diary_id = _seed_diary(user_id)

    resp = client.get(f"/diary/{diary_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["stamp"] is None
    assert resp.json()["stamp_phrase"] is None
