from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.exc import SQLAlchemyError

from utils.api_exceptions import APIError

def register_exception_handlers(app: FastAPI):
    """向FastAPI應用註冊全局異常處理器"""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        """處理 HTTPException / APIError

        沒有這個處理器的話，所有 NotFoundError / BadRequestError / UnauthorizedError /
        ServerError 都會落到 FastAPI 預設處理器，回應只剩 {"detail": "..."} ——
        api_exceptions.py 設定的 error_code 會被整個丟掉，前端無法依 code 分支
        (docs/error_handling.md 明確把 code/error/request_id 列為 API 契約)。
        """
        request_id = getattr(request.state, "request_id", "unknown")

        # APIError 帶有 error_code；一般的 HTTPException 則以 HTTP_<status> 表示
        error_code = getattr(exc, "error_code", None) or f"HTTP_{exc.status_code}"

        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": "http_error",
                "detail": exc.detail,
                "request_id": request_id,
                "code": error_code
            },
            headers=getattr(exc, "headers", None)
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """處理請求驗證錯誤"""
        request_id = getattr(request.state, "request_id", "unknown")
        
        errors = []
        for error in exc.errors():
            errors.append({
                "loc": error.get("loc", []),
                "msg": error.get("msg", ""),
                "type": error.get("type", "")
            })
        
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": "validation_error",
                "detail": "請求參數驗證失敗",
                "request_id": request_id,
                "code": "INVALID_INPUT",
                "errors": errors
            }
        )
    
    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
        """處理數據庫異常"""
        request_id = getattr(request.state, "request_id", "unknown")
        
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "database_error",
                "detail": "資料庫操作失敗",
                "request_id": request_id,
                "code": "DB_ERROR"
            }
        )
    
    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        """處理所有其他異常"""
        request_id = getattr(request.state, "request_id", "unknown")
        
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "server_error",
                "detail": "伺服器內部錯誤",
                "request_id": request_id,
                "code": "INTERNAL_ERROR"
            }
        ) 