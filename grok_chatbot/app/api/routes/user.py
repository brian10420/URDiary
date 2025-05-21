from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta

from api.deps import get_db
from utils.api_exceptions import BadRequestError, NotFoundError, UnauthorizedError
from utils.error_codes import ErrorCode
from database import crud
from utils.security import (
    create_access_token, 
    create_refresh_token,
    decode_token, 
    verify_password,
    get_password_hash,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_long_lived_token,
    ALGORITHM
)
from jose import JWTError, jwt
from config import SECRET_KEY

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class UserCreate(BaseModel):
    username: str

class Token(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user_id: int
    username: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int

@router.post("/create", response_model=Dict[str, Any], 
            summary="創建新用戶",
            description="創建新用戶並返回用戶ID和用戶名")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """創建新用戶"""
    existing_user = crud.get_user_by_username(db, user.username)
    if existing_user:
        raise BadRequestError(
            error_code=ErrorCode.USER_ALREADY_EXISTS,
            detail="該用戶名稱已存在"
        )

    new_user = crud.create_user(db, user.username)
    return {"message": "User created", "user_id": new_user.id, "username": new_user.username}

@router.get("/{user_id}", response_model=Dict[str, Any],
           summary="獲取用戶資訊",
           description="根據用戶ID獲取用戶詳細資訊")
def get_user(user_id: int, db: Session = Depends(get_db)):
    """獲取用戶資訊"""
    user = crud.get_user(db, user_id)
    if not user:
        raise NotFoundError(
            error_code=ErrorCode.USER_NOT_FOUND,
            detail="用戶不存在"
        )
    return {
        "user_id": user.id,
        "username": user.username,
        "created_at": user.created_at.isoformat()
    }

@router.get("/", response_model=List[Dict[str, Any]],
          summary="獲取用戶列表",
          description="獲取用戶列表，支持分頁")
def get_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """獲取用戶列表"""
    users = crud.get_users(db, skip, limit)
    return [{"user_id": u.id, "username": u.username, "created_at": u.created_at.isoformat()} for u in users]

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
           description="使用現有的有效令牌獲取新的訪問令牌")
async def refresh_token(current_token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """刷新JWT令牌有效期，適用於長時間使用的日記應用"""
    try:
        # 解碼當前令牌
        payload = jwt.decode(current_token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        user_id = payload.get("id")
        
        if username is None or user_id is None:
            raise UnauthorizedError(
                error_code=ErrorCode.UNAUTHORIZED,
                detail="無效的令牌"
            )
            
        # 檢查用戶是否存在
        user = crud.get_user(db, user_id=user_id)
        if user is None:
            raise NotFoundError(
                error_code=ErrorCode.USER_NOT_FOUND,
                detail="用戶不存在"
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
        
    except JWTError:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail="無法刷新令牌"
        )

# 简单令牌获取端点，用于 OAuth2PasswordBearer
@router.post("/token", response_model=Token)
async def get_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """获取访问令牌 - 与login端点功能相同，但符合OAuth2标准"""
    return await login(form_data, db)