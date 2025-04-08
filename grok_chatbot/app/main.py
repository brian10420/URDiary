from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
from database.models import Base
from api.routes import api_router
from middleware.error_handler import error_handler
from middleware.exception_handlers import register_exception_handlers

# -----------------------
# 初始化 FastAPI
# -----------------------
app = FastAPI(
    title="AI Diary API",
    description="AI日記應用後端API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# 添加錯誤處理中間件
app.middleware("http")(error_handler)

# 註冊異常處理器
register_exception_handlers(app)

# 添加 CORS 中間件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生產環境中，您應該指定具體的源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------
# 自動建表 (MVP 階段)
# -----------------------
# 當容器啟動時，若表尚未建立，就在 PostgreSQL 內建立
Base.metadata.create_all(bind=engine)

# 註冊API路由
app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)