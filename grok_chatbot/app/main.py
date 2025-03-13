from fastapi import FastAPI, HTTPException, Depends, Body
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from grok_client import send_to_grok
from memory_manager import clear_chat_history
from database import engine, SessionLocal
from database.models import Base
from database import crud
from services.diary_service import check_sensitive_content, get_support_message, save_diary_for_user
from sqlalchemy.orm import Session

from services.interaction_service import (
    get_latest_interaction_note, 
    process_interaction_note_update,
    enhanced_chat_with_context,
    generate_enhanced_diary
)

from fastapi.middleware.cors import CORSMiddleware # fromend

# -----------------------
# 初始化 FastAPI
# -----------------------
app = FastAPI(title="AI Diary API")

# 添加 CORS 中間件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生產環境中，您應該指定具體的源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------
# 自動建表 (MVP 階段)
# -----------------------
# 當容器啟動時，若表尚未建立，就在 PostgreSQL 內建立
Base.metadata.create_all(bind=engine)

# 創建依賴項，用於獲取數據庫會話
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -----------------------
# 資料模型
# -----------------------
class UserCreate(BaseModel):
    username: str

class ChatInput(BaseModel):
    user_id: str
    message: str

class UserDiaryCreate(BaseModel):
    user_id: str
    numeric_user_id: int

class DiaryUpdate(BaseModel):
    content: Optional[str] = None
    valence: Optional[float] = None
    arousal: Optional[float] = None

# -----------------------
# 既有對話 API
# -----------------------
@app.post("/chat/", response_model=Dict[str, str])
def chat_with_ai(user_input: ChatInput):
    """
    對話 API，調用 Grok AI 進行回應
    """
    user_id = user_input.user_id
    message = user_input.message

    # 檢查敏感內容
    if check_sensitive_content(message):
        support_message = get_support_message()
        # 依然發送給 AI，但會附上關懷訊息
        ai_response = send_to_grok(user_id, message)
        return {"response": f"{ai_response}\n\n{support_message}"}
    
    # 正常對話
    response = send_to_grok(user_id, message)
    return {"response": response}

@app.delete("/chat/clear/")
def clear_chat(user_id: str):
    """
    清除使用者對話記錄
    """
    clear_chat_history(user_id)
    return {"message": f"已清除 {user_id} 的對話記錄"}

# -----------------------
# 用戶相關 API
# -----------------------
@app.post("/users/create", response_model=Dict[str, Any])
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """
    新增用戶到 users 表
    """
    existing_user = crud.get_user_by_username(db, user.username)
    if existing_user:
        raise HTTPException(status_code=400, detail="該用戶名稱已存在")

    new_user = crud.create_user(db, user.username)
    return {"message": "User created", "user_id": new_user.id, "username": new_user.username}

@app.get("/users/{user_id}", response_model=Dict[str, Any])
def get_user(user_id: int, db: Session = Depends(get_db)):
    """
    獲取用戶資訊
    """
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用戶不存在")
    return {
        "user_id": user.id,
        "username": user.username,
        "created_at": user.created_at.isoformat()
    }

@app.get("/users/", response_model=List[Dict[str, Any]])
def get_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    獲取用戶列表
    """
    users = crud.get_users(db, skip, limit)
    return [{"user_id": u.id, "username": u.username, "created_at": u.created_at.isoformat()} for u in users]

# -----------------------
# 日記相關 API
# -----------------------
@app.post("/diary/generate", response_model=Dict[str, Any])
def generate_diary(user_input: UserDiaryCreate):
    """
    根據用戶的對話歷史自動生成日記
    """
    try:
        diary = save_diary_for_user(user_input.user_id, user_input.numeric_user_id)
        return {
            "message": "日記生成成功",
            "diary": diary
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"日記生成失敗: {str(e)}")

@app.get("/diaries/{user_id}", response_model=Dict[str, Any])
def get_user_diaries(user_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    查詢某個 user 的日記列表
    """
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用戶不存在")
        
    diaries = crud.get_user_diaries(db, user_id, skip, limit)
    
    results = []
    for d in diaries:
        results.append({
            "diary_id": d.id,
            "content": d.content,
            "valence": d.valence,
            "arousal": d.arousal,
            "diary_date": d.diary_date.isoformat(),
            "created_at": d.created_at.isoformat()
        })
    return {"user_id": user_id, "diaries": results}

@app.get("/diary/{diary_id}", response_model=Dict[str, Any])
def get_diary(diary_id: int, db: Session = Depends(get_db)):
    """
    獲取特定日記內容
    """
    diary = crud.get_diary(db, diary_id)
    if not diary:
        raise HTTPException(status_code=404, detail="日記不存在")
        
    return {
        "diary_id": diary.id,
        "user_id": diary.user_id,
        "content": diary.content,
        "valence": diary.valence,
        "arousal": diary.arousal,
        "diary_date": diary.diary_date.isoformat(),
        "created_at": diary.created_at.isoformat()
    }


