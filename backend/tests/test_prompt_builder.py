"""鎖定 services/prompt_builder.py 的分層組裝行為
(persona_core -> conversation_prompt -> 選配的 crisis_mode 附錄)。
"""
from services.prompt_loader import load_prompt
from services.prompt_builder import build_conversation_system, build_checkin_prompt


def test_build_conversation_system_injects_all_values():
    persona = load_prompt("persona_core.txt", "zh-TW")
    system = build_conversation_system(
        lang="zh-TW",
        user_profile_block="【互動筆記哨兵文字ABC123】",
        companion_notes_block="",
        relevant_memories="【相關記憶哨兵文字XYZ789】",
        today_date="2026-08-04",
        crisis=False,
    )

    assert persona in system
    assert "【互動筆記哨兵文字ABC123】" in system
    assert "【相關記憶哨兵文字XYZ789】" in system
    assert "2026-08-04" in system


def test_build_conversation_system_crisis_false_does_not_append_crisis_mode():
    crisis_text = load_prompt("crisis_mode.txt", "zh-TW")
    system = build_conversation_system(
        lang="zh-TW",
        user_profile_block="note",
        companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04",
        crisis=False,
    )
    assert crisis_text not in system


def test_build_conversation_system_crisis_true_appends_crisis_mode():
    crisis_text = load_prompt("crisis_mode.txt", "zh-TW")
    system = build_conversation_system(
        lang="zh-TW",
        user_profile_block="note",
        companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04",
        crisis=True,
    )
    assert crisis_text in system
    # 附錄接在尾端
    assert system.endswith(crisis_text)


def test_build_checkin_prompt_injects_five_values():
    persona = load_prompt("persona_core.txt", "en")
    prompt = build_checkin_prompt(
        lang="en",
        time_of_day="【SENTINEL-TIME-OF-DAY】",
        today_date="【SENTINEL-TODAY-DATE】",
        last_diary_block="【SENTINEL-LAST-DIARY】",
        user_profile="【SENTINEL-USER-PROFILE】",
    )

    assert persona in prompt
    assert "【SENTINEL-TIME-OF-DAY】" in prompt
    assert "【SENTINEL-TODAY-DATE】" in prompt
    assert "【SENTINEL-LAST-DIARY】" in prompt
    assert "【SENTINEL-USER-PROFILE】" in prompt


# --- 行事曆脈絡注入 (calendar_context / calendar_block) -------------------------

CAL_LINE_ZH = "- [08/05(週二) 14:00]《面試》(工作)"
CAL_LINE_EN = "- [08/05(Tue) 14:00]《Interview》(work)"


def test_build_conversation_system_injects_calendar_context():
    system = build_conversation_system(
        lang="zh-TW",
        user_profile_block="note",
        companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04",
        calendar_context=CAL_LINE_ZH,
    )

    assert CAL_LINE_ZH in system
    assert "行事曆" in system  # 區塊標題存在，事件行不是裸掛在提示詞裡


def test_build_conversation_system_calendar_none_uses_placeholder_per_language():
    zh_system = build_conversation_system(
        lang="zh-TW", user_profile_block="note", companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04", calendar_context=None,
    )
    en_system = build_conversation_system(
        lang="en", user_profile_block="note", companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04", calendar_context=None,
    )

    assert "（近期沒有行事曆事件）" in zh_system
    assert "(no calendar events in the coming days)" in en_system
    # 佔位字串不可跨語言洩漏
    assert "(no calendar events in the coming days)" not in zh_system
    assert "（近期沒有行事曆事件）" not in en_system


def test_build_conversation_system_empty_calendar_string_uses_placeholder():
    system = build_conversation_system(
        lang="zh-TW", user_profile_block="note", companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04", calendar_context="",
    )
    assert "（近期沒有行事曆事件）" in system


def test_build_conversation_system_crisis_appends_after_calendar_block():
    crisis_text = load_prompt("crisis_mode.txt", "zh-TW")
    system = build_conversation_system(
        lang="zh-TW",
        user_profile_block="note",
        companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04",
        calendar_context=CAL_LINE_ZH,
        crisis=True,
    )

    assert CAL_LINE_ZH in system
    assert crisis_text in system
    assert system.endswith(crisis_text)          # 危機附錄仍在最尾端
    assert system.index(CAL_LINE_ZH) < system.index(crisis_text)


def test_build_checkin_prompt_injects_calendar_block():
    zh_prompt = build_checkin_prompt(
        lang="zh-TW",
        time_of_day="早上",
        today_date="2026-08-04",
        last_diary_block="（最近三天沒有日記）",
        user_profile="profile",
        calendar_block=CAL_LINE_ZH,
    )

    assert CAL_LINE_ZH in zh_prompt
    assert "行事曆" in zh_prompt


def test_build_checkin_prompt_calendar_none_uses_placeholder_per_language():
    zh_prompt = build_checkin_prompt(
        lang="zh-TW", time_of_day="早上", today_date="2026-08-04",
        last_diary_block="d", user_profile="p", calendar_block=None,
    )
    en_prompt = build_checkin_prompt(
        lang="en", time_of_day="morning", today_date="2026-08-04",
        last_diary_block="d", user_profile="p", calendar_block=None,
    )

    assert "（近期沒有行事曆事件）" in zh_prompt
    assert "(no calendar events in the coming days)" in en_prompt


def test_build_checkin_prompt_injects_calendar_block_en():
    en_prompt = build_checkin_prompt(
        lang="en", time_of_day="morning", today_date="2026-08-04",
        last_diary_block="d", user_profile="p", calendar_block=CAL_LINE_EN,
    )

    assert CAL_LINE_EN in en_prompt
    assert "calendar" in en_prompt.lower()


def test_build_conversation_system_calendar_context_en():
    en_system = build_conversation_system(
        lang="en", user_profile_block="note", companion_notes_block="",
        relevant_memories="mem",
        today_date="2026-08-04", calendar_context=CAL_LINE_EN,
    )

    assert CAL_LINE_EN in en_system
    assert "calendar" in en_system.lower()
