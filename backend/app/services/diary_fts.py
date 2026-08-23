"""日記全文檢索：SQLite FTS5 索引層 (v2.5 Spec C)。

- 入索引前先 jieba 斷詞 (FTS5 內建 tokenizer 不切中文詞)；查詢端
  memory_retrieval.extract_terms 同用 jieba——查索同一把刀。
- bm25 權重 title 3 / summary 2 / content 1 / note(day_note 小語) 2。
- 降級保險：FTS5 不可用 (罕見自編譯 SQLite) → available() False，
  同步 hook 靜默跳過、檢索退回 LIKE 路徑 (memory_retrieval)。
- 維護：crud 的 create/update/delete_diary 與 upsert_day_note 呼叫本模組；
  startup 若表空則背景緒 backfill (比照 embeddings 模式)。
"""
import logging
import threading

from sqlalchemy import text as sql_text

logger = logging.getLogger(__name__)

FTS_TABLE = "diary_fts"
_CREATE_SQL = (
    f"CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5("
    "seg_title, seg_summary, seg_content, seg_note, "
    "diary_id UNINDEXED, user_id UNINDEXED)"
)
# bm25 一個欄位一個權重 (含 UNINDEXED 欄位佔位，權重 0)
_BM25 = f"bm25({FTS_TABLE}, 3.0, 2.0, 1.0, 2.0, 0.0, 0.0)"

_available = False


def available() -> bool:
    return _available


def ensure_fts(engine) -> bool:
    """建虛擬表 (冪等)。失敗＝FTS5 不可用，整層降級。"""
    global _available
    try:
        with engine.begin() as conn:
            conn.execute(sql_text(_CREATE_SQL))
        _available = True
    except Exception as e:
        _available = False
        logger.warning(f"FTS5 不可用，檢索降級 LIKE 路徑: {e}")
    return _available


def _segment(value) -> str:
    """jieba 搜尋模式斷詞後以空白連接 (與查詢端同一把刀)。"""
    if not value:
        return ""
    from services.memory_retrieval import _get_jieba
    return " ".join(tok.strip() for tok in _get_jieba().cut_for_search(str(value)) if tok.strip())


def index_diary(db, diary) -> None:
    """重建單篇日記的索引列 (含 day_note 小語)；降級時靜默跳過。"""
    if not _available:
        return
    try:
        note_phrase = ""
        row = db.execute(sql_text(
            "SELECT phrase FROM day_notes WHERE source_diary_id = :d LIMIT 1"),
            {"d": diary.id}).fetchone()
        if row:
            note_phrase = row[0] or ""
        db.execute(sql_text(f"DELETE FROM {FTS_TABLE} WHERE diary_id = :d"), {"d": diary.id})
        db.execute(sql_text(
            f"INSERT INTO {FTS_TABLE} (seg_title, seg_summary, seg_content, seg_note, diary_id, user_id) "
            "VALUES (:t, :s, :c, :n, :d, :u)"),
            {"t": _segment(diary.title), "s": _segment(diary.summary),
             "c": _segment(diary.content), "n": _segment(note_phrase),
             "d": diary.id, "u": diary.user_id})
        db.commit()
    except Exception as e:
        logger.warning(f"FTS 索引失敗 (diary_id={getattr(diary, 'id', '?')}): {e}")
        try:
            db.rollback()
        except Exception:
            pass  # rollback 本身失敗也不該再往外炸——這裡只是盡力清理


def remove_diary(db, diary_id: int) -> None:
    if not _available:
        return
    try:
        db.execute(sql_text(f"DELETE FROM {FTS_TABLE} WHERE diary_id = :d"), {"d": diary_id})
        db.commit()
    except Exception as e:
        logger.warning(f"FTS 移除失敗 (diary_id={diary_id}): {e}")
        try:
            db.rollback()
        except Exception:
            pass  # rollback 本身失敗也不該再往外炸——這裡只是盡力清理


