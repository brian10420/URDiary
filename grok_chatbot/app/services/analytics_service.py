# 在 services 目錄下創建 analytics_service.py

from grok_client import client
from database import SessionLocal, crud
from typing import Dict, List, Any
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
import io
import base64
import os

# 獲取提示詞目錄路徑
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_DIR = os.path.join(BASE_DIR, "services", "prompts")

def read_prompt_file(filename):
    """安全讀取提示詞文件"""
    try:
        prompt_path = os.path.join(PROMPTS_DIR, filename)
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"讀取提示詞文件 {filename} 時發生錯誤: {str(e)}")
        # 返回一個簡單的備用提示詞
        return "請根據提供的內容進行分析。"

def analyze_emotion_trends(user_id: int, time_range: str = "month") -> Dict[str, Any]:
    """
    分析用戶情緒隨時間的變化趨勢
    
    Args:
        user_id: 用戶ID
        time_range: 時間範圍，可選 'week', 'month', 'year'
        
    Returns:
        Dict 包含分析結果和圖表
    """
    db = SessionLocal()
    try:
        # 獲取用戶的日記列表
        diaries = crud.get_user_diaries(db, user_id, limit=100)
        
        if not diaries:
            return {"message": "沒有足夠的數據進行分析"}
            
        # 準備數據
        data = []
        for diary in diaries:
            data.append({
                "date": diary.diary_date,
                "valence": diary.valence,
                "arousal": diary.arousal,
                "content": diary.content
            })
            
        df = pd.DataFrame(data)
        df = df.sort_values("date")
        
        # 情緒趨勢分析
        valence_trend = df["valence"].rolling(window=3).mean()
        arousal_trend = df["arousal"].rolling(window=3).mean()
        
        # 使用 Grok 分析情緒主題
        recent_contents = "\n\n".join([d["content"] for d in data[-5:]])
        
        # 讀取情緒分析提示詞
        prompt_template = read_prompt_file("emotion_analysis_prompt.txt")
        prompt = prompt_template.format(recent_contents=recent_contents)
        
        completion = client.chat.completions.create(
            model="grok-3-latest",
            messages=[
                {"role": "system", "content": "你是一位情緒分析專家。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        # 提取主題分析
        import json
        try:
            theme_analysis = json.loads(completion.choices[0].message.content)
        except:
            theme_analysis = {
                "主要情緒主題": ["無法解析"],
                "情緒變化模式": "無法解析",
                "積極和消極因素": "無法解析",
                "建議的關注點": "無法解析"
            }
        
        # 創建圖表 (假設我們有一個生成圖表的函數)
        chart_base64 = "圖表數據將在這裡" # 實際項目中會生成真實圖表
        
        # 增加時間範圍過濾
        if time_range == "week":
            start_date = datetime.now() - timedelta(days=7)
        elif time_range == "month":
            start_date = datetime.now() - timedelta(days=30)
        elif time_range == "year":
            start_date = datetime.now() - timedelta(days=365)
        else:
            start_date = datetime.now() - timedelta(days=30)  # 默認一個月
            
        # 按時間範圍過濾
        df = df[df['date'] >= start_date]
        
        # 情緒變化速率分析
        if len(df) > 1:
            df['valence_diff'] = df['valence'].diff()
            df['arousal_diff'] = df['arousal'].diff()
            valence_volatility = df['valence_diff'].abs().mean()
            arousal_volatility = df['arousal_diff'].abs().mean()
        else:
            valence_volatility = 0
            arousal_volatility = 0        
        return {
            "valence_trend": valence_trend.tolist(),
            "arousal_trend": arousal_trend.tolist(),
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "theme_analysis": theme_analysis,
            "chart": chart_base64,
            "valence_volatility": valence_volatility,
            "arousal_volatility": arousal_volatility,
            "most_positive_day": df.loc[df['valence'].idxmax()]['date'].strftime("%Y-%m-%d") if not df.empty else None,
            "most_negative_day": df.loc[df['valence'].idxmin()]['date'].strftime("%Y-%m-%d") if not df.empty else None,
        }
    finally:
        db.close()
        
def generate_emotion_chart(df, filename="emotion_chart.png"):
    """生成情緒圖表並返回Base64編碼"""
    plt.figure(figsize=(10, 6))
    plt.plot(df['date'], df['valence'], 'b-', label='愉悅度')
    plt.plot(df['date'], df['arousal'], 'r-', label='激動度')
    plt.xlabel('日期')
    plt.ylabel('情緒指數')
    plt.title('情緒變化趨勢')
    plt.legend()
    plt.grid(True)
    
    # 保存到內存而不是文件
    buf = io.BytesIO()
    plt.savefig(buf, format='png')
    buf.seek(0)
    
    # 轉為base64以便前端顯示
    chart_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close()
    
    return chart_base64

def extract_key_themes(user_id: int) -> List[str]:
    """
    從用戶的互動筆記中提取關鍵主題
    """
    db = SessionLocal()
    try:
        # 獲取最新的互動筆記
        latest_note = crud.get_latest_interaction_note(db, user_id)
        if not latest_note:
            return []
            
        # 讀取主題提取提示詞
        prompt_template = read_prompt_file("theme_extraction_prompt.txt")
        prompt = prompt_template.format(interaction_note_content=latest_note.content)
        
        completion = client.chat.completions.create(
            model="grok-3-latest",
            messages=[
                {"role": "system", "content": "你是一位心靈事件主題分析專家。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        # 提取主題列表
        themes_text = completion.choices[0].message.content
        themes = [t.strip() for t in themes_text.split("\n") if t.strip()]
        
        return themes
    finally:
        db.close()