"""初次見面完成時的取名判定 (v2.5 Spec B 驗收回饋①)。

onboarding 依設計純腳本、零 LLM，取名題當下只能照字面收下答案——「我想叫你
小樹洞」整句就成了名字；有人甚至在下一題才改口（「等等你的名字改成喵喵好了，
我的才是可愛33」）。/onboarding/complete 首次完成時在這裡多跑一次小呼叫，
讀全部原文答案（含取名題與後題改口）判斷使用者真正想取的名字，直接寫回
users.companion_name——那是使用者明講的意願、不是模型推論，所以不走記憶
核可帳本。取名答案仍然不進記憶檔（companion_naming 照舊排除在收納外，
本模組只讀不戳記）。

獨立一次呼叫、不塞進 memory_review 的 review pass：parse_review_output 回傳
裸 ops list，塞欄位得改回傳形狀並穿過 retry/超標路徑；而且使用者只答取名、
其餘跳過時根本沒有收納素材，review pass 不會跑。

best-effort：判不出 (null)、違規 (空、>12 字) 或任何失敗 → 名字維持腳本版，
行為與沒有這一步時完全相同，不會更糟。
"""
import json
import logging
import re
from typing import NamedTuple, Optional

import llm
from database import db_session, crud
from services.prompt_loader import get_role, load_prompt, normalize_lang
from services.user_profile import ONBOARDING_LABELS, _flatten_answer

logger = logging.getLogger(__name__)

NAME_MAX_CHARS = 12   # 與前端 onboarding_module.js 的 NAME_MAX_CHARS 同一把尺 (code point 數)

# 取名題不在 ONBOARDING_LABELS 裡——那張表只收「使用者資料」，companion_naming
# 依設計不收納。標籤沿用那張表的視角：「他」是使用者、「你」是讀素材的模型。
_NAMING_LABEL = {"zh-TW": "他想幫你取的名字", "en": "The name they'd give you"}
_NO_NAME_MARKER = {"zh-TW": "（還沒有名字）", "en": "(no name yet)"}
_QUOTE_PAIRS = (("「", "」"), ("『", "』"), ("“", "”"), ('"', '"'), ("'", "'"))

# 沒取名時的預設名字 (v2.5 Spec B 驗收回饋②)。
#
# ⚠ 與前端 desktop/js/i18n.js 的 onboarding.defaultName 是耦合的一對，兩邊必須
# 是同一個字串：使用者在取名題當下說「隨便／之後再取」時，前端自己比對片語、
# 用那把 i18n 鑰匙寫進 companion_name；腳本沒接住的說法（或跳過整題）則由這裡
# 的判定與後備補上。兩邊不一致的話，使用者會先聽到前端那個名字，收束時又被
# 後端改成另一個（companion_name 與腳本當下自稱的不同＝前端會再說一次更正句）。
# 有 test_companion_naming.test_default_name_matches_frontend_i18n 釘住。
DEFAULT_COMPANION_NAME = {"zh-TW": "愛你的日記", "en": "Loving Diary"}

# 「他沒有要取名字」的兩種分類：都改寫成預設名字，差別只在前端說哪一句。
# 模型給的其餘值（含缺鍵、亂值）一律當 unclear＝看不出來，名字不動。
NO_NAME_NOTES = ("declined", "later")


class NamingOutput(NamedTuple):
    """模型輸出的兩個欄位。no_name 永遠是 declined／later／unclear 之一。"""
    name: Optional[str] = None
    no_name: str = "unclear"


class NameResolution(NamedTuple):
    """判定結果：name＝這次寫進 companion_name 的名字，note＝沒取名的分類。

    沒有寫入時兩個欄位都是 None（呼叫端據此什麼都不做）。note 只在「名字是
    預設名字」時才有值——呼叫端拿它決定要說哪一句話。
    """
    name: Optional[str] = None
    note: Optional[str] = None


def parse_naming_output(raw) -> NamingOutput:
    """模型輸出 → NamingOutput(name, no_name)。

    name：companion_name 的原始字串；null、缺鍵、非字串、解析失敗一律 None。
    no_name：只認 declined／later，其餘（缺鍵、亂值、型別不對、整段解析失敗）
    一律 unclear——寧可什麼都不做，也不要誤觸預設名字。
    容錯比照 memory_review.parse_review_output：整段 JSON → code fence 包裹 →
    前後有說明文字 (取首個 { 到末個 })。
    """
    if not raw or not isinstance(raw, str):
        return NamingOutput()
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
    candidates = [text]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start:end + 1])
    for cand in candidates:
        try:
            data = json.loads(cand)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and "companion_name" in data:
            value = data["companion_name"]
            no_name = data.get("no_name")
            return NamingOutput(value if isinstance(value, str) else None,
                                no_name if no_name in NO_NAME_NOTES else "unclear")
    return NamingOutput()


