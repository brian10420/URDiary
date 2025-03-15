import os
from dotenv import load_dotenv

# 讀取 .env 文件
load_dotenv()

# Grok API 設定
GROK_API_URL = os.getenv("GROK_API_URL", "https://api.x.ai/v1")
XAI_API_KEY = os.getenv("XAI_API_KEY")

# Redis 相關
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB = int(os.getenv("REDIS_DB", 0))  # 新增此行

# PostgreSQL 相關
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "myuser")
DB_PASS = os.getenv("DB_PASS", "mypassword")
DB_NAME = os.getenv("DB_NAME", "mydb")

if not XAI_API_KEY:
    raise ValueError("❌ XAI_API_KEY 未設定，請確認 .env 文件！")