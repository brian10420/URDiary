from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
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

# AuthSession CRUD operations (v2.3 認證強化)
# 時間欄位一律用 datetime.utcnow()，與 JWT 的 iat/exp 同一個時間軸
# (日記那邊用的是台北牆上時間，兩者不可混用)。

def create_auth_session(db: Session, user_id: int, refresh_jti: str, expires_at: datetime,
                        device_label: Optional[str] = None, user_agent: Optional[str] = None,
                        created_at: Optional[datetime] = None):
    """新增一列工作階段 (created_at 可指定，供輪替時沿用原本的登入時間)"""
    now = datetime.utcnow()
    session = models.AuthSession(
        user_id=user_id,
        refresh_jti=refresh_jti,
        device_label=device_label,
        user_agent=user_agent,
        created_at=created_at or now,
        last_used_at=now,
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_auth_session_by_jti(db: Session, refresh_jti: str):
    """依刷新令牌的 jti 取工作階段 (含已撤銷／已輪替的舊列)"""
    return db.query(models.AuthSession).filter(
        models.AuthSession.refresh_jti == refresh_jti
    ).first()


def get_auth_session(db: Session, session_id: int):
    return db.query(models.AuthSession).filter(models.AuthSession.id == session_id).first()


def list_active_auth_sessions(db: Session, user_id: int) -> List[models.AuthSession]:
    """使用者目前活著的工作階段 (每台裝置一列)：未撤銷、未輪替、未過期"""
    return (db.query(models.AuthSession)
            .filter(models.AuthSession.user_id == user_id)
            .filter(models.AuthSession.revoked_at.is_(None))
            .filter(models.AuthSession.replaced_by_jti.is_(None))
            .filter(models.AuthSession.expires_at > datetime.utcnow())
            .order_by(models.AuthSession.last_used_at.desc())
            .all())


def claim_auth_session_rotation(db: Session, session_id: int, new_jti: str) -> bool:
    """把「這一列還沒被輪替過」的檢查與寫入合成一次條件式 UPDATE (CAS)。

    先讀後寫會有競態：兩個並行的刷新請求都讀到「未輪替」，就會從同一張
    刷新令牌長出兩條有效的鏈。這裡靠 WHERE ... IS NULL 讓資料庫來裁決，
    只有 rowcount == 1 的那一方算贏。
    """
    updated = (db.query(models.AuthSession)
               .filter(models.AuthSession.id == session_id)
               .filter(models.AuthSession.replaced_by_jti.is_(None))
               .filter(models.AuthSession.revoked_at.is_(None))
               .update({"replaced_by_jti": new_jti, "last_used_at": datetime.utcnow()},
                       synchronize_session=False))
    db.commit()
    return updated == 1


def revoke_auth_session_chain(db: Session, session: models.AuthSession) -> int:
    """撤銷一條輪替鏈上所有還活著的列 (從 session 沿 replaced_by_jti 往後走)。

    登出時客戶端手上的訪問令牌可能是輪替前簽發的，sid 指向鏈中間的舊列；
    只撤那一列的話，鏈尾那個真正還能用的工作階段會活下來。
    """
    now = datetime.utcnow()
    revoked = 0
    current = session
    seen = set()
    while current is not None and current.id not in seen:
        seen.add(current.id)
        if current.revoked_at is None:
            current.revoked_at = now
            revoked += 1
        next_jti = current.replaced_by_jti
        current = get_auth_session_by_jti(db, next_jti) if next_jti else None
    db.commit()
    return revoked


def revoke_all_user_auth_sessions(db: Session, user_id: int) -> int:
    """撤銷該使用者所有未撤銷的工作階段 (重用偵測時的緊急煞車)"""
    count = (db.query(models.AuthSession)
             .filter(models.AuthSession.user_id == user_id)
             .filter(models.AuthSession.revoked_at.is_(None))
             .update({"revoked_at": datetime.utcnow()}, synchronize_session=False))
    db.commit()
    return count


def delete_user(db: Session, user_id: int) -> bool:
    """刪除使用者。

    唯一呼叫端是邀請碼消費競態失敗時的補償刪除 (api/routes/user.py)：
    帳號剛建立、還沒有任何關聯資料 (日記/工作階段等)，直接刪除即可，
    不需要處理外鍵串連刪除。
    """
    user = get_user(db, user_id)
    if not user:
        return False
    db.delete(user)
    db.commit()
    return True


# InviteCode CRUD operations (v2.3 task 1.4：邀請碼註冊閘門)
# 明文碼只存在於 CLI mint 當下的終端輸出；資料庫一律只存 sha256 雜湊
# (utils/invite_codes.hash_invite_code)，這裡的函式全部只吃/回 code_hash。

def create_invite_code(db: Session, code_hash: str, max_uses: int = 1,
                       note: Optional[str] = None,
                       expires_at: Optional[datetime] = None):
    """新增一組邀請碼 (used_count 從 0 起算)"""
    invite = models.InviteCode(
        code_hash=code_hash,
        max_uses=max_uses,
        note=note,
        expires_at=expires_at,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


def get_invite_code(db: Session, invite_id: int):
    return db.query(models.InviteCode).filter(models.InviteCode.id == invite_id).first()


def get_invite_code_by_hash(db: Session, code_hash: str):
    return db.query(models.InviteCode).filter(models.InviteCode.code_hash == code_hash).first()


def list_invite_codes(db: Session) -> List[models.InviteCode]:
    """CLI `list-invites` 用：依建立順序列出全部邀請碼 (含已撤銷/已用完的)。"""
    return db.query(models.InviteCode).order_by(models.InviteCode.id).all()


def invite_code_is_usable(invite: models.InviteCode) -> bool:
    """未撤銷、未過期、還有剩餘名額 —— /users/create 消費前的「驗證但不消費」判斷。

    真正防止超用的是 claim_invite_code_use 的條件式 UPDATE；這裡只是先擋掉
    明顯無效的碼，避免每個請求都先建立使用者再失敗回滾。
    """
    if invite.revoked_at is not None:
        return False
    if invite.expires_at is not None and invite.expires_at <= datetime.utcnow():
        return False
    return invite.used_count < invite.max_uses


def claim_invite_code_use(db: Session, invite_id: int) -> bool:
    """把「還有剩餘名額」的檢查與 used_count 遞增合成一次條件式 UPDATE (CAS)。

    與 claim_auth_session_rotation 同一種寫法：先讀後寫會有競態 —— 兩個
    並行的註冊請求都讀到「還有 1 個名額」，就會一起通過驗證、一起把
    used_count 加到超過 max_uses。這裡靠 WHERE used_count < max_uses 讓
    資料庫來裁決，只有 rowcount == 1 的那一方算贏；連 revoked_at/expires_at
    也一併在 WHERE 裡覆核，避免「驗證通過後、認領前」這段極短時間內剛好
    被 CLI 撤銷或過期的邊界情況。
    """
    now = datetime.utcnow()
    updated = (db.query(models.InviteCode)
               .filter(models.InviteCode.id == invite_id)
               .filter(models.InviteCode.revoked_at.is_(None))
               .filter(models.InviteCode.used_count < models.InviteCode.max_uses)
               .filter(or_(models.InviteCode.expires_at.is_(None),
                           models.InviteCode.expires_at > now))
               .update({"used_count": models.InviteCode.used_count + 1},
                       synchronize_session=False))
    db.commit()
    return updated == 1


def revoke_invite_code(db: Session, invite_id: int):
    """撤銷一組邀請碼 (設定 revoked_at)；已撤銷過的再呼叫一次是 no-op (冪等)。

    回傳該列 (找不到該 id 回 None)，供 CLI 印出目前狀態。
    """
    invite = get_invite_code(db, invite_id)
    if invite is None:
        return None
    if invite.revoked_at is None:
        invite.revoked_at = datetime.utcnow()
        db.commit()
        db.refresh(invite)
    return invite


# LLMCredential CRUD operations (v2.3 task 1.6：雙軌 LLM 金鑰儲存)
# 這些函式一律只碰 `api_key_enc` (密文)，加解密由 utils/key_vault 負責、
# 由呼叫端在進出資料庫「之前/之後」完成——與邀請碼只存 code_hash 同一個
# 分層原則：CRUD 不該看到、也不需要看到明文。
# user_id=None 代表伺服器預設那一列 (SQL 上是 IS NULL，不能寫成 == None)。

def _llm_credential_owner_filter(query, user_id: Optional[int]):
    if user_id is None:
        return query.filter(models.LLMCredential.user_id.is_(None))
    return query.filter(models.LLMCredential.user_id == user_id)


def get_user_llm_credential(db: Session, user_id: int):
    """該使用者的個人憑證 (沒有則 None)。"""
    return (_llm_credential_owner_filter(db.query(models.LLMCredential), user_id)
            .order_by(models.LLMCredential.id.desc())
            .first())


def get_server_llm_credential(db: Session):
    """伺服器預設憑證 (user_id IS NULL；沒有則 None)。"""
    return (_llm_credential_owner_filter(db.query(models.LLMCredential), None)
            .order_by(models.LLMCredential.id.desc())
            .first())


def set_llm_credential(db: Session, user_id: Optional[int], provider: str,
                       api_key_enc: str, base_url: Optional[str] = None,
                       model: Optional[str] = None):
    """設定「這個擁有者唯一的一組憑證」：先刪光既有列，再插入新的一列。

    刪與插之間**不 commit**，整段是同一個交易——兩個並發的 PUT 才不會出現
    「都刪完了、都要插入」而撞上 unique(user_id, provider)，或更糟的
    「刪掉了但沒插回去」。SQLite 的寫鎖會把兩個交易排成先後順序。

    刻意不做「就地更新既有列」：換供應商時舊列必須消失，否則同一個使用者
    會同時留著兩組憑證，解析順序得多一條「該挑哪一個」的規則。
    """
    _llm_credential_owner_filter(db.query(models.LLMCredential), user_id).delete(
        synchronize_session=False)

    credential = models.LLMCredential(
        user_id=user_id,
        provider=provider,
        api_key_enc=api_key_enc,
        base_url=base_url,
        model=model,
        updated_at=datetime.utcnow(),
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return credential


def delete_llm_credentials(db: Session, user_id: Optional[int]) -> int:
    """刪除該擁有者的憑證 (回傳刪掉幾列；沒有時回 0，冪等)。"""
    deleted = _llm_credential_owner_filter(
        db.query(models.LLMCredential), user_id).delete(synchronize_session=False)
    db.commit()
    return deleted


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

# CalendarEvent CRUD operations
def create_calendar_event(db: Session, user_id: int, title: str, event_date, *,
                          note: Optional[str] = None, category: str = "other",
                          event_time: Optional[str] = None, recurrence: str = "none",
                          recurrence_until=None, reminder_minutes: Optional[int] = None,
                          end_date=None, color: Optional[str] = None):
    """新增一筆行事曆事件 (event_date/recurrence_until/end_date 一律傳 datetime.date 物件)"""
    event = models.CalendarEvent(
        user_id=user_id,
        title=title,
        note=note,
        category=category,
        event_date=event_date,
        event_time=event_time,
        recurrence=recurrence,
        recurrence_until=recurrence_until,
        reminder_minutes=reminder_minutes,
        end_date=end_date,
        color=color,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event

def get_calendar_event(db: Session, event_id: int):
    """依 ID 取得單筆行事曆事件"""
    return db.query(models.CalendarEvent).filter(models.CalendarEvent.id == event_id).first()

def get_calendar_events(db: Session, user_id: int, start, end) -> List[models.CalendarEvent]:
    """取得使用者在 [start, end] 視窗內「可能落有 occurrence」的原始事件列。

    只做粗篩：非重複事件要求 event_date 落在視窗內；重複事件只要求
    「還沒結束」(recurrence_until 為 NULL 或未早於 start)。實際 occurrence
    展開 (含跳過短月/取閏年等細節) 交由 services.calendar_service.expand_occurrences
    在 session 外進行。
    """
    return (db.query(models.CalendarEvent)
            .filter(models.CalendarEvent.user_id == user_id)
            .filter(models.CalendarEvent.event_date <= end)
            .filter(or_(
                and_(models.CalendarEvent.recurrence == "none",
                     models.CalendarEvent.event_date >= start),
                and_(models.CalendarEvent.recurrence != "none",
                     or_(models.CalendarEvent.recurrence_until.is_(None),
                         models.CalendarEvent.recurrence_until >= start)),
            ))
            .all())

def update_calendar_event(db: Session, event_id: int, **kwargs):
    """更新行事曆事件欄位"""
    event = get_calendar_event(db, event_id)
    if not event:
        return None

    for key, value in kwargs.items():
        if hasattr(event, key):
            setattr(event, key, value)

    db.commit()
    db.refresh(event)
    return event

def delete_calendar_event(db: Session, event_id: int) -> bool:
    """刪除行事曆事件"""
    event = get_calendar_event(db, event_id)
    if not event:
        return False

    db.delete(event)
    db.commit()
    return True


# DayNote CRUD operations (v2.5 Spec A：AI 日記印章＋小語)
def upsert_day_note(db: Session, user_id: int, note_date, stamp: str, phrase: str, *,
                    source_diary_id: Optional[int] = None):
    """同 (user_id, note_date) 覆蓋更新；不存在則新增 (v2.5 Spec A)。"""
    row = (db.query(models.DayNote)
             .filter(models.DayNote.user_id == user_id,
                     models.DayNote.note_date == note_date)
             .first())
    if row is None:
        row = models.DayNote(user_id=user_id, note_date=note_date,
                             stamp=stamp, phrase=phrase, source_diary_id=source_diary_id)
        db.add(row)
    else:
        row.stamp = stamp
        row.phrase = phrase
        row.source_diary_id = source_diary_id
    db.commit()
    db.refresh(row)
    return row


def get_day_notes(db: Session, user_id: int, start, end) -> List[models.DayNote]:
    """取 [start, end] (含兩端) 的印章，依日期排序。"""
    return (db.query(models.DayNote)
              .filter(models.DayNote.user_id == user_id,
                      models.DayNote.note_date >= start,
                      models.DayNote.note_date <= end)
              .order_by(models.DayNote.note_date)
              .all())


def delete_day_note(db: Session, user_id: int, note_date) -> bool:
    """刪除某日印章；不存在回 False。"""
    row = (db.query(models.DayNote)
             .filter(models.DayNote.user_id == user_id,
                     models.DayNote.note_date == note_date)
             .first())
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True