from sqlalchemy import or_
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import List, Optional
from database import models
from utils.time_utils import get_diary_datetime  # 修正导入路径

# User CRUD operations
def create_user(db: Session, username: str, password_hash: Optional[str] = None):
    """Create a new user in the database (password_hash 由路由層以 bcrypt 產生)"""
    user = models.User(username=username, password_hash=password_hash)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def get_user(db: Session, user_id: int):
    """Get a user by ID"""
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_username(db: Session, username: str):
    """Get a user by username"""
    return db.query(models.User).filter(models.User.username == username).first()

# Diary CRUD operations
def create_diary(db: Session, user_id: int, content: str,
                valence: Optional[float] = None, arousal: Optional[float] = None,
                title: Optional[str] = None, summary: Optional[str] = None):
    """Create a new diary entry for a user"""
    diary = models.Diary(
        user_id=user_id,
        content=content,
        title=title,
        summary=summary,
        valence=valence,
        arousal=arousal,
        diary_date=get_diary_datetime()  # 使用自定义时间函数获取正确的日期
    )
    db.add(diary)
    db.commit()
    db.refresh(diary)

    # best-effort 語意索引：在背景執行緒生成 embedding (不阻塞請求、
    # 不影響存檔結果；fastembed 未安裝時內部直接跳過)。
    # 延遲 import 避免 crud <-> services 頂層循環依賴。
    try:
        from services.memory_retrieval import schedule_index_diary
        schedule_index_diary(diary.id, diary.title, diary.summary, diary.content)
    except Exception:
        pass

    return diary

def get_diary(db: Session, diary_id: int):
    """Get a diary entry by ID"""
    return db.query(models.Diary).filter(models.Diary.id == diary_id).first()

def get_user_diaries(db: Session, user_id: int, skip: int = 0, limit: int = 100):
    """Get all diary entries for a user"""
    return db.query(models.Diary).filter(
        models.Diary.user_id == user_id
    ).order_by(models.Diary.diary_date.desc()).offset(skip).limit(limit).all()

def update_diary(db: Session, diary_id: int, **kwargs):
    """Update a diary entry"""
    diary = get_diary(db, diary_id)
    if not diary:
        return None
        
    for key, value in kwargs.items():
        if hasattr(diary, key):
            setattr(diary, key, value)
            
    db.commit()
    db.refresh(diary)
    return diary

def delete_diary(db: Session, diary_id: int):
    """Delete a diary entry"""
    diary = get_diary(db, diary_id)
    if not diary:
        return False

    db.delete(diary)
    db.commit()
    return True

def search_diaries_by_terms(db: Session, user_id: int, terms: List[str],
                            limit: int = 50,
                            exclude_ids: Optional[set] = None) -> List[models.Diary]:
    """以關鍵字 OR-LIKE 搜尋日記的 title/summary/content (記憶檢索的候選撈取)。

    只撈候選 (LIMIT 50)，相關性計分由 services/memory_retrieval 在
    Python 端進行 (個人日記量在數百篇等級，記憶體排序無壓力)。
    """
    if not terms:
        return []
    conditions = []
    for term in terms:
        pattern = f"%{term}%"
        conditions.append(or_(
            models.Diary.title.ilike(pattern),
            models.Diary.summary.ilike(pattern),
            models.Diary.content.ilike(pattern),
        ))
    query = (db.query(models.Diary)
             .filter(models.Diary.user_id == user_id)
             .filter(or_(*conditions)))
    if exclude_ids:
        query = query.filter(~models.Diary.id.in_(exclude_ids))
    return query.order_by(models.Diary.diary_date.desc()).limit(limit).all()

def get_latest_diary(db: Session, user_id: int, within_days: int = 3) -> Optional[models.Diary]:
    """取最近一篇日記；超過 within_days 天回 None (每日 check-in 的素材)。

    diary_date 與 get_diary_datetime() 同為台北牆上時間的 naive datetime，
    可直接相減。
    """
    diary = (db.query(models.Diary)
             .filter(models.Diary.user_id == user_id)
             .order_by(models.Diary.diary_date.desc())
             .first())
    if not diary:
        return None
    if get_diary_datetime() - diary.diary_date > timedelta(days=within_days):
        return None
    return diary

# DiaryEmbedding CRUD operations (語意檢索選配)
def upsert_diary_embedding(db: Session, diary_id: int, model: str,
                           vector: bytes, dim: int):
    """寫入或更新日記的語意向量"""
    row = db.query(models.DiaryEmbedding).filter(
        models.DiaryEmbedding.diary_id == diary_id
    ).first()
    if row:
        row.model = model
        row.dim = dim
        row.vector = vector
    else:
        db.add(models.DiaryEmbedding(
            diary_id=diary_id, model=model, dim=dim, vector=vector))
    db.commit()

def get_user_embeddings(db: Session, user_id: int, model: str):
    """取用戶全部日記向量 (與日記 join，供餘弦相似度計算)"""
    return (db.query(models.DiaryEmbedding, models.Diary)
            .join(models.Diary, models.Diary.id == models.DiaryEmbedding.diary_id)
            .filter(models.Diary.user_id == user_id,
                    models.DiaryEmbedding.model == model)
            .all())