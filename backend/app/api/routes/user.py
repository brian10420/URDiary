from fastapi import APIRouter, Depends, Header
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta

from api.deps import get_db, get_current_user
from utils.api_exceptions import BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError
from utils.error_codes import ErrorCode
from utils.password_validator import validate_password_and_get_errors
from database import crud
from database.models import User
from utils.security import (
    create_access_token,
    create_refresh_token,
    verify_password,
    get_password_hash,
    ALGORITHM
)
from jose import JWTError, jwt
from config import SECRET_KEY

router = APIRouter()

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    expires_in: int
    user_id: int
    username: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int

class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = None

@router.post("/create", response_model=Dict[str, Any],
            summary="創建新用戶",
            description="創建新用戶（密碼經強度檢查與 bcrypt 雜湊後儲存）並返回用戶ID和用戶名")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """創建新用戶"""
    existing_user = crud.get_user_by_username(db, user.username)
    if existing_user:
        raise BadRequestError(
            error_code=ErrorCode.USER_ALREADY_EXISTS,
            detail="該用戶名稱已存在"
        )

    password_errors = validate_password_and_get_errors(user.password)
    if password_errors:
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail="密碼強度不足：" + "；".join(password_errors)
        )

    new_user = crud.create_user(db, user.username, get_password_hash(user.password))
    return {"message": "User created", "user_id": new_user.id, "username": new_user.username}

@router.get("/{user_id}", response_model=Dict[str, Any],
           summary="獲取用戶資訊",
           description="獲取自己的用戶詳細資訊（需認證，僅能查詢自己）")
def get_user(user_id: int, current_user: User = Depends(get_current_user)):
    """獲取用戶資訊（僅限本人）"""
    if user_id != current_user.id:
        raise ForbiddenError(
            error_code=ErrorCode.FORBIDDEN,
            detail="無權存取其他使用者的資料"
        )
    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "created_at": current_user.created_at.isoformat()
    }

@router.get("/", response_model=List[Dict[str, Any]],
          summary="獲取目前登入的用戶",
          description="不再無認證列出全部使用者；僅回傳目前登入者（本機 profile 清單由前端維護）")
def get_users(current_user: User = Depends(get_current_user)):
    """獲取用戶列表（僅回傳目前登入者，避免洩漏其他帳號）"""
    return [{
        "user_id": current_user.id,
        "username": current_user.username,
        "created_at": current_user.created_at.isoformat()
    }]

@router.post("/login", response_model=Token,
            summary="用戶登入",
            description="驗證用戶憑證並返回訪問令牌和刷新令牌")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """用戶登入並獲取訪問令牌"""
    # 查詢用戶
    user = crud.get_user_by_username(db, form_data.username)
    if not user:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail="用戶名或密碼不正確"
        )

    # 驗證密碼（bcrypt + pepper，見 utils/security）
    if not user.password_hash:
        # 加密碼欄位之前建立的舊帳號 —— 不能無條件放行
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail="此帳號尚未設定密碼，請重新建立帳號"
        )
    if not verify_password(form_data.password, user.password_hash):
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail="用戶名或密碼不正確"
        )

    # 創建訪問令牌
    access_token_expires = timedelta(hours=24)  # 24小時過期
    access_token = create_access_token(
        data={"sub": user.username, "id": user.id},
        expires_delta=access_token_expires
    )
    
    # 創建刷新令牌
    refresh_token = create_refresh_token(
        data={"sub": user.username, "id": user.id}
    )
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,  # 新增刷新令牌
        "token_type": "bearer",
        "expires_in": 24 * 60 * 60,  # 24小時的秒數
        "user_id": user.id,
        "username": user.username
    }

@router.post("/token/refresh", response_model=TokenResponse,
           summary="刷新訪問令牌",
           description="使用刷新令牌或過期的訪問令牌獲取新的訪問令牌")
async def refresh_token(
    authorization: Optional[str] = Header(None),
    refresh_request: Optional[RefreshTokenRequest] = None,
    db: Session = Depends(get_db)
):
    """刷新JWT令牌有效期，適用於長時間使用的日記應用"""
    
    current_token = None
    
    # 從 Authorization header 中提取令牌
    if authorization and authorization.startswith("Bearer "):
        current_token = authorization[7:]  # 移除 "Bearer " 前綴
    elif refresh_request and refresh_request.refresh_token:
        current_token = refresh_request.refresh_token
    
    if not current_token:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail="未提供令牌"
        )
    
    try:
        # 解碼令牌，即使過期也要能解碼（用於獲取用戶信息）
        payload = jwt.decode(
            current_token, 
            SECRET_KEY, 
            algorithms=[ALGORITHM],
            # 允許解碼過期的令牌
            options={"verify_exp": False}
        )
        
        username = payload.get("sub")
        user_id = payload.get("id")
        
        if username is None or user_id is None:
            raise UnauthorizedError(
                error_code=ErrorCode.UNAUTHORIZED,
                detail="無效的令牌格式"
            )
            
        # 檢查用戶是否存在
        user = crud.get_user(db, user_id=user_id)
        if user is None:
            raise NotFoundError(
                error_code=ErrorCode.USER_NOT_FOUND,
                detail="用戶不存在"
            )
            
        # 檢查令牌是否過期太久（超過7天不允許刷新）
        token_exp = payload.get("exp")
        if token_exp:
            # exp 為 UTC 時間戳，必須用 UTC 解析，否則非 UTC 時區的主機會判斷錯誤
            exp_time = datetime.utcfromtimestamp(token_exp)
            now = datetime.utcnow()
            if (now - exp_time).days > 7:
                raise UnauthorizedError(
                    error_code=ErrorCode.UNAUTHORIZED,
                    detail="令牌過期時間過長，請重新登入"
                )
        
        # 創建新令牌，有效期更長
        # 日記應用使用更長的過期時間
        access_token_expires = timedelta(days=7)  # 7天過期時間
        access_token = create_access_token(
            data={"sub": user.username, "id": user.id},
            expires_delta=access_token_expires
        )
        
        return {
            "access_token": access_token, 
            "token_type": "bearer",
            "expires_in": 7 * 24 * 60 * 60  # 7天的秒數
        }
        
    except JWTError as e:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=f"無法刷新令牌: {str(e)}"
        )
    except Exception as e:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=f"刷新令牌時發生錯誤: {str(e)}"
        )

# 简单令牌获取端点，用于 OAuth2PasswordBearer
@router.post("/token", response_model=Token)
async def get_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """获取访问令牌 - 与login端点功能相同，但符合OAuth2标准"""
    return await login(form_data, db)