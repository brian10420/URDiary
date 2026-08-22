from providers.base import LLMConfig, LLMError
from database import crud, db_session
from services import day_stamp
from services.interaction_service import generate_enhanced_diary
from services.prompt_loader import load_prompt
from utils.logger import log_error
from utils.time_utils import get_diary_date
from typing import Dict, Any, Optional

# 敏感詞分兩級 (危機處理的「機械保底」層；語意判斷由 crisis_mode.txt
# 提示詞交給模型分級處理，兩層互為雙保險)：
# - ACUTE：明確的自傷/自殺語彙 → system prompt 附危機模式 + 回覆後強制附求助資源
# - CONTEXTUAL：需要上下文判斷的詞 (單獨出現常是誤報，例如「怕傷害到他的感情」)
#   → 只附危機模式讓模型自行分辨，不強制附資源，避免誤觸發的說教感
SENSITIVE_WORDS_ACUTE = [
    "自殺", "自杀", "suicide", "想死", "不想活", "輕生", "轻生",
    "活不下去", "了結自己", "了结自己", "結束生命", "结束生命",
    "自殘", "自残", "自傷", "自伤", "割腕",
    "self-harm", "self harm", "kill myself", "end my life",
    "hurt myself", "cut myself", "end it all",
    "藥物過量", "药物过量", "overdose", "吞藥", "吞药",
]
SENSITIVE_WORDS_CONTEXTUAL = [
    "想消失", "去死", "他殺", "他杀", "殺人", "杀人", "傷害", "伤害",
    "kill him", "kill her", "kill them", "hurt someone", "want to die",
]

def check_sensitive_content(message: str) -> int:
    """回傳風險級別：2=急性自傷語彙、1=需上下文判斷的詞、0=無。

    級別 >=1 時應在 system prompt 附加危機模式 (crisis_mode.txt)；
    級別 >=2 時另在回覆後機械附上求助資源 (不依賴模型自覺)。
    """
    lower_message = (message or "").lower()
    for word in SENSITIVE_WORDS_ACUTE:
        if word.lower() in lower_message:
            return 2
    for word in SENSITIVE_WORDS_CONTEXTUAL:
        if word.lower() in lower_message:
            return 1
    return 0

def get_support_message(lang: str = "zh-TW") -> str:
    """求助資源訊息 (prompts/{lang}/support_message.txt)"""
    return load_prompt("support_message.txt", lang).strip()

def save_diary_for_user(user_id: str, numeric_user_id: int, cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> Dict[str, Any]:
    """
    Generate a diary for a user and save it to the database
    Returns diary details as a dict

    純聊天記錄生成日記 (/diary/generate 端點用，不帶互動筆記脈絡)，等同呼叫
    interaction_service.generate_enhanced_diary 並強制 exclude_interaction_notes=True
    (兩者原本近乎重複實作，僅差在是否撈互動筆記，現已合併)。
    """
    draft = generate_enhanced_diary(
        user_id, numeric_user_id, exclude_interaction_notes=True, cfg=cfg, lang=lang
    )

    # Save to database
    with db_session() as db:
        diary = crud.create_diary(
            db=db,
            user_id=numeric_user_id,
            content=draft.content,
            valence=draft.valence,
            arousal=draft.arousal,
            title=draft.title,
            summary=draft.summary,
        )

        return {
            "diary_id": diary.id,
            "title": diary.title,
            "summary": diary.summary,
            "content": diary.content,
            "valence": diary.valence,
            "arousal": diary.arousal,
            "created_at": diary.created_at.isoformat()
        }


def run_end_of_chat_pipeline(user_id: str, numeric_user_id: int,
                              exclude_interaction_notes: bool,
                              cfg: LLMConfig, lang: str = "zh-TW",
                              enable_day_note: bool = False) -> Dict[str, Any]:
    """生成日記(LLM) → 短交易存檔 → 記憶 review pass(LLM，容忍部分失敗)。

    `/chat/end/` 與 `/diary/enhanced-generate` 共用的收尾管線 (兩端點原本
    近乎重複實作)。呼叫端須先以 llm.resolve_config() 補齊 cfg 再傳入 (早期
    解析：缺金鑰在任何 LLM 呼叫前就報錯，對話/日記資料不受影響)。

    回傳 {"diary": payload, "memory_review": ReviewResult.as_dict() 或 None,
    "memory_review_error": ...}
    """
    # 1. 生成今日日記 (LLM 呼叫，期間不持有 DB 連線)。
    #    失敗時讓 LLMError 往上拋——絕不可把錯誤字串當成日記內容寫進資料庫，
    #    呼叫端 (路由層) 負責轉成 503。
    draft = generate_enhanced_diary(
        user_id, numeric_user_id, exclude_interaction_notes, cfg, lang=lang
    )

    # 2. 保存日記 (短交易；絕不可在持有 session 時做下面的互動筆記 LLM 呼叫)
    with db_session() as db:
        try:
            diary = crud.create_diary(
                db=db,
                user_id=numeric_user_id,
                content=draft.content,
                valence=draft.valence,
                arousal=draft.arousal,
                title=draft.title,
                summary=draft.summary,
            )
            diary_payload = {
                "diary_id": diary.id,
                "title": diary.title,
                "summary": diary.summary,
                "content": diary.content,
                "valence": diary.valence,
                "arousal": diary.arousal,
                "created_at": diary.created_at.isoformat(),
            }
        except Exception as e:
            db.rollback()
            log_error(e, {"user_id": user_id, "action": "run_end_of_chat_pipeline_save_diary"})
            raise

    # 2.5 AI 印章 (v2.5 Spec A)：印章跟著「日記日」(5am 換日) 走，代表那篇日記
    # 的日子。任何失敗只記 log——印章是加分項，絕不影響日記主流程。
    if enable_day_note:
        try:
            stamp, note_text = day_stamp.finalize(draft.stamp, draft.note, draft.valence)
            if stamp:
                with db_session() as db:
                    crud.upsert_day_note(db, numeric_user_id, get_diary_date(),
                                         stamp, note_text,
                                         source_diary_id=diary_payload["diary_id"])
        except Exception as e:
            log_error(e, {"user_id": user_id, "action": "run_end_of_chat_pipeline_day_note"})

    # 3. 記憶 review pass (v2.5 Spec C：取代舊互動筆記整份重寫；又一次 LLM 呼叫，
    #    自行管理連線)。日記此時已存檔成功，review 失敗回報部分成功即可。
    from services.memory_review import run_review_pass
    from memory_manager import get_chat_history
    review_result = None
    review_error = None
    try:
        review = run_review_pass(
            numeric_user_id, cfg, lang=lang,
            chat_history=get_chat_history(user_id),
            diary_content=draft.content,
            diary_id=diary_payload["diary_id"],
            valence=draft.valence,
        )
        review_result = review.as_dict()
    except LLMError as e:
        review_error = str(e)
        log_error(e, {"user_id": user_id, "action": "run_end_of_chat_pipeline_memory_review"})

    return {
        "diary": diary_payload,
        "memory_review": review_result,
        "memory_review_error": review_error,
    }