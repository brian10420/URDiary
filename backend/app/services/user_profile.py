"""記憶注入渲染 (v2.5 Spec C)——Spec B 接縫契約檔。

get_user_profile_block(user_id, lang) 是 Spec B 設計文件 §5 的契約函式：
B 落地後在「本函式內部」追加未收納 onboarding 答案的渲染，呼叫端不動。

三態 fallback（懶遷移）：新檔有內容 → 新檔；兩檔皆空且有舊互動筆記 → 舊筆記；
皆無 → 「還不熟」佔位。注入值永遠非空 (profile) 或整塊消失 (companion)。
"""
from dataclasses import dataclass

from database import db_session, crud
from services import memory_files


@dataclass
class MemoryContext:
    profile_block: str      # conversation/check-in 的使用者檔案區塊 (永遠非空)
    companion_block: str    # 陪伴者筆記區塊 (空字串=整塊消失)
    diary_context: str      # daily_note_prompt {interaction_note} 槽的純文字上下文
    has_any: bool


_EMPTY_PLACEHOLDER = {
    "zh-TW": "（你們還不熟，這可能是最初幾次見面——慢慢認識就好。）",
    "en": "(You barely know each other yet — this may be one of your first meetings. Take it slow.)",
}
_EMPTY_DIARY_CONTEXT = {"zh-TW": "尚無互動筆記記錄。", "en": "No interaction notes yet."}


def _profile_block(content: str, lang: str) -> str:
    if lang != "en":
        return ("【你對這位使用者的長期認識（使用者檔案）】\n" + content +
                "\n（使用說明：這是你長期記得他的依據。日期標記代表資訊記下的時間——對方說「今天」時，"
                "別把過去的事當成今天發生的。自然地記得就好，不要向他複誦這份檔案。）")
    return ("[Your long-term understanding of this user (user profile)]\n" + content +
            "\n(How to use: this is what you remember about them long-term. Date tags mark when "
            "each item was recorded — when they say \"today\", don't mistake past items for today. "
            "Remember naturally; never recite this file back to them.)")


def _companion_block(content: str, lang: str) -> str:
    if lang != "en":
        return ("【你自己的陪伴筆記（寫給自己的，別向他展示）】\n" + content +
                "\n（這是你為自己寫的陪伴心得與提醒——自然地照著做，不要念給他聽。）")
    return ("[Your own companion notes (for yourself — never show them)]\n" + content +
            "\n(These are your private notes on how to accompany them — follow them naturally, "
            "never read them aloud.)")


def get_memory_context(user_id: int, lang: str) -> MemoryContext:
    with db_session() as db:
        files = crud.get_memory_files(db, user_id)
        profile = files["user_profile"].content.strip() if "user_profile" in files else ""
        companion = files["companion_notes"].content.strip() if "companion_notes" in files else ""
        legacy = None
        if not profile and not companion:
            from services.interaction_service import get_latest_interaction_note
            note = get_latest_interaction_note(db, user_id)
            legacy = note.content.strip() if note and note.content else None

    if profile or companion:
        profile_block = _profile_block(profile or memory_files.blank_template("user_profile"), lang)
        companion_block = _companion_block(companion, lang) if companion else ""
        if lang != "en":
            diary_context = "使用者檔案：\n" + (profile or "（空）")
            if companion:
                diary_context += "\n\n陪伴者筆記：\n" + companion
        else:
            diary_context = "User profile:\n" + (profile or "(empty)")
            if companion:
                diary_context += "\n\nCompanion notes:\n" + companion
        return MemoryContext(profile_block, companion_block, diary_context, True)

    if legacy:  # 懶遷移期：首次 review pass 前沿用舊筆記，現狀不退化
        return MemoryContext(_profile_block(legacy, lang), "", legacy, True)

    lang_key = "en" if lang == "en" else "zh-TW"
    return MemoryContext(_profile_block(_EMPTY_PLACEHOLDER[lang_key], lang), "",
                         _EMPTY_DIARY_CONTEXT[lang_key], False)


def get_user_profile_block(user_id: int, lang: str) -> str:
    """Spec B 接縫契約：B 落地後在本函式內部加【他初次見面時告訴你的】渲染。"""
    return get_memory_context(user_id, lang).profile_block
