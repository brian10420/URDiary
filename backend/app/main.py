from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from database import engine
from database.models import Base
from api.routes import api_router
from middleware.error_handler import error_handler
from middleware.exception_handlers import register_exception_handlers
from middleware.security_headers import SecurityHeadersMiddleware
from config import CORS_ALLOWED_ORIGINS, ENV, SERVE_FRONTEND, FRONTEND_DIR
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

# 添加安全標頭中間件 (v2.3)：刻意註冊在 CORS 之後，使其成為最外層——
# add_middleware() 是 insert(0, ...)，最後呼叫的排在最外層。CORS 對
# preflight (OPTIONS) 請求會直接短路回應、不呼叫更內層，只有放在最外層
# 才能保證「所有」回應都會被加上安全標頭 (見 middleware/security_headers.py)。
app.add_middleware(SecurityHeadersMiddleware)

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


# -----------------------
# 前端靜態檔案 (v2.3)
# -----------------------
# 刻意不掛 catch-all "/{path:path}"：diary router 沒有 prefix，/generate、
# /diaries/*、/diary/*、/analytics/*、/interaction-notes/* 都在根路徑，
# catch-all 會蓋掉這些 API 路由。改成只掛明確的子樹 (js/css/assets) 與
# 明確的檔案路由，這樣也不會把 desktop/node_modules、package.json、
# main.js (Electron 主行程)、tests/ 曝露到網路。
#
# 這個區塊必須排在 include_router(api_router) 與 /health、
# /system/capabilities 之後：Starlette 依「註冊順序」first-match-wins，
# 同名時要讓 API 路由贏。
if SERVE_FRONTEND:
    app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="fe-js")
    app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="fe-css")
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="fe-assets")

    def _serve_frontend_file(filename: str, *, no_cache: bool = False) -> FileResponse:
        """從 FRONTEND_DIR 讀單一檔案；不存在時回乾淨的 404 (不是 500)。

        manifest.webmanifest/sw.js/favicon.ico 目前都還不存在 (由後續任務
        建立)，行為要跟 StaticFiles 本身缺檔時一致——starlette.staticfiles
        缺檔同樣是 raise HTTPException(status_code=404)，兩者的 404 JSON
        回應形狀才會一致。
        """
        file_path = FRONTEND_DIR / filename
        if not file_path.is_file():
            raise HTTPException(status_code=404)
        headers = {"Cache-Control": "no-cache"} if no_cache else None
        return FileResponse(file_path, headers=headers)

    @app.get("/", include_in_schema=False, name="fe-index")
    def serve_frontend_index():
        return _serve_frontend_file("index.html", no_cache=True)

    @app.get("/manifest.webmanifest", include_in_schema=False, name="fe-manifest")
    def serve_frontend_manifest():
        return _serve_frontend_file("manifest.webmanifest")

    @app.get("/sw.js", include_in_schema=False, name="fe-sw")
    def serve_frontend_service_worker():
        # 必須從網站根目錄提供，Service Worker 的 scope 才能涵蓋整個 app；
        # no-cache 讓瀏覽器每次都重新驗證，PWA 更新才不會卡在舊版 SW。
        return _serve_frontend_file("sw.js", no_cache=True)

    @app.get("/favicon.ico", include_in_schema=False, name="fe-favicon")
    def serve_frontend_favicon():
        return _serve_frontend_file("favicon.ico")


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