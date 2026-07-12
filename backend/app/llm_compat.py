"""相容層：舊程式碼的 GrokAPIError / send_to_grok 收斂到統一的 llm.chat。

新程式請直接使用 llm.chat(messages, cfg) 與 providers.base.LLMError。
供應商實作見 app/providers/（openai/anthropic/gemini 官方 SDK）。
"""
import llm
from memory_manager import get_chat_history, append_chat_messages
from providers.base import LLMError
from services.prompt_loader import load_prompt, get_role

# 舊名稱相容：原本散落各處的 `except GrokAPIError` 等同捕捉 LLMError。
# 語意不變 —— 絕不可把錯誤訊息當成模型輸出回傳（會寫進日記並污染
# 之後每一次對話的 system prompt），失敗一律拋例外讓路由回 5xx。
GrokAPIError = LLMError


def send_to_grok(user_id, message, cfg=None, crisis=False, lang="zh-TW"):
    """發送使用者輸入到所選的 LLM 供應商，並管理對話歷史。

    Args:
        user_id: 對話歷史使用的用戶ID（由 token 導出）
        message: 使用者的訊息
        cfg: 請求範圍的 LLMConfig；None 時走 .env Grok 後備
        crisis: 敏感詞命中時附加危機模式指示
        lang: 提示詞語言

    Raises:
        LLMError: API 呼叫失敗時拋出（不會把錯誤字串當成回應）
    """
    chat_history = get_chat_history(user_id)

    # 只保留使用者與助手訊息，避免歷史中殘留的 system 訊息重複累積
    history = [m for m in chat_history if m.get("role") in ("user", "assistant")]

    system_prompt = get_role("companion", lang)
    if crisis:
        system_prompt += "\n\n" + load_prompt("crisis_mode.txt", lang)

    messages = [{"role": "system", "content": system_prompt}]
    messages += history
    messages.append({"role": "user", "content": message})

    ai_response = llm.chat(messages, cfg)

    # 儲存本輪對話 (append 語意；則數/天數修剪由 memory_manager 處理)
    append_chat_messages(user_id, [
        {"role": "user", "content": message},
        {"role": "assistant", "content": ai_response},
    ])

    return ai_response