@app.post("/chat/end/", response_model=Dict[str, Any])
def end_chat_session(user_input: UserDiaryCreate):
    """
    結束當前對話，生成日記並更新互動筆記
    """
    try:
        # 1. 生成今日對話筆記
        diary_content, emotion_scores = generate_enhanced_diary(
            user_input.user_id, 
            user_input.numeric_user_id
        )
        
        # 2. 保存日記到數據庫
        db = SessionLocal()
        try:
            diary = crud.create_diary(
                db=db,
                user_id=user_input.numeric_user_id,
                content=diary_content,
                valence=emotion_scores.get("valence"),
                arousal=emotion_scores.get("arousal")
            )
            
            # 3. 更新互動筆記
            note_result = process_interaction_note_update(
                user_input.user_id, 
                user_input.numeric_user_id,
                diary_content
            )
            
            # 4. 清除 Redis 中的當前對話歷史
            from memory_manager import clear_chat_history
            clear_chat_history(user_input.user_id)
            
            return {
                "message": "對話已結束並生成摘要",
                "diary": {
                    "diary_id": diary.id,
                    "content": diary.content,
                    "valence": diary.valence,
                    "arousal": diary.arousal,
                    "created_at": diary.created_at.isoformat()
                },
                "interaction_note": note_result
            }
        finally:
            db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"結束對話失敗: {str(e)}")
    
@app.put("/diary/{diary_id}", response_model=Dict[str, Any])
def update_diary(diary_id: int, diary_update: DiaryUpdate, db: Session = Depends(get_db)):
    """
    更新日記內容
    """
    update_data = {k: v for k, v in diary_update.dict().items() if v is not None}
    diary = crud.update_diary(db, diary_id, **update_data)
    
    if not diary:
        raise HTTPException(status_code=404, detail="日記不存在")
        
    return {
        "message": "日記更新成功",
        "diary": {
            "diary_id": diary.id,
            "content": diary.content,
            "valence": diary.valence,
            "arousal": diary.arousal,
            "updated_at": diary.created_at.isoformat()
        }
    }

@app.delete("/diary/{diary_id}", response_model=Dict[str, str])
def delete_diary(diary_id: int, db: Session = Depends(get_db)):
    """
    删除日記
    """
    success = crud.delete_diary(db, diary_id)
    if not success:
        raise HTTPException(status_code=404, detail="日記不存在")
        
    return {"message": "日記刪除成功"}

# -----------------------
# 互動筆記相關 API
# -----------------------

@app.get("/interaction-notes/{user_id}", response_model=Dict[str, Any])
def get_interaction_note(user_id: int, db: Session = Depends(get_db)):
    """
    獲取最新的互動筆記
    """
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用戶不存在")
        
    note = get_latest_interaction_note(db, user_id)
    if not note:
        raise HTTPException(status_code=404, detail="尚未有互動筆記")
        
    return {
        "note_id": note.id,
        "user_id": note.user_id,
        "content": note.content,
        "version": note.version,
        "updated_at": note.updated_at.isoformat(),
        "created_at": note.created_at.isoformat()
    }

@app.post("/interaction-notes/update", response_model=Dict[str, Any])
def update_interaction_notes(user_input: UserDiaryCreate):
    """
    根據今日日記更新互動筆記
    """
    try:
        # 先生成今日日記
        diary_result = save_diary_for_user(user_input.user_id, user_input.numeric_user_id)
        
        # 基於今日日記更新互動筆記
        note_result = process_interaction_note_update(
            user_input.user_id, 
            user_input.numeric_user_id,
            diary_result["content"]
        )
        
        return {
            "message": "互動筆記更新成功",
            "diary": diary_result,
            "interaction_note": note_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"互動筆記更新失敗: {str(e)}")

# -----------------------
# 增強版對話 API
# -----------------------
class EnhancedChatInput(BaseModel):
    user_id: str  # Redis用的字符串ID
    numeric_user_id: int  # 數據庫用的數字ID
    message: str

@app.post("/chat/enhanced/", response_model=Dict[str, str])
def enhanced_chat_with_ai(user_input: EnhancedChatInput):
    """
    使用互動筆記增強的對話API
    """
    user_id = user_input.user_id
    numeric_user_id = user_input.numeric_user_id
    message = user_input.message

    # 檢查敏感內容
    if check_sensitive_content(message):
        support_message = get_support_message()
        # 使用增強對話但附上關懷訊息
        ai_response = enhanced_chat_with_context(user_id, numeric_user_id, message)
        return {"response": f"{ai_response}\n\n{support_message}"}
    
    # 增強對話
    response = enhanced_chat_with_context(user_id, numeric_user_id, message)
    return {"response": response}

# -----------------------
# 增強版日記生成 API
# -----------------------
@app.post("/diary/enhanced-generate", response_model=Dict[str, Any])
def generate_enhanced_diary_api(user_input: UserDiaryCreate):
    """
    使用互動筆記增強的日記生成
    """
    try:
        # 使用增強版日記生成
        diary_content, emotion_scores = generate_enhanced_diary(
            user_input.user_id, 
            user_input.numeric_user_id
        )
        
        # 保存到數據庫
        db = SessionLocal()
        try:
            diary = crud.create_diary(
                db=db,
                user_id=user_input.numeric_user_id,
                content=diary_content,
                valence=emotion_scores.get("valence"),
                arousal=emotion_scores.get("arousal")
            )
            
            # 更新互動筆記
            note_result = process_interaction_note_update(
                user_input.user_id, 
                user_input.numeric_user_id,
                diary_content
            )
            
            return {
                "message": "增強版日記生成成功",
                "diary": {
                    "diary_id": diary.id,
                    "content": diary.content,
                    "valence": diary.valence,
                    "arousal": diary.arousal,
                    "created_at": diary.created_at.isoformat()
                },
                "interaction_note": note_result
            }
        finally:
            db.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"增強版日記生成失敗: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)