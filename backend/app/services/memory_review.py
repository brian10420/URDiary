"""記憶 review pass (v2.5 Spec C)。

本檔分兩層：
- 解析與素材格式化 (本任務)：純函式，無 DB、無 LLM。
- 管線與治理 (Task 4/5 擴充)：run_review_pass / ingest_diary / approve 等。
"""
import json
import logging
import re
from typing import Optional

from services import day_stamp

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
