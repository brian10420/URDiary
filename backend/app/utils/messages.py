"""使用者可見訊息的 zh/en 對照表。

只收錄「會直接顯示給使用者」的路由層 detail 訊息；
內部日誌與開發者訊息不翻譯。語言由 X-Language 標頭決定 (deps.get_language)。
"""

MESSAGES = {
    "ai_unavailable": {
        "zh-TW": "AI 服務暫時無法使用: {error}",
        "en": "The AI service is temporarily unavailable: {error}",
    },
    "diary_failed_retry": {
        "zh-TW": "日記生成失敗，對話記錄已保留，請稍後重試: {error}",
        "en": "Diary generation failed — your conversation is preserved, please try again later: {error}",
    },
    "diary_not_generated": {
        "zh-TW": "AI 服務暫時無法使用，日記未生成: {error}",
        "en": "The AI service is temporarily unavailable — no diary was generated: {error}",
    },
    "diary_create_failed": {
        "zh-TW": "日記生成失敗: {error}",
        "en": "Failed to create the diary: {error}",
    },
    "analytics_unavailable": {
        "zh-TW": "AI 服務暫時無法使用，情緒分析未完成: {error}",
        "en": "The AI service is temporarily unavailable — emotion analysis was not completed: {error}",
    },
    "analytics_failed": {
        "zh-TW": "情緒分析生成失敗: {error}",
        "en": "Failed to generate emotion analytics: {error}",
    },
    "note_unavailable": {
        "zh-TW": "AI 服務暫時無法使用，互動筆記未更新: {error}",
        "en": "The AI service is temporarily unavailable — the interaction note was not updated: {error}",
    },
    "note_update_failed": {
        "zh-TW": "互動筆記更新失敗: {error}",
        "en": "Failed to update the interaction note: {error}",
    },
    "forbidden_diaries": {
        "zh-TW": "無權存取其他使用者的日記",
        "en": "You cannot access another user's diaries",
    },
    "forbidden_analytics": {
        "zh-TW": "無權存取其他使用者的情緒分析",
        "en": "You cannot access another user's emotion analytics",
    },
    "forbidden_notes": {
        "zh-TW": "無權存取其他使用者的互動筆記",
        "en": "You cannot access another user's interaction notes",
    },
    "diary_not_found": {
        "zh-TW": "日記不存在",
        "en": "Diary not found",
    },
    "note_not_found": {
        "zh-TW": "尚未有互動筆記",
        "en": "No interaction note yet",
    },
    "no_update_data": {
        "zh-TW": "未提供任何更新數據",
        "en": "No update data provided",
    },
    "diary_update_failed": {
        "zh-TW": "日記更新失敗: {error}",
        "en": "Failed to update the diary: {error}",
    },
    "diary_delete_failed": {
        "zh-TW": "日記刪除失敗: {error}",
        "en": "Failed to delete the diary: {error}",
    },
    "missing_api_key": {
        "zh-TW": "缺少 {provider} 的 API Key，請在「設定」面板填入後再試",
        "en": "Missing API key for {provider} — add it in the Settings panel and try again",
    },
    "event_not_found": {
        "zh-TW": "行事曆事件不存在",
        "en": "Calendar event not found",
    },
    "invalid_date_range": {
        "zh-TW": "查詢區間無效：結束日期不可早於起始日期，且跨度不可超過 62 天",
        "en": "Invalid date range: the end date must not be before the start date, and the span cannot exceed 62 days",
    },
    "event_created": {
        "zh-TW": "行事曆事件已新增",
        "en": "Calendar event created",
    },
    "event_updated": {
        "zh-TW": "行事曆事件已更新",
        "en": "Calendar event updated",
    },
    "event_deleted": {
        "zh-TW": "行事曆事件已刪除",
        "en": "Calendar event deleted",
    },
}


def msg(key: str, lang: str = "zh-TW", **kwargs) -> str:
    """取指定語言的訊息；缺項時退回 zh-TW，再不行回 key 本身。"""
    entry = MESSAGES.get(key, {})
    template = entry.get(lang) or entry.get("zh-TW") or key
    try:
        return template.format(**kwargs) if kwargs else template
    except (KeyError, IndexError):
        return template
