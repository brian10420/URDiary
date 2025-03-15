/**
 * 通用錯誤處理模塊 - 用於記錄和顯示應用程序錯誤
 */
const ErrorHandler = (function() {
    // 錯誤類型
    const ERROR_TYPES = {
        VALIDATION: 'validation',
        API: 'api',
        UI: 'ui',
        DATA: 'data',
        UNKNOWN: 'unknown'
    };
    
    // 處理錯誤
    function handleError(error, type = ERROR_TYPES.UNKNOWN, context = {}) {
        // 包裝錯誤信息
        const errorInfo = {
            message: error.message || String(error),
            type: type,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            context: context
        };
        
        // 記錄錯誤
        logError(errorInfo);
        
        // 顯示用戶友好的錯誤信息
        showUserFriendlyError(errorInfo);
        
        return errorInfo;
    }
    
    // 處理表單驗證錯誤
    function handleValidationError(message, field = null) {
        const error = new Error(message);
        return handleError(error, ERROR_TYPES.VALIDATION, { field });
    }
    
    // 處理API錯誤
    function handleApiError(error, endpoint = null, requestData = null) {
        return handleError(error, ERROR_TYPES.API, { endpoint, requestData });
    }
    
    // 處理UI錯誤
    function handleUiError(error, component = null, action = null) {
        return handleError(error, ERROR_TYPES.UI, { component, action });
    }
    
    // 處理數據錯誤
    function handleDataError(error, dataType = null, operation = null) {
        return handleError(error, ERROR_TYPES.DATA, { dataType, operation });
    }
    
    // 記錄錯誤
    function logError(errorInfo) {
        // 控制台輸出
        console.error('應用錯誤:', errorInfo);
        
        // 使用日誌系統記錄
        if (window.Logger && Logger.error) {
            Logger.error(`[${errorInfo.type.toUpperCase()}] ${errorInfo.message}`, {
                context: errorInfo.context,
                stack: errorInfo.stack
            });
        }
    }
    
    // 顯示用戶友好的錯誤信息
    function showUserFriendlyError(errorInfo) {
        let userMessage = '應用發生錯誤';
        
        // 根據錯誤類型提供不同的錯誤消息
        switch (errorInfo.type) {
            case ERROR_TYPES.VALIDATION:
                userMessage = `驗證錯誤: ${errorInfo.message}`;
                break;
            case ERROR_TYPES.API:
                userMessage = '網絡請求失敗，請稍後再試';
                break;
            case ERROR_TYPES.UI:
                userMessage = '界面操作錯誤，請刷新頁面';
                break;
            case ERROR_TYPES.DATA:
                userMessage = '數據處理錯誤，請確認數據格式';
                break;
            default:
                userMessage = '應用發生未知錯誤';
        }
        
        // 使用UI管理器顯示toast
        if (window.UIManager && UIManager.showToast) {
            UIManager.showToast(userMessage);
        } else {
            // 後備方案：使用alert
            alert(userMessage);
        }
    }
    
    // 獲取錯誤詳情HTML
    function getErrorDetailsHtml(errorInfo) {
        return `
            <div class="error-details">
                <div class="error-type">${errorInfo.type.toUpperCase()}</div>
                <div class="error-message">${errorInfo.message}</div>
                ${errorInfo.stack ? `<pre class="error-stack">${errorInfo.stack}</pre>` : ''}
                <div class="error-time">${new Date(errorInfo.timestamp).toLocaleString()}</div>
            </div>
        `;
    }
    
    // 為後續任務添加錯誤處理
    function withErrorHandling(fn, errorType, context) {
        return async function(...args) {
            try {
                return await fn(...args);
            } catch (error) {
                handleError(error, errorType, { 
                    ...context, 
                    args
                });
                throw error; // 重新拋出以允許進一步處理
            }
        };
    }
    
    // 導出公共API
    return {
        handleError,
        handleValidationError,
        handleApiError,
        handleUiError,
        handleDataError,
        getErrorDetailsHtml,
        withErrorHandling,
        TYPES: ERROR_TYPES
    };
})();

// 設置全局未處理的錯誤處理器
window.addEventListener('error', function(event) {
    ErrorHandler.handleError(event.error || new Error(event.message), 
        ErrorHandler.TYPES.UNKNOWN, 
        { 
            source: event.filename,
            line: event.lineno,
            column: event.colno
        }
    );
});

// 設置未處理的Promise錯誤處理器
window.addEventListener('unhandledrejection', function(event) {
    ErrorHandler.handleError(event.reason || new Error('未處理的Promise拒絕'), 
        ErrorHandler.TYPES.UNKNOWN, 
        { promiseRejection: true }
    );
}); 