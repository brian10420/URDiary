"""記憶 review pass (v2.5 Spec C)。

本檔分兩層：
- 解析與素材格式化 (本任務)：純函式，無 DB、無 LLM。
- 管線與治理 (Task 4/5 擴充)：run_review_pass / ingest_diary / approve 等。
"""
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

import llm
from database import db_session, crud
from memory_manager import format_chat_content
from services import day_stamp, memory_files
from services.prompt_loader import load_prompt, get_role
from utils.time_utils import get_diary_date

logger = logging.getLogger(__name__)


def parse_review_output(raw) -> Optional[list]:
    """把模型輸出解析成 ops list。

    None＝解析失敗 (呼叫端記 log、本輪不寫入)；[]＝合法的「今天不記」。
    容錯：整段就是 JSON → code fence 包裹 → 前後有說明文字 (取首個 { 到末個 })。
    """
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
    candidates = [text]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start:end + 1])
    for cand in candidates:
        try:
            data = json.loads(cand)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and isinstance(data.get("ops"), list):
            return [op for op in data["ops"] if isinstance(op, dict)]
    return None


def format_day_notes_trail(rows, lang: str) -> str:
    """近 14 天 day_notes → 一行一天的情緒軌跡素材。"""
    if not rows:
        return "（近兩週沒有印章）" if lang != "en" else "(no stamps in the past two weeks)"
    return "\n".join(
        f"- {r.note_date.strftime('%m/%d')} [{r.stamp}] {r.phrase}" for r in rows)


def mood_hint(valence, lang: str) -> str:
    """情緒素材的單一接縫：只經 day_stamp.is_negative（未來換使用者的情緒識別模型）。"""
    v = valence if valence is not None else 0.5
    if day_stamp.is_negative(v):
        return ("情緒偏低——溫柔地記：優先記下他撐過了什麼、什麼支持方式有效；不要寫成成就清單。"
                if lang != "en" else
                "Low mood — be gentle when recording: focus on what they endured and which support helped; do not write an achievement list.")
    return "情緒平穩或不錯。" if lang != "en" else "Mood steady or good."


@dataclass
class ReviewResult:
    batch_id: str
    applied: int = 0
    pending: int = 0
    failed: int = 0
    error: Optional[str] = None

    def as_dict(self) -> dict:
        return {"batch_id": self.batch_id, "applied": self.applied,
                "pending": self.pending, "failed": self.failed, "error": self.error}


def _near_limit_hint(snapshot: dict, lang: str) -> str:
    tight = [k for k in memory_files.FILE_KEYS
             if memory_files.near_limit(k, snapshot[k])]
    if not tight:
        return ""
    names = {"user_profile": ("使用者檔案", "user profile"),
             "companion_notes": ("陪伴者筆記", "companion notes")}
    idx = 0 if lang != "en" else 1
    listed = "、".join(names[k][idx] for k in tight) if lang != "en" else ", ".join(names[k][idx] for k in tight)
    if lang != "en":
        return f"【注意】{listed}已達 80% 空間——請趁這次整併：合併同主題、刪過時、把細節抽象成 pattern。\n\n"
    return f"[Note] {listed} reached 80% of the limit — consolidate now: merge same-topic items, drop stale ones, abstract details into patterns.\n\n"


def _over_budget_feedback(over_keys: list, snapshot_counts: dict, lang: str) -> str:
    parts = []
    for key in over_keys:
        limit = memory_files.FILE_LIMITS[key]
        parts.append(f"{key} {snapshot_counts[key]}→上限 {limit}")
    detail = "；".join(parts)
    if lang != "en":
        return (f"【上次輸出超標，已被拒絕】套用後字數超過上限（{detail}）。"
                "請重新輸出「整批」ops：整併同主題、刪去過時內容，確保套用後兩檔都在上限內。\n\n")
    return (f"[Your previous output exceeded the limits and was rejected] ({detail}). "
            "Re-output the FULL ops batch: consolidate and trim so both files fit within their limits.\n\n")


