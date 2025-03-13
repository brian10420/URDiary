from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from database import models

# User CRUD operations
def create_user(db: Session, username: str):
    """Create a new user in the database"""
    user = models.User(username=username)
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

def get_users(db: Session, skip: int = 0, limit: int = 100):
    """Get a list of users"""
    return db.query(models.User).offset(skip).limit(limit).all()

# Diary CRUD operations
def create_diary(db: Session, user_id: int, content: str, 
                valence: Optional[float] = None, arousal: Optional[float] = None):
    """Create a new diary entry for a user"""
    diary = models.Diary(
        user_id=user_id,
        content=content,
        valence=valence,
        arousal=arousal,
        diary_date=datetime.utcnow()
    )
    db.add(diary)
    db.commit()
    db.refresh(diary)
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