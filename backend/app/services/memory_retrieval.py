"""記憶檢索管線：依當前訊息撈出「相關的過往日記」注入聊天 system prompt。

雙軌設計：
- 關鍵字軌 (預設)：jieba 中文分詞 + 英文切詞 → SQL OR-LIKE 撈候選 →
  Python 計分 (匹配度 × 新近度 × 情緒強度)。零重依賴、全離線、毫秒級。
- 語意軌 (選配)：fastembed ONNX 多語模型 (multilingual-e5-small)。
  未安裝 fastembed 時整軌靜默停用，絕不影響主流程。
  embedding 於日記存檔時在背景執行緒生成 (crud.create_diary 觸發)。

合併策略：關鍵字/語意兩軌各取 top-N，以「排名交錯」去重合併
(kw1, sem1, kw2, sem2, ...)——兩軌分數量綱不同，不做絕對值比較。

Session 紀律：所有函式自開自關 session，回傳純資料後呼叫端才進 LLM 階段。
"""
import importlib.util
import logging
import re
import threading
from itertools import chain, zip_longest

from database import SessionLocal, crud
from services.diary_draft import derive_summary, derive_title
from utils.time_utils import get_diary_date, get_diary_datetime

logger = logging.getLogger(__name__)

TOP_N = 3
MAX_TERMS = 12
CANDIDATE_LIMIT = 50

# 多語對稱模型 (50+ 語言含中英)，384 維、下載約 0.22GB。
# 門檻 0.35 依實測校準 (fastembed mean pooling 版)：相關對 0.38~0.44、
# 弱相關 ~0.30、無關 < 0.21。若日後換模型需重新校準
# (e5 系列整體偏高、prefix 規則也不同)。
EMBED_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MIN_COSINE = 0.35

NO_MEMORY_PLACEHOLDER = "（本輪對話沒有明顯相關的過往日記）"

_CJK_RE = re.compile(r"[一-鿿]")
_EN_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z']{2,}")

# 停用詞：太常見、當檢索詞會匹配到所有日記的詞
ZH_STOPWORDS = frozenset("""
的 了 是 我 你 他 她 它 我們 你們 他們 這 那 這個 那個 這些 那些 這樣 那樣
就 都 而 及 與 或 也 很 到 說 要 去 會 著 沒有 沒 在 有 人 什麼 怎麼 怎麼辦
因為 所以 但是 可是 如果 覺得 感覺 知道 現在 今天 昨天 明天 最近 之前 後來
一個 一些 一直 還是 還有 然後 開始 時候 事情 東西 自己 真的 可能 應該 已經
嗯嗯 哈哈 好像 有點 比較 非常 其實 就是 不是 不會 不要 不過 剛剛 剛才
""".split())

EN_STOPWORDS = frozenset("""
the and for are was were been being with that this these those from into
about have has had having not you your yours she her him his they them
their what when where why how does did doing just very really today
yesterday tomorrow feel feels felt feeling think thought know like want
wanted going get got some any all can could would should will there here
because but yes maybe okay kind sort thing things stuff time day
""".split())

# --- 關鍵字軌 ---------------------------------------------------------------

_jieba = None
_jieba_lock = threading.Lock()


def _get_jieba():
    """惰性載入 jieba (首次載入 1-2 秒且建字典快取，不放 startup)。"""
    global _jieba
    if _jieba is None:
        with _jieba_lock:
            if _jieba is None:
                import jieba as _j
                _j.setLogLevel(logging.WARNING)
                _jieba = _j
    return _jieba


def extract_terms(text: str, max_terms: int = MAX_TERMS) -> list:
    """從文字抽出檢索詞：中文 jieba 搜尋模式 + 英文 token，過濾停用詞。"""
    if not text:
        return []
    terms, seen = [], set()

    if _CJK_RE.search(text):
        for tok in _get_jieba().cut_for_search(text):
            tok = tok.strip()
            if (len(tok) >= 2 and _CJK_RE.search(tok)
                    and tok not in ZH_STOPWORDS and tok not in seen):
                seen.add(tok)
                terms.append(tok)

    for tok in _EN_TOKEN_RE.findall(text):
        low = tok.lower()
        if low not in EN_STOPWORDS and low not in seen:
            seen.add(low)
            terms.append(low)

    return terms[:max_terms]


