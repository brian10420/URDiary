from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from pydantic import BaseModel

from api.deps import get_db
from utils.api_exceptions import BadRequestError, NotFoundError
from utils.error_codes import ErrorCode
from database import crud

router = APIRouter()

class UserCreate(BaseModel):
    username: str

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