def _build_prompt(snapshot: dict, lang: str, *, chat_text: str, diary_content: str,
                  valence, day_notes_rows, legacy_note: Optional[str],
                  over_budget: str = "") -> str:
    today = get_diary_date().strftime("%Y-%m-%d")
    if legacy_note:
        if lang != "en":
            legacy_block = ("【舊版互動筆記（一次性遷移素材）】\n" + legacy_note +
                            "\n（這是舊系統的筆記：請把仍然重要的內容「分流」進上面兩份檔案；這次 ops 較多是正常的。）\n\n")
        else:
            legacy_block = ("[Legacy interaction note (one-time migration material)]\n" + legacy_note +
                            "\n(Notes from the old system: sort what still matters into the two files above; a larger ops batch is expected this time.)\n\n")
    else:
        legacy_block = ""
    return load_prompt("memory_review_prompt.txt", lang).format(
        today_date=today,
        user_profile_content=snapshot["user_profile"] or "（還是空的）",
        user_profile_count=memory_files.char_count(snapshot["user_profile"]),
        user_profile_limit=memory_files.FILE_LIMITS["user_profile"],
        companion_notes_content=snapshot["companion_notes"] or "（還是空的）",
        companion_notes_count=memory_files.char_count(snapshot["companion_notes"]),
        companion_notes_limit=memory_files.FILE_LIMITS["companion_notes"],
        near_limit_hint=_near_limit_hint(snapshot, lang),
        legacy_note_block=legacy_block,
        over_budget_feedback=over_budget,
        chat_history=chat_text or ("（本次沒有對話素材）" if lang != "en" else "(no conversation material)"),
        todays_diary=diary_content or ("（無）" if lang != "en" else "(none)"),
        mood_hint=mood_hint(valence, lang),
        day_notes_trail=format_day_notes_trail(day_notes_rows, lang),
    )


def _validate_and_apply(ops: list, snapshot: dict):
    """對工作副本逐筆套用。回 (per_op_results, new_contents)。

    per_op_results: [{"op": 原始 op, "status": "applied"/"failed", "error": ...}]
    """
    contents = dict(snapshot)
    results = []
    for op in ops:
        file_key = op.get("file")
        if file_key not in memory_files.FILE_KEYS:
            results.append({"op": op, "status": "failed", "error": "bad_file"})
            continue
        action = op.get("action")
        applied = memory_files.apply_op(
            file_key, contents[file_key], action,
            section=op.get("section"), target=op.get("target"), text=op.get("text"))
        if applied.ok:
            # undo remove 需要知道原節：套用前回填 section (find_section_of 看「套用前」內容)
            if action == "remove" and not op.get("section"):
                op["section"] = memory_files.find_section_of(contents[file_key], op.get("target") or "")
            contents[file_key] = applied.content
            results.append({"op": op, "status": "applied", "error": None})
        else:
            results.append({"op": op, "status": "failed", "error": applied.error})
    return results, contents


def _op_rows(user_id, batch_id, source, diary_id, results, status_map=None) -> list:
    """把套用結果轉成 crud.create_memory_ops 的 dict 列。status_map 可整批覆寫。"""
    rows = []
    for item in results:
        op = item["op"]
        status = item["status"]
        if status_map is not None:
            status = status_map.get(item["status"], item["status"])
        rows.append({
            "user_id": user_id,
            "file_key": op.get("file") if op.get("file") in memory_files.FILE_KEYS else "user_profile",
            "batch_id": batch_id,
            "action": op.get("action") if op.get("action") in ("add", "replace", "remove") else "add",
            "section": op.get("section"),
            "target_text": op.get("target"),
            "new_text": op.get("text"),
            "status": status,
            "source": source,
            "source_diary_id": diary_id,
            "error": item["error"],
        })
    return rows


