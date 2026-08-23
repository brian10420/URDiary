from fastapi import APIRouter

api_router = APIRouter()

# Import routers
from api.routes import user, chat, diary, calendar, voice, memory

# Include routers
api_router.include_router(user.router, prefix="/users", tags=["users"])
api_router.include_router(memory.router, prefix="/users/me/memory", tags=["memory"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(diary.router, tags=["diary"])
api_router.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
api_router.include_router(voice.router)