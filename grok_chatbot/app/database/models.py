# app/database/models.py
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    # nullable 以相容加欄位前建立的舊帳號；登入時對 NULL 回明確錯誤要求重設
    password_hash = Column(String(255), nullable=True)
    # 每日 check-in：最後一次 AI 主動問候的「日記日」(5am 換日，naive 台北牆上時間)
    last_checkin_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    diaries = relationship("Diary", back_populates="user")

class Diary(Base):
    __tablename__ = "diaries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    diary_date = Column(DateTime, default=datetime.utcnow)
    content = Column(Text, nullable=False)

    # LLM 生成的標題與一行摘要 (記憶檢索與「引用某天日記」的地基)。
    # nullable：舊資料無此欄，顯示時由前後端的 derive 後備補上
    title = Column(String(120), nullable=True)
    summary = Column(String(500), nullable=True)

    # valence, arousal 以情緒為例，非必要可自行移除
    valence = Column(Float, nullable=True)
    arousal = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="diaries")

class DiaryEmbedding(Base):
    """日記的語意向量 (選配的語意檢索用；fastembed 未安裝時此表閒置)。

    vector 為 float32 numpy tobytes()；model 記錄生成模型，
    換模型時舊向量不混用 (查詢按 model 過濾)。
    """
    __tablename__ = "diary_embeddings"

    diary_id = Column(Integer, ForeignKey("diaries.id", ondelete="CASCADE"), primary_key=True)
    model = Column(String(80), nullable=False)
    dim = Column(Integer, nullable=False)
    vector = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class ChatMessage(Base):
    """聊天訊息 (原 Redis 對話歷史，純本地部署後落地 SQLite)。

    只存 user/assistant 兩種 role；保留策略 (200 則/30 天) 由
    memory_manager 在寫入與每日排程時執行。
    """
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

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