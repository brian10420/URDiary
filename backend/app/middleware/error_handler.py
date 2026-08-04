import time
import uuid
from fastapi import Request

# 使用統一的日誌工具 (相對 logs/ 目錄，本機與容器皆可寫入)
from utils.logger import create_logger

logger = create_logger("app.error_handler", "app_errors.log")

class ErrorHandler:
    """輕量中間件：只負責 request-id 產生與請求起訖 timing logging。

    例外一律 re-raise，統一交由 middleware/exception_handlers.py 的
    FastAPI exception handler 轉成 JSON。原本這裡也會攔截例外並自行組
    JSONResponse，但 FastAPI 的 ExceptionMiddleware 位於本中間件更內層
    (見 Starlette build_middleware_stack：僅 bare Exception 的 handler
    會被拉到最外層的 ServerErrorMiddleware，其餘已註冊的例外類型都在
    ExceptionMiddleware 攔截)，所以 HTTPException/RequestValidationError/
    SQLAlchemyError 一律不會走到這裡；未註冊的例外則會一路往外拋到
    ServerErrorMiddleware，改由 exception_handlers.py 的
    general_exception_handler 處理——兩者輸出的 JSON 完全相同。
    也就是說底下的例外分支原本就是死碼，這裡不再重複維護。
    """

    async def __call__(self, request: Request, call_next):
        # 生成請求ID用於跟蹤；exception_handlers.py 會從 request.state 讀出
        # 同一個值一併寫進錯誤回應，讓成功/失敗的請求都能用同一個 ID 追蹤。
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

        start_time = time.time()
        method = request.method
        url = str(request.url)
        logger.info(f"Request started: {method} {url} - ID: {request_id}")

        try:
            response = await call_next(request)
        except Exception:
            process_time = time.time() - start_time
            logger.error(
                f"Request raised: {method} {url} - ID: {request_id} - "
                f"Time: {process_time:.3f}s",
                exc_info=True
            )
            raise

        process_time = time.time() - start_time
        logger.info(
            f"Request completed: {method} {url} - ID: {request_id} "
            f"Status: {response.status_code} - Time: {process_time:.3f}s"
        )
        return response

# 單例實例
error_handler = ErrorHandler() 