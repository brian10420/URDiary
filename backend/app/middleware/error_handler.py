import time
import uuid
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

# 使用統一的日誌工具 (相對 logs/ 目錄，本機與容器皆可寫入)
from utils.logger import create_logger

logger = create_logger("app.error_handler", "app_errors.log")

class ErrorHandler:
    """全局錯誤處理中間件"""
    
    async def __call__(self, request: Request, call_next):
        # 生成請求ID用於跟蹤
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        
        # 記錄請求開始
        start_time = time.time()
        method = request.method
        url = str(request.url)
        logger.info(f"Request started: {method} {url} - ID: {request_id}")
        
        try:
            # 執行請求
            response = await call_next(request)
            
            # 記錄成功的請求
            process_time = time.time() - start_time
            logger.info(
                f"Request completed: {method} {url} - ID: {request_id} "
                f"Status: {response.status_code} - Time: {process_time:.3f}s"
            )
            
            return response
            
        except Exception as e:
            # 計算處理時間
            process_time = time.time() - start_time
            
            # 根據異常類型處理
            return await self.handle_exception(e, request, request_id, process_time)
    
    async def handle_exception(self, exc, request, request_id, process_time):
        """根據異常類型返回適當的響應"""
        
        client_host = request.client.host if request.client else "unknown"
        url = str(request.url)
        method = request.method
        
        if isinstance(exc, RequestValidationError):
            # 請求驗證錯誤（如參數類型不匹配）
            status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
            logger.error(
                f"Validation error: {method} {url} - ID: {request_id} - "
                f"Client: {client_host} - Time: {process_time:.3f}s",
                exc_info=True
            )
            return JSONResponse(
                status_code=status_code,
                content={
                    "error": "validation_error",
                    "detail": str(exc),
                    "request_id": request_id,
                    "code": "INVALID_INPUT"
                }
            )
            
        elif isinstance(exc, StarletteHTTPException):
            # FastAPI的HTTP異常
            status_code = exc.status_code
            logger.error(
                f"HTTP error {status_code}: {method} {url} - ID: {request_id} - "
                f"Client: {client_host} - Time: {process_time:.3f}s - Detail: {exc.detail}",
                exc_info=True
            )
            return JSONResponse(
                status_code=status_code,
                content={
                    "error": "http_error",
                    "detail": exc.detail,
                    "request_id": request_id,
                    "code": f"HTTP_{status_code}"
                }
            )
            
        elif isinstance(exc, SQLAlchemyError):
            # 數據庫錯誤
            status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
            logger.error(
                f"Database error: {method} {url} - ID: {request_id} - "
                f"Client: {client_host} - Time: {process_time:.3f}s",
                exc_info=True
            )
            return JSONResponse(
                status_code=status_code,
                content={
                    "error": "database_error",
                    "detail": "資料庫操作失敗",
                    "request_id": request_id,
                    "code": "DB_ERROR"
                }
            )
            
        else:
            # 其他未處理的異常
            status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
            logger.error(
                f"Unhandled error: {method} {url} - ID: {request_id} - "
                f"Client: {client_host} - Time: {process_time:.3f}s",
                exc_info=True
            )
            return JSONResponse(
                status_code=status_code,
                content={
                    "error": "server_error",
                    "detail": "伺服器內部錯誤",
                    "request_id": request_id,
                    "code": "INTERNAL_ERROR"
                }
            )

# 單例實例
error_handler = ErrorHandler() 