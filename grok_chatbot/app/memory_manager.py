import redis
import json
from config import REDIS_HOST, REDIS_PORT, REDIS_DB

# 連接 Redis
redis_client = redis.StrictRedis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)

def get_chat_history(user_id):
    """取得使用者的對話記錄"""
    chat_history = redis_client.get(user_id)
    return json.loads(chat_history) if chat_history else []

def save_chat_history(user_id, messages, max_history=10):
    """儲存最新的 max_history 條對話記錄"""
    redis_client.set(user_id, json.dumps(messages[-max_history:]))

def clear_chat_history(user_id):
    """清除使用者的對話記錄"""
    redis_client.delete(user_id)
