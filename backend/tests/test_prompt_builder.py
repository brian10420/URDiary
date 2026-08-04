"""鎖定 services/prompt_builder.py 的分層組裝行為
(persona_core -> conversation_prompt -> 選配的 crisis_mode 附錄)。
"""
from services.prompt_loader import load_prompt
from services.prompt_builder import build_conversation_system, build_checkin_prompt


def test_build_conversation_system_injects_all_values():
    persona = load_prompt("persona_core.txt", "zh-TW")
    system = build_conversation_system(
        lang="zh-TW",
        interaction_note="【互動筆記哨兵文字ABC123】",
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
        interaction_note="note",
        relevant_memories="mem",
        today_date="2026-08-04",
        crisis=False,
    )
    assert crisis_text not in system


def test_build_conversation_system_crisis_true_appends_crisis_mode():
    crisis_text = load_prompt("crisis_mode.txt", "zh-TW")
    system = build_conversation_system(
        lang="zh-TW",
        interaction_note="note",
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
