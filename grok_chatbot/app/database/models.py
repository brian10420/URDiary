# app/database/models.py
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    diaries = relationship("Diary", back_populates="user")

class Diary(Base):
    __tablename__ = "diaries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    title = Column(String(255), nullable=True)
    diary_date = Column(DateTime, default=datetime.utcnow)
    content = Column(Text, nullable=False)

    # valence, arousal 以情緒為例，非必要可自行移除
    valence = Column(Float, nullable=True)
    arousal = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="diaries")

class InteractionNote(Base):
    __tablename__ = "interaction_notes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # 互動筆記內容
    content = Column(Text, nullable=False)
    
    # 版本追蹤
    version = Column(Integer, default=1)
    
    updated_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 關係
    user = relationship("User", back_populates="interaction_notes")

# 在 User 類中添加
User.interaction_notes = relationship("InteractionNote", back_populates="user")