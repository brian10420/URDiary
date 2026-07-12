import llm
from providers.base import LLMConfig
from memory_manager import get_chat_history
from database import crud
from database import SessionLocal
from services.diary_draft import DiaryDraft, parse_diary_output
from services.prompt_loader import load_prompt, get_role
from typing import List, Dict, Any, Optional

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

def generate_diary_from_chat(user_id: str, cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> DiaryDraft:
    """
    Generate a diary entry based on chat history
    Returns a DiaryDraft (content/title/summary/valence/arousal)
    """
    # Get chat history
    chat_history = get_chat_history(user_id)

    # If no chat history, return empty diary
    if not chat_history:
        return DiaryDraft(
            content="今天似乎沒有對話記錄。",
            title="沒有對話的一天",
            summary="今天沒有對話記錄。",
            valence=0.5,
            arousal=0.5,
        )
    
    # Format chat history for the Grok API
    formatted_history = []
    for msg in chat_history:
        if msg["role"] in ["user", "assistant"]:
            formatted_history.append(f"{msg['role'].upper()}: {msg['content']}")
    
    chat_content = "\n".join(formatted_history)
    
    # 讀取日記生成提示詞
    prompt_template = load_prompt("daily_note_prompt.txt", lang)

    # 準備提示詞
    diary_prompt = prompt_template.format(
        chat_history=chat_content,
        interaction_note="請忽略此部分，專注於今日對話生成日記。"
    )

    # 調用 LLM 生成日記
    # 失敗時拋出 LLMError —— 不可把錯誤訊息當成日記內容寫進資料庫
    diary_text = llm.chat(
        [
            {"role": "system", "content": get_role("diary_writer", lang)},
            {"role": "user", "content": diary_prompt}
        ],
        cfg
    )

    # 解析永不拋例外：格式不合時退回後備推導 (此時正文已是合法的模型輸出)
    return parse_diary_output(diary_text)

def save_diary_for_user(user_id: str, numeric_user_id: int, cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> Dict[str, Any]:
    """
    Generate a diary for a user and save it to the database
    Returns diary details as a dict
    """
    draft = generate_diary_from_chat(user_id, cfg, lang=lang)

    # Save to database
    db = SessionLocal()
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

        return {
            "diary_id": diary.id,
            "title": diary.title,
            "summary": diary.summary,
            "content": diary.content,
            "valence": diary.valence,
            "arousal": diary.arousal,
            "created_at": diary.created_at.isoformat()
        }
    finally:
        db.close()