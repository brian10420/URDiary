"""分層組裝 system prompt。

層次：人格核心 (persona_core) → 對話框架與記憶注入 (conversation_prompt)
→ 危機模式附錄 (crisis_mode，僅敏感詞命中時)。
check-in 開場共用同一份人格核心，確保「同一個陪伴者」的一致性。
"""
from services.prompt_loader import load_prompt


def build_conversation_system(lang: str, interaction_note: str,
                              relevant_memories: str, today_date: str,
                              crisis: bool = False) -> str:
    """組出聊天用的完整 system prompt。"""
    persona = load_prompt("persona_core.txt", lang)
    system = load_prompt("conversation_prompt.txt", lang).format(
        persona_core=persona,
        interaction_note=interaction_note,
        relevant_memories=relevant_memories,
        today_date=today_date,
    )
    if crisis:
        system += "\n\n" + load_prompt("crisis_mode.txt", lang)
    return system


def build_checkin_prompt(lang: str, time_of_day: str, today_date: str,
                         last_diary_block: str, user_profile: str) -> str:
    """組出每日 check-in 開場的生成提示詞。"""
    persona = load_prompt("persona_core.txt", lang)
    return load_prompt("checkin_prompt.txt", lang).format(
        persona_core=persona,
        time_of_day=time_of_day,
        today_date=today_date,
        last_diary_block=last_diary_block,
        user_profile=user_profile,
    )