def sanitize_companion_name(value) -> Optional[str]:
    """鏡像前端 sanitizeName＋後端 CompanionSettingsIn 的 _NO_CTRL_PATTERN。

    換行/tab → 空白、其餘控制字元刪除、strip（_flatten_answer 正是這三步）；
    再剝掉包住整個名字的成對引號。空字串或超過 NAME_MAX_CHARS 個 code point
    → None（呼叫端當作判不出，名字維持腳本版）。這個名字會進 system prompt，
    寫入前必須乾淨。
    """
    if not isinstance(value, str):
        return None
    name = _flatten_answer(value)
    stripped = True
    while stripped and len(name) >= 2:
        stripped = False
        for open_q, close_q in _QUOTE_PAIRS:
            if name.startswith(open_q) and name.endswith(close_q):
                name = name[len(open_q):-len(close_q)].strip()
                stripped = True
                break
    if not name or len(name) > NAME_MAX_CHARS:
        return None
    return name


def _render_material(answers, lang_key: str) -> list:
    """(question_key, answer_text) → 一題一行「- 標籤：答案」，依題目順序、跳過空字串。

    答案先過 _flatten_answer（raw 注入區塊與收納素材共用的同一套單行化）：
    使用者輸入的換行在這裡壓掉，偽造不出一行【】標頭假裝成給模型的指示。
    """
    from database.models import ONBOARDING_QUESTION_KEYS
    labels = dict(ONBOARDING_LABELS[lang_key])
    labels["companion_naming"] = _NAMING_LABEL[lang_key]
    order = {k: i for i, k in enumerate(ONBOARDING_QUESTION_KEYS)}
    sep = "：" if lang_key == "zh-TW" else ": "
    lines = []
    for key, text in sorted(answers, key=lambda a: order.get(a[0], 99)):
        answer = _flatten_answer(text)
        if not answer:
            continue
        lines.append(f"- {labels.get(key, key)}{sep}{answer}")
    return lines


def _resolve(user_id: int, cfg, lang: str) -> NameResolution:
    lang_key = normalize_lang(lang)

    # --- 讀階段 (短交易；session 內就把 ORM 列取成純資料) ---
    with db_session() as db:
        user = crud.get_user(db, user_id)
        if user is None:
            return NameResolution()
        current = user.companion_name or None
        answers = [(r.question_key, r.answer_text or "")
                   for r in crud.get_onboarding_answers(db, user_id)]

    # 「按了跳過這題」＝有 companion_naming 這一列、內容卻是空的。完全沒有那一列
    # 是另一回事（第一題就按「直接開始聊天」，連取名邀請都沒回答）——那不給名字。
    naming_skipped = any(key == "companion_naming" and not _flatten_answer(text)
                         for key, text in answers)

    target = note = None
    lines = _render_material(answers, lang_key)
    if lines:   # 一題都沒答就沒有素材可判斷，連 LLM 都不打
        # --- LLM 階段 (不持有 DB 連線) ---
        prompt = load_prompt("companion_naming_prompt.txt", lang_key).format(
            current_name=current or _NO_NAME_MARKER[lang_key],
            answers_block="\n".join(lines))
        try:
            raw = llm.chat([{"role": "system", "content": get_role("note_taker", lang_key)},
                            {"role": "user", "content": prompt}], cfg)
        except Exception as e:
            # 無金鑰／供應商掛掉：判定放棄，但下面的跳過題後備不能跟著失效
            logger.warning(f"取名判定的 LLM 呼叫失敗 (user_id={user_id}): {e}")
            raw = None
        parsed = parse_naming_output(raw)
        name = sanitize_companion_name(parsed.name)
        if name:                                   # 給過名字就以名字為準
            target = name
        elif parsed.no_name in NO_NAME_NOTES:      # 他說不用／之後再取 → 預設名字
            target, note = DEFAULT_COMPANION_NAME[lang_key], parsed.no_name

    if target is None and not current and naming_skipped:
        # 跳過取名題、也沒判出名字：給預設名字。這條純粹看 DB，不依賴 LLM 有沒有
        # 成功（沒素材不打、打了失敗都走到這裡），否則零金鑰的人永遠沒有名字。
        target, note = DEFAULT_COMPANION_NAME[lang_key], "later"

    if target is None or target == current:
        return NameResolution()   # 名字沒變（含前端當下就寫好預設名字的情形）

    # --- 寫階段 (第二個短交易) ---
    with db_session() as db:
        user = crud.get_user(db, user_id)
        if user is None:
            return NameResolution()
        user.companion_name = target
        db.commit()
    return NameResolution(target, note)


def resolve_companion_name(user_id: int, cfg, lang: str = "zh-TW") -> NameResolution:
    """判定並寫回名字。回傳 NameResolution——name 為 None 代表名字沒改。

    三條路：LLM 判定出的名字 → 他表示不用／之後再取時的預設名字 → 跳過整題時
    的預設名字後備 (零 LLM)。連線紀律比照 memory_review.run_review_pass：
    短交易讀 → 關 → LLM → 短交易寫。任何例外都吞掉 (log warning) 回空結果
    ——best-effort，不擋 complete。
    """
    try:
        return _resolve(user_id, cfg, lang)
    except Exception as e:
        logger.warning(f"取名判定失敗 (user_id={user_id})，名字維持原樣: {e}")
        return NameResolution()
