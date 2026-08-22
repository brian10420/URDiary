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

SECTIONS = {
    "user_profile": ("稱呼與身分", "四大生活領域", "情緒模式", "重要事件時間線", "優勢與關鍵洞察"),
    "companion_notes": ("有效的支持方式", "進行中的關注", "觀察與提醒"),
}
# 時間線「最新在前」(v1 慣例)：add 插在節首而非節尾
TIMELINE_SECTION = "重要事件時間線"


def blank_template(file_key: str) -> str:
    return "\n\n".join(f"## {sec}" for sec in SECTIONS[file_key]) + "\n"


def normalize_section(file_key: str, name) -> Optional[str]:
    """容忍 '## ' 前綴與首尾空白；回白名單正名，不在白名單回 None。"""
    if not isinstance(name, str):
        return None
    cleaned = name.strip().lstrip("#").strip()
    return cleaned if cleaned in SECTIONS.get(file_key, ()) else None


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


def _insert_into_section(content: str, section: str, text: str) -> Optional[str]:
    lines = content.split("\n")
    header = f"## {section}"
    try:
        idx = next(i for i, ln in enumerate(lines) if ln.strip() == header)
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
             section=None, target=None, text=None) -> ApplyResult:
    """套用單一 op。失敗時回原 content 不變 (呼叫端據此逐筆記帳)。"""
    content = content or ""
    if action == "add":
        sec = normalize_section(file_key, section)
        if sec is None:
            return _fail(content, "bad_section")
        if not isinstance(text, str) or not text.strip():
            return _fail(content, "missing_text")
        base = content if content.strip() else blank_template(file_key)
        new = _insert_into_section(base, sec, text)
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