def _snapshot(diary) -> dict:
    """在 session 內把需要的欄位拷成純 dict，避免 detached instance。"""
    return {
        "id": diary.id,
        "date": diary.diary_date,
        "title": diary.title or derive_title(diary.content),
        "summary": diary.summary or derive_summary(diary.content),
        "valence": diary.valence,
    }


def _recency_emotion_factor(diary) -> float:
    days = max(0, (get_diary_datetime() - diary.diary_date).days)
    recency = 1.0 / (1.0 + days / 30.0)  # 30 天半衰
    valence = diary.valence if diary.valence is not None else 0.5
    emotion = 1.0 + abs(valence - 0.5)  # 情緒越強烈越值得被想起 (1.0~1.5)
    return recency * emotion


def _keyword_match_score(diary, terms: list) -> int:
    title = (diary.title or "").lower()
    summary = (diary.summary or "").lower()
    content = (diary.content or "").lower()
    score = 0
    for term in terms:
        low = term.lower()
        if low in title:
            score += 3
        if low in summary:
            score += 2
        count = content.count(low)
        if count:
            score += min(count, 3)
    return score


def _keyword_hits(user_id: int, terms: list, today) -> list:
    """回傳 [(snapshot, score)]，分數由高至低。"""
    if not terms:
        return []
    db = SessionLocal()
    try:
        candidates = crud.search_diaries_by_terms(
            db, user_id, terms, limit=CANDIDATE_LIMIT)
        scored = []
        for diary in candidates:
            if diary.diary_date.date() == today:
                continue  # 排除今日日記，避免回聲
            match = _keyword_match_score(diary, terms)
            if match < 3:  # 至少一個實質命中 (title 或 summary 或 content×3)
                continue
            scored.append((_snapshot(diary), match * _recency_emotion_factor(diary)))
        scored.sort(key=lambda pair: -pair[1])
        return scored[:TOP_N]
    finally:
        db.close()


# --- 語意軌 (選配) -----------------------------------------------------------

_embedder = None
_embedder_failed = False
_embedder_lock = threading.Lock()


def _fastembed_installed() -> bool:
    return importlib.util.find_spec("fastembed") is not None


def semantic_available() -> bool:
    """給 /system/capabilities：fastembed 已安裝且未曾載入失敗。"""
    return _fastembed_installed() and not _embedder_failed


def _get_embedder():
    """惰性載入 embedding 模型 (首次會下載 ~100MB ONNX 模型)。"""
    global _embedder, _embedder_failed
    if _embedder is not None:
        return _embedder
    if _embedder_failed or not _fastembed_installed():
        return None
    with _embedder_lock:
        if _embedder is not None or _embedder_failed:
            return _embedder
        try:
            from fastembed import TextEmbedding
            _embedder = TextEmbedding(model_name=EMBED_MODEL_NAME)
            logger.info(f"語意檢索模型已載入: {EMBED_MODEL_NAME}")
        except Exception as e:
            _embedder_failed = True
            logger.warning(f"語意檢索不可用，降級純關鍵字檢索: {e}")
    return _embedder


def _embed(texts: list, is_query: bool = False):
    """回傳 float32 numpy 向量清單或 None。

    paraphrase 系列為對稱模型，query 與文件不需要前綴
    (is_query 參數保留：若換成 e5 系列需要 query:/passage: 前綴)。
    """
    embedder = _get_embedder()
    if embedder is None:
        return None
    import numpy as np
    try:
        return [np.asarray(v, dtype=np.float32)
                for v in embedder.embed(list(texts))]
    except Exception as e:
        logger.warning(f"embedding 生成失敗: {e}")
        return None


def schedule_index_diary(diary_id: int, title, summary, content) -> None:
    """日記存檔後的 best-effort 語意索引 (crud.create_diary 呼叫)。

    在背景執行緒進行：首次模型下載可能耗時數十秒，不可阻塞請求；
    fastembed 未安裝時直接跳過。索引缺漏由關鍵字軌與 backfill CLI 兜底。
    """
    if not _fastembed_installed():
        return
    threading.Thread(
        target=_index_diary_safe,
        args=(diary_id, title, summary, content),
        daemon=True,
    ).start()


def _index_diary_safe(diary_id: int, title, summary, content) -> None:
    try:
        text = f"{title or ''}\n{summary or ''}\n{(content or '')[:1000]}"
        vectors = _embed([text])
        if not vectors:
            return
        vec = vectors[0]
        db = SessionLocal()
        try:
            crud.upsert_diary_embedding(
                db, diary_id, EMBED_MODEL_NAME, vec.tobytes(), int(vec.shape[0]))
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"日記語意索引失敗 (diary_id={diary_id}): {e}")


