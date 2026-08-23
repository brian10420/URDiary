"""FTS5 索引：建表/同步/搜尋/隔離/降級/backfill (v2.5 Spec C Task 9)。"""
from database import db_session, crud, engine
from services import diary_fts


def test_ensure_fts_idempotent(client):
    assert diary_fts.ensure_fts(engine) is True
    assert diary_fts.ensure_fts(engine) is True  # 再跑一次不炸
    assert diary_fts.available()


def test_index_on_create_and_search(client, auth_header):
    _h, uid = auth_header
    with db_session() as db:
        crud.create_diary(db, uid, "今天去台南吃牛肉湯，湯頭很甜", title="台南行", summary="牛肉湯之旅")
        hits = diary_fts.search(db, uid, ["牛肉湯"])
    assert len(hits) == 1
    diary_id, score = hits[0]
    assert score > 0


def test_title_weight_beats_content(client, auth_header):
    _h, uid = auth_header
    with db_session() as db:
        in_title = crud.create_diary(db, uid, "無關內文", title="牛肉湯大勝利", summary="s")
        in_content = crud.create_diary(db, uid, "早餐吃了牛肉湯", title="平常的一天", summary="s")
        hits = diary_fts.search(db, uid, ["牛肉湯"])
        assert hits[0][0] == in_title.id  # bm25 權重 title 3 > content 1


def test_update_and_delete_sync(client, auth_header):
    _h, uid = auth_header
    with db_session() as db:
        diary = crud.create_diary(db, uid, "原始內容", title="t", summary="s")
        crud.update_diary(db, diary.id, content="改成關於爬山的內容")
        assert diary_fts.search(db, uid, ["爬山"])
        assert not diary_fts.search(db, uid, ["原始內容"])
        crud.delete_diary(db, diary.id)
        assert not diary_fts.search(db, uid, ["爬山"])


def test_day_note_phrase_indexed(client, auth_header):
    _h, uid = auth_header
    from utils.time_utils import get_diary_date
    with db_session() as db:
        diary = crud.create_diary(db, uid, "普通內文", title="t", summary="s")
        crud.upsert_day_note(db, uid, get_diary_date(), "food", "螺絲粉的呼喚",
                             source_diary_id=diary.id)
        hits = diary_fts.search(db, uid, ["螺絲粉"])
        assert hits and hits[0][0] == diary.id


def test_user_isolation(client, auth_header, other_auth_header):
    _h, uid = auth_header
    _oh, other_uid = other_auth_header
    with db_session() as db:
        crud.create_diary(db, uid, "我的獨家秘密關鍵詞甲乙丙", title="t", summary="s")
        assert not diary_fts.search(db, other_uid, ["獨家秘密"])


def test_degraded_mode_is_silent(client, auth_header, monkeypatch):
    _h, uid = auth_header
    monkeypatch.setattr(diary_fts, "_available", False)
    assert diary_fts.available() is False
    with db_session() as db:
        crud.create_diary(db, uid, "降級時不炸", title="t", summary="s")  # hook 靜默跳過
        assert diary_fts.search(db, uid, ["降級時不炸"]) == []


def test_backfill_fills_missing(client, auth_header):
    _h, uid = auth_header
    from sqlalchemy import text as sql_text
    with db_session() as db:
        diary = crud.create_diary(db, uid, "被 backfill 撿回來的登山日", title="t", summary="s")
        db.execute(sql_text("DELETE FROM diary_fts WHERE diary_id = :d"), {"d": diary.id})
        db.commit()
        assert not diary_fts.search(db, uid, ["登山日"])
    diary_fts.backfill()
    with db_session() as db:
        assert diary_fts.search(db, uid, ["登山日"])


def test_search_survives_metacharacter_terms(client, auth_header):
    """jieba 斷出的子詞可能含 FTS5 語法字元 (日期的 -、縮寫的 '、保留字等)；
    未跳脫時整條 MATCH 會 fts5 syntax error，還會拖累同批次其他乾淨的 term
    一起變成空結果 (v2.5 Spec C Task 9 fix round 1)。"""
    _h, uid = auth_header
    with db_session() as db:
        crud.create_diary(db, uid, "今天去爬山，很累但值得", title="t", summary="s")
        hits = diary_fts.search(db, uid, ["爬山", "check-in", "2026-08-23", "don't"])
    assert hits  # 爬山 命中不該被同批次裡的髒 term 拖累成空
