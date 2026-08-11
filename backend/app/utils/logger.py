import os
import logging
import json
import time
from datetime import datetime
from pathlib import Path
from logging.handlers import RotatingFileHandler, TimedRotatingFileHandler

# 設置日誌目錄 (錨定在 backend/app/logs，與啟動時的工作目錄無關)
LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_DIR.mkdir(exist_ok=True)

# 日誌級別
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
LOG_LEVEL_NUM = getattr(logging, LOG_LEVEL, logging.INFO)

# 日誌格式
LOG_FORMAT = "%(asctime)s - %(levelname)s - [%(name)s] - %(message)s"

# 日誌輪轉設置
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOG_BACKUPS = 7  # 保留7個輪轉文件，約一周的量
LOG_ROTATE_WHEN = 'midnight'  # 每天午夜輪轉

# 創建日誌處理器
def create_logger(name, log_file=None, use_rotating=True):
    """創建並配置日誌記錄器
    
    Args:
        name: 日誌記錄器名稱
        log_file: 日誌文件名稱，如不指定則僅輸出到控制台
        use_rotating: 是否使用輪轉日誌
        
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
        
        if use_rotating:
            # 使用基於時間的輪轉處理器，每天午夜輪轉
            file_handler = TimedRotatingFileHandler(
                filename=file_path,
                when=LOG_ROTATE_WHEN,  # 每天午夜
                interval=1,  # 每1個單位時間
                backupCount=MAX_LOG_BACKUPS,  # 保留備份數量
                encoding='utf-8'
            )
            # 設置命名格式為 log_file.2023-12-31
            file_handler.suffix = "%Y-%m-%d"
            
            # 同時使用大小輪轉，確保文件不會過大
            size_handler = RotatingFileHandler(
                filename=file_path,
                maxBytes=MAX_LOG_SIZE,
                backupCount=3,  # 基於大小的輪轉備份較少
                encoding='utf-8'
            )
            size_handler.setFormatter(logging.Formatter(LOG_FORMAT))
            logger.addHandler(size_handler)
        else:
            # 使用普通文件處理器
            file_handler = logging.FileHandler(file_path, encoding='utf-8')
        
        file_handler.setFormatter(logging.Formatter(LOG_FORMAT))
        logger.addHandler(file_handler)
    
    return logger

# 主應用日誌記錄器
app_logger = create_logger("app", "app.log")

# API日誌記錄器
api_logger = create_logger("app.api", "api.log")

# 錯誤日誌記錄器
error_logger = create_logger("app.error", "error.log")

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

# 清理舊日誌文件
def cleanup_old_logs(days_to_keep=14):
    """清理超過指定天數的舊日誌文件
    
    Args:
        days_to_keep: 要保留的天數
    """
    try:
        now = time.time()
        for log_file in LOG_DIR.glob("*.log*"):
            # 獲取文件修改時間
            mtime = log_file.stat().st_mtime
            # 如果文件超過指定天數，刪除它
            if (now - mtime) > (days_to_keep * 86400):  # 86400秒 = 1天
                log_file.unlink()
                print(f"已刪除舊日誌文件: {log_file.name}")
    except Exception as e:
        error_logger.error(f"清理舊日誌文件失敗: {str(e)}") 