def search(db, user_id: int, terms, limit: int = 50):
    """回 [(diary_id, relevance)]，相關度大者在前；降級或無詞回 []。

    每個 term 先以 jieba 斷成子詞 (與索引端同一把刀)，子詞之間用 AND
    (詞義上仍是同一個查詢詞，缺一角就不算命中；避免像「原始內容」的子詞
    「內容」單獨飄出去命中不相干的文件)；只在最後一個子詞加 `*` 前綴，
    容許 jieba 把詞尾與後面的字黏成一塊的斷詞誤差 (例如「牛肉湯」在某些
    上下文被切成「牛肉」+「湯大勝利」，仍要能命中)。多個 term 之間 OR。
    每個子詞個別加雙引號包成 FTS5 短語 (內部 `"` 轉義成 `""`)，`*` 前綴
    放在收尾引號外——子詞來自 jieba 未經清洗，日期/英文縮寫/半形符號等
    都可能單獨成詞 (例如 "2026-08-23" 斷成 2026/-/08/-/23)，裸字組
    match 字串會被當成 FTS5 查詢語法解析、任何一個子詞撞到語法字元
    (括號、冒號、單引號、`*`、保留字 AND/OR/NOT…) 就整條 MATCH 直接
    fts5 syntax error；短語引號讓這些內容一律被當成純文字丟給
    tokenizer，不會被解析成運算子，且不影響比對結果 (已實測與未跳脫
    的裸字版本分數一致)。切勿為了「精簡」拿掉這層引號。
    """
    if not _available or not terms:
        return []
    clauses = []
    for t in terms:
        subtokens = [tok for tok in _segment(t).split() if tok]
        if not subtokens:
            continue
        escaped = ['"' + tok.replace('"', '""') + '"' for tok in subtokens]
        escaped[-1] = escaped[-1] + "*"
        clauses.append("(" + " AND ".join(escaped) + ")")
    if not clauses:
        return []
    match = " OR ".join(clauses)
    try:
        rows = db.execute(sql_text(
            f"SELECT diary_id, {_BM25} AS score FROM {FTS_TABLE} "
            f"WHERE {FTS_TABLE} MATCH :q AND user_id = :u "
            "ORDER BY score LIMIT :n"),
            {"q": match, "u": user_id, "n": limit}).fetchall()
        # SQLite bm25 值越小越相關 (實務為負值)：取負轉成「越大越相關」
        return [(int(r[0]), -float(r[1])) for r in rows]
    except Exception as e:
        logger.warning(f"FTS 查詢失敗，本輪回空: {e}")
        return []


def backfill() -> int:
    """為缺索引列的日記補索引；回補了幾篇。CLI 與 startup 背景緒共用。"""
    if not _available:
        return 0
    from database import db_session
    from database.models import Diary
    filled = 0
    with db_session() as db:
        indexed = {int(r[0]) for r in db.execute(
            sql_text(f"SELECT diary_id FROM {FTS_TABLE}")).fetchall()}
        for diary in db.query(Diary).all():
            if diary.id not in indexed:
                index_diary(db, diary)
                filled += 1
    if filled:
        logger.info(f"FTS backfill 完成: {filled} 篇")
    return filled


def start_backfill_thread_if_empty() -> None:
    """startup 用：表空且有日記時，背景緒補索引 (不阻塞啟動)。"""
    if not _available:
        return
    from database import db_session
    try:
        with db_session() as db:
            fts_count = db.execute(sql_text(f"SELECT count(*) FROM {FTS_TABLE}")).scalar() or 0
            diary_count = db.execute(sql_text("SELECT count(*) FROM diaries")).scalar() or 0
        if fts_count == 0 and diary_count > 0:
            threading.Thread(target=backfill, daemon=True).start()
    except Exception as e:
        logger.warning(f"FTS backfill 排程失敗: {e}")


if __name__ == "__main__":
    import sys
    from database import engine as _engine
    if "--backfill" in sys.argv:
        ensure_fts(_engine)
        print(f"補了 {backfill()} 篇")
    else:
        print("用法: python -m services.diary_fts --backfill")
