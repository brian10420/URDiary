from fastapi import FastAPI, HTTPException
from grok_client import send_to_grok
from memory_manager import clear_chat_history

app = FastAPI()

@app.post("/chat/")
def chat_with_ai(user_input: dict):
    """對話 API，調用 Grok AI 進行回應"""
    user_id = user_input.get("user_id")
    message = user_input.get("message")

    if not user_id or not message:
        raise HTTPException(status_code=400, detail="User ID 和 Message 是必需的")

    response = send_to_grok(user_id, message)
    return {"response": response}

@app.delete("/chat/clear/")
def clear_chat(user_id: str):
    """清除使用者對話記錄"""
    clear_chat_history(user_id)
    return {"message": f"已清除 {user_id} 的對話記錄"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
