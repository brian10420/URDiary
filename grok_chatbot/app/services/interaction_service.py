from grok_client import client
from memory_manager import get_chat_history
from database import crud, SessionLocal
from database.models import InteractionNote
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional, Tuple
import re
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_DIR = os.path.join(BASE_DIR, "services", "prompts")

def get_latest_interaction_note(db: Session, user_id: int) -> Optional[InteractionNote]:
    """
    獲取用戶最新的互動筆記
    """
    return db.query(InteractionNote).filter(
        InteractionNote.user_id == user_id
    ).order_by(InteractionNote.version.desc()).first()

def create_interaction_note(db: Session, user_id: int, content: str) -> InteractionNote:
    """
    創建新的互動筆記
    """
    # 獲取當前最新版本
    latest_note = get_latest_interaction_note(db, user_id)
    version = 1 if not latest_note else latest_note.version + 1
    
    interaction_note = InteractionNote(
        user_id=user_id,
        content=content,
        version=version
    )
    db.add(interaction_note)
    db.commit()
    db.refresh(interaction_note)
    return interaction_note

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
    
def update_interaction_note(
    chat_history: list, 
    previous_note_content: Optional[str], 
    today_diary: str
) -> str:
    """
    生成更新的互動筆記內容
    """
    # 讀取互動筆記提示詞
    prompt_template = read_prompt_file("interaction_note_prompt.txt")
    
    # 格式化對話歷史
    formatted_history = []
    for msg in chat_history:
        if msg["role"] in ["user", "assistant"]:
            formatted_history.append(f"{msg['role'].upper()}: {msg['content']}")
    
    chat_content = "\n".join(formatted_history)
    
    # 準備提示詞
    prompt = prompt_template.format(
        previous_interaction_note=previous_note_content or "尚無互動筆記",
        chat_history=chat_content,
        todays_diary=today_diary
    )
    
    # 調用 Grok API
    try:
        completion = client.chat.completions.create(
            model="grok-2-latest",
            messages=[
                {"role": "system", "content": "你是一位專業的心理陪伴記錄員，負責整理客戶互動筆記。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        return completion.choices[0].message.content
        
    except Exception as e:
        print(f"更新互動筆記時發生錯誤: {str(e)}")
        return "無法生成互動筆記，請稍後再試。"

def process_interaction_note_update(chat_id: str, numeric_user_id: int, today_diary: str) -> Dict[str, Any]:
    """
    處理互動筆記更新流程
    """
    db = SessionLocal()
    try:
        # 獲取聊天歷史
        chat_history = get_chat_history(chat_id)
        
        # 獲取最新的互動筆記
        latest_note = get_latest_interaction_note(db, numeric_user_id)
        previous_content = latest_note.content if latest_note else None
        
        # 生成新的互動筆記
        new_content = update_interaction_note(chat_history, previous_content, today_diary)
        
        # 保存新的互動筆記
        new_note = create_interaction_note(db, numeric_user_id, new_content)
        
        return {
            "note_id": new_note.id,
            "version": new_note.version,
            "content": new_note.content,
            "created_at": new_note.created_at.isoformat()
        }
    finally:
        db.close()

def get_conversation_context(numeric_user_id: int) -> str:
    """
    獲取對話開始時的互動筆記上下文
    """
    db = SessionLocal()
    try:
        latest_note = get_latest_interaction_note(db, numeric_user_id)
        
        if not latest_note:
            return "尚無互動筆記記錄。"
        
        return latest_note.content
    finally:
        db.close()

def enhanced_chat_with_context(chat_id: str, numeric_user_id: int, message: str) -> str:
    """
    使用互動筆記增強對話體驗
    """
    # 獲取互動筆記上下文
    interaction_context = get_conversation_context(numeric_user_id)
    
    # 讀取對話提示詞
    prompt_template = read_prompt_file("conversation_prompt.txt")
    
    # 準備系統提示詞
    system_prompt = prompt_template.format(interaction_note=interaction_context)
    
    # 獲取對話歷史
    chat_history = get_chat_history(chat_id)
    
    # 準備消息列表，用於API請求
    messages = [{"role": "system", "content": system_prompt}]
    
    # 只添加用戶和助手的消息
    for msg in chat_history:
        if msg["role"] in ["user", "assistant"]:
            messages.append(msg)
    
    # 添加用戶新消息
    messages.append({"role": "user", "content": message})
    
    # 調用 Grok API
    try:
        completion = client.chat.completions.create(
            model="grok-2-latest",
            messages=messages
        )
        
        ai_response = completion.choices[0].message.content
        
        # 關鍵修改：正確保存對話歷史
        # 新增：建立不包含系統消息的歷史記錄
        save_messages = []
        for msg in chat_history:
            if msg["role"] in ["user", "assistant"]:
                save_messages.append(msg)
        
        # 添加本次對話
        save_messages.append({"role": "user", "content": message})
        save_messages.append({"role": "assistant", "content": ai_response})
        
        # 保存到 Redis
        from memory_manager import save_chat_history
        save_chat_history(chat_id, save_messages)
        
        return ai_response
        
    except Exception as e:
        print(f"增強對話時發生錯誤: {str(e)}")
        return "抱歉，我現在無法回應。請稍後再試。"
    
def generate_enhanced_diary(chat_id: str, numeric_user_id: int) -> Tuple[str, Dict[str, float]]:
    """
    使用互動筆記增強日記生成
    """
    # 獲取聊天歷史
    chat_history = get_chat_history(chat_id)
    
    if not chat_history:
        return "今天似乎沒有對話記錄。", {"valence": 0.5, "arousal": 0.5}
    
    # 獲取互動筆記上下文
    db = SessionLocal()
    try:
        latest_note = get_latest_interaction_note(db, numeric_user_id)
        interaction_context = latest_note.content if latest_note else "尚無互動筆記記錄。"
    finally:
        db.close()
    
    # 格式化對話歷史
    formatted_history = []
    for msg in chat_history:
        if msg["role"] in ["user", "assistant"]:
            formatted_history.append(f"{msg['role'].upper()}: {msg['content']}")
    
    chat_content = "\n".join(formatted_history)
    
    # 讀取日記提示詞
    prompt_template = read_prompt_file("daily_note_prompt.txt")
    
    # 簡化JSON請求格式
    simplified_prompt = prompt_template + "\n請確保回應中包含日記內容和簡單的情緒評分格式。請使用這樣的格式：\n\n日記內容...\n\n情緒評分：\nvalence: 0.7\narousal: 0.3"
    
    # 準備提示詞
    prompt = simplified_prompt.format(
        chat_history=chat_content,
        interaction_note=interaction_context
    )
    
    try:
        # 調用 Grok API
        completion = client.chat.completions.create(
            model="grok-2-latest",
            messages=[
                {"role": "system", "content": "你是一位能夠寫出溫暖、洞察力強的日記的助手。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        diary_text = completion.choices[0].message.content
        
        # 設置默認值
        emotion_scores = {"valence": 0.5, "arousal": 0.5}
        diary_content = diary_text
        
        # 方法一：尋找標準JSON
        try:
            import re
            import json
            
            json_pattern = r'\{[\s\S]*?"valence"[\s\S]*?"arousal"[\s\S]*?\}'
            matches = re.findall(json_pattern, diary_text)
            
            if matches:
                for potential_json in matches:
                    try:
                        # 清理JSON字符串
                        cleaned_json = potential_json.strip().replace('\n', ' ').replace('    ', ' ')
                        emotion_data = json.loads(cleaned_json)
                        
                        if 'valence' in emotion_data and 'arousal' in emotion_data:
                            emotion_scores["valence"] = float(emotion_data.get("valence", 0.5))
                            emotion_scores["arousal"] = float(emotion_data.get("arousal", 0.5))
                            
                            # 獲取日記內容（JSON之前的部分）
                            json_start = diary_text.find(potential_json)
                            if json_start > 0:
                                diary_content = diary_text[:json_start].strip()
                            break
                    except Exception as parse_error:
                        print(f"嘗試解析JSON時出錯: {str(parse_error)}, JSON: {potential_json}")
                        continue
        except Exception as e:
            print(f"方法一提取情緒評分時出錯: {str(e)}")

        # 方法二：使用正則表達式直接提取數值
        if emotion_scores["valence"] == 0.5 and emotion_scores["arousal"] == 0.5:
            try:
                # 尋找 valence: X.X 或 "valence": X.X 模式
                valence_pattern = r'["\']?valence["\']?\s*[:=]\s*([0-9](\.[0-9]+)?)'
                arousal_pattern = r'["\']?arousal["\']?\s*[:=]\s*([0-9](\.[0-9]+)?)'
                
                valence_match = re.search(valence_pattern, diary_text)
                arousal_match = re.search(arousal_pattern, diary_text)
                
                if valence_match:
                    try:
                        emotion_scores["valence"] = float(valence_match.group(1))
                    except:
                        pass
                
                if arousal_match:
                    try:
                        emotion_scores["arousal"] = float(arousal_match.group(1))
                    except:
                        pass
                
                # 尋找"情緒評分："標記
                score_marker = "情緒評分："
                if score_marker in diary_text:
                    diary_content = diary_text.split(score_marker)[0].strip()
            except Exception as e:
                print(f"方法二提取情緒評分時出錯: {str(e)}")
        
        # 方法三：最保守的方法，使用整個文本但避免具有格式的輸出
        if diary_content == diary_text:
            # 確保日記內容不包含JSON格式的字符串
            if "{" in diary_content and "}" in diary_content:
                try:
                    # 嘗試去除JSON或格式化的內容
                    parts = diary_content.split("{")
                    if len(parts) > 1:
                        diary_content = parts[0].strip()
                except:
                    pass
        
        # 確保情緒評分在合理範圍內
        if "valence" in emotion_scores:
            if emotion_scores["valence"] < 0:
                emotion_scores["valence"] = 0
            elif emotion_scores["valence"] > 1:
                emotion_scores["valence"] = 1
                
        if "arousal" in emotion_scores:
            if emotion_scores["arousal"] < 0:
                emotion_scores["arousal"] = 0
            elif emotion_scores["arousal"] > 1:
                emotion_scores["arousal"] = 1
        
        return diary_content, emotion_scores
        
    except Exception as e:
        print(f"生成增強日記時發生錯誤: {str(e)}")
        return f"今天的日記生成遇到了一些技術問題。", {"valence": 0.5, "arousal": 0.5}