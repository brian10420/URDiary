# app/database/models.py
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import (Column, Integer, String, DateTime, Date, Text, Float,
                        ForeignKey, LargeBinary, UniqueConstraint)
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
    # 陪伴者客製化 (v2.4 spec ①)：五欄皆 nullable，空值語意見 companion_service
    companion_name = Column(String(40), nullable=True)      # 使用者幫 AI 取的名字 (≤20 字)
    user_nickname = Column(String(40), nullable=True)       # AI 對使用者的稱呼 (≤20 字)
    style_reply_length = Column(String(10), nullable=True)  # short / natural / chatty
    style_emoji = Column(String(10), nullable=True)         # none / low / high
    style_formality = Column(String(10), nullable=True)     # casual / polite
    memory_write_mode = Column(String(10), nullable=True)  # NULL=auto / "approval" (v2.5 Spec C 治理)
    onboarding_completed_at = Column(DateTime, nullable=True)  # 初次見面完成戳記 (v2.5 Spec B)
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

class InviteCode(Base):
    """邀請碼 (v2.3 task 1.4：對外開放前的安全閘門)。

    只存 code_hash (明文以 secrets.token_urlsafe(16) 產生、sha256 雜湊後儲存)；
    明文只在 CLI mint 當下顯示一次，資料庫裡永遠拿不回明文
    (backend/scripts/urdiary_admin.py、utils/invite_codes.hash_invite_code)。

    used_count 的遞增走條件式 UPDATE (crud.claim_invite_code_use)，與
    AuthSession 的輪替認領 (crud.claim_auth_session_rotation) 同一種 CAS
    寫法，確保 max_uses 在併發下不會被超用。
    """
    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True)
    code_hash = Column(String(64), unique=True, nullable=False, index=True)
    note = Column(String(200), nullable=True)
    max_uses = Column(Integer, nullable=False, default=1)
    used_count = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime, nullable=True)   # NULL = 永不過期
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)   # NULL = 未撤銷


