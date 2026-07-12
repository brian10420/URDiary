"""聊天歷史儲存層 (SQLite)。

原本存 Redis (單 key JSON、TTL 30 天)；純本地部署後改存主資料庫的
chat_messages 表——後端重啟不失憶，資料也可供記憶檢索使用。
對外介面維持舊版的 messages 陣列格式：[{"role": ..., "content": ...}, ...]，
只存 user/assistant 訊息，system prompt 永遠不落地。

此模組自行開/關 session (短交易)；呼叫端不應在持有 DB session 的
情況下呼叫 LLM (見 interaction_service 的連線紀律說明)。
"""
from datetime import datetime, timedelta

from database import SessionLocal
from database.models import ChatMessage

# 對話歷史保留上限：超過則數修剪最舊的；超過天數由每日排程清除
MAX_HISTORY_MESSAGES = 200
HISTORY_RETENTION_DAYS = 30


def get_chat_history(user_id):
    """取得使用者的對話記錄 (近 30 天、最後 200 則，時間正序)。"""
    cutoff = datetime.utcnow() - timedelta(days=HISTORY_RETENTION_DAYS)
    db = SessionLocal()
    try:
        rows = (
            db.query(ChatMessage)
            .filter(
                ChatMessage.user_id == int(user_id),
                ChatMessage.created_at >= cutoff,
            )
            .order_by(ChatMessage.id.desc())
            .limit(MAX_HISTORY_MESSAGES)
            .all()
        )
        return [{"role": r.role, "content": r.content} for r in reversed(rows)]
    finally:
        db.close()


def append_chat_messages(user_id, messages):
    """附加本輪訊息到對話歷史，並修剪超過上限的舊訊息。

    取代舊版「整串重寫」的 save_chat_history：append 語意下兩個請求
    交錯時只會各自加上自己的訊息，不會互相覆蓋。
    """
    if not messages:
        return
    uid = int(user_id)
    db = SessionLocal()
    try:
        for m in messages:
            db.add(ChatMessage(user_id=uid, role=m["role"], content=m["content"]))
        db.commit()

        # 修剪：找出第 MAX_HISTORY_MESSAGES+1 新的訊息，刪除它與更舊的
        threshold = (
            db.query(ChatMessage.id)
            .filter(ChatMessage.user_id == uid)
            .order_by(ChatMessage.id.desc())
            .offset(MAX_HISTORY_MESSAGES)
            .limit(1)
            .first()
        )
        if threshold:
            db.query(ChatMessage).filter(
                ChatMessage.user_id == uid,
                ChatMessage.id <= threshold[0],
            ).delete(synchronize_session=False)
            db.commit()
    finally:
        db.close()


def clear_chat_history(user_id):
    """清除使用者的對話記錄"""
    db = SessionLocal()
    try:
        db.query(ChatMessage).filter(
            ChatMessage.user_id == int(user_id)
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def purge_expired_chat_messages():
    """刪除所有使用者超過保留天數的訊息 (main.py 每日排程呼叫)。"""
    cutoff = datetime.utcnow() - timedelta(days=HISTORY_RETENTION_DAYS)
    db = SessionLocal()
    try:
        deleted = (
            db.query(ChatMessage)
            .filter(ChatMessage.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        return deleted
    finally:
        db.close()
