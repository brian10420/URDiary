# 錯誤處理系統文檔

本文檔描述 URDiary 後端（單機 SQLite 部署）的錯誤處理：錯誤碼、例外類別、
API 錯誤回應格式，以及日誌記錄方式。

## 1. 錯誤響應格式

所有 API 錯誤回應遵循以下統一格式：

```json
{
    "error": "error_type",
    "detail": "錯誤描述信息",
    "request_id": "請求唯一標識",
    "code": "ERROR_CODE"
}
```

其中：
- `error`：錯誤類型，如 `validation_error`、`http_error`、`database_error`、`server_error`
- `detail`：對錯誤的詳細描述
- `request_id`：用於追蹤這次請求的 UUID（由 `middleware/error_handler.py` 產生）
- `code`：錯誤代碼，如 `E1001`、`E3001` 等（見下）

這個契約由 `middleware/exception_handlers.py` **唯一**負責產生——它是應用中
唯一把例外轉成 JSON 回應的地方。`middleware/error_handler.py` 只負責產生
`request_id`（寫入 `request.state.request_id`）與記錄請求起訖時間，不處理
例外內容：FastAPI 的 `ExceptionMiddleware`／`ServerErrorMiddleware` 在 ASGI
堆疊中位於它更內層，例外一律先被攔截並轉交 `exception_handlers.py`。

## 2. 錯誤代碼

錯誤代碼定義於 `utils/error_codes.py`（`ErrorCode` 類別），分為以下類別：

1. **通用錯誤** (1000-1999)：`E1000` 未知錯誤、`E1001` 無效輸入、
   `E1002` 資源不存在、`E1003` 操作失敗、`E1004` 未經授權、`E1005` 禁止訪問
2. **用戶相關錯誤** (2000-2999)：`E2000` 用戶不存在、`E2001` 用戶已存在、
   `E2002` 無效的用戶名、`E2003` 需要邀請碼、`E2004` 邀請碼無效
3. **聊天相關錯誤** (3000-3999)：`E3000` 聊天歷史不存在、
   `E3001` 聊天服務不可用、`E3002` 消息過長、`E3003` 敏感內容
4. **日記相關錯誤** (4000-4999)：`E4000` 日記不存在、`E4001` 日記創建失敗、
   `E4002` 日記更新失敗、`E4003` 日記刪除失敗
5. **互動筆記相關錯誤** (5000-5999)：`E5000` 互動筆記不存在、
   `E5001` 互動筆記創建失敗、`E5002` 互動筆記更新失敗
6. **數據庫相關錯誤** (6000-6999)：`E6000`~`E6003`（連線/查詢/交易/完整性）
7. **第三方服務相關錯誤** (7000-7999)：`E7000`~`E7002`（服務不可用/超時/回應錯誤）

## 3. 例外類別

`utils/api_exceptions.py` 提供以下自訂例外（皆繼承 `HTTPException`）：

1. `APIError`：基礎類別，帶 `error_code`
2. `NotFoundError`（404）、`BadRequestError`（400）、`UnauthorizedError`（401）、
   `ForbiddenError`（403）、`ServerError`（500）、`ServiceUnavailableError`（503）

路由層一律拋這些例外，交由 `exception_handlers.py` 轉成上面的 JSON 格式：

```python
from utils.api_exceptions import NotFoundError
from utils.error_codes import ErrorCode

@router.get("/{user_id}")
def get_user(user_id: int):
    user = find_user(user_id)
    if not user:
        raise NotFoundError(
            error_code=ErrorCode.USER_NOT_FOUND,
            detail=f"找不到 ID 為 {user_id} 的用戶"
        )
    return user
```

`RequestValidationError`（請求驗證失敗）與 `SQLAlchemyError`（資料庫錯誤）
也各自在 `exception_handlers.py` 註冊了 handler，未被上述任何一種攔截到的
例外最終落到 `general_exception_handler`，回應 500 `server_error`。

## 4. 日誌記錄

日誌工具在 `utils/logger.py`，皆為扁平匯入（`from utils.logger import ...`）。
提供三個具名 logger：`app_logger`（主應用）、`api_logger`（API 請求）、
`error_logger`（錯誤）；`log_error(error, context=None)` 為統一的錯誤記錄
輔助函式：

```python
from utils.logger import log_error

try:
    result = process_data(data)
except Exception as e:
    log_error(e, {"data": data, "action": "process_data"})
    raise
```

日誌檔寫在 `backend/app/logs/`（與啟動時的工作目錄無關），依檔案大小
輪轉——每個 log target 只掛一個 `RotatingFileHandler`，單檔上限 10MB，
保留最近 3 份備份（見 `utils/logger.py` 的 `MAX_LOG_SIZE`／
`MAX_LOG_BACKUPS`；v2.3 task 3.1 之前曾同時掛大小與每日午夜雙重輪轉，
導致每筆記錄被寫兩次，已移除）。`main.py` 每日排程呼叫
`cleanup_old_logs()` 清除超過 14 天的舊檔。

## 5. 除錯與追蹤

每個請求都有一個 `request_id`（見第 1 節），可用於：

1. 在日誌檔中搜尋這個請求的完整生命週期（`error_handler.py` 記錄的
   起訖 timing log 與各處 `log_error` 的內容都會經過同一個 request）
2. 在錯誤回應中直接取得，回報問題時附上即可
