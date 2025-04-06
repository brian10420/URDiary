# 錯誤處理系統文檔

本文檔描述了AI日記應用中的錯誤處理系統，包括錯誤碼、異常處理、日誌記錄以及API響應格式。

## 1. 錯誤響應格式

所有API錯誤響應遵循以下統一格式：

```json
{
    "error": "error_type",
    "detail": "錯誤描述信息",
    "request_id": "請求唯一標識",
    "code": "ERROR_CODE"
}
```

其中：
- `error`: 錯誤類型，如 `validation_error`、`http_error`、`database_error` 等
- `detail`: 對錯誤的詳細描述
- `request_id`: 用於跟蹤和調試的請求ID
- `code`: 錯誤代碼，如 `E1001`、`E2000` 等

## 2. 錯誤代碼

錯誤代碼分為以下幾個類別：

1. **通用錯誤** (1000-1999)
   - `E1000`: 未知錯誤
   - `E1001`: 無效的輸入
   - `E1002`: 資源不存在
   - `E1003`: 操作失敗
   - `E1004`: 未經授權
   - `E1005`: 禁止訪問

2. **用戶相關錯誤** (2000-2999)
   - `E2000`: 用戶不存在
   - `E2001`: 用戶已存在
   - `E2002`: 無效的用戶名

3. **聊天相關錯誤** (3000-3999)
   - `E3000`: 聊天歷史不存在
   - `E3001`: 聊天服務不可用
   - `E3002`: 消息過長
   - `E3003`: 敏感內容

4. **日記相關錯誤** (4000-4999)
   - `E4000`: 日記不存在
   - `E4001`: 日記創建失敗
   - `E4002`: 日記更新失敗
   - `E4003`: 日記刪除失敗

5. **互動筆記相關錯誤** (5000-5999)
   - `E5000`: 互動筆記不存在
   - `E5001`: 互動筆記創建失敗
   - `E5002`: 互動筆記更新失敗

6. **數據庫相關錯誤** (6000-6999)
   - `E6000`: 數據庫連接錯誤
   - `E6001`: 數據庫查詢錯誤
   - `E6002`: 數據庫事務錯誤
   - `E6003`: 數據庫完整性錯誤

7. **第三方服務相關錯誤** (7000-7999)
   - `E7000`: 服務不可用
   - `E7001`: 服務超時
   - `E7002`: 服務響應錯誤

## 3. 異常類

應用中提供了以下幾種自定義異常類：

1. `APIError`: 基礎API錯誤類
2. `NotFoundError`: 資源不存在錯誤 (404)
3. `BadRequestError`: 無效請求錯誤 (400)
4. `UnauthorizedError`: 未授權錯誤 (401)
5. `ForbiddenError`: 禁止訪問錯誤 (403)
6. `ConflictError`: 資源衝突錯誤 (409)
7. `ServerError`: 伺服器內部錯誤 (500)
8. `ServiceUnavailableError`: 服務不可用錯誤 (503)

## 4. 使用示例

### 在API路由中使用

```python
from app.utils.api_exceptions import NotFoundError, BadRequestError
from app.utils.error_codes import ErrorCode

@router.get("/{user_id}")
def get_user(user_id: int):
    user = find_user(user_id)
    if not user:
        raise NotFoundError(
            error_code=ErrorCode.USER_NOT_FOUND,
            detail=f"找不到ID為{user_id}的用戶"
        )
    return user
```

### 處理驗證錯誤

```python
@router.post("/create")
def create_item(item: ItemCreate):
    if item.price < 0:
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail="商品價格不能為負數"
        )
    # 處理創建邏輯...
```

## 5. 日誌記錄

應用使用以下幾種不同的日誌記錄器：

1. `app_logger`: 主應用日誌
2. `api_logger`: API請求日誌
3. `error_logger`: 錯誤日誌
4. `db_logger`: 數據庫操作日誌

### 記錄一般日誌

```python
from app.utils.logger import api_logger

def process_request(request_data):
    api_logger.info(f"處理請求: {request_data}")
    # 處理邏輯...
```

### 記錄錯誤

```python
from app.utils.logger import log_error

try:
    # 可能出錯的操作
    result = process_data(data)
except Exception as e:
    log_error(e, {"data": data, "action": "process_data"})
    raise
```

### 記錄結構化事件

```python
from app.utils.logger import log_event
import logging

log_event(
    "user_login",
    {"user_id": user.id, "ip": request.client.host},
    level=logging.INFO
)
```

## 6. 調試與跟蹤

每個請求都會生成一個唯一的請求ID，可用於在日誌系統中跟蹤完整的請求生命週期：

1. 在日誌文件中搜索請求ID
2. 在響應錯誤中查看請求ID
3. 使用請求ID向用戶請求更多信息，以便調試問題

## 7. 生產環境配置

在生產環境中，建議以下配置：

1. 將 `LOG_LEVEL` 環境變量設置為 `INFO` 或 `WARNING`
2. 配置日誌文件的輪換，防止日誌文件過大
3. 考慮將錯誤日誌發送到集中式日誌系統
4. 定期檢查錯誤報告和趨勢

## 8. 擴展

錯誤處理系統可以通過以下方式擴展：

1. 添加新的錯誤代碼
2. 創建特定領域的異常類
3. 增強日誌記錄器的功能
4. 集成錯誤監控和報警系統 