from grok_client import client
from memory_manager import get_chat_history
from database import crud
from database import SessionLocal
import re
import os
from typing import List, Dict, Any, Tuple

# 獲取提示詞目錄路徑
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_DIR = os.path.join(BASE_DIR, "services", "prompts")

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

def read_prompt_file(filename):
    """安全讀取提示詞文件"""
    try:
        prompt_path = os.path.join(PROMPTS_DIR, filename)
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"讀取提示詞文件 {filename} 時發生錯誤: {str(e)}")
        # 返回一個簡單的備用提示詞
        return "請根據對話歷史生成相應內容。"

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
    
    # 讀取日記生成提示詞
    prompt_template = read_prompt_file("daily_note_prompt.txt")
    
    # 準備提示詞
    diary_prompt = prompt_template.format(
        chat_history=chat_content,
        interaction_note="請忽略此部分，專注於今日對話生成日記。"
    )
    
    try:
        # Call Grok API to generate diary
        completion = client.chat.completions.create(
            model="grok-3-latest",
            messages=[
                {"role": "system", "content": "你是一位溫暖且有洞察力的日記作者."},
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
    
    # 生成日记标题
    title = generate_diary_title(diary_content)
    
    # Save to database
    db = SessionLocal()
    try:
        diary = crud.create_diary(
            db=db,
            user_id=numeric_user_id,
            title=title,
            content=diary_content,
            valence=emotion_scores.get("valence"),
            arousal=emotion_scores.get("arousal")
        )
        
        return {
            "diary_id": diary.id,
            "title": diary.title,
            "content": diary.content,
            "valence": diary.valence,
            "arousal": diary.arousal,
            "created_at": diary.created_at.isoformat()
        }
    finally:
        db.close()

def generate_diary_title(content: str) -> str:
    """
    Generate a title for the diary based on its content
    """
    if not content:
        return "今日日記"
    
    # 简单的标题生成逻辑
    lines = content.split('\n')
    first_meaningful_line = ""
    
    for line in lines:
        clean_line = line.strip()
        if clean_line and len(clean_line) > 5:
            first_meaningful_line = clean_line
            break
    
    if not first_meaningful_line:
        return "今日日記"
    
    # 取前20个字符作为标题
    title = first_meaningful_line[:20]
    if len(first_meaningful_line) > 20:
        title += "..."
    
    return title