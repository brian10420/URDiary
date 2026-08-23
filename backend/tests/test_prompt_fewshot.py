# backend/tests/test_prompt_fewshot.py
"""few-shot 段防護欄 (v2.5 Spec B §3/§6)。

禁詞掃描只掃 few-shot 段——全檔 grep 會誤報（「加油」本來就列在 persona_core
的【禁止的句式】清單裡）。清單動態取自兩語 persona_core，之後 persona 禁詞
更新，本測試自動跟上。
"""
import re
from pathlib import Path

PROMPTS = Path(__file__).resolve().parents[1] / "app" / "services" / "prompts"
ZH_MARKER = "【回應手感示範】"
EN_MARKER = "[How replies should feel"


def _read(lang, name):
    return (PROMPTS / lang / name).read_text(encoding="utf-8")


def _fewshot_section(lang):
    text = _read(lang, "conversation_prompt.txt")
    marker = ZH_MARKER if lang == "zh-TW" else EN_MARKER
    assert marker in text, f"{lang} conversation_prompt 缺 few-shot 段標題"
    return text[text.index(marker):]


def _banned_words(lang):
    text = _read(lang, "persona_core.txt")
    header = "【禁止的句式】" if lang == "zh-TW" else "【Banned phrases】"
    lines = text[text.index(header):].splitlines()
    banned_line = next(l for l in lines[1:] if l.strip())
    if lang == "zh-TW":
        items = re.findall(r"「(.+?)」", banned_line)
    else:
        items = re.findall(r"\"(.+?)\"", banned_line)
    items = [i.rstrip("…") for i in items]
    assert len(items) >= 5, "persona 禁詞清單讀取失敗"
    return items


def test_fewshot_no_banned_words_zh():
    section = _fewshot_section("zh-TW")
    for word in _banned_words("zh-TW"):
        assert word not in section, f"few-shot 段含 zh 禁詞：{word}"


def test_fewshot_no_banned_words_en():
    section = _fewshot_section("en").lower()
    for word in _banned_words("en"):
        assert word.lower() not in section, f"few-shot 段含 en 禁詞：{word}"


def test_fewshot_no_braces_no_title_citations():
    zh = _fewshot_section("zh-TW")
    en = _fewshot_section("en")
    for section in (zh, en):
        assert "{" not in section and "}" not in section  # .format() 花括號炸彈
    assert "《" not in zh   # 例句不得含具體《標題》引用（引用示範由既有段落承擔）
    assert "“" not in en    # en 的日記標題引用慣例用彎引號，few-shot 不得模仿


def test_fewshot_has_contrast_pair_and_four_scenes():
    zh = _fewshot_section("zh-TW")
    en = _fewshot_section("en")
    for section in (zh, en):
        assert "✗" in section and "✓" in section  # 例 1 的分量對比
    for marker in ("一、", "二、", "三、", "四、"):
        assert marker in zh
    for marker in ("1.", "2.", "3.", "4."):
        assert marker in en


def test_conversation_format_smoke_both_langs():
    from services.prompt_loader import load_prompt
    for lang, marker in (("zh-TW", ZH_MARKER), ("en", EN_MARKER)):
        tpl = load_prompt("conversation_prompt.txt", lang)
        out = tpl.format(persona_core="P", user_profile_block="U",
                         companion_notes_block="C", relevant_memories="M",
                         today_date="2026-08-24", calendar_context="K")
        assert marker in out
