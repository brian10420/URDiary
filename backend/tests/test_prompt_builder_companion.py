"""companion 設定 → 自然語言注入小節。"""
from services.companion_service import CompanionSettings, EMPTY_COMPANION
from services.prompt_builder import (build_companion_block,
                                     build_conversation_system)


def test_empty_settings_produce_empty_block():
    assert build_companion_block("zh-TW", EMPTY_COMPANION) == ""
    assert build_companion_block("zh-TW", None) == ""


def test_full_settings_zh_block():
    s = CompanionSettings(name="小澄", nickname="阿哲", reply_length="short",
                          emoji="none", formality="polite")
    block = build_companion_block("zh-TW", s)
    assert "小澄" in block and "阿哲" in block
    assert "簡短" in block and "不用表情符號" in block and "斯文" in block
    assert block.startswith("【")  # 是一個帶標題的小節


def test_partial_settings_only_mention_set_fields():
    s = CompanionSettings(name="小澄")
    block = build_companion_block("zh-TW", s)
    assert "小澄" in block
    assert "表情符號" not in block and "回覆" not in block


def test_conversation_system_appends_block_after_persona():
    s = CompanionSettings(name="小澄")
    base = build_conversation_system(lang="zh-TW", interaction_note="無",
                                     relevant_memories="無", today_date="2026-08-14")
    with_c = build_conversation_system(lang="zh-TW", interaction_note="無",
                                       relevant_memories="無",
                                       today_date="2026-08-14", companion=s)
    assert "小澄" in with_c and "小澄" not in base
    assert with_c.replace(build_companion_block("zh-TW", s), "").replace("\n\n", "\n") \
        .startswith(base[:40].replace("\n\n", "\n"))  # persona 開頭不變


def test_conversation_system_empty_companion_identical_to_none():
    kwargs = dict(lang="zh-TW", interaction_note="無", relevant_memories="無",
                  today_date="2026-08-14")
    assert build_conversation_system(**kwargs) == \
        build_conversation_system(**kwargs, companion=EMPTY_COMPANION)


def test_en_block_localized():
    s = CompanionSettings(name="Sunny", reply_length="chatty")
    block = build_companion_block("en", s)
    assert "Sunny" in block and "chat" in block.lower()


def test_out_of_enum_style_value_skipped_not_raised():
    s = CompanionSettings(name="小澄", reply_length="explosive")
    block = build_companion_block("zh-TW", s)
    assert "小澄" in block
    assert "回覆" not in block
