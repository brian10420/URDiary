"""記憶注入渲染 (v2.5 Spec C)——Spec B 接縫已於本檔落地。

raw onboarding 答案（未收納者）由 get_memory_context 附掛渲染
（【他初次見面時告訴你的】區塊＋diary_context 純文字版），conversation／
check-in／get_user_profile_block 呼叫端零改動（spec §7-1）。

三態 fallback（懶遷移）：新檔有內容 → 新檔；兩檔皆空且有舊互動筆記 → 舊筆記；
皆無 → 「還不熟」佔位（只有未收納答案時 → raw 區塊獨挑）。注入值永遠非空
(profile) 或整塊消失 (companion)。
"""
import re
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


# onboarding 答案的渲染標籤 (v2.5 Spec B)：key 順序由 models.ONBOARDING_QUESTION_KEYS 決定。
#
# ⚠ 與 memory_review.run_review_pass 的耦合：那邊的 onboarding_ids 收「查詢回來的
# 每一列」，而下面 render_onboarding_lines 會把「查不到標籤的 key 直接跳過」——
# 兩者只在標籤表涵蓋所有 key 時才對齊。日後新增第 9 題卻忘了在這裡補標籤，那題
# 就會被標成「已收納」(ingested_at)，但它從頭到尾沒有出現在任何送進模型的素材裡
# ——答案等於憑空蒸發，且沒有任何 UI 能重跑。新增題目＝同時補這張表的兩種語言。
ONBOARDING_LABELS = {
    "zh-TW": {"name": "稱呼", "location": "住的城市", "favorite_food": "喜歡的食物",
              "important_people": "重要的人", "hobbies": "喜歡做的事",
              "strengths": "他眼中自己的優點", "self_view": "他怎麼形容自己"},
    "en": {"name": "Name to call them", "location": "City", "favorite_food": "Favorite food",
           "important_people": "People who matter", "hobbies": "Hobbies",
           "strengths": "Strength in their own eyes", "self_view": "How they describe themselves"},
}


_BREAK_CHARS = re.compile(r"[\r\n\t\x0b\x0c]+")   # 斷行類 → 空白 (壓成單行)
_DROP_CHARS = re.compile(r"[\x00-\x08\x0e-\x1f\x7f]")   # 其餘控制字元 → 刪除


def _flatten_answer(text: str) -> str:
    """答案原文 → 可安全放進提示詞區塊的「單行」文字。

    答案本身照 spec §4 以原文入庫、也不在 schema 層擋換行 (擋了就是 422，
    而前端寫入失敗是刻意吞掉的 → 合法的多行答案會無聲消失，用真實的資料
    遺失換一個只能自傷的問題不划算)。防線放在這裡：answer_text 來自
    <textarea>，換行過得了 .trim()，一旦原樣渲染進【他初次見面時告訴你的】
    區塊 (_onboarding_block) 或 review pass 素材 (memory_review._onboarding_material)，
    使用者就能自己偽造一行假的 【】 標頭或區塊結尾、假裝成系統給模型的指示。
    兩個注入點共用本函式，所以壓在這一處就同時關上兩邊。
    """
    if not text:
        return ""
    return _BREAK_CHARS.sub(" ", _DROP_CHARS.sub("", text)).strip()


def render_onboarding_lines(rows, lang: str) -> list:
    """未收納答案 → 渲染行清單（raw 注入區塊與 review pass 素材共用）。

    rows 已由 crud.get_uningested_onboarding_answers 濾掉空字串與 companion_naming；
    這裡再以標籤 dict 防守一次未知 key（直接跳過——但**跳過不等於沒被標成已收納**，
    見 ONBOARDING_LABELS 上方的耦合警告）。呼叫端必須在 db session 內呼叫
    （rows 是 ORM 物件，session 關閉後不得再碰屬性）。
    """
    from database.models import ONBOARDING_QUESTION_KEYS
    lang_key = "en" if lang == "en" else "zh-TW"
    labels = ONBOARDING_LABELS[lang_key]
    order = {k: i for i, k in enumerate(ONBOARDING_QUESTION_KEYS)}
    lines = []
    for r in sorted(rows, key=lambda r: order.get(r.question_key, 99)):
        label = labels.get(r.question_key)
        if not label:
            continue
        date = r.answered_at.strftime("%Y-%m-%d") if r.answered_at else ""
        answer = _flatten_answer(r.answer_text)
        if lang_key == "zh-TW":
            lines.append(f"-（{date}）{label}：{answer}")
        else:
            lines.append(f"- ({date}) {label}: {answer}")
    return lines


def _onboarding_block(lines: list, lang: str) -> str:
    """【他初次見面時告訴你的】區塊（使用說明緊貼鐵律）。lines 空時呼叫端不該進來。"""
    body = "\n".join(lines)
    if lang != "en":
        return ("【他初次見面時告訴你的】\n" + body +
                "\n（使用說明：這些是他初次見面自我介紹時親口說的原文。自然地記得就好，"
                "別把這份清單複誦給他；日期是他說這些話的時間——他說「今天」時，"
                "別把過去的回答當成今天的事。）")
    return ("[What they told you when you first met]\n" + body +
            "\n(How to use: these are their own words from your first meeting. Remember them "
            "naturally — never recite this list back to them; the dates mark when they said it, "
            "so when they say \"today\", don't mistake these for today's news.)")


def _onboarding_context(lines: list, lang: str) -> str:
    """diary_context 的純文字版（daily_note 的 {interaction_note} 槽）。"""
    header = "初次見面他告訴你的：" if lang != "en" else "What they told you at first meeting:"
    return header + "\n" + "\n".join(lines)


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
        # v2.5 Spec B：未收納的初次見面答案 (session 內先渲染成字串，關閉後不碰 ORM)
        onboarding_lines = render_onboarding_lines(
            crud.get_uningested_onboarding_answers(db, user_id), lang)

    onb_block = _onboarding_block(onboarding_lines, lang) if onboarding_lines else ""
    onb_context = _onboarding_context(onboarding_lines, lang) if onboarding_lines else ""

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
        if onb_block:
            profile_block += "\n\n" + onb_block
            diary_context += "\n\n" + onb_context
        return MemoryContext(profile_block, companion_block, diary_context, True)

    if legacy:  # 懶遷移期：首次 review pass 前沿用舊筆記，現狀不退化
        profile_block = _profile_block(legacy, lang)
        diary_context = legacy
        if onb_block:
            profile_block += "\n\n" + onb_block
            diary_context += "\n\n" + onb_context
        return MemoryContext(profile_block, "", diary_context, True)

    if onb_block:  # 檔案與舊筆記皆無、只有初次見面答案：raw 區塊獨挑 (B §7-1/§7-2)
        return MemoryContext(onb_block, "", onb_context, True)

    lang_key = "en" if lang == "en" else "zh-TW"
    return MemoryContext(_profile_block(_EMPTY_PLACEHOLDER[lang_key], lang), "",
                         _EMPTY_DIARY_CONTEXT[lang_key], False)


def get_user_profile_block(user_id: int, lang: str) -> str:
    """Spec B 接縫契約（已落地）：【他初次見面時告訴你的】由 get_memory_context
    內部附掛在 profile_block 上，本包裝維持零改動（spec §7-1）。"""
    return get_memory_context(user_id, lang).profile_block
