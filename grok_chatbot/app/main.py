from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
from database.models import Base
from api.routes import api_router
from middleware.error_handler import error_handler
from middleware.exception_handlers import register_exception_handlers
from config import CORS_ALLOWED_ORIGINS, ENV
from utils.logger import cleanup_old_logs, app_logger
import atexit
import threading
import time
import schedule

# -----------------------
# 日志管理
# -----------------------
# 启动时清理旧日志文件
cleanup_old_logs(days_to_keep=14)

# 创建定时清理任务
def schedule_cleanup():
    def run_scheduled_jobs():
        while True:
            schedule.run_pending()
            time.sleep(3600)  # 每小时检查一次待执行任务
    
    # 每天凌晨2点执行日志清理
    schedule.every().day.at("02:00").do(cleanup_old_logs)
    
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
    allow_headers=["Authorization", "Content-Type"],  # 限制允許的標頭
)

# -----------------------
# 自動建表 (MVP 階段)
# -----------------------
# 當容器啟動時，若表尚未建立，就在 PostgreSQL 內建立
Base.metadata.create_all(bind=engine)

# 註冊API路由
app.include_router(api_router)

# 启动定时任务
schedule_cleanup()

@app.on_event("startup")
async def startup_event():
    app_logger.info("URDiary后端服务已启动")
    app_logger.info(f"环境: {ENV}")

@app.on_event("shutdown")
async def shutdown_event():
    app_logger.info("URDiary后端服务正在关闭")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)