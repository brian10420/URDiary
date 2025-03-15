# 在 services 目錄下創建 analytics_service.py

from grok_client import client
from database import SessionLocal, crud
from typing import Dict, List, Any
import pandas as pd
import matplotlib.pyplot as plt
import io
import base64

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
        prompt = f"""
        分析以下一系列日記中的情緒主題和模式：
        
        {recent_contents}
        
        請提供：
        1. 主要情緒主題 (列出3-5個)
        2. 情緒變化模式
        3. 積極和消極因素
        4. 建議的關注點
        
        以JSON格式回應，包含這四個字段。
        """
        
        completion = client.chat.completions.create(
            model="grok-2-latest",
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
        
        return {
            "valence_trend": valence_trend.tolist(),
            "arousal_trend": arousal_trend.tolist(),
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "theme_analysis": theme_analysis,
            "chart": chart_base64
        }
    finally:
        db.close()

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
            
        # 分析互動筆記內容
        prompt = f"""
        從以下互動筆記中提取5-7個關鍵主題或關注點：
        
        {latest_note.content}
        
        只返回關鍵主題列表，無需其他解釋。每個主題控制在3-5個字。
        """
        
        completion = client.chat.completions.create(
            model="grok-2-latest",
            messages=[
                {"role": "system", "content": "你是一位主題分析專家。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        # 提取主題列表
        themes_text = completion.choices[0].message.content
        themes = [t.strip() for t in themes_text.split("\n") if t.strip()]
        
        return themes
    finally:
        db.close()