def _semantic_hits(user_id: int, query: str, today) -> list:
    """回傳 [(snapshot, score)]，分數由高至低；語意軌不可用時回 []。"""
    vectors = _embed([query], is_query=True)
    if not vectors:
        return []
    import numpy as np
    qvec = vectors[0]
    qnorm = float(np.linalg.norm(qvec)) or 1e-9

    db = SessionLocal()
    try:
        rows = crud.get_user_embeddings(db, user_id, EMBED_MODEL_NAME)
        scored = []
        for embedding, diary in rows:
            if diary.diary_date.date() == today:
                continue
            vec = np.frombuffer(embedding.vector, dtype=np.float32)
            if vec.shape[0] != embedding.dim:
                continue
            cosine = float(np.dot(qvec, vec) / (qnorm * (float(np.linalg.norm(vec)) or 1e-9)))
            if cosine < MIN_COSINE:
                continue
            scored.append((_snapshot(diary), cosine * _recency_emotion_factor(diary)))
        scored.sort(key=lambda pair: -pair[1])
        return scored[:TOP_N]
    finally:
        db.close()


# --- 對外入口 ----------------------------------------------------------------

def get_relevant_memories(user_id, message: str, chat_history=None,
                          semantic: bool = False) -> str:
    """組出注入 conversation prompt {relevant_memories} 槽的文字區塊。

    query = 本輪訊息 + 上一則使用者訊息 (提供跨句上下文)。
    永遠回傳非空字串 (無結果時回占位說明)，.format() 不會缺槽。
    """
    try:
        query_parts = [message or ""]
        if chat_history:
            previous_user = [m.get("content", "") for m in chat_history
                             if m.get("role") == "user"]
            if previous_user:
                query_parts.insert(0, previous_user[-1])
        query = "\n".join(part for part in query_parts if part)

        today = get_diary_date()
        uid = int(user_id)

        keyword_hits = _keyword_hits(uid, extract_terms(query), today)
        semantic_hits = _semantic_hits(uid, query, today) if semantic else []

        # 排名交錯合併 (kw1, sem1, kw2, sem2, ...)，兩軌分數不做絕對比較
        merged, seen_ids = [], set()
        for pair in chain.from_iterable(zip_longest(keyword_hits, semantic_hits)):
            if pair is None:
                continue
            snap, _score = pair
            if snap["id"] in seen_ids:
                continue
            seen_ids.add(snap["id"])
            merged.append(snap)
            if len(merged) >= TOP_N:
                break

        return format_memories(merged)
    except Exception as e:
        # 檢索是增強功能：任何失敗都不該擋掉聊天本體
        logger.warning(f"記憶檢索失敗 (user_id={user_id})，本輪不注入: {e}")
        return NO_MEMORY_PLACEHOLDER


def format_memories(snapshots: list) -> str:
    if not snapshots:
        return NO_MEMORY_PLACEHOLDER
    return "\n".join(
        f"- [{snap['date'].strftime('%Y-%m-%d')}]《{snap['title']}》{snap['summary']}"
        for snap in snapshots
    )


# --- backfill CLI ------------------------------------------------------------

def backfill_embeddings() -> None:
    """為所有缺 embedding 的日記補索引：python -m services.memory_retrieval --backfill

    (以 backend/app 為工作目錄執行)
    """
    if not _fastembed_installed():
        print("fastembed 未安裝，無法 backfill。請先: pip install fastembed")
        return
    from database.models import Diary, DiaryEmbedding

    db = SessionLocal()
    try:
        indexed = {row.diary_id for row in db.query(DiaryEmbedding.diary_id).filter(
            DiaryEmbedding.model == EMBED_MODEL_NAME)}
        pending = [(d.id, d.title, d.summary, d.content)
                   for d in db.query(Diary).all() if d.id not in indexed]
    finally:
        db.close()

    print(f"待補索引: {len(pending)} 篇")
    for i, (diary_id, title, summary, content) in enumerate(pending, 1):
        _index_diary_safe(diary_id, title, summary, content)
        print(f"  [{i}/{len(pending)}] diary_id={diary_id}")
    print("backfill 完成")


if __name__ == "__main__":
    import sys
    if "--backfill" in sys.argv:
        backfill_embeddings()
    else:
        print("用法: python -m services.memory_retrieval --backfill")
