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
        
        // 捕獲全局錯誤 —— 與下方 unhandledrejection 監聽，是本應用唯一的未捕捉錯誤捕捉路徑
        // (ErrorHandler 的重複 window 'error' 監聽、main.js 的 window.onerror 已移除)
        window.addEventListener('error', function(event) {
            const errorInfo = captureError(event.error || new Error(event.message), {
                type: 'global',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });

            displayErrorInConsole(errorInfo);
            saveErrorToFile(errorInfo);
            notifyUser(errorInfo);
        });

        // 捕獲未處理的Promise錯誤
        window.addEventListener('unhandledrejection', function(event) {
            const errorInfo = captureError(event.reason || new Error('Promise拒絕'), {
                type: 'promise'
            });

            displayErrorInConsole(errorInfo);
            saveErrorToFile(errorInfo);
            notifyUser(errorInfo);
        });

        console.log('錯誤日誌系統已啟動');
    }

    // 未捕捉錯誤的使用者提示（UIManager 可用時顯示一行 toast；ErrorHandler 移除後這是唯一的提示路徑）
    function notifyUser(errorInfo) {
        if (typeof UIManager !== 'undefined' && UIManager.showToast) {
            UIManager.showToast(errorInfo.message);
        }
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
            // 使用Electron IPC發送錯誤到主進程進行保存（feature-guard 比照 secure_store.js：
            // window.electron 從未存在過，正確的沙箱外露出口是 window.require('electron')）
            if (window.require) {
                window.require('electron').ipcRenderer.send('save-error-log', errorInfo);
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