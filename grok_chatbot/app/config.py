import os
from dotenv import load_dotenv
import secrets

# 讀取 .env 文件 - 使用正斜杠避免轉義字符問題
load_dotenv("../.env")
# 環境設定
ENV = os.getenv("ENV", "development")  # development, staging, production

# 安全密鑰設置 - 從環境變量讀取或生成
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))
HASH_SALT = os.getenv("HASH_SALT", secrets.token_hex(8))
API_KEY = os.getenv("API_KEY", secrets.token_hex(16))

# JWT 設置
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "1440"))  # 默認24小時

# Grok API 設定
GROK_API_URL = os.getenv("GROK_API_URL", "https://api.x.ai/v1")
XAI_API_KEY = os.getenv("XAI_API_KEY")

# 默認模型設定
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "grok3")  # 可選值: grok2, grok3
# 如果未指定模型，是否自動選擇最新版本
AUTO_USE_LATEST_MODEL = os.getenv("AUTO_USE_LATEST_MODEL", "True").lower() in ("true", "1", "yes")

# Redis 相關
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB = int(os.getenv("REDIS_DB", 0))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

# PostgreSQL 相關
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "myuser")
DB_PASS = os.getenv("DB_PASS", "")  # 使用您提供的密碼
DB_NAME = os.getenv("DB_NAME", "mydb")

# 連接池設定 - 環境變量優先，否則使用預設值
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "30"))
DB_POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "60"))
DB_POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "3600"))

# CORS設置 - 默認允許本地前端訪問
default_origins = ["http://localhost:3000", "http://localhost:8080"]
CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
if not CORS_ALLOWED_ORIGINS or CORS_ALLOWED_ORIGINS == [""]:
    CORS_ALLOWED_ORIGINS = default_origins

# 必要的配置檢查
if ENV == "production" and not XAI_API_KEY:
    raise ValueError("❌ 生產環境中必須設定 XAI_API_KEY!")

# 數據庫密碼檢查
if ENV == "production" and not DB_PASS:
    raise ValueError("❌ 生產環境中必須設定 DB_PASS!")

# API地址配置
API_HOST = os.getenv("API_HOST", "http://localhost:8000")

def get_config():
    """返回配置字典，便于在测试和其他模块中使用"""
    return {
        "ENV": ENV,
        "SECRET_KEY": SECRET_KEY,
        "ALGORITHM": ALGORITHM,
        "TOKEN_EXPIRE_MINUTES": TOKEN_EXPIRE_MINUTES,
        "GROK_API_URL": GROK_API_URL,
        "DEFAULT_MODEL": DEFAULT_MODEL,
        "AUTO_USE_LATEST_MODEL": AUTO_USE_LATEST_MODEL,
        "REDIS_HOST": REDIS_HOST,
        "REDIS_PORT": REDIS_PORT,
        "REDIS_DB": REDIS_DB,
        "DB_HOST": DB_HOST,
        "DB_PORT": DB_PORT,
        "DB_USER": DB_USER,
        "DB_NAME": DB_NAME,
        "CORS_ALLOWED_ORIGINS": CORS_ALLOWED_ORIGINS,
        "API_HOST": API_HOST
    }