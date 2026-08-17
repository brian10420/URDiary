"""日記生成輸出的結構化解析 (DiaryDraft)。

daily_note_prompt 要求模型在日記正文後輸出單行 JSON tail：
{"title": ..., "summary": ..., "valence": 0.7, "arousal": 0.3}

解析容錯順序：
1. JSON tail (新格式，含 title/summary)
2. 正則提取 valence/arousal (相容舊格式「情緒評分：valence: 0.7」)
3. 後備推導：title 取正文首行、summary 取正文開頭

API 失敗在 llm.chat 已拋 LLMError；這裡只處理「合法輸出但格式不合」，
永遠回傳可入庫的草稿，不拋例外。
"""
import json
import re
from dataclasses import dataclass
from typing import Optional

TITLE_MAX = 120
SUMMARY_MAX = 500
DERIVED_TITLE_LEN = 24
DERIVED_SUMMARY_LEN = 100


@dataclass
class DiaryDraft:
    content: str
    title: Optional[str]
    summary: Optional[str]
    valence: float
    arousal: float
    stamp: Optional[str] = None   # v2.5 Spec A：AI 印章 id (未驗證原始值，day_stamp.finalize 才淨化)
    note: Optional[str] = None    # v2.5 Spec A：印章小語原始值


def _clamp(value, default=0.5):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, v))


def _clean_field(value, max_len):
    if not value or not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip().strip('"「」『』')
    return cleaned[:max_len] if cleaned else None


def derive_title(content: str) -> str:
    """後備標題：取正文第一個非空行，去除 Markdown 標記後截短。

    與前端 api_service.deriveDiaryTitle 對舊資料的顯示後備邏輯一致。
    """
    for line in (content or "").splitlines():
        line = re.sub(r"^[#>\-\*\d\.\s]+", "", line)
        line = re.sub(r"[*_`]+", "", line).strip()
        if line:
            return line[:DERIVED_TITLE_LEN]
    return "無標題日記"


def derive_summary(content: str) -> str:
    """後備摘要：正文去 Markdown 前綴後的開頭片段。"""
    text = re.sub(r"^[#>\-\*\s]+", "", content or "", flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:DERIVED_SUMMARY_LEN]


def parse_diary_output(diary_text: str) -> DiaryDraft:
    """把模型輸出解析成 DiaryDraft (永不拋例外，缺欄以後備補上)。"""
    content = (diary_text or "").strip()
    title = None
    summary = None
    valence = 0.5
    arousal = 0.5
    stamp = None
    note = None
    parsed_json = False

    # 1) JSON tail：取「最後一個」含 valence 的扁平 JSON 區塊
    #    (tail 設計上在結尾；取最後一個可避開正文裡碰巧出現的大括號)
    tail_match = None
    for m in re.finditer(r"\{[^{}]*\}", diary_text or ""):
        if "valence" in m.group(0):
            tail_match = m
    if tail_match:
        raw = tail_match.group(0)
        data = None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            try:
                data = json.loads(raw.replace("\n", " ").replace("'", '"'))
            except json.JSONDecodeError:
                data = None
        if isinstance(data, dict):
            parsed_json = True
            title = _clean_field(data.get("title"), TITLE_MAX)
            summary = _clean_field(data.get("summary"), SUMMARY_MAX)
            valence = _clamp(data.get("valence"))
            arousal = _clamp(data.get("arousal"))
            stamp = _clean_field(data.get("stamp"), 24)
            note = _clean_field(data.get("note"), 200)
            content = (diary_text[:tail_match.start()] + diary_text[tail_match.end():]).strip()

    # 2) 相容舊格式：純文字 valence/arousal
    if not parsed_json:
        vm = re.search(r'["\']?valence["\']?\s*[:=]\s*([0-9](?:\.[0-9]+)?)', diary_text or "")
        am = re.search(r'["\']?arousal["\']?\s*[:=]\s*([0-9](?:\.[0-9]+)?)', diary_text or "")
        if vm:
            valence = _clamp(vm.group(1))
        if am:
            arousal = _clamp(am.group(1))
        # 把「情緒評分：」尾段從正文剝離，避免評分文字入庫
        if "情緒評分" in content:
            content = content.split("情緒評分")[0].rstrip().rstrip("：:").rstrip()

    # 清掉移除 JSON 後殘留的空 code fence
    content = re.sub(r"```(?:json)?\s*```", "", content).strip()

    if not content:
        # 保底：寧可帶格式殘渣也不讓空白內容入庫
        content = (diary_text or "").strip() or "（生成內容為空）"

    if not title:
        title = derive_title(content)
    if not summary:
        summary = derive_summary(content)

    return DiaryDraft(
        content=content,
        title=title,
        summary=summary,
        valence=valence,
        arousal=arousal,
        stamp=stamp,
        note=note,
    )
