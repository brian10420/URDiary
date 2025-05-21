import redis
import json
import os
from config import REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD
from dotenv import load_dotenv



# 安全地獲取Redis密碼
def get_redis_password():
    # 優先使用環境變量中的密碼
    env_password = os.getenv("REDIS_PASSWORD")
    if env_password:
        return env_password
    # 如果環境變量中沒有，則使用配置中的密碼
    return REDIS_PASSWORD


# 連接 Redis
redis_client = redis.StrictRedis(
    host=REDIS_HOST, 
    port=REDIS_PORT, 
    db=REDIS_DB, 
    password=REDIS_PASSWORD,  
    decode_responses=True
)

def get_chat_history(user_id):
    """取得使用者的對話記錄"""
    chat_history = redis_client.get(user_id)
    return json.loads(chat_history) if chat_history else []

def save_chat_history(user_id, messages, max_history=200):
    """儲存最新的 max_history 條對話記錄"""
    redis_client.set(user_id, json.dumps(messages[-max_history:]))

def clear_chat_history(user_id):
    """清除使用者的對話記錄"""
    redis_client.delete(user_id)
