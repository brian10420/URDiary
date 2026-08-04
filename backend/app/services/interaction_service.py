import llm
from providers.base import LLMConfig
from memory_manager import get_chat_history, append_chat_messages, format_chat_content
from database import crud, db_session
from database.models import InteractionNote
from services.calendar_service import build_calendar_context
from services.diary_draft import DiaryDraft, parse_diary_output
from services.prompt_loader import load_prompt, get_role
from services.prompt_builder import build_conversation_system, build_checkin_prompt
from sqlalchemy.orm import Session
from utils.time_utils import get_diary_date, get_diary_datetime, get_local_now
from typing import Dict, Any, Optional

def get_latest_interaction_note(db: Session, user_id: int) -> Optional[InteractionNote]:
    """
    獲取用戶最新的互動筆記
    """
    return db.query(InteractionNote).filter(
        InteractionNote.user_id == user_id
    ).order_by(InteractionNote.version.desc()).first()

def create_interaction_note(db: Session, user_id: int, content: str) -> InteractionNote:
    """
    創建新的互動筆記
    """
    # 獲取當前最新版本
    latest_note = get_latest_interaction_note(db, user_id)
    version = 1 if not latest_note else latest_note.version + 1
    
    interaction_note = InteractionNote(
        user_id=user_id,
        content=content,
        version=version
    )
    db.add(interaction_note)
    db.commit()
    db.refresh(interaction_note)
    return interaction_note

def update_interaction_note(
    chat_history: list,
    previous_note_content: Optional[str],
    today_diary: str,
    cfg: Optional[LLMConfig] = None,
    user_id: Optional[int] = None,
    lang: str = "zh-TW"
) -> str:
    """
    生成更新的互動筆記內容

    Args:
        chat_history: 聊天歷史
        previous_note_content: 前一個互動筆記內容
        today_diary: 今日日記內容
        cfg: 請求範圍的 LLM 設定；None 時走 .env Grok 後備
        user_id: 用戶數字ID，提供時會執行情緒趨勢分析
        lang: 提示詞語言
    """
    # 讀取互動筆記提示詞
    prompt_template = load_prompt("interaction_note_prompt.txt", lang)

    # 格式化對話歷史
    chat_content = format_chat_content(chat_history)

    # 獲取今日日期，格式為YYYY-MM-DD
    # 必須用日記的本地日期基準：容器內 datetime.now() 是 UTC，
    # 台北早上 7 點 = UTC 前一天 23 點，會讓提示詞把今天的事標成昨天。
    today_date = get_diary_date().strftime("%Y-%m-%d")
    
    # 執行情緒分析 (JSON key 為英文，與 emotion_analysis_prompt.txt 的輸出格式對齊)
    from services.analytics_service import analyze_emotion_trends
    emotion_analysis = {"theme_analysis": {"themes": ["無資料"], "pattern": "無資料", "factors": "無資料", "focus": "無資料"}}

    try:
        # 若呼叫端提供用戶ID，執行情緒分析（沿用同一份 LLM 設定 —— 最深的串接鏈）
        if user_id:
            emotion_analysis = analyze_emotion_trends(user_id, "week", cfg, lang=lang)
    except Exception as e:
        print(f"分析情緒時發生錯誤: {str(e)}")

    # 提取情緒分析結果
    emotion_themes = emotion_analysis.get("theme_analysis", {})
    themes = emotion_themes.get('themes', ['無資料'])
    if not isinstance(themes, list):
        themes = [str(themes)]
    emotion_info = f"""
情緒分析結果：
- 主要情緒主題: {', '.join(str(t) for t in themes)}
- 情緒變化模式: {emotion_themes.get('pattern', '無資料')}
- 正負向因素: {emotion_themes.get('factors', '無資料')}
- 建議留意: {emotion_themes.get('focus', '無資料')}
"""
    
    # 準備提示詞
    prompt = prompt_template.format(
        previous_interaction_note=previous_note_content or "尚無互動筆記",
        chat_history=chat_content,
        todays_diary=today_diary,
        today_date=today_date,
        emotion_analysis=emotion_info
    )
    
    # 調用 LLM
    # 不可捕捉 LLMError：失敗訊息若被當成筆記內容存入資料庫，
    # 會污染之後每一次對話的 system prompt。讓例外往上拋，由路由回 5xx。
    messages = [
        {"role": "system", "content": get_role("note_taker", lang)},
        {"role": "user", "content": prompt}
    ]

    return llm.chat(messages, cfg)

