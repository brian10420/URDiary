from fastapi import APIRouter

api_router = APIRouter()

# Import routers
from api.routes import user, chat, diary

# Include routers
api_router.include_router(user.router, prefix="/users", tags=["users"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(diary.router, tags=["diary"]) 