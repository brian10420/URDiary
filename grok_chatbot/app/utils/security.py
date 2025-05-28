# app/utils/security.py
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
import redis
from config import REDIS_HOST, REDIS_PORT, REDIS_DB

from database import get_db
import database.crud as crud
from utils.error_codes import ErrorCode
from utils.api_exceptions import UnauthorizedError
from utils.logger import log_error

# 從配置中載入密鑰和設置
# 通過從配置模塊導入避免循環引用
from config import SECRET_KEY, HASH_SALT, API_KEY

redis_client = redis.StrictRedis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB)

# JWT token設置
ALGORITHM = "HS256"
# 默認為12小時，但可通過參數設置更長時間
ACCESS_TOKEN_EXPIRE_MINUTES = 720

# 密碼哈希配置
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# API密鑰驗證
api_key_header = APIKeyHeader(name="X-API-Key")

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None

def verify_api_key(api_key: str = Depends(api_key_header)):
    """驗證API密鑰"""
    if api_key != API_KEY:
        log_error("Invalid API key attempt", {"provided_key_length": len(api_key) if api_key else 0})
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail="無效的API密鑰",
            headers={"WWW-Authenticate": "APIKey"},
        )
    return api_key

def get_password_hash(password: str) -> str:
    """生成密碼的哈希值"""
    salted_password = f"{password}{HASH_SALT}"
    return pwd_context.hash(salted_password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """驗證密碼"""
    salted_password = f"{plain_password}{HASH_SALT}"
    return pwd_context.verify(salted_password, hashed_password)

def create_long_lived_token(data: dict):
    """创建长期有效的令牌，适合日记应用"""
    to_encode = data.copy()
    # 7天有效期
    expire = datetime.utcnow() + timedelta(days=7)
    to_encode.update({"exp": expire})
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

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
        "jti": str(uuid.uuid4()),  # JWT唯一ID，用於撤銷
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

def revoke_token(token: str, expire_in_seconds: int = None):
    """將令牌加入黑名單"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = payload.get("jti")
        
        if not jti:
            return False
            
        # 如果沒有指定過期時間，使用令牌的原始過期時間
        if expire_in_seconds is None:
            token_exp = payload.get("exp")
            if token_exp:
                now = datetime.utcnow().timestamp()
                expire_in_seconds = int(token_exp - now)
                
        # 添加到黑名單
        redis_key = f"revoked_token:{jti}"
        redis_client.set(redis_key, "1")
        
        # 設置過期時間（如果有）
        if expire_in_seconds and expire_in_seconds > 0:
            redis_client.expire(redis_key, expire_in_seconds)
            
        return True
    except Exception as e:
        log_error(e, {"action": "revoke_token"})
        return False

def is_token_revoked(token: str) -> bool:
    """檢查令牌是否被撤銷"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = payload.get("jti")
        
        if not jti:
            return False
            
        redis_key = f"revoked_token:{jti}"
        return bool(redis_client.exists(redis_key))
    except Exception:
        return False
    
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

async def get_current_user(token: str, db: Session = Depends(get_db)):
    """獲取當前用戶"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="無法驗證憑證",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token_data = decode_token(token)
    if token_data is None:
        raise credentials_exception
        
    user = crud.get_user(db, user_id=token_data.user_id)
    if user is None:
        raise credentials_exception
        
    return user



def sanitize_input(input_data: str) -> str:
    """對輸入進行清理，防止SQL注入和XSS攻擊"""
    # 簡單的清理策略，實際應用中可根據需要擴展
    if not input_data:
        return input_data
        
    # 替換危險字符
    replacements = {
        "'": "''",  # SQL注入防護
        "<": "&lt;", # XSS防護
        ">": "&gt;", # XSS防護
        "--": "",    # SQL注入防護
        ";": "",     # SQL注入防護
    }
    
    result = input_data
    for char, replacement in replacements.items():
        result = result.replace(char, replacement)
        
    return result

def get_token_expiry(token: str) -> Optional[datetime]:
    """獲取令牌的過期時間"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": False})
        exp = payload.get("exp")
        if exp:
            return datetime.fromtimestamp(exp)
        return None
    except JWTError:
        return None

def is_token_about_to_expire(token: str, threshold_hours: int = 24) -> bool:
    """檢查令牌是否即將過期（默認閾值為24小時）"""
    expiry = get_token_expiry(token)
    if not expiry:
        return True
        
    threshold = datetime.utcnow() + timedelta(hours=threshold_hours)
    return expiry <= threshold