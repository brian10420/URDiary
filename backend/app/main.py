from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
from database.models import Base
from api.routes import api_router
from middleware.error_handler import error_handler
from middleware.exception_handlers import register_exception_handlers
from config import CORS_ALLOWED_ORIGINS, ENV
from utils.logger import cleanup_old_logs, app_logger
from memory_manager import purge_expired_chat_messages
import atexit
import threading
import time
import schedule

# -----------------------
# 日志管理
# -----------------------
# 创建定时清理任务
def schedule_cleanup():
    def run_scheduled_jobs():
        while True:
            schedule.run_pending()
            # 每分鐘檢查一次。原本 sleep(3600) 搭配 .at("02:00") 的每日任務，
            # 會讓任務在 02:00~02:59 之間的任意分鐘才觸發 (取決於進程啟動時間)。
            time.sleep(60)

    # 每天凌晨2点执行日志清理
    schedule.every().day.at("02:00").do(cleanup_old_logs)
    # 清除超過保留天數 (30 天) 的聊天訊息
    schedule.every().day.at("02:10").do(purge_expired_chat_messages)

    # 在后台线程中运行定时任务
    scheduler_thread = threading.Thread(target=run_scheduled_jobs, daemon=True)
    scheduler_thread.start()
    app_logger.info("日志清理定时任务已启动")

# 应用退出时的清理工作
def on_exit():
    app_logger.info("应用程序正在关闭")

# 注册退出处理函数
atexit.register(on_exit)

# -----------------------
# 初始化 FastAPI
# -----------------------
app = FastAPI(
    title="AI Diary API",
    description="AI日記應用後端API",
    version="1.0.0",
    docs_url="/docs" if ENV != "production" else None,
    redoc_url="/redoc" if ENV != "production" else None
)

# 添加錯誤處理中間件
app.middleware("http")(error_handler)

# 註冊異常處理器
register_exception_handlers(app)

# 添加 CORS 中間件
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,  # 從配置中讀取允許的來源
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],  # 限制允許的HTTP方法
    # X-LLM-*: 前端以標頭傳遞請求範圍的 LLM 供應商設定 (api/deps.get_llm_config)
    # X-Memory-Semantic: 語意記憶檢索開關 (api/deps.get_memory_prefs)
    # X-Language: 對話語言 (api/deps.get_language)
    allow_headers=["Authorization", "Content-Type", "X-Client",
                   "X-LLM-Provider", "X-LLM-Model", "X-LLM-Api-Key", "X-LLM-Base-Url",
                   "X-Memory-Semantic", "X-Language"],
)

# 註冊API路由
app.include_router(api_router)


@app.get("/health", tags=["health"], summary="健康檢查")
def health_check():
    """容器健康檢查端點。

    不能用 /docs 當健康檢查：ENV=production 時 docs_url=None，
    /docs 會回 404 而讓容器永遠處於 unhealthy。
    """
    return {"status": "ok", "env": ENV}


@app.get("/system/capabilities", tags=["health"], summary="系統能力查詢")
def system_capabilities():
    """回報選配功能的可用狀態 (免認證；設定面板顯示用)。"""
    from services.memory_retrieval import semantic_available
    return {
        "semantic_memory_available": semantic_available(),
        "app_version": app.version,
    }


@app.on_event("startup")
async def startup_event():
    # 建表與定時任務移到 startup，不在 module import 時執行。
    # 放在 import 階段會讓「import main」就需要一個可用的資料庫
    # (--reload 每次改檔都會重跑一次並多開一條排程執行緒)。
    Base.metadata.create_all(bind=engine)
    # create_all 不會為既有表加欄位；跨版本升級靠 ensure_schema 補欄
    from database.schema_upgrade import ensure_schema
    ensure_schema(engine)
    schedule_cleanup()

    app_logger.info("URDiary后端服务已启动")
    app_logger.info(f"环境: {ENV}")

@app.on_event("shutdown")
async def shutdown_event():
    app_logger.info("URDiary后端服务正在关闭")