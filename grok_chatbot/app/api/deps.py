from database import SessionLocal
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from typing import Optional

from utils.security import decode_token, is_token_revoked
from utils.api_exceptions import UnauthorizedError
from utils.error_codes import ErrorCode
import database.crud as crud

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="users/token")

def get_db():
    """
    數據庫會話依賴項，用於注入到路由函數中
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    獲取當前認證用戶的依賴項
    """
    credentials_exception = UnauthorizedError(
        error_code=ErrorCode.UNAUTHORIZED,
        detail="無法驗證憑證",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # 檢查令牌是否被撤銷
    if is_token_revoked(token):
        raise credentials_exception
    
    # 解碼令牌
    token_data = decode_token(token)
    if token_data is None:
        raise credentials_exception
        
    # 獲取用戶
    user = crud.get_user(db, user_id=token_data.user_id)
    if user is None:
        raise credentials_exception
        
    return user

async def get_current_user_optional(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    可選的用戶認證依賴項，用於不強制要求認證的端點
    """
    if not token:
        return None
        
    try:
        return await get_current_user(token, db)
    except:
        return None 