"""分層組裝 system prompt。

層次：人格核心 (persona_core) → 對話框架與記憶注入 (conversation_prompt)
→ 危機模式附錄 (crisis_mode，僅敏感詞命中時)。
check-in 開場共用同一份人格核心，確保「同一個陪伴者」的一致性。
"""
from typing import Optional

from services.calendar_service import NO_EVENTS_PLACEHOLDER
from services.prompt_loader import load_prompt, normalize_lang


def _calendar_or_placeholder(value: Optional[str], lang: str) -> str:
    """行事曆脈絡的空值保護：None/空字串 → 該語言的置底句。

    比照 memory_retrieval 佔位字串的模式：注入 .format 的值永遠非空，
    模型才不會看到一個沒有內容的區塊標題而自行腦補。
    """
    return value or NO_EVENTS_PLACEHOLDER[normalize_lang(lang)]


def build_conversation_system(lang: str, interaction_note: str,
                              relevant_memories: str, today_date: str,
                              calendar_context: Optional[str] = None,
                              crisis: bool = False) -> str:
    """組出聊天用的完整 system prompt。

    注意兩個「今天」的基準不同：`today_date` 是日記日 (5am 換日)，而
    `calendar_context` 走真實本地牆上日期，且每行自帶 MM/DD——凌晨時段
    兩者可能差一天，日期由行內文字說了算，模型不必自行推斷 (詳見
    services.calendar_service 模組註解)。
    """
    persona = load_prompt("persona_core.txt", lang)
    system = load_prompt("conversation_prompt.txt", lang).format(
        persona_core=persona,
        interaction_note=interaction_note,
        relevant_memories=relevant_memories,
        today_date=today_date,
        calendar_context=_calendar_or_placeholder(calendar_context, lang),
    )
    if crisis:
        system += "\n\n" + load_prompt("crisis_mode.txt", lang)
    return system


def build_checkin_prompt(lang: str, time_of_day: str, today_date: str,
                         last_diary_block: str, user_profile: str,
                         calendar_block: Optional[str] = None) -> str:
    """組出每日 check-in 開場的生成提示詞。"""
    persona = load_prompt("persona_core.txt", lang)
    return load_prompt("checkin_prompt.txt", lang).format(
        persona_core=persona,
        time_of_day=time_of_day,
        today_date=today_date,
        last_diary_block=last_diary_block,
        user_profile=user_profile,
        calendar_block=_calendar_or_placeholder(calendar_block, lang),
    )
