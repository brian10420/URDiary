# app/database/models.py
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, String, DateTime, Date, Text, Float, ForeignKey, LargeBinary
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

class AuthSession(Base):
    """一台裝置的登入工作階段 (v2.3 認證強化)。

    刷新令牌每被使用一次就輪替：舊列填上 replaced_by_jti 保留下來當稽核
    軌跡，另插一列新的。因此「目前活著的工作階段」= revoked_at 為 NULL、
    replaced_by_jti 為 NULL、且 expires_at 還沒過的那一列 (每台裝置剛好
    一列)；輪替時 created_at 會沿用原本的登入時間，裝置清單才顯示得出
    「何時登入」而不是「何時剛好刷新過」。

    舊列不清理 (無清理排程，YAGNI)：它們正是重用偵測的依據 ——
    拿一張已經 replaced 的令牌來刷新，就代表令牌外洩。
    """
    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    refresh_jti = Column(String(36), unique=True, nullable=False, index=True)
    device_label = Column(String(80), nullable=True)
    user_agent = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    replaced_by_jti = Column(String(36), nullable=True)

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

class CalendarEvent(Base):
    """行事曆事件。未來若加欄位必須 nullable (ensure_schema 限制)。"""
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(120), nullable=False)
    note = Column(Text, nullable=True)
    category = Column(String(20), nullable=False, default="other")   # work/study/health/family/anniversary/other
    event_date = Column(Date, nullable=False, index=True)  # 真實本地牆上日期 (非 5am 日記日，見 calendar_service 說明)
    event_time = Column(String(5), nullable=True)          # "HH:MM"；NULL = 全天
    recurrence = Column(String(10), nullable=False, default="none")  # none/daily/weekly/monthly/yearly
    recurrence_until = Column(Date, nullable=True)         # 含當日
    reminder_minutes = Column(Integer, nullable=True)      # NULL = 不提醒 (前端 in-app 通知用)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)