def process_interaction_note_update(chat_id: str, numeric_user_id: int, today_diary: str, cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> Dict[str, Any]:
    """
    處理互動筆記更新流程

    Args:
        chat_id: 聊天ID
        numeric_user_id: 用戶數字ID
        today_diary: 今日日記內容
        cfg: 請求範圍的 LLM 設定；None 時走 .env Grok 後備
    """
    # 讀取階段 —— 取完資料立刻關閉連線。
    # 絕不可在持有 DB 連線 (開著的交易) 的狀態下呼叫 LLM：一次 /chat/end/ 會做
    # 2~3 次 Grok 往返，每次數十秒，連線會被釘住直到連線池 (20+30) 耗盡。
    with db_session() as db:
        chat_history = get_chat_history(chat_id)
        latest_note = get_latest_interaction_note(db, numeric_user_id)
        previous_content = latest_note.content if latest_note else None

    # LLM 階段 —— 此時不持有任何 DB 連線
    new_content = update_interaction_note(
        chat_history, previous_content, today_diary, cfg,
        user_id=numeric_user_id, lang=lang
    )

    # 寫入階段 (獨立的第二個 session；絕不可與上面的讀取階段合併，
    # 否則 session 會跨越中間的 LLM 呼叫)
    with db_session() as db:
        new_note = create_interaction_note(db, numeric_user_id, new_content)

        return {
            "note_id": new_note.id,
            "version": new_note.version,
            "content": new_note.content,
            "created_at": new_note.created_at.isoformat()
        }

def get_conversation_context(numeric_user_id: int) -> str:
    """
    獲取對話開始時的互動筆記上下文
    """
    with db_session() as db:
        latest_note = get_latest_interaction_note(db, numeric_user_id)

        if not latest_note:
            return "尚無互動筆記記錄。"

        return latest_note.content

def enhanced_chat_with_context(chat_id: str, numeric_user_id: int, message: str, cfg: Optional[LLMConfig] = None, semantic: bool = False, crisis: bool = False, lang: str = "zh-TW") -> str:
    """
    使用互動筆記增強對話體驗

    Args:
        chat_id: 聊天ID
        numeric_user_id: 用戶數字ID
        message: 用戶消息
        cfg: 請求範圍的 LLM 設定；None 時走 .env Grok 後備
        semantic: 是否啟用語意記憶檢索 (X-Memory-Semantic 標頭)
        crisis: 敏感詞命中時附加危機模式指示 (雙保險之一)
        lang: 提示詞語言
    """
    # 獲取互動筆記上下文
    interaction_context = get_conversation_context(numeric_user_id)

    # 獲取對話歷史 (先取：記憶檢索需要上一則使用者訊息當 query 上下文)
    chat_history = get_chat_history(chat_id)

    # 檢索相關的過往日記 (毫秒級；失敗時內部降級為占位文字，不擋聊天)
    from services.memory_retrieval import get_relevant_memories
    relevant_memories = get_relevant_memories(
        numeric_user_id, message, chat_history, semantic=semantic)

    # 行事曆脈絡 (昨天 ~ +7 天)。自管 session 且在 LLM 呼叫之前就取完；
    # 用真實本地日期，不是日記的 5am 換日日 (見 calendar_service 模組註解)。
    # 失敗時內部降級為置底句，不擋聊天。
    calendar_context = build_calendar_context(
        numeric_user_id, get_local_now().date(), lang)

    # 分層組裝系統提示詞 (人格核心 → 對話框架與記憶 → 危機模式附錄)
    system_prompt = build_conversation_system(
        lang=lang,
        interaction_note=interaction_context,
        relevant_memories=relevant_memories,
        today_date=get_diary_date().strftime("%Y-%m-%d"),
        calendar_context=calendar_context,
        crisis=crisis,
    )

    # 準備消息列表，用於API請求
    messages = [{"role": "system", "content": system_prompt}]
    
    # 只添加用戶和助手的消息
    for msg in chat_history:
        if msg["role"] in ["user", "assistant"]:
            messages.append(msg)
    
    # 添加用戶新消息
    messages.append({"role": "user", "content": message})
    
    # 調用 LLM
    # LLMError 不在此攔截：失敗時不應把錯誤字串當成 AI 回應存進對話歷史，
    # 否則它會被帶入日記與互動筆記。由路由回 503。
    ai_response = llm.chat(messages, cfg)

    # 保存本輪對話 (append 語意，不再整串重寫；修剪由 memory_manager 處理)
    append_chat_messages(chat_id, [
        {"role": "user", "content": message},
        {"role": "assistant", "content": ai_response},
    ])

    return ai_response


def generate_enhanced_diary(chat_id: str, numeric_user_id: int, exclude_interaction_notes: bool = False, cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> DiaryDraft:
    """
    使用互動筆記增強日記生成

    Args:
        chat_id: 用戶聊天ID
        numeric_user_id: 用戶數字ID
        exclude_interaction_notes: 是否排除互動筆記，如果為True，則不使用互動筆記
        cfg: 請求範圍的 LLM 設定；None 時走 .env Grok 後備
        lang: 提示詞語言

    Returns:
        DiaryDraft (content/title/summary/valence/arousal)
    """
    # 獲取聊天歷史
    chat_history = get_chat_history(chat_id)

    if not chat_history:
        return DiaryDraft(
            content="今天似乎沒有對話記錄。",
            title="沒有對話的一天",
            summary="今天沒有對話記錄。",
            valence=0.5,
            arousal=0.5,
        )

    # 獲取互動筆記上下文 (短交易；LLM 呼叫前關閉連線)
    interaction_context = "尚無互動筆記記錄。"
    if not exclude_interaction_notes:
        with db_session() as db:
            latest_note = get_latest_interaction_note(db, numeric_user_id)
            interaction_context = latest_note.content if latest_note else "尚無互動筆記記錄。"

    # 格式化對話歷史
    chat_content = format_chat_content(chat_history)

    # 讀取日記提示詞。輸出格式要求 (含 title/summary/valence/arousal 的
    # JSON tail) 已寫在模板的【輸出格式】段，不再動態附加格式指示。
    prompt_template = load_prompt("daily_note_prompt.txt", lang)
    prompt = prompt_template.format(
        chat_history=chat_content,
        interaction_note=(
            "請忽略此部分，專注於今日對話生成日記。"
            if exclude_interaction_notes else interaction_context
        ),
    )

    # 調用 LLM
    # LLMError 直接往上拋：日記生成失敗時必須回 5xx，
    # 絕不可把 "Error: ..." 當成日記內容寫進 diaries.content。
    messages = [
        {"role": "system", "content": get_role("diary_writer", lang)},
        {"role": "user", "content": prompt}
    ]

    diary_text = llm.chat(messages, cfg)

    # 解析永不拋例外：格式不合時退回後備推導 (此時正文已是合法的模型輸出)
    return parse_diary_output(diary_text)


# --- 每日 check-in ------------------------------------------------------------

def _time_of_day_label(hour: int, lang: str = "zh-TW") -> str:
    """把小時映射為時段稱呼 (check-in 開場用)。"""
    if lang == "en":
        if 5 <= hour < 11:
            return "morning"
        if 11 <= hour < 14:
            return "midday"
        if 14 <= hour < 18:
            return "afternoon"
        if 18 <= hour < 23:
            return "evening"
        return "late night"
    if 5 <= hour < 11:
        return "早上"
    if 11 <= hour < 14:
        return "中午"
    if 14 <= hour < 18:
        return "下午"
    if 18 <= hour < 23:
        return "晚上"
    return "深夜"


def daily_checkin(chat_id: str, numeric_user_id: int, cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> Optional[str]:
    """生成「今日首次開啟」的主動問候；今日已問候過則回 None。

    依 5am 換日基準判定 (users.last_checkin_date vs get_diary_date())。
    流程守連線紀律：讀 → 關 → LLM → 開 → 寫。
    問候會 append 進正式對話歷史，之後的日記生成自然涵蓋這句開場。
    """
    today = get_diary_date()

    # 讀階段
    with db_session() as db:
        user = crud.get_user(db, numeric_user_id)
        if user is None:
            return None
        if user.last_checkin_date is not None and user.last_checkin_date.date() >= today:
            return None

        latest = crud.get_latest_diary(db, numeric_user_id, within_days=3)
        if latest is not None:
            valence = latest.valence if latest.valence is not None else 0.5
            if valence < 0.4:
                mood_hint = "情緒偏低" if lang != "en" else "was feeling low"
            elif valence > 0.6:
                mood_hint = "心情不錯" if lang != "en" else "was in good spirits"
            else:
                mood_hint = "情緒平穩" if lang != "en" else "was feeling steady"
            last_diary_block = (
                f"[{latest.diary_date.strftime('%m/%d')}]"
                f"《{latest.title or '無標題'}》{latest.summary or ''}（{mood_hint}）"
            )
        else:
            last_diary_block = "（最近三天沒有日記）" if lang != "en" else "(no diary entries in the past three days)"

        note = get_latest_interaction_note(db, numeric_user_id)
        if note is not None:
            user_profile = note.content[:400]
        else:
            user_profile = ("（你們還不熟，這可能是最初幾次見面）" if lang != "en"
                            else "(you barely know each other yet — this may be one of your first meetings)")

    # 行事曆脈絡：讀階段的 session 已關閉，build_calendar_context 自管自己的
    # 短交易並在回傳前關掉，接下來的 llm.chat 仍不持有任何 DB 連線。
    # 日期用真實本地日 (get_local_now)，不是上面那個 5am 換日的日記日 today。
    calendar_block = build_calendar_context(
        numeric_user_id, get_local_now().date(), lang)

    # LLM 階段 (不持有 DB 連線)。LLMError 往上拋，由路由層轉為 checkin:false。
    prompt = build_checkin_prompt(
        lang=lang,
        time_of_day=_time_of_day_label(get_local_now().hour, lang),
        today_date=today.strftime("%Y-%m-%d"),
        last_diary_block=last_diary_block,
        user_profile=user_profile,
        calendar_block=calendar_block,
    )
    messages = [
        {"role": "system", "content": get_role("companion", lang)},
        {"role": "user", "content": prompt},
    ]
    greeting = llm.chat(messages, cfg)

    # 寫階段：標記今日已問候 + 問候進入正式對話歷史。
    # LLM 呼叫期間可能有並發的 checkin 請求同時通過了開頭的判定
    # (前端已有 single-flight 防護，這裡是後端保底)：寫入前重新檢查，
    # 若別的請求已搶先標記今日，丟棄本次問候避免連發兩句開場。
    # 獨立的第二個 session (與上面的讀階段分開)——不得合併，session 範圍
    # 不可跨越中間那次 llm.chat() 呼叫。
    with db_session() as db:
        user = crud.get_user(db, numeric_user_id)
        if user is None:
            return None
        if user.last_checkin_date is not None and user.last_checkin_date.date() >= today:
            return None  # 已被並發請求標記，本次問候不送出
        user.last_checkin_date = get_diary_datetime()
        db.commit()

    append_chat_messages(chat_id, [{"role": "assistant", "content": greeting}])
    return greeting