def run_review_pass(user_id: int, cfg, lang: str = "zh-TW", *,
                    source: str = "review_pass", chat_history=None,
                    diary_content: str = "", diary_id=None, valence=None) -> ReviewResult:
    """對話後記憶更新 (取代舊 process_interaction_note_update)。

    連線紀律：讀→關→LLM→開→寫；任何失敗都不該擋日記主流程 (呼叫端 catch LLMError)。
    """
    batch_id = str(uuid.uuid4())
    result = ReviewResult(batch_id=batch_id)

    # --- 讀階段 (短交易，取完關閉) ---
    with db_session() as db:
        files = crud.get_memory_files(db, user_id)
        snapshot = {k: (files[k].content if k in files else "") for k in memory_files.FILE_KEYS}
        legacy_note = None
        if not any(snapshot.values()):
            from services.interaction_service import get_latest_interaction_note
            note = get_latest_interaction_note(db, user_id)
            legacy_note = note.content if note else None
        user = crud.get_user(db, user_id)
        approval = (user is not None and user.memory_write_mode == "approval")
        today = get_diary_date()
        day_rows = crud.get_day_notes(db, user_id, today - timedelta(days=13), today)

    chat_text = format_chat_content(chat_history) if chat_history else ""

    # --- LLM 階段 (不持有 DB 連線)；超標 retry 一次 ---
    def _call(over_budget_feedback=""):
        prompt = _build_prompt(snapshot, lang, chat_text=chat_text,
                               diary_content=diary_content, valence=valence,
                               day_notes_rows=day_rows, legacy_note=legacy_note,
                               over_budget=over_budget_feedback)
        raw = llm.chat([{"role": "system", "content": get_role("note_taker", lang)},
                        {"role": "user", "content": prompt}], cfg)
        return parse_review_output(raw)

    ops = _call()
    if ops is None:
        logger.warning(f"記憶 review 解析失敗 (user_id={user_id})，本輪不寫入")
        result.error = "parse_failed"
        return result
    if not ops:
        return result  # 平凡的一天：不記，也不留帳

    results, contents = _validate_and_apply(ops, snapshot)
    over = [k for k in memory_files.FILE_KEYS if memory_files.over_limit(k, contents[k])]
    if over:
        counts = {k: memory_files.char_count(contents[k]) for k in over}
        ops = _call(_over_budget_feedback(over, counts, lang))
        if ops is None or not ops:
            results = [{"op": o["op"], "status": "failed", "error": "over_budget"} for o in results]
            contents = None
        else:
            results, contents = _validate_and_apply(ops, snapshot)  # 重試對「原始」快照重來
            over = [k for k in memory_files.FILE_KEYS if memory_files.over_limit(k, contents[k])]
            if over:
                results = [{"op": o["op"], "status": "failed", "error": "over_budget"} for o in results]
                contents = None

    # --- 寫階段 (第二個短交易) ---
    with db_session() as db:
        if contents is None:  # 整批超標拒絕：檔案不動
            rows = _op_rows(user_id, batch_id, source, diary_id, results)
            crud.create_memory_ops(db, rows)
            result.failed = len(rows)
            result.error = "over_budget"
            return result
        if approval:
            # 明顯無效的立即記 failed；有效的進 pending，檔案不動
            rows = _op_rows(user_id, batch_id, source, diary_id, results,
                            status_map={"applied": "pending"})
            crud.create_memory_ops(db, rows)
            result.pending = sum(1 for r in rows if r["status"] == "pending")
            result.failed = sum(1 for r in rows if r["status"] == "failed")
            return result
        for key in memory_files.FILE_KEYS:
            if contents[key] != snapshot[key]:
                crud.upsert_memory_file(db, user_id, key, contents[key])
        rows = _op_rows(user_id, batch_id, source, diary_id, results)
        crud.create_memory_ops(db, rows)
        result.applied = sum(1 for r in rows if r["status"] == "applied")
        result.failed = sum(1 for r in rows if r["status"] == "failed")
        return result


def ingest_diary(user_id: int, diary_id: int, cfg, lang: str = "zh-TW") -> ReviewResult:
    """Spec D consent ingestion 接口：以單篇日記為素材跑 review pass (無對話歷史)。"""
    with db_session() as db:
        diary = crud.get_diary(db, diary_id)
        if diary is None or diary.user_id != user_id:
            return ReviewResult(batch_id="", error="diary_not_found")
        content, valence = diary.content, diary.valence
    return run_review_pass(user_id, cfg, lang=lang, source="diary_ingest",
                           chat_history=None, diary_content=content,
                           diary_id=diary_id, valence=valence)
