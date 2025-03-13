/**
 * 日誌模塊 - 處理系統日誌記錄
 */
const Logger = (function() {
    // 私有變量
    let logs = [];
    let maxLogs = 1000;
    let logLevel = 'info'; // debug, info, warn, error
    
    // 日誌級別權重
    const LOG_LEVELS = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3
    };
    
    // DOM元素
    let logsContainer = null;
    
    // 初始化
    function init() {
        console.log('初始化日誌模塊');
        
        // 載入設置
        const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USER_SETTINGS) || '{}');
        logLevel = settings.logLevel || logLevel;
        maxLogs = settings.maxLogEntries || maxLogs;
        
        // 載入日誌
        loadLogs();
        
        // 找到日誌容器
        logsContainer = document.querySelector('.logs-container');
        
        // 綁定清除日誌按鈕
        const clearLogsBtn = document.querySelector('#clear-logs-btn');
        if (clearLogsBtn) {
            clearLogsBtn.addEventListener('click', clearLogs);
        }
        
        // 綁定導出日誌按鈕
        const exportLogsBtn = document.querySelector('#export-logs-btn');
        if (exportLogsBtn) {
            exportLogsBtn.addEventListener('click', exportLogs);
        }
        
        // 綁定日誌級別選擇器
        const logLevelSelect = document.querySelector('#log-level-select');
        if (logLevelSelect) {
            logLevelSelect.value = logLevel;
            logLevelSelect.addEventListener('change', function() {
                setLogLevel(this.value);
                renderLogs();
            });
        }
    }
    
    // 載入日誌
    function loadLogs() {
        try {
            const saved = localStorage.getItem('urdiary_system_logs');
            if (saved) {
                logs = JSON.parse(saved);
            }
        } catch (error) {
            console.error('載入日誌失敗:', error);
            logs = [];
        }
    }
    
    // 保存日誌
    function saveLogs() {
        try {
            localStorage.setItem('urdiary_system_logs', JSON.stringify(logs));
        } catch (error) {
            console.error('保存日誌失敗:', error);
            
            // 如果是存儲空間問題，刪除最舊的日誌
            if (error.name === 'QuotaExceededError') {
                logs = logs.slice(-maxLogs / 2); // 刪除一半的舊日誌
                try {
                    localStorage.setItem('urdiary_system_logs', JSON.stringify(logs));
                } catch (e) {
                    console.error('保存日誌失敗，即使刪除了一半:', e);
                }
            }
        }
    }
    
    // 添加日誌
    function addLog(level, message, data = null) {
        if (LOG_LEVELS[level] < LOG_LEVELS[logLevel]) {
            return; // 低於當前日誌級別，不記錄
        }
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
            data: data
        };
        
        logs.push(logEntry);
        
        // 限制日誌數量
        if (logs.length > maxLogs) {
            logs.shift(); // 刪除最舊的日誌
        }
        
        // 保存日誌
        saveLogs();
        
        // 如果日誌容器存在，且當前在日誌視圖，渲染日誌
        if (logsContainer && isLogsViewActive()) {
            appendLogToUI(logEntry);
        }
        
        // 同時輸出到控制台
        outputToConsole(level, message, data);
    }
    
    // 檢查日誌視圖是否活動
    function isLogsViewActive() {
        const logsView = document.querySelector('#logs-view');
        return logsView && window.getComputedStyle(logsView).display !== 'none';
    }
    
    // 輸出到控制台
    function outputToConsole(level, message, data) {
        const consoleMethod = {
            debug: 'debug',
            info: 'info',
            warn: 'warn',
            error: 'error'
        }[level] || 'log';
        
        if (data) {
            console[consoleMethod](message, data);
        } else {
            console[consoleMethod](message);
        }
    }
    
    // 渲染日誌
    function renderLogs() {
        if (!logsContainer) return;
        
        // 清空容器
        logsContainer.innerHTML = '';
        
        // 篩選日誌
        const filteredLogs = logs.filter(log => 
            LOG_LEVELS[log.level] >= LOG_LEVELS[logLevel]
        );
        
        // 顯示日誌計數
        const logCountElement = document.querySelector('.log-count');
        if (logCountElement) {
            logCountElement.textContent = `顯示 ${filteredLogs.length} / ${logs.length} 條日誌`;
        }
        
        // 如果沒有日誌，顯示空狀態
        if (filteredLogs.length === 0) {
            logsContainer.innerHTML = '<div class="empty-logs">沒有符合條件的日誌</div>';
            return;
        }
        
        // 添加所有日誌
        filteredLogs.forEach(log => appendLogToUI(log));
    }
    
    // 向UI添加單條日誌
    function appendLogToUI(log) {
        if (!logsContainer) return;
        
        const logElement = document.createElement('div');
        logElement.className = `log-entry log-${log.level}`;
        
        // 格式化時間
        const date = new Date(log.timestamp);
        const formattedTime = date.toLocaleTimeString();
        
        // 創建日誌內容
        logElement.innerHTML = `
            <div class="log-time">${formattedTime}</div>
            <div class="log-level">${log.level.toUpperCase()}</div>
            <div class="log-message">${escapeHtml(log.message)}</div>
            ${log.data ? `<div class="log-data">${formatLogData(log.data)}</div>` : ''}
        `;
        
        // 添加到容器
        logsContainer.appendChild(logElement);
        
        // 滾動到底部
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }
    
    // 格式化日誌數據
    function formatLogData(data) {
        try {
            if (typeof data === 'object') {
                return `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
            }
            return escapeHtml(String(data));
        } catch (error) {
            return `<span class="error">無法格式化數據: ${error.message}</span>`;
        }
    }
    
    // HTML轉義
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 清除日誌
    function clearLogs() {
        if (confirm('確定要清除所有日誌嗎？')) {
            logs = [];
            saveLogs();
            renderLogs();
            UIManager.showToast('日誌已清除');
        }
    }
    
    // 導出日誌
    function exportLogs() {
        try {
            const logsJson = JSON.stringify(logs, null, 2);
            const blob = new Blob([logsJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const date = new Date();
            const filename = `urdiary_logs_${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}.json`;
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            UIManager.showToast('日誌已導出');
        } catch (error) {
            console.error('導出日誌失敗:', error);
            UIManager.showToast('導出日誌失敗: ' + error.message);
        }
    }
    
    // 設置日誌級別
    function setLogLevel(level) {
        if (LOG_LEVELS[level] !== undefined) {
            logLevel = level;
            
            // 更新設置
            const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USER_SETTINGS) || '{}');
            settings.logLevel = logLevel;
            localStorage.setItem(CONFIG.STORAGE.USER_SETTINGS, JSON.stringify(settings));
            
            // 更新選擇器
            const logLevelSelect = document.querySelector('#log-level-select');
            if (logLevelSelect) {
                logLevelSelect.value = logLevel;
            }
            
            return true;
        }
        return false;
    }
    
    // 返回公共API
    return {
        init: init,
        debug: function(message, data) { addLog('debug', message, data); },
        info: function(message, data) { addLog('info', message, data); },
        warn: function(message, data) { addLog('warn', message, data); },
        error: function(message, data) { addLog('error', message, data); },
        renderLogs: renderLogs,
        clearLogs: clearLogs,
        exportLogs: exportLogs,
        setLogLevel: setLogLevel
    };
})(); 