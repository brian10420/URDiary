"""鎖定 services/prompt_loader.py 的語言正規化與提示詞載入後備規則。"""
from services.prompt_loader import normalize_lang, load_prompt, get_role, FALLBACK_PROMPT


# --- normalize_lang --------------------------------------------------------------

def test_normalize_lang_english_variants():
    assert normalize_lang("en") == "en"
    assert normalize_lang("EN") == "en"
    assert normalize_lang("en-US") == "en"


def test_normalize_lang_chinese_variants():
    assert normalize_lang("zh") == "zh-TW"
    assert normalize_lang("zh-TW") == "zh-TW"


def test_normalize_lang_none_or_garbage_falls_back_to_zh_tw():
    assert normalize_lang(None) == "zh-TW"
    assert normalize_lang("") == "zh-TW"
    assert normalize_lang("亂碼xyz") == "zh-TW"
    assert normalize_lang("fr-FR") == "zh-TW"


# --- load_prompt -------------------------------------------------------------------

def test_load_prompt_en_and_zh_differ():
    en_text = load_prompt("persona_core.txt", "en")
    zh_text = load_prompt("persona_core.txt", "zh-TW")

    assert en_text.strip() != ""
    assert zh_text.strip() != ""
    assert en_text != zh_text


def test_load_prompt_missing_file_returns_fallback():
    result = load_prompt("this_file_does_not_exist.txt", "en")
    assert result == FALLBACK_PROMPT


# --- get_role ------------------------------------------------------------------------

def test_get_role_known_key_is_non_empty():
    role = get_role("companion")
    assert isinstance(role, str)
    assert role.strip() != ""


def test_get_role_unknown_key_falls_back():
    role = get_role("this_role_does_not_exist")
    assert role == "你是一位溫暖、有同理心的助手。"
