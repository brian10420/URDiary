"""陪伴者客製化設定的讀取 (v2.4 spec ①)。

鐵律 (同 llm_credential_service)：自己用 db_session() 開短交易、回傳純資料
快照 dataclass——絕不把 ORM 物件或 session 交給呼叫端，session 不得活過
後續的 llm.chat 呼叫。
"""
from dataclasses import dataclass
from typing import Optional

from database import db_session
from database.models import User


@dataclass(frozen=True)
class CompanionSettings:
    """users 表五欄的純資料快照；全 None = 使用者從未設定過。"""
    name: Optional[str] = None
    nickname: Optional[str] = None
    reply_length: Optional[str] = None
    emoji: Optional[str] = None
    formality: Optional[str] = None

    def is_empty(self) -> bool:
        return not (self.name or self.nickname or self.reply_length
                    or self.emoji or self.formality)


EMPTY_COMPANION = CompanionSettings()


def get_companion_settings(user_id: int) -> CompanionSettings:
    """讀取使用者的陪伴者設定；查無使用者時回空設定 (不拋錯，聊天不因此中斷)。"""
    with db_session() as db:
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            return EMPTY_COMPANION
        return CompanionSettings(
            name=user.companion_name or None,
            nickname=user.user_nickname or None,
            reply_length=user.style_reply_length or None,
            emoji=user.style_emoji or None,
            formality=user.style_formality or None,
        )
