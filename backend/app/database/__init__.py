# database/__init__.py
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from config import DB_PATH
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# SQLite 單檔資料庫 (純本地部署，無外部服務)。
# check_same_thread=False：FastAPI 同步端點跑在 threadpool，連線會跨執行緒
# 使用；併發安全由 WAL + busy_timeout + 短交易紀律保證 (LLM 呼叫期間不持 session)。
DB_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DB_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """每條新連線都套用 SQLite 調校。

    WAL：讀寫不互鎖，適合聊天存檔與日記存檔並行的桌面場景。
    busy_timeout：寫鎖競爭時等待而非立刻拋 database is locked。
    foreign_keys：SQLite 預設不強制外鍵，明確開啟。
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
logger.info(f"SQLite database at {DB_PATH}")


def get_db():
    """
    依賴注入函數，用於獲取數據庫會話
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
