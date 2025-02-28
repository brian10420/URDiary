import os
from dotenv import load_dotenv

# 讀取 .env 文件
load_dotenv()

# Grok API 設定
GROK_API_URL = os.getenv("GROK_API_URL", "https://api.x.ai/v1")
XAI_API_KEY = os.getenv("XAI_API_KEY")

if not XAI_API_KEY:
    raise ValueError("❌ XAI_API_KEY 未設定，請確認 .env 文件！")

# Redis 伺服器設定
REDIS_HOST = "redis"  # Docker 內的 Redis 服務名稱
REDIS_PORT = 6379
REDIS_DB = 0
