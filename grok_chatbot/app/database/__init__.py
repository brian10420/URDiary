# database/__init__.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from config import DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
from urllib.parse import quote_plus
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 對密碼進行URL編碼 - 特別處理特殊字符
try:
    encoded_pass = quote_plus(DB_PASS)
    DB_URL = f"postgresql://{DB_USER}:{encoded_pass}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    
    # 配置連接池和額外的安全性設置
    engine = create_engine(
        DB_URL, 
        echo=False,  # 生产环境关闭SQL语句打印
        pool_size=20,  # 增加到20，支持更多并发用户
        max_overflow=30,  # 增加到30，允许更多临时连接
        pool_timeout=60,  # 增加到60秒，适应聊天应用可能的延迟
        pool_recycle=3600,  # 增加到60分钟，减少连接重置频率
        pool_pre_ping=True,  # 保持启用，确保连接有效
        connect_args={
            "connect_timeout": 180,  # 保持180秒，适合长时间操作
            "application_name": "DiaryChat",  # 应用标识符
            "client_encoding": "utf8"  # 确保多语言支持
    }
)
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    logger.info("Database connection established successfully")
    
except Exception as e:
    logger.error(f"Database connection error: {str(e)}")
    raise

def get_db():
    """
    依賴注入函數，用於獲取數據庫會話
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()