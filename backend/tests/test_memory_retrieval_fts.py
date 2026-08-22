"""關鍵字軌 FTS 切換與 LIKE 降級 (v2.5 Spec C Task 10)。"""
from database import db_session, crud
from services import diary_fts
from services import memory_retrieval as mrv


def _make_old_diary(uid, content, title):
    """造一篇「昨天」的日記 (檢索排除今日，測試素材必須是過去)。"""
    from datetime import timedelta
    with db_session() as db:
        diary = crud.create_diary(db, uid, content, title=title, summary=content[:50])
        diary.diary_date = diary.diary_date - timedelta(days=1)
        db.commit()
        db.refresh(diary)
        crud.update_diary(db, diary.id, content=content)  # 重索引 (日期改了)
        return diary.id


def test_fts_path_returns_snapshots(client, auth_header):
    _h, uid = auth_header
    diary_id = _make_old_diary(uid, "上週去台南吃牛肉湯很開心", "台南牛肉湯")
    hits = mrv._keyword_hits(uid, ["牛肉湯"], __import__("utils.time_utils", fromlist=["get_diary_date"]).get_diary_date())
    assert hits and hits[0][0]["id"] == diary_id
    assert set(hits[0][0].keys()) == {"id", "date", "title", "summary", "valence"}


def test_like_fallback_when_fts_down(client, auth_header, monkeypatch):
    _h, uid = auth_header
    from utils.time_utils import get_diary_date
    _make_old_diary(uid, "降級路徑也找得到爬山記錄", "爬山")
    monkeypatch.setattr(diary_fts, "_available", False)
    hits = mrv._keyword_hits(uid, ["爬山"], get_diary_date())
    assert hits and "爬山" in hits[0][0]["title"]


def test_get_relevant_memories_end_to_end(client, auth_header):
    _h, uid = auth_header
    _make_old_diary(uid, "跟凱詳去吃牛肉湯，聊了論文", "牛肉湯之夜")
    block = mrv.get_relevant_memories(uid, "我想再去吃牛肉湯")
    assert "牛肉湯之夜" in block and "《" in block  # 格式維持《標題》慣例


def test_today_excluded(client, auth_header):
    _h, uid = auth_header
    from utils.time_utils import get_diary_date
    with db_session() as db:
        crud.create_diary(db, uid, "今天剛寫的牛肉麵日記", title="今日", summary="s")
    hits = mrv._keyword_hits(uid, ["牛肉麵"], get_diary_date())
    assert hits == []  # 排除今日，避免回聲
