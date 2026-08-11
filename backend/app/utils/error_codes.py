"""錯誤代碼定義

這個模塊定義了應用中所有錯誤的代碼和描述信息，
使所有模塊可以統一引用這些錯誤代碼。
"""

class ErrorCode:
    """錯誤代碼常量類"""
    
    # 通用錯誤 (1000-1999)
    UNKNOWN_ERROR = "E1000"
    INVALID_INPUT = "E1001"
    RESOURCE_NOT_FOUND = "E1002"
    OPERATION_FAILED = "E1003"
    UNAUTHORIZED = "E1004"
    FORBIDDEN = "E1005"
    
    # 用戶相關錯誤 (2000-2999)
    USER_NOT_FOUND = "E2000"
    USER_ALREADY_EXISTS = "E2001"
    INVALID_USERNAME = "E2002"
    INVITE_CODE_REQUIRED = "E2003"
    INVITE_CODE_INVALID = "E2004"
    
    # 聊天相關錯誤 (3000-3999)
    CHAT_HISTORY_NOT_FOUND = "E3000"
    CHAT_SERVICE_UNAVAILABLE = "E3001"
    MESSAGE_TOO_LONG = "E3002"
    SENSITIVE_CONTENT = "E3003"
    
    # 日記相關錯誤 (4000-4999)
    DIARY_NOT_FOUND = "E4000"
    DIARY_CREATION_FAILED = "E4001"
    DIARY_UPDATE_FAILED = "E4002"
    DIARY_DELETE_FAILED = "E4003"
    
    # 互動筆記相關錯誤 (5000-5999)
    NOTE_NOT_FOUND = "E5000"
    NOTE_CREATION_FAILED = "E5001"
    NOTE_UPDATE_FAILED = "E5002"
    
    # 數據庫相關錯誤 (6000-6999)
    DB_CONNECTION_ERROR = "E6000"
    DB_QUERY_ERROR = "E6001"
    DB_TRANSACTION_ERROR = "E6002"
    DB_INTEGRITY_ERROR = "E6003"
    
    # 第三方服務相關錯誤 (7000-7999)
    SERVICE_UNAVAILABLE = "E7000"
    SERVICE_TIMEOUT = "E7001"
    SERVICE_RESPONSE_ERROR = "E7002"


# 錯誤代碼對應的錯誤描述
ERROR_DESCRIPTIONS = {
    # 通用錯誤
    ErrorCode.UNKNOWN_ERROR: "未知錯誤",
    ErrorCode.INVALID_INPUT: "無效的輸入",
    ErrorCode.RESOURCE_NOT_FOUND: "資源不存在",
    ErrorCode.OPERATION_FAILED: "操作失敗",
    ErrorCode.UNAUTHORIZED: "未經授權",
    ErrorCode.FORBIDDEN: "禁止訪問",
    
    # 用戶相關錯誤
    ErrorCode.USER_NOT_FOUND: "用戶不存在",
    ErrorCode.USER_ALREADY_EXISTS: "用戶已存在",
    ErrorCode.INVALID_USERNAME: "無效的用戶名",
    ErrorCode.INVITE_CODE_REQUIRED: "需要邀請碼",
    ErrorCode.INVITE_CODE_INVALID: "邀請碼無效",
    
    # 聊天相關錯誤
    ErrorCode.CHAT_HISTORY_NOT_FOUND: "聊天歷史不存在",
    ErrorCode.CHAT_SERVICE_UNAVAILABLE: "聊天服務不可用",
    ErrorCode.MESSAGE_TOO_LONG: "消息過長",
    ErrorCode.SENSITIVE_CONTENT: "敏感內容",
    
    # 日記相關錯誤
    ErrorCode.DIARY_NOT_FOUND: "日記不存在",
    ErrorCode.DIARY_CREATION_FAILED: "日記創建失敗",
    ErrorCode.DIARY_UPDATE_FAILED: "日記更新失敗",
    ErrorCode.DIARY_DELETE_FAILED: "日記刪除失敗",
    
    # 互動筆記相關錯誤
    ErrorCode.NOTE_NOT_FOUND: "互動筆記不存在",
    ErrorCode.NOTE_CREATION_FAILED: "互動筆記創建失敗",
    ErrorCode.NOTE_UPDATE_FAILED: "互動筆記更新失敗",
    
    # 數據庫相關錯誤
    ErrorCode.DB_CONNECTION_ERROR: "數據庫連接錯誤",
    ErrorCode.DB_QUERY_ERROR: "數據庫查詢錯誤",
    ErrorCode.DB_TRANSACTION_ERROR: "數據庫事務錯誤",
    ErrorCode.DB_INTEGRITY_ERROR: "數據庫完整性錯誤",
    
    # 第三方服務相關錯誤
    ErrorCode.SERVICE_UNAVAILABLE: "服務不可用",
    ErrorCode.SERVICE_TIMEOUT: "服務超時",
    ErrorCode.SERVICE_RESPONSE_ERROR: "服務響應錯誤"
}


def get_error_description(error_code: str) -> str:
    """根據錯誤代碼獲取錯誤描述
    
    Args:
        error_code: 錯誤代碼
        
    Returns:
        對應的錯誤描述，如果代碼不存在則返回未知錯誤
    """
    return ERROR_DESCRIPTIONS.get(error_code, "未知錯誤") 