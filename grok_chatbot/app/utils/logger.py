import os
import logging
import json
from datetime import datetime
from pathlib import Path

# 設置日誌目錄
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)

# 日誌級別
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
LOG_LEVEL_NUM = getattr(logging, LOG_LEVEL, logging.INFO)

# 日誌格式
LOG_FORMAT = "%(asctime)s - %(levelname)s - [%(name)s] - %(message)s"

# 創建日誌處理器
def create_logger(name, log_file=None):
    """創建並配置日誌記錄器
    
    Args:
        name: 日誌記錄器名稱
        log_file: 日誌文件名稱，如不指定則僅輸出到控制台
        
    Returns:
        配置好的日誌記錄器
    """
    logger = logging.getLogger(name)
    logger.setLevel(LOG_LEVEL_NUM)
    
    # 清除現有處理器，避免重複
    if logger.handlers:
        logger.handlers.clear()
    
    # 創建控制台處理器
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(console_handler)
    
    # 如果指定了日誌文件，創建文件處理器
    if log_file:
        file_path = LOG_DIR / log_file
        file_handler = logging.FileHandler(file_path)
        file_handler.setFormatter(logging.Formatter(LOG_FORMAT))
        logger.addHandler(file_handler)
    
    return logger

# 主應用日誌記錄器
app_logger = create_logger("app", "app.log")

# API日誌記錄器
api_logger = create_logger("app.api", "api.log")

# 錯誤日誌記錄器
error_logger = create_logger("app.error", "error.log")

# 數據庫日誌記錄器
db_logger = create_logger("app.db", "db.log")

# JSON格式日誌記錄
def log_event(event_type, data, logger=app_logger, level=logging.INFO):
    """記錄JSON格式的事件日誌
    
    Args:
        event_type: 事件類型
        data: 事件數據
        logger: 使用的日誌記錄器
        level: 日誌級別
    """
    try:
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "event_type": event_type,
            "data": data
        }
        
        logger.log(level, json.dumps(log_entry))
    except Exception as e:
        error_logger.error(f"日誌記錄失敗: {str(e)}")

# 記錄錯誤
def log_error(error, context=None, logger=error_logger):
    """記錄錯誤信息
    
    Args:
        error: 錯誤對象或字符串
        context: 錯誤上下文
        logger: 使用的日誌記錄器
    """
    try:
        error_data = {
            "error": str(error),
            "context": context or {},
            "timestamp": datetime.now().isoformat()
        }
        
        # 添加異常類型和堆棧
        if isinstance(error, Exception):
            error_data["type"] = error.__class__.__name__
            import traceback
            error_data["traceback"] = traceback.format_exc()
        
        logger.error(json.dumps(error_data))
    except Exception as e:
        error_logger.error(f"錯誤記錄失敗: {str(e)}") 