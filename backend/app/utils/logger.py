import os
import logging
import json
import time
from datetime import datetime
from pathlib import Path
from logging.handlers import RotatingFileHandler

# 設置日誌目錄 (錨定在 backend/app/logs，與啟動時的工作目錄無關)
LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_DIR.mkdir(exist_ok=True)

# 日誌級別
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
LOG_LEVEL_NUM = getattr(logging, LOG_LEVEL, logging.INFO)

# 日誌格式
LOG_FORMAT = "%(asctime)s - %(levelname)s - [%(name)s] - %(message)s"

# -----------------------
# 日誌輪轉設置 (v2.3 task 3.1 修正)
# -----------------------
# 舊版同時掛 TimedRotatingFileHandler (每日輪轉) 與 RotatingFileHandler
# (大小輪轉) 兩個 handler 在同一個檔案上：每筆記錄因此被寫兩次，兩個
# rotator 還會搶著輪轉同一個路徑 (backend/app/logs/ 因此從 13.5MB 長到
# 44MB)。修法是每個 log target 只保留「一個」handler。
#
# 選 RotatingFileHandler (大小輪轉) 而不是 TimedRotatingFileHandler
# (日期輪轉)，理由：
#   1. 單純：只有一種輪轉政策，不會再有兩個 rotator 對同一個路徑打架。
#   2. 直接對症下藥：這次的操作痛點是「磁碟用量失控」，大小輪轉直接對
#      maxBytes 設上限；日期輪轉的檔案大小取決於當天流量，完全沒有上限
#      保證 (尖峰流量的一天可以比大小輪轉的整整一輪備份還大)。
#   3. 單人本機部署不需要「照日曆天數回顧記錄」的稽核情境，「保留最近
#      N MB」已經夠用。
# MAX_LOG_BACKUPS 沿用原本 size_handler 的校準值 (3)：這是原作者特地為
# 「大小輪轉」這個角色選的備份數 (註解寫「基於大小的輪轉備份較少」)，
# 現在它從安全網變成唯一策略，繼續沿用同一個值——每個 log target 上限
# 為 (1 + 3) * MAX_LOG_SIZE = 40MB。
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOG_BACKUPS = 3

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

    # 關掉往上傳遞 (v2.3 task 3.1 修正，與上方的單一 handler 修正同一批)。
    # production 的四個 logger 名稱 (app / app.api / app.error /
    # app.error_handler) 剛好構成一組父子階層 (app 是另外三個的父)，而
    # logging.Logger.propagate 預設是 True：子 logger 每筆記錄除了自己的
    # handler 會處理一次，還會「額外」往上傳給父 logger 的 handler 再處理
    # 一次。這四個 logger 各自都有自己完整的 console+檔案 handler，等於
    # api.log/error.log/app_errors.log 的每一筆記錄都會被複製一份寫進
    # app.log、主控台也印兩次——即使各自都只掛了一個 file handler、沒有
    # 上面那個 bug，仍然是另一條獨立的重複寫入路徑 (用一支腳本直接呼叫
    # 子 logger 一次、檢查父 logger 檔案內容才複現確認)。這裡的四個
    # logger 名稱只是借用點號做命名空間視覺分組，不是真的要「api/error
    # 的記錄也該流進 app.log」，所以直接關閉 propagate，讓每個 logger
    # 徹底獨立、只寫自己的目標。
    logger.propagate = False

    # 清除現有處理器，避免重複 (--reload / 測試重複呼叫 create_logger()
    # 時的防護：logging.getLogger(name) 對同名一律回傳同一個物件，沒有
    # 這段會讓 handler 隨每次呼叫累加)。先逐一 close() 再 clear()：
    # list.clear() 只是把 handler 物件從 list 移除，不會關閉底層檔案
    # ——FileHandler/RotatingFileHandler 的檔案描述符不會因此自動釋放，
    # 沒有先 close() 就 clear() 會讓每次重複呼叫都洩漏一個 fd
    # (code review 抓到)。
    if logger.handlers:
        for handler in logger.handlers:
            handler.close()
        logger.handlers.clear()

    # 創建控制台處理器
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(console_handler)

    # 如果指定了日誌文件，創建「唯一一個」文件處理器 (見上方模組註解：
    # 絕對不要在這裡同時掛兩個 file handler)
    if log_file:
        file_path = LOG_DIR / log_file

        if use_rotating:
            file_handler = RotatingFileHandler(
                filename=file_path,
                maxBytes=MAX_LOG_SIZE,
                backupCount=MAX_LOG_BACKUPS,
                encoding='utf-8'
            )
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