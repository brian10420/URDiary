"""共用的請求 schema (Pydantic model)。

chat.py 與 diary.py 原本各自宣告一份幾乎相同的 UserDiaryCreate，合併到
這裡供兩個 router 共用。之後新功能 (如行事曆) 若也有跨路由共用的請求
schema，一併放這裡。
"""
from typing import Optional
from pydantic import BaseModel


class UserDiaryCreate(BaseModel):
    """`/chat/end/`、`/diary/generate`、`/diary/enhanced-generate`、
    `/diary/interaction-notes/update` 共用的請求 body。

    身分一律由 JWT 導出 (見各路由的 get_current_user 依賴)，user_id/
    numeric_user_id/model 這幾個欄位僅為相容舊客戶端而保留，伺服器端
    一律忽略。
    """
    user_id: Optional[str] = None  # 已忽略，身分取自 token
    numeric_user_id: Optional[int] = None  # 已忽略，身分取自 token
    exclude_interaction_notes: bool = False
    model: Optional[str] = None  # 已忽略，模型取自 X-LLM-Model 標頭
