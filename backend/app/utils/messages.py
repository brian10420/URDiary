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
        "zh-TW": "查詢區間無效：結束日期不可早於起始日期，且跨度不可超過 63 天",
        "en": "Invalid date range: the end date must not be before the start date, and the span cannot exceed 63 days",
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
    "field_not_clearable": {
        "zh-TW": "欄位 {fields} 不可清空為 null，若要維持原值請不要提供該欄位",
        "en": "Field(s) {fields} cannot be cleared to null — omit them to keep the existing value",
    },

    # --- 認證 / 工作階段 (api/routes/user.py, api/deps.py) ---
    "username_taken": {
        "zh-TW": "該用戶名稱已存在",
        "en": "That username is already taken",
    },
    "password_too_weak": {
        "zh-TW": "密碼強度不足：{reasons}",
        "en": "Password is too weak: {reasons}",
    },
    "forbidden_user": {
        "zh-TW": "無權存取其他使用者的資料",
        "en": "You cannot access another user's data",
    },
    "invalid_credentials": {
        "zh-TW": "用戶名或密碼不正確",
        "en": "Incorrect username or password",
    },
    "account_has_no_password": {
        "zh-TW": "此帳號尚未設定密碼，請重新建立帳號",
        "en": "This account has no password set — please create the account again",
    },
    "invalid_token": {
        "zh-TW": "無法驗證憑證",
        "en": "Could not validate credentials",
    },
    "token_missing": {
        "zh-TW": "未提供令牌",
        "en": "No token provided",
    },
    "refresh_token_invalid": {
        "zh-TW": "刷新令牌無效或已過期，請重新登入",
        "en": "The refresh token is invalid or expired — please sign in again",
    },
    "refresh_token_reused": {
        "zh-TW": "偵測到刷新令牌被重複使用，已登出此帳號的所有裝置，請重新登入",
        "en": "Refresh-token reuse detected — every device for this account was signed out, please sign in again",
    },
    "user_not_found": {
        "zh-TW": "用戶不存在",
        "en": "User not found",
    },
    "session_not_found": {
        "zh-TW": "工作階段不存在",
        "en": "Session not found",
    },
    "logged_out": {
        "zh-TW": "已登出此裝置",
        "en": "Signed out on this device",
    },
    "session_revoked": {
        "zh-TW": "已撤銷該裝置的登入狀態",
        "en": "That device has been signed out",
    },

    # --- 密碼強度規則 (utils/password_validator.py) ---
    "password_min_length": {
        "zh-TW": "密碼長度至少需要8個字符",
        "en": "Password must be at least 8 characters",
    },
    "password_need_upper": {
        "zh-TW": "密碼需要包含至少一個大寫字母",
        "en": "Password needs at least one uppercase letter",
    },
    "password_need_lower": {
        "zh-TW": "密碼需要包含至少一個小寫字母",
        "en": "Password needs at least one lowercase letter",
    },
    "password_need_digit": {
        "zh-TW": "密碼需要包含至少一個數字",
        "en": "Password needs at least one digit",
    },
    "password_need_special": {
        "zh-TW": "密碼需要包含至少一個特殊字符",
        "en": "Password needs at least one special character",
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