class LLMCredential(Base):
    """LLM 供應商憑證 (v2.3 task 1.6：雙軌金鑰儲存)。

    兩種列共用同一張表，靠 user_id 區分：

    - `user_id IS NULL` → **伺服器預設**：家人在手機瀏覽器上零設定就能用，
      只由 CLI (`urdiary_admin.py set-server-key`) 管理，永遠只保留一列。
    - `user_id` 有值 → 該使用者的**個人覆寫**，優先於伺服器預設；
      由 `/users/me/llm` 端點管理，一個使用者同樣只保留一列
      (PUT 會先刪光既有列再插入，見 crud.set_llm_credential)。

    `api_key_enc` 存的是 utils/key_vault 的 Fernet 密文，**不是明文**；
    解密金鑰由 SECRET_KEY 導出，因此輪換 SECRET_KEY 會讓這些憑證全部失效
    (降級成「沒有憑證」，不是錯誤，見 services/llm_credential_service)。

    unique(user_id, provider) 是結構上的保險。注意 SQLite 的 unique 索引
    對 NULL 一律視為互異，所以它擋不住「多列伺服器預設」——「只保留一列」
    這件事是由 CRUD 的先刪後插保證的，不能只靠這個約束。
    """
    __tablename__ = "llm_credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    provider = Column(String(20), nullable=False)   # claude/openai/grok/gemini/local
    api_key_enc = Column(Text, nullable=False)      # Fernet 密文 (可為空字串的密文：local 端點免金鑰)
    base_url = Column(String(255), nullable=True)
    model = Column(String(80), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_llm_credentials_user_provider"),
    )


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
    category = Column(String(20), nullable=False, default="other")   # work/study/health/family/anniversary/travel/other
    event_date = Column(Date, nullable=False, index=True)  # 真實本地牆上日期 (非 5am 日記日，見 calendar_service 說明)
    event_time = Column(String(5), nullable=True)          # "HH:MM"；NULL = 全天
    recurrence = Column(String(10), nullable=False, default="none")  # none/daily/weekly/monthly/yearly
    recurrence_until = Column(Date, nullable=True)         # 含當日
    reminder_minutes = Column(Integer, nullable=True)      # NULL = 不提醒 (前端 in-app 通知用)
    end_date = Column(Date, nullable=True)    # 跨天事件結束日 (含當日)；NULL=單日。僅 recurrence="none" 的全天事件可設 (schema+路由雙層驗證)
    color = Column(String(7), nullable=True)  # 事件自選色 "#rrggbb"；NULL=前端用分類色 --cat-*
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DayNote(Base):
    """AI 日記印章＋小語 (v2.5 Spec A)。一使用者一天最多一筆 (upsert 覆蓋)。

    note_date 用「日記日」(utils.time_utils.get_diary_date，凌晨 5 點換日)——
    印章代表的是那篇日記的日子，跟行事曆事件的「真實牆上日期」語意不同，
    這是刻意的：半夜寫完的日記，印章要蓋在使用者心中的「今天」。
    """
    __tablename__ = "day_notes"
    __table_args__ = (UniqueConstraint("user_id", "note_date", name="uq_day_notes_user_date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    note_date = Column(Date, nullable=False, index=True)
    stamp = Column(String(24), nullable=False)      # services/day_stamp.py STAMP_IDS 之一
    phrase = Column(Text, nullable=False)           # AI 小語 (目標 ≤30 字，入庫上限見 day_stamp.NOTE_MAX)
    source_diary_id = Column(Integer, ForeignKey("diaries.id"), nullable=True)  # 回顧連結；刪日記時服務層置 NULL (未來 Spec D)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MemoryFile(Base):
    """常駐記憶檔 (v2.5 Spec C)：一使用者兩列 (user_profile / companion_notes)。

    懶建立——首次寫入 (review pass seed 或使用者編輯) 才產生列；
    不存在＝還沒開始記，注入層 fallback 舊互動筆記或佔位。
    """
    __tablename__ = "memory_files"
    __table_args__ = (UniqueConstraint("user_id", "file_key", name="uq_memory_files_user_key"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    file_key = Column(String(16), nullable=False)   # services/memory_files.FILE_KEYS 之一
    content = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MemoryOp(Base):
    """記憶帳本 (v2.5 Spec C)：每筆變更一列——同時是稽核軌跡與核可制的 pending 佇列。

    status: applied/pending/rejected/undone/stale/failed（語意見設計文件 §2）。
    source_diary_id 供「這筆記憶來自哪篇日記」回溯；刪日記時服務層置 NULL
    (同 day_notes 慣例，不依賴 FK pragma)。
    """
    __tablename__ = "memory_ops"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    file_key = Column(String(16), nullable=False)
    batch_id = Column(String(36), nullable=False, index=True)
    action = Column(String(12), nullable=False)      # add/replace/remove/user_edit
    section = Column(String(40), nullable=True)
    target_text = Column(Text, nullable=True)
    new_text = Column(Text, nullable=True)
    status = Column(String(12), nullable=False, default="applied", index=True)
    source = Column(String(20), nullable=False, default="review_pass")
    source_diary_id = Column(Integer, ForeignKey("diaries.id"), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)


# onboarding 題目白名單 (v2.5 Spec B)：tuple 順序＝raw 區塊與收納素材的渲染順序。
# companion_naming 是「幫陪伴者取名」——不是使用者資料，注入與收納一律排除。
ONBOARDING_QUESTION_KEYS = (
    "companion_naming", "name", "location", "favorite_food",
    "important_people", "hobbies", "strengths", "self_view",
)


class OnboardingAnswer(Base):
    """初次見面的答案原文 (v2.5 Spec B)。一使用者一題一列 (upsert 覆蓋，為未來重跑留路)。

    answer_text 空字串＝跳過（answered_keys 因此含它、續跑不重問；注入渲染時濾掉）。
    ingested_at：memory review pass 收納戳記（spec §7-3 懶收納）——NULL＝尚未收納，
    會出現在 raw 注入區塊與 review pass 素材；成功套用後戳記，區塊自然消失。
    """
    __tablename__ = "onboarding_answers"
    __table_args__ = (UniqueConstraint("user_id", "question_key", name="uq_onboarding_user_key"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    question_key = Column(String(32), nullable=False)
    answer_text = Column(Text, nullable=False, default="")
    answered_at = Column(DateTime, default=datetime.utcnow)
    ingested_at = Column(DateTime, nullable=True)