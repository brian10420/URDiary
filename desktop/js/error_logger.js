/**
 * 錯誤日誌記錄工具 - 捕獲並記錄前端錯誤
 */
const ErrorLogger = (function() {
    // 日誌存儲
    const errorLogs = [];
    
    // 最大日誌數量
    const MAX_LOGS = 100;
    
    // 初始化
    function init() {
        console.log('錯誤日誌系統初始化');
        
        // 捕獲全局錯誤
        window.addEventListener('error', function(event) {
            const errorInfo = captureError(event.error || new Error(event.message), {
                type: 'global',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });
            
            displayErrorInConsole(errorInfo);
            saveErrorToFile(errorInfo);
        });
        
        // 捕獲未處理的Promise錯誤
        window.addEventListener('unhandledrejection', function(event) {
            const errorInfo = captureError(event.reason || new Error('Promise拒絕'), {
                type: 'promise'
            });
            
            displayErrorInConsole(errorInfo);
            saveErrorToFile(errorInfo);
        });
        
        // 重寫console.error以捕獲所有控制台錯誤
        const originalConsoleError = console.error;
        console.error = function() {
            // 調用原始方法
            originalConsoleError.apply(console, arguments);
            
            // 捕獲錯誤信息
            const errorMessage = Array.from(arguments).map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            
            const errorInfo = {
                message: errorMessage,
                type: 'console',
                timestamp: new Date().toISOString(),
                stack: new Error().stack
            };
            
            addErrorLog(errorInfo);
        };
        
        console.log('錯誤日誌系統已啟動');
    }
    
    // 捕獲錯誤
    function captureError(error, context = {}) {
        const errorInfo = {
            message: error.message || String(error),
            stack: error.stack,
            timestamp: new Date().toISOString(),
            ...context
        };
        
        addErrorLog(errorInfo);
        return errorInfo;
    }
    
    // 捕獲信息日誌
    function captureInfo(message, data = {}) {
        const infoLog = {
            message: message,
            data: data,
            timestamp: new Date().toISOString(),
            type: 'info'
        };
        
        console.info(`[INFO] ${message}`, data);
        
        // 不將普通信息添加到錯誤日誌，僅在控制台顯示
        return infoLog;
    }
    
    // 添加錯誤日誌
    function addErrorLog(errorInfo) {
        errorLogs.unshift(errorInfo);
        
        // 限制日誌數量
        if (errorLogs.length > MAX_LOGS) {
            errorLogs.pop();
        }
        
        // 觸發錯誤記錄事件
        window.dispatchEvent(new CustomEvent('errorLogged', { 
            detail: { errorInfo } 
        }));
    }
    
    // 顯示錯誤在控制台
    function displayErrorInConsole(errorInfo) {
        console.group('%c應用錯誤', 'color:red; font-weight:bold');
        console.log('錯誤信息:', errorInfo.message);
        console.log('時間:', new Date(errorInfo.timestamp).toLocaleString());
        console.log('類型:', errorInfo.type);
        if (errorInfo.stack) {
            console.log('堆棧:', errorInfo.stack);
        }
        console.groupEnd();
    }
    
    // 保存錯誤到文件
    function saveErrorToFile(errorInfo) {
        try {
            // 使用Electron IPC發送錯誤到主進程進行保存
            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('save-error-log', errorInfo);
            }
        } catch (e) {
            console.error('無法保存錯誤到文件:', e);
        }
    }
    
    // 獲取所有錯誤日誌
    function getAllErrors() {
        return [...errorLogs];
    }
    
    // 清空錯誤日誌
    function clearErrors() {
        errorLogs.length = 0;
    }
    
    // 導出API
    return {
        init,
        captureError,
        captureInfo,
        getAllErrors,
        clearErrors
    };
})();

// 初始化錯誤日誌系統
document.addEventListener('DOMContentLoaded', function() {
    ErrorLogger.init();
}); 