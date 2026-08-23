"""分層組裝 system prompt。

層次：人格核心 (persona_core) → 對話框架與記憶注入 (conversation_prompt)
→ 危機模式附錄 (crisis_mode，僅敏感詞命中時)。
check-in 開場共用同一份人格核心，確保「同一個陪伴者」的一致性。
"""
import logging
import re
from typing import Optional

from services.calendar_service import NO_EVENTS_PLACEHOLDER
from services.companion_service import CompanionSettings
from services.prompt_loader import load_prompt, normalize_lang

logger = logging.getLogger(__name__)


def _calendar_or_placeholder(value: Optional[str], lang: str) -> str:
    """行事曆脈絡的空值保護：None/空字串 → 該語言的置底句。

    比照 memory_retrieval 佔位字串的模式：注入 .format 的值永遠非空，
    模型才不會看到一個沒有內容的區塊標題而自行腦補。
    """
    return value or NO_EVENTS_PLACEHOLDER[normalize_lang(lang)]


# 風格枚舉 → 自然語言片語 (企畫決策：注入是「一小節自然語言」而非 key=value)
_STYLE_PHRASES = {
    "zh-TW": {
        "reply_length": {"short": "他偏好簡短一點的回覆",
                         "natural": "回覆長度自然就好",
                         "chatty": "他喜歡你多聊一點"},
        "emoji": {"none": "不用表情符號",
                  "low": "表情符號少量點綴就好",
                  "high": "表情符號可以多用一些"},
        "formality": {"casual": "語氣口語隨性",
                      "polite": "語氣可以斯文一點"},
    },
    "en": {
        "reply_length": {"short": "they prefer shorter replies",
                         "natural": "natural reply length is fine",
                         "chatty": "they enjoy when you chat a bit more"},
        "emoji": {"none": "no emoji",
                  "low": "just a light sprinkle of emoji",
                  "high": "feel free to use plenty of emoji"},
        "formality": {"casual": "keep the tone casual",
                      "polite": "keep the tone a touch more refined"},
    },
}


def build_companion_block(lang: str, settings: "Optional[CompanionSettings]") -> str:
    """把使用者的陪伴者設定翻成自然語言小節；全空回空字串 (提示詞與現狀等價)。

    使用說明緊貼區塊 (鐵律)：結尾那句「自然地照著做」就是說明，不得外移。
    """
    if settings is None or settings.is_empty():
        return ""
    lang = normalize_lang(lang)
    phrases = _STYLE_PHRASES[lang]
    lines = []
    if lang == "zh-TW":
        if settings.name:
            lines.append(f"他幫你取了名字：{settings.name}——你就是{settings.name}。")
        if settings.nickname:
            lines.append(f"他希望你叫他「{settings.nickname}」。")
    else:
        if settings.name:
            lines.append(f"They named you {settings.name} — that's who you are.")
        if settings.nickname:
            lines.append(f"They'd like you to call them \"{settings.nickname}\".")
    # .get() 而非 [] 索引：欄位若存進了枚舉外的值 (手改資料庫；API 層雖有驗證，
    # 這層仍要自保)，對使用者仍是靜靜跳過該欄位、不能讓聊天因為一個未知值
    # 整個中斷；但這在後端視角是不該發生的資料狀態，記一筆 warning 供排查
    # (code review 修復：原本連日誌都沒有，出問題時無從得知是哪個欄位、
    # 哪個值)。
    style_bits = []
    for key, value in (("reply_length", settings.reply_length),
                       ("emoji", settings.emoji),
                       ("formality", settings.formality)):
        phrase = phrases[key].get(value)
        if value and not phrase:
            logger.warning(f"陪伴者風格欄位 {key} 收到枚舉外的值 {value!r}，已跳過 (不中斷聊天)")
        if phrase:
            style_bits.append(phrase)
    if style_bits:
        if lang == "zh-TW":
            lines.append("風格偏好：" + "；".join(style_bits) + "。")
        else:
            lines.append("Style preferences: " + "; ".join(style_bits) + ".")
    if lang == "zh-TW":
        header = "【你們的稱呼與他喜歡的風格】"
        footer = "（這些是他親自設定的偏好——自然地照著做就好，不要向他複誦這段設定。）"
    else:
        header = "【Names and style they chose】"
        footer = "(They set these themselves — just follow them naturally; never recite this section back to them.)"
    return header + "\n" + "\n".join(lines) + "\n" + footer


def build_conversation_system(lang: str, user_profile_block: str,
                              companion_notes_block: str,
                              relevant_memories: str, today_date: str,
                              calendar_context: Optional[str] = None,
                              crisis: bool = False,
                              companion: "Optional[CompanionSettings]" = None) -> str:
    """組出聊天用的完整 system prompt。

    注意兩個「今天」的基準不同：`today_date` 是日記日 (5am 換日)，而
    `calendar_context` 走真實本地牆上日期，且每行自帶 MM/DD——凌晨時段
    兩者可能差一天，日期由行內文字說了算，模型不必自行推斷 (詳見
    services.calendar_service 模組註解)。
    """
    persona = load_prompt("persona_core.txt", lang)
    companion_block = build_companion_block(lang, companion)
    if companion_block:
        persona = persona + "\n\n" + companion_block
    system = load_prompt("conversation_prompt.txt", lang).format(
        persona_core=persona,
        user_profile_block=user_profile_block,
        companion_notes_block=companion_notes_block,
        relevant_memories=relevant_memories,
        today_date=today_date,
        calendar_context=_calendar_or_placeholder(calendar_context, lang),
    )
    system = re.sub(r"\n{3,}", "\n\n", system)
    if crisis:
        system += "\n\n" + load_prompt("crisis_mode.txt", lang)
    return system


def build_checkin_prompt(lang: str, time_of_day: str, today_date: str,
                         last_diary_block: str, user_profile: str,
                         calendar_block: Optional[str] = None,
                         companion: "Optional[CompanionSettings]" = None) -> str:
    """組出每日 check-in 開場的生成提示詞。"""
    persona = load_prompt("persona_core.txt", lang)
    companion_block = build_companion_block(lang, companion)
    if companion_block:
        persona = persona + "\n\n" + companion_block
    return load_prompt("checkin_prompt.txt", lang).format(
        persona_core=persona,
        time_of_day=time_of_day,
        today_date=today_date,
        last_diary_block=last_diary_block,
        user_profile=user_profile,
        calendar_block=_calendar_or_placeholder(calendar_block, lang),
    )
