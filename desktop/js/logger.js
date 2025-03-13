/**
 * 系統日誌模塊 - 處理日誌記錄和存儲
 */
const Logger = (function() {
    // 私有變量
    let logs = [];
    let isInitialized = false;
    
    // 日誌級別
    const LOG_LEVELS = {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    };
    
    // 初始化
    function init() {
        console.log('初始化日誌系統');
        
        if (isInitialized) {
            console.log('日誌系統已經初始化');
            return;
        }
        
        try {
            // 從本地存儲加載日誌
            loadLogs();
            
            // 設置全局錯誤處理
            setupGlobalErrorHandling();
            
            isInitialized = true;
            console.log('日誌系統初始化完成');
            info('日誌系統初始化完成');
        } catch (error) {
            console.error('初始化日誌系統失敗:', error);
        }
    }
    
    // 從本地存儲加載日誌
    function loadLogs() {
        try {
            const storedLogs = localStorage.getItem(CONFIG.STORAGE.LOGS);
            if (storedLogs) {
                logs = JSON.parse(storedLogs);
                console.log(`已加載${logs.length}條日誌記錄`);
            }
        } catch (error) {
            console.error('加載日誌記錄失敗:', error);
            logs = [];
        }
    }
    
    // 保存日誌到本地存儲
    function saveLogs() {
        try {
            // 限制日誌數量
            if (logs.length > CONFIG.APP.MAX_LOGS) {
                logs = logs.slice(-CONFIG.APP.MAX_LOGS);
            }
            
            localStorage.setItem(CONFIG.STORAGE.LOGS, JSON.stringify(logs));
            console.log(`已保存${logs.length}條日誌記錄`);
        } catch (error) {
            console.error('保存日誌記錄失敗:', error);
        }
    }
    
    // 添加日誌
    function addLog(level, message, data = null) {
        const logEntry = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
            data: data
        };
        
        logs.unshift(logEntry);
        saveLogs();
        
        // 觸發日誌更新事件
        window.dispatchEvent(new CustomEvent('logsUpdated', {
            detail: { log: logEntry }
        }));
        
        return logEntry;
    }
    
    // 設置全局錯誤處理
    function setupGlobalErrorHandling() {
        window.onerror = function(message, source, lineno, colno, error) {
            error('全局錯誤', {
                message: message,
                source: source,
                lineno: lineno,
                colno: colno,
                stack: error ? error.stack : null
            });
            return false;
        };
        
        window.onunhandledrejection = function(event) {
            error('未處理的Promise拒絕', {
                message: event.reason.message || String(event.reason),
                stack: event.reason.stack
            });
        };
    }
    
    // 生成唯一ID
    function generateId() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    
    // 日誌方法
    function debug(message, data = null) {
        return addLog(LOG_LEVELS.DEBUG, message, data);
    }
    
    function info(message, data = null) {
        return addLog(LOG_LEVELS.INFO, message, data);
    }
    
    function warn(message, data = null) {
        return addLog(LOG_LEVELS.WARN, message, data);
    }
    
    function error(message, data = null) {
        return addLog(LOG_LEVELS.ERROR, message, data);
    }
    
    // 過濾日誌
    function filterLogs(options = {}) {
        let filtered = [...logs];
        
        // 按級別過濾
        if (options.level && options.level !== 'all') {
            filtered = filtered.filter(log => log.level === options.level);
        }
        
        // 按搜索詞過濾
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            filtered = filtered.filter(log => 
                log.message.toLowerCase().includes(searchLower) ||
                (log.data && JSON.stringify(log.data).toLowerCase().includes(searchLower))
            );
        }
        
        // 按日期範圍過濾
        if (options.startDate) {
            filtered = filtered.filter(log => new Date(log.timestamp) >= new Date(options.startDate));
        }
        if (options.endDate) {
            filtered = filtered.filter(log => new Date(log.timestamp) <= new Date(options.endDate));
        }
        
        // 計算總數
        const total = filtered.length;
        
        // 分頁
        if (options.limit) {
            const start = options.offset || 0;
            filtered = filtered.slice(start, start + options.limit);
        }
        
        return {
            logs: filtered,
            total: total
        };
    }
    
    // 清空日誌
    function clearLogs() {
        logs = [];
        saveLogs();
        
        // 觸發日誌更新事件
        window.dispatchEvent(new CustomEvent('logsUpdated', {
            detail: { cleared: true }
        }));
    }
    
    // 獲取所有日誌
    function getAllLogs() {
        return [...logs];
    }
    
    // 導出公共API
    return {
        init,
        debug,
        info,
        warn,
        error,
        filterLogs,
        getAllLogs,
        clearLogs,
        LOG_LEVELS
    };
})();

// 當DOM加載完成後初始化
document.addEventListener('DOMContentLoaded', function() {
    Logger.init();
}); 