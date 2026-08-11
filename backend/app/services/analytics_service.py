# 在 services 目錄下創建 analytics_service.py

import llm
from providers.base import LLMConfig
from database import db_session, crud
from services.prompt_loader import load_prompt, get_role
from utils.time_utils import get_local_now
from typing import Dict, Any, Optional
import pandas as pd
from datetime import timedelta
import re

def analyze_emotion_trends(user_id: int, time_range: str = "month", cfg: Optional[LLMConfig] = None, lang: str = "zh-TW") -> Dict[str, Any]:
    """
    分析用戶情緒隨時間的變化趨勢

    Args:
        user_id: 用戶ID
        time_range: 時間範圍，可選 'week', 'month', 'year'
        cfg: 請求範圍的 LLM 設定；None 時走 .env Grok 後備

    Returns:
        Dict 包含分析結果和圖表
    """
    # 讀取階段 —— 取完資料立刻關閉連線，不可在持有連線時呼叫 LLM
    with db_session() as db:
        diaries = crud.get_user_diaries(db, user_id, limit=100)

        if not diaries:
            return {"message": "沒有足夠的數據進行分析"}

        # 準備數據 (在 session 內取出所有需要的欄位)
        data = [
            {
                "date": diary.diary_date,
                "valence": diary.valence,
                "arousal": diary.arousal,
                "content": diary.content,
            }
            for diary in diaries
        ]

    df = pd.DataFrame(data)
    df = df.sort_values("date")

    # 使用 LLM 分析情緒主題 (此時不持有 DB 連線)
    recent_contents = "\n\n".join([d["content"] for d in data[-5:]])

    # 讀取情緒分析提示詞
    prompt_template = load_prompt("emotion_analysis_prompt.txt", lang)
    prompt = prompt_template.format(recent_contents=recent_contents)

    analysis_text = llm.chat(
        [
            {"role": "system", "content": get_role("emotion_analyst", lang)},
            {"role": "user", "content": prompt}
        ],
        cfg
    )

    # 提取主題分析 (模型偶爾會包 ```json 圍欄，先剝掉再解析)
    import json
    try:
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", analysis_text.strip())
        theme_analysis = json.loads(cleaned)
    except Exception:
        theme_analysis = {
            "themes": ["無法解析"],
            "pattern": "無法解析",
            "factors": "無法解析",
            "focus": "無法解析"
        }

    # 創建圖表 (尚未實作真實圖表)
    chart_base64 = None

    # 時間範圍過濾
    # diary_date 由 time_utils.get_diary_datetime() 產生，是「台北牆上時間」的
    # naive datetime。若用 datetime.now() (容器內為 UTC) 當基準比較，視窗會偏移 8 小時，
    # 因此這裡以同樣的台北時間為基準。
    days = {"week": 7, "month": 30, "year": 365}.get(time_range, 30)
    start_date = get_local_now().replace(tzinfo=None) - timedelta(days=days)

    df = df[df['date'] >= start_date]

    # 情緒趨勢分析 - 在過濾後計算，確保與 dates 長度一致；
    # min_periods=1 讓資料量少時也有數值，NaN 轉為 None 以產生合法 JSON
    valence_trend = df["valence"].rolling(window=3, min_periods=1).mean()
    arousal_trend = df["arousal"].rolling(window=3, min_periods=1).mean()
    valence_trend = [None if pd.isna(v) else float(v) for v in valence_trend]
    arousal_trend = [None if pd.isna(v) else float(v) for v in arousal_trend]

    # 情緒變化速率分析
    if len(df) > 1:
        valence_volatility = df['valence'].diff().abs().mean()
        arousal_volatility = df['arousal'].diff().abs().mean()
        valence_volatility = 0 if pd.isna(valence_volatility) else float(valence_volatility)
        arousal_volatility = 0 if pd.isna(arousal_volatility) else float(arousal_volatility)
    else:
        valence_volatility = 0
        arousal_volatility = 0

    # 最正面/負面日 - 需防範過濾後為空或 valence 全為 NULL 的情況
    has_valence = (not df.empty) and df['valence'].notna().any()
    most_positive_day = df.loc[df['valence'].idxmax()]['date'].strftime("%Y-%m-%d") if has_valence else None
    most_negative_day = df.loc[df['valence'].idxmin()]['date'].strftime("%Y-%m-%d") if has_valence else None

    return {
        "valence_trend": valence_trend,
        "arousal_trend": arousal_trend,
        "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
        "theme_analysis": theme_analysis,
        "chart": chart_base64,
        "valence_volatility": valence_volatility,
        "arousal_volatility": arousal_volatility,
        "most_positive_day": most_positive_day,
        "most_negative_day": most_negative_day,
    }