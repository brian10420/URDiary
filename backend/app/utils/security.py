# app/utils/security.py
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import uuid

from utils.logger import log_error

# 從配置中載入密鑰和設置
# 通過從配置模塊導入避免循環引用
from config import SECRET_KEY, HASH_SALT

# JWT token設置
ALGORITHM = "HS256"
# 默認為12小時，但可通過參數設置更長時間
ACCESS_TOKEN_EXPIRE_MINUTES = 720

# 密碼哈希配置
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None

def get_password_hash(password: str) -> str:
    """生成密碼的哈希值"""
    salted_password = f"{password}{HASH_SALT}"
    return pwd_context.hash(salted_password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """驗證密碼"""
    salted_password = f"{plain_password}{HASH_SALT}"
    return pwd_context.verify(salted_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """創建JWT訪問令牌，添加標準聲明"""
    to_encode = data.copy()
    
    issued_at = datetime.utcnow()
    expire = issued_at + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    
    # 添加標準聲明
    to_encode.update({
        "iat": issued_at,    # 簽發時間
        "exp": expire,       # 過期時間
        "iss": "ai_diary",   # 簽發者
        "jti": str(uuid.uuid4()),  # JWT 唯一 ID (預留：未來若加入撤銷機制可用)
    })
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict):
    """創建刷新令牌"""
    to_encode = data.copy()
    
    issued_at = datetime.utcnow()
    # 刷新令牌有效期更長，這裡設為30天
    expire = issued_at + timedelta(days=30)
    
    to_encode.update({
        "iat": issued_at,
        "exp": expire,
        "iss": "ai_diary",
        "jti": str(uuid.uuid4()),
        "type": "refresh"  # 標記為刷新令牌
    })
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str):
    """解碼JWT令牌"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        user_id = payload.get("id")
        
        if username is None or user_id is None:
            log_error("JWT令牌格式無效", {"payload": payload})
            return None
            
        return TokenData(username=username, user_id=user_id)
    except jwt.ExpiredSignatureError:
        log_error("JWT令牌已過期", {"token_prefix": token[:20] if token else "None"})
        return None
    except JWTError as e:
        log_error("JWT解碼錯誤", {"error": str(e), "token_prefix": token[:20] if token else "None"})
        return None