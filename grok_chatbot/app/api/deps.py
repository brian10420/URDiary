from database import SessionLocal
from sqlalchemy.orm import Session

def get_db():
    """
    數據庫會話依賴項，用於注入到路由函數中
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 