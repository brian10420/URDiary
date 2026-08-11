# app/utils/security.py
"""密碼雜湊與 JWT 的簽發／驗證。

v2.3 認證強化的兩條鐵律：
1. **每個令牌都帶 `type`，驗證時一定要比對**。少了這一步，刷新令牌就能
   當訪問令牌用 —— 它有效期 30 天，等於把整條長命憑證直接送進所有
   受保護端點。
2. **簽發者 (`iss`) 一定要比對**。SECRET_KEY 若被其他用途共用，別人簽的
   token 也會通過簽章驗證；`iss` 是最後一道成本極低的防線。
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import uuid

from utils.logger import log_error

# 從配置中載入密鑰和設置
# 通過從配置模塊導入避免循環引用
from config import SECRET_KEY, HASH_SALT, ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS

# JWT token設置
ALGORITHM = "HS256"
ISSUER = "ai_diary"
TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"
# 預設有效期由 config 決定 (URDIARY_ACCESS_TOKEN_MINUTES / URDIARY_REFRESH_TOKEN_DAYS)
ACCESS_TOKEN_EXPIRE_MINUTES = ACCESS_TOKEN_MINUTES

# 密碼哈希配置
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None
    # 工作階段參照 (= 簽發當下該裝置的 refresh_jti)。logout 與裝置清單靠它
    # 認出「這個請求來自哪一個工作階段」，不必再請使用者附上刷新令牌。
    sid: Optional[str] = None

def get_password_hash(password: str) -> str:
    """生成密碼的哈希值"""
    salted_password = f"{password}{HASH_SALT}"
    return pwd_context.hash(salted_password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """驗證密碼"""
    salted_password = f"{plain_password}{HASH_SALT}"
    return pwd_context.verify(salted_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None,
                        sid: Optional[str] = None):
    """創建JWT訪問令牌，添加標準聲明 (含 type=access 與工作階段參照 sid)"""
    to_encode = data.copy()

    issued_at = datetime.utcnow()
    expire = issued_at + (expires_delta or timedelta(minutes=ACCESS_TOKEN_MINUTES))

    # 添加標準聲明
    to_encode.update({
        "iat": issued_at,    # 簽發時間
        "exp": expire,       # 過期時間
        "iss": ISSUER,       # 簽發者
        "jti": str(uuid.uuid4()),  # JWT 唯一 ID
        "type": TOKEN_TYPE_ACCESS,  # 少了它，刷新令牌就能冒充訪問令牌
    })
    if sid:
        to_encode["sid"] = sid

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict, jti: Optional[str] = None,
                         expires_delta: Optional[timedelta] = None):
    """創建刷新令牌。

    jti 可由呼叫端指定，好讓 auth_sessions 那一列與令牌用同一個識別碼
    (輪替與撤銷都以 jti 為鍵)。
    """
    to_encode = data.copy()

    issued_at = datetime.utcnow()
    expire = issued_at + (expires_delta or timedelta(days=REFRESH_TOKEN_DAYS))

    to_encode.update({
        "iat": issued_at,
        "exp": expire,
        "iss": ISSUER,
        "jti": jti or str(uuid.uuid4()),
        "type": TOKEN_TYPE_REFRESH,  # 標記為刷新令牌
    })

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def _decode(token: str, expected_type: str) -> Optional[dict]:
    """驗簽 + 驗期 + 驗 iss + 驗 type，全過才回 payload，否則 None。

    日誌只記錄失敗原因與令牌類型，**絕不記錄令牌本身或其片段** ——
    日誌檔的權限比資料庫寬鬆，任何令牌內容都不該落在那裡。
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer=ISSUER)
    except jwt.ExpiredSignatureError:
        log_error("JWT令牌已過期", {"expected_type": expected_type})
        return None
    except JWTError as e:
        log_error("JWT解碼錯誤", {"error": str(e), "expected_type": expected_type})
        return None

    if payload.get("type") != expected_type:
        # 例如拿 30 天有效期的刷新令牌去存取受保護端點
        log_error("JWT令牌類型不符", {
            "expected_type": expected_type,
            "actual_type": payload.get("type"),
        })
        return None

    return payload

def decode_token(token: str) -> Optional[TokenData]:
    """解碼並驗證**訪問**令牌 (type 必須是 access)"""
    payload = _decode(token, TOKEN_TYPE_ACCESS)
    if payload is None:
        return None

    username = payload.get("sub")
    user_id = payload.get("id")

    if username is None or user_id is None:
        log_error("JWT令牌格式無效", {"missing": "sub/id"})
        return None

    return TokenData(username=username, user_id=user_id, sid=payload.get("sid"))

def decode_refresh_token(token: str) -> Optional[dict]:
    """解碼並驗證**刷新**令牌，回傳 payload (需要 jti，故不轉成 TokenData)。

    刻意不提供 verify_exp=False 的旁路：過期的令牌就是過期了，「過期後
    還能換新的」等於把有效期變成無限滑動視窗。
    """
    payload = _decode(token, TOKEN_TYPE_REFRESH)
    if payload is None:
        return None

    if payload.get("sub") is None or payload.get("id") is None or payload.get("jti") is None:
        log_error("JWT令牌格式無效", {"missing": "sub/id/jti"})
        return None

    return payload
