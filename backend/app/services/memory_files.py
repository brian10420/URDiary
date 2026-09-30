"""常駐記憶檔的常數與純文字 ops 引擎 (v2.5 Spec C)。

字數上限只定義在這裡 (設計裁決：常數集中一處、先測後調)。
apply_op 是純函式：吃內容字串、回 ApplyResult，無 DB、無 LLM——
review pass (memory_review) 與核可/撤銷都經同一個引擎，行為一致。
"""
import re
from dataclasses import dataclass
from typing import Optional

USER_PROFILE_MAX = 800
COMPANION_NOTES_MAX = 600
SOFT_RATIO = 0.8

FILE_KEYS = ("user_profile", "companion_notes")
FILE_LIMITS = {"user_profile": USER_PROFILE_MAX, "companion_notes": COMPANION_NOTES_MAX}

# 區段 (v2.6：標題依介面語言)。canonical key 語言無關——帳本 section 欄、ops 驗證、
# 找節標頭都認 key；檔案裡的「## 標題」則是寫入當下請求語言的標題。
# zh-TW 標題＝v2.5 原字串 (一字不改：既有 zh 檔與帳本逐位元組相容)。
SECTION_TITLES = {
    "user_profile": {
        "identity":         {"zh-TW": "稱呼與身分",     "en": "Name & identity"},
        "life_domains":     {"zh-TW": "四大生活領域",   "en": "Four life domains"},
        "emotion_patterns": {"zh-TW": "情緒模式",       "en": "Emotional patterns"},
        "timeline":         {"zh-TW": "重要事件時間線", "en": "Key events timeline"},
        "strengths":        {"zh-TW": "優勢與關鍵洞察", "en": "Strengths & key insights"},
    },
    "companion_notes": {
        "support":      {"zh-TW": "有效的支持方式", "en": "Support that works"},
        "follow_ups":   {"zh-TW": "進行中的關注",   "en": "Ongoing follow-ups"},
        "observations": {"zh-TW": "觀察與提醒",     "en": "Observations & reminders"},
    },
}
SECTIONS = {file_key: tuple(titles) for file_key, titles in SECTION_TITLES.items()}  # key，依檔內順序
# 時間線「最新在前」(v1 慣例)：add 插在節首而非節尾
TIMELINE_SECTION = "timeline"

# 檔內「## 標題」只認標題 (任一語言，casefold)——使用者手打的 `## Timeline` 不是節
_TITLE_LOOKUP = {
    file_key: {title.casefold(): key
               for key, titles in by_key.items()
               for title in titles.values()}
    for file_key, by_key in SECTION_TITLES.items()
}
# op 的 section 欄 (模型送來的) 另外接受 key；名稱在兩個檔之間不重複，但仍逐檔查表
_SECTION_LOOKUP = {
    file_key: {**titles, **{key.casefold(): key for key in SECTION_TITLES[file_key]}}
    for file_key, titles in _TITLE_LOOKUP.items()
}


def _lang_key(lang) -> str:
    return "en" if lang == "en" else "zh-TW"


def section_title(file_key: str, key: str, lang) -> str:
    return SECTION_TITLES[file_key][key][_lang_key(lang)]


def section_titles(file_key: str, lang) -> tuple:
    return tuple(section_title(file_key, key, lang) for key in SECTIONS[file_key])


def blank_template(file_key: str, lang="zh-TW") -> str:
    return "\n\n".join(f"## {title}" for title in section_titles(file_key, lang)) + "\n"


def normalize_section(file_key: str, name) -> Optional[str]:
    """容忍 '## ' 前綴、首尾空白與大小寫；任一語言的標題或 key → canonical key，不在白名單回 None。"""
    if not isinstance(file_key, str) or not isinstance(name, str):  # 模型可能送任何 JSON 型別
        return None
    cleaned = name.strip().lstrip("#").strip().casefold()
    return _SECTION_LOOKUP.get(file_key, {}).get(cleaned) if cleaned else None


def _header_key(file_key: str, line: str) -> Optional[str]:
    """檔內一行若是某節的「## 標題」回該節 key；key 字樣、未知標題、非 '## ' 行回 None。"""
    stripped = line.strip()
    if not stripped.startswith("## "):
        return None
    return _TITLE_LOOKUP.get(file_key, {}).get(stripped[3:].strip().casefold())


def canonical_section(file_key, name):
    """帳本 section 欄的存法：認得的節存 key；認不得的 (壞 op) 原樣保留當稽核真相。"""
    return normalize_section(file_key, name) or name


