import os
from openai import OpenAI
from memory_manager import get_chat_history, save_chat_history
from config import GROK_API_URL, XAI_API_KEY

# 初始化 OpenAI 客戶端（用於調用 Grok API）
client = OpenAI(
    api_key=XAI_API_KEY,
    base_url=GROK_API_URL,  # 官方提供的 API URL
)

def send_to_grok(user_id, message):
    """發送使用者輸入到 Grok AI，並返回回應"""
    try:
        chat_history = get_chat_history(user_id)

        # 格式化對話內容
        messages = [{"role": "system", "content": "You are Grok, a chatbot inspired by the Hitchhiker's Guide to the Galaxy."}]
        messages += chat_history
        messages.append({"role": "user", "content": message})

        # 調用 Grok API
        completion = client.chat.completions.create(
            model="grok-2-latest",
            messages=messages,
        )

        ai_response = completion.choices[0].message.content

        # 儲存對話歷史
        messages.append({"role": "assistant", "content": ai_response})
        save_chat_history(user_id, messages)

        return ai_response

    except Exception as e:
        return f"Error: {str(e)}"
