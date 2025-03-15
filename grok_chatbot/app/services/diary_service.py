from grok_client import client
from memory_manager import get_chat_history
from database import crud
from database import SessionLocal
import re
from typing import List, Dict, Any, Tuple

# Sensitive words detection
SENSITIVE_WORDS = [
    "自殺", "suicide", "自杀", "想死", "不想活", 
    "自殘", "自残", "自傷", "自伤", "割腕", 
    "他殺", "他杀", "殺人", "杀人", "傷害", "伤害",
    "藥物過量", "药物过量", "overdose"
]

SUPPORT_MESSAGE = """
我注意到你提到了一些令人擔憂的內容。如果你正在經歷痛苦或有自我傷害的想法，
請記住這些感受通常是暫時的，而且有專業人士可以提供幫助。

以下是一些可能有幫助的資源：
- 生命線協談專線：1995 (24小時)
- 張老師專線：1980 (24小時)
- 安心專線：1925 (24小時)
- 或撥打119尋求緊急救援

請記住，尋求幫助是勇氣和力量的表現，而不是軟弱。
"""

def check_sensitive_content(message: str) -> bool:
    """Check if message contains sensitive words related to self-harm or harm to others"""
    lower_message = message.lower()
    for word in SENSITIVE_WORDS:
        if word.lower() in lower_message:
            return True
    return False

def get_support_message() -> str:
    """Return support message for users mentioning sensitive topics"""
    return SUPPORT_MESSAGE

def generate_diary_from_chat(user_id: str) -> Tuple[str, Dict[str, float]]:
    """
    Generate a diary entry based on chat history
    Returns the diary content and emotional scores
    """
    # Get chat history from Redis
    chat_history = get_chat_history(user_id)
    
    # If no chat history, return empty diary
    if not chat_history:
        return "今天似乎沒有對話記錄。", {"valence": 0.5, "arousal": 0.5}
    
    # Format chat history for the Grok API
    formatted_history = []
    for msg in chat_history:
        if msg["role"] in ["user", "assistant"]:
            formatted_history.append(f"{msg['role'].upper()}: {msg['content']}")
    
    chat_content = "\n".join(formatted_history)
    
    # Prompt for diary generation
    diary_prompt = f"""
    請根據以下對話歷史，以第一人稱（我）為使用者寫一篇今日日記。
    日記應該總結使用者今天分享的重要事件、想法和感受。
    日記風格應該溫暖、有同理心，但不要過於情緒化。
    長度應在300-500字之間。
    請不要直接引用對話內容，而是根據對話概括使用者的一天。
    請不要提及這是AI生成的內容。

    對話歷史：
    {chat_content}

    在日記後，請另外用JSON格式提供情緒評分：
    {{
        "valence": 0-1之間的數值（愉悅程度，0為非常負面，1為非常正面）,
        "arousal": 0-1之間的數值（情緒激動程度，0為非常平靜，1為非常激動）
    }}
    
    只返回日記內容和JSON格式的情緒評分，不要有多餘的說明。
    """
    
    try:
        # Call Grok API to generate diary
        completion = client.chat.completions.create(
            model="grok-2-latest",
            messages=[
                {"role": "system", "content": "You are a helpful, supportive diary writer."},
                {"role": "user", "content": diary_prompt}
            ]
        )
        
        diary_text = completion.choices[0].message.content
        
        # Try to extract the emotional scores
        emotion_scores = {"valence": 0.5, "arousal": 0.5}  # Default values
        json_pattern = r'\{[\s\S]*"valence"[\s\S]*"arousal"[\s\S]*\}'
        json_match = re.search(json_pattern, diary_text)
        
        if json_match:
            # Extract just the diary content (everything before the JSON)
            diary_content = diary_text[:json_match.start()].strip()
            
            # Try to parse the emotion scores
            import json
            try:
                json_str = json_match.group(0)
                emotion_data = json.loads(json_str)
                emotion_scores["valence"] = float(emotion_data.get("valence", 0.5))
                emotion_scores["arousal"] = float(emotion_data.get("arousal", 0.5))
            except (json.JSONDecodeError, ValueError):
                # If parsing fails, use default values
                pass
        else:
            diary_content = diary_text
        
        return diary_content, emotion_scores
        
    except Exception as e:
        print(f"Error generating diary: {str(e)}")
        return f"今天的日記生成遇到了一些技術問題。", {"valence": 0.5, "arousal": 0.5}

def save_diary_for_user(user_id: str, numeric_user_id: int) -> Dict[str, Any]:
    """
    Generate a diary for a user and save it to the database
    Returns diary details as a dict
    """
    diary_content, emotion_scores = generate_diary_from_chat(user_id)
    
    # Save to database
    db = SessionLocal()
    try:
        diary = crud.create_diary(
            db=db,
            user_id=numeric_user_id,
            content=diary_content,
            valence=emotion_scores.get("valence"),
            arousal=emotion_scores.get("arousal")
        )
        
        return {
            "diary_id": diary.id,
            "content": diary.content,
            "valence": diary.valence,
            "arousal": diary.arousal,
            "created_at": diary.created_at.isoformat()
        }
    finally:
        db.close()