def localize_headers(file_key: str, content: str, lang) -> str:
    """把檔內認得的「## 節標題」全部換成 lang 的標題 (懶遷移：寫入時才做)。

    認不得的節 (使用者自己加的) 與非 '## ' 行一律不動；已是目標語言的行原樣保留。
    """
    if not content:
        return content
    lines = content.split("\n")
    for i, line in enumerate(lines):
        key = _header_key(file_key, line)  # 與找節 (_insert_into_section) 同一套判定
        if key is None:
            continue
        title = section_title(file_key, key, lang)
        if line.strip()[3:].strip() != title:
            lines[i] = f"## {title}"
    return "\n".join(lines)


def char_count(content: str) -> int:
    return len(content or "")


def over_limit(file_key: str, content: str) -> bool:
    return char_count(content) > FILE_LIMITS[file_key]


def near_limit(file_key: str, content: str) -> bool:
    return char_count(content) >= FILE_LIMITS[file_key] * SOFT_RATIO


def find_section_of(content: str, target: str) -> Optional[str]:
    """target 首次出現的位置屬於哪個 '## ' 節 (undo remove 的回填依據)。"""
    if not content or not target:
        return None
    pos = content.find(target)
    if pos < 0:
        return None
    current = None
    offset = 0
    for line in content.split("\n"):
        if line.startswith("## "):
            current = line[3:].strip()
        offset += len(line) + 1
        if offset > pos:
            return current
    return current


@dataclass
class ApplyResult:
    ok: bool
    content: str
    error: Optional[str] = None


def _fail(content: str, error: str) -> ApplyResult:
    return ApplyResult(ok=False, content=content, error=error)


def _cleanup(content: str) -> str:
    """remove 後的整理：去空彈頭列表行、收斂 3+ 連續空行、去行尾空白。"""
    lines = [ln.rstrip() for ln in content.split("\n") if not re.fullmatch(r"\s*-\s*", ln)]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text)


def _insert_into_section(file_key: str, content: str, section: str, text: str) -> Optional[str]:
    """section 是 canonical key；節標頭可以是任一語言 (舊檔／混合檔都找得到)。"""
    lines = content.split("\n")
    try:
        idx = next(i for i, ln in enumerate(lines) if _header_key(file_key, ln) == section)
    except StopIteration:
        return None
    end = len(lines)
    for j in range(idx + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    if section == TIMELINE_SECTION:
        insert_at = idx + 1  # 最新在前
    else:
        insert_at = end
        while insert_at - 1 > idx and lines[insert_at - 1].strip() == "":
            insert_at -= 1
    lines.insert(insert_at, text.strip())
    return "\n".join(lines)


def apply_op(file_key: str, content: str, action: str,
             section=None, target=None, text=None, lang=None) -> ApplyResult:
    """套用單一 op。失敗時回原 content 不變 (呼叫端據此逐筆記帳)。

    lang (v2.6)：寫入者的介面語言。給了 → 空檔從該語言的模板起、成功寫入後把
    整份檔的節標頭換成該語言 (懶遷移)；None → 舊行為 (zh 模板、標頭不動)。
    target 一律比對「套用前」的原文 (模型看到的就是它)，標頭遷移在套用之後。
    遷移不吃字數上限：en 標頭較長，換了會超標就先不換 (留到有空間的下次寫入)，
    免得接近上限的檔連「縮小」的 op (撤銷、刪除) 都被 over_budget 擋下而鎖死；
    套用前就已超標的結果照常換 (呼叫端反正會拒絕)。
    """
    content = content or ""
    result = _apply(file_key, content, action, section, target, text, lang)
    if result.ok and lang is not None:
        localized = localize_headers(file_key, result.content, lang)
        if not over_limit(file_key, localized) or over_limit(file_key, result.content):
            result.content = localized
    return result


def _apply(file_key, content, action, section, target, text, lang) -> ApplyResult:
    if action == "add":
        sec = normalize_section(file_key, section)
        if sec is None:
            return _fail(content, "bad_section")
        if not isinstance(text, str) or not text.strip():
            return _fail(content, "missing_text")
        base = content if content.strip() else blank_template(file_key, lang)  # None → zh-TW
        new = _insert_into_section(file_key, base, sec, text)
        if new is None:  # 使用者手改刪掉了節標題：附加到檔尾，不丟資料
            new = base.rstrip() + "\n" + text.strip() + "\n"
        return ApplyResult(ok=True, content=new)
    if action == "replace":
        if not isinstance(target, str) or not target:
            return _fail(content, "missing_target")
        if not isinstance(text, str) or not text.strip():
            return _fail(content, "missing_text")
        if target not in content:
            return _fail(content, "target_not_found")
        return ApplyResult(ok=True, content=content.replace(target, text.strip(), 1))
    if action == "remove":
        if not isinstance(target, str) or not target:
            return _fail(content, "missing_target")
        if target not in content:
            return _fail(content, "target_not_found")
        return ApplyResult(ok=True, content=_cleanup(content.replace(target, "", 1)))
    return _fail(content, "bad_action")
