from fastapi import HTTPException, status
from .error_codes import ErrorCode, get_error_description

class APIError(HTTPException):
    """API錯誤基類"""
    
    def __init__(
        self,
        status_code: int,
        error_code: str,
        detail: str = None,
        headers: dict = None
    ):
        self.error_code = error_code
        detail_message = detail or get_error_description(error_code)
        super().__init__(status_code=status_code, detail=detail_message, headers=headers)


# 404錯誤：資源不存在
class NotFoundError(APIError):
    """資源不存在錯誤"""
    
    def __init__(self, error_code: str = ErrorCode.RESOURCE_NOT_FOUND, detail: str = None, headers: dict = None):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code=error_code,
            detail=detail,
            headers=headers
        )


# 400錯誤：無效輸入
class BadRequestError(APIError):
    """請求錯誤"""
    
    def __init__(self, error_code: str = ErrorCode.INVALID_INPUT, detail: str = None, headers: dict = None):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code=error_code,
            detail=detail,
            headers=headers
        )


# 401錯誤：未經授權
class UnauthorizedError(APIError):
    """未授權錯誤"""
    
    def __init__(self, error_code: str = ErrorCode.UNAUTHORIZED, detail: str = None, headers: dict = None):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code=error_code,
            detail=detail,
            headers=headers
        )


# 403錯誤：禁止訪問
class ForbiddenError(APIError):
    """禁止訪問錯誤"""
    
    def __init__(self, error_code: str = ErrorCode.FORBIDDEN, detail: str = None, headers: dict = None):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            error_code=error_code,
            detail=detail,
            headers=headers
        )


# 500錯誤：服務器內部錯誤
class ServerError(APIError):
    """伺服器內部錯誤"""
    
    def __init__(self, error_code: str = ErrorCode.UNKNOWN_ERROR, detail: str = None, headers: dict = None):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code=error_code,
            detail=detail,
            headers=headers
        )


# 503錯誤：服務不可用
class ServiceUnavailableError(APIError):
    """服務不可用錯誤"""
    
    def __init__(self, error_code: str = ErrorCode.SERVICE_UNAVAILABLE, detail: str = None, headers: dict = None):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code=error_code,
            detail=detail,
            headers=headers
        ) 