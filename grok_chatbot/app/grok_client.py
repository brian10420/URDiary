import os
from openai import OpenAI
from memory_manager import get_chat_history, save_chat_history
from config import GROK_API_URL, XAI_API_KEY

# 初始化 OpenAI 客戶端（用於調用 Grok API）
client = OpenAI(
    api_key=XAI_API_KEY,
    base_url=GROK_API_URL,  # 官方提供的 API URL
)

# 定義常用的模型 ID
MODELS = {
    "grok2": "grok-2-latest",
    "grok3": "grok-3-latest"
}

def send_to_grok(user_id, message, model="grok3"):
    """發送使用者輸入到 Grok AI，並返回回應
    
    Args:
        user_id: 用戶ID
        message: 使用者的信息
        model: 使用的模型，可選值為 "grok2" 或 "grok3"，默認為 "grok3"
    """
    try:
        chat_history = get_chat_history(user_id)

        # 獲取模型 ID
        model_id = MODELS.get(model, MODELS["grok3"])

        # 格式化對話內容
        messages = [{"role": "system", "content": "You are Grok, a chatbot inspired by the Hitchhiker's Guide to the Galaxy."}]
        messages += chat_history
        messages.append({"role": "user", "content": message})

        # 調用 Grok API
        completion = client.chat.completions.create(
            model=model_id,
            messages=messages,
        )

        ai_response = completion.choices[0].message.content

        # 儲存對話歷史
        messages.append({"role": "assistant", "content": ai_response})
        save_chat_history(user_id, messages)

        return ai_response

    except Exception as e:
        return f"Error: {str(e)}"

def send_to_model(messages, model="grok3"):
    """透過指定模型發送消息
    
    Args:
        messages: 消息列表
        model: 使用的模型，可選值為 "grok2" 或 "grok3"，默認為 "grok3"
    """
    try:
        # 獲取模型 ID
        model_id = MODELS.get(model, MODELS["grok3"])
        
        # 調用 Grok API
        completion = client.chat.completions.create(
            model=model_id,
            messages=messages,
        )
        
        return completion.choices[0].message.content
    except Exception as e:
        print(f"調用模型 {model} 時出錯: {str(e)}")
        return f"Error: {str(e)}"
