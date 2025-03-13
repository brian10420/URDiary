/**
 * 系統日誌視圖模塊 - 顯示和管理應用程序日誌
 */
const LogsModule = (function() {
    // 私有變量
    let logsContainer = null;
    let logsTable = null;
    let logsData = [];
    let isInitialized = false;
    let logModal = null;
    
    // 過濾選項
    let filterOptions = {
        level: 'all',
        search: '',
        startDate: null,
        endDate: null,
        limit: 100,
        offset: 0
    };
    
    // 初始化模塊
    function init() {
        console.log('初始化系統日誌視圖');
        
        try {
            // 檢查是否已初始化
            if (isInitialized) {
                console.log('日誌模塊已經初始化，跳過');
                return true;
            }
            
            // 獲取DOM元素
            logsContainer = document.querySelector('#logs-view');
            
            if (!logsContainer) {
                console.error('找不到日誌視圖元素 (#logs-view)');
                return false;
            }
            
            // 創建日誌視圖結構
            createLogsView();
            
            // 綁定事件
            bindEvents();
            
            // 加載日誌
            loadLogs();
            
            // 標記為已初始化
            isInitialized = true;
            console.log('系統日誌視圖初始化完成');
            
            return true;
        } catch (error) {
            console.error('初始化系統日誌視圖時出錯:', error);
            if (typeof ErrorLogger !== 'undefined') {
                ErrorLogger.captureError(error, { type: 'ui', context: 'logs-init' });
            }
            return false;
        }
    }
    
    // 創建日誌視圖結構
    function createLogsView() {
        // 清空容器
        logsContainer.innerHTML = '';
        
        // 創建標題
        const header = document.createElement('div');
        header.className = 'logs-header';
        header.innerHTML = `
            <h2>系統日誌</h2>
            <div class="logs-actions">
                <button id="refresh-logs-btn" class="btn btn-primary">刷新</button>
                <button id="clear-logs-btn" class="btn btn-danger">清空日誌</button>
            </div>
        `;
        logsContainer.appendChild(header);
        
        // 創建過濾器
        const filterContainer = document.createElement('div');
        filterContainer.className = 'logs-filter';
        filterContainer.innerHTML = `
            <div class="filter-group">
                <label for="log-level-filter">日誌級別:</label>
                <select id="log-level-filter" class="form-control">
                    <option value="all">全部</option>
                    <option value="error">錯誤</option>
                    <option value="warn">警告</option>
                    <option value="info">信息</option>
                    <option value="debug">調試</option>
                </select>
            </div>
            <div class="filter-group">
                <label for="log-search">搜索:</label>
                <input type="text" id="log-search" class="form-control" placeholder="搜索日誌...">
            </div>
            <div class="filter-group">
                <label for="log-date-start">開始日期:</label>
                <input type="date" id="log-date-start" class="form-control">
            </div>
            <div class="filter-group">
                <label for="log-date-end">結束日期:</label>
                <input type="date" id="log-date-end" class="form-control">
            </div>
            <button id="apply-filter-btn" class="btn btn-primary">應用過濾</button>
        `;
        logsContainer.appendChild(filterContainer);
        
        // 創建日誌表格容器
        const tableContainer = document.createElement('div');
        tableContainer.className = 'logs-table-container';
        logsContainer.appendChild(tableContainer);
        
        // 創建日誌表格
        logsTable = document.createElement('table');
        logsTable.className = 'logs-table';
        logsTable.innerHTML = `
            <thead>
                <tr>
                    <th>時間</th>
                    <th>級別</th>
                    <th>來源</th>
                    <th>消息</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody id="logs-tbody"></tbody>
        `;
        tableContainer.appendChild(logsTable);
        
        // 創建分頁控件
        const pagination = document.createElement('div');
        pagination.className = 'logs-pagination';
        pagination.innerHTML = `
            <button id="prev-page-btn" class="btn btn-secondary">上一頁</button>
            <span id="page-info">第 1 頁</span>
            <button id="next-page-btn" class="btn btn-secondary">下一頁</button>
        `;
        logsContainer.appendChild(pagination);
        
        // 創建日誌詳情模態框
        logModal = document.createElement('div');
        logModal.className = 'modal';
        logModal.id = 'log-detail-modal';
        logModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>日誌詳情</h3>
                    <span class="close">&times;</span>
                </div>
                <div class="modal-body" id="log-detail-content">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary modal-close">關閉</button>
                </div>
            </div>
        `;
        document.body.appendChild(logModal);
    }
    
    // 綁定事件
    function bindEvents() {
        // 刷新按鈕
        const refreshBtn = document.getElementById('refresh-logs-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadLogs);
        }
        
        // 清空按鈕
        const clearBtn = document.getElementById('clear-logs-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearLogs);
        }
        
        // 過濾應用按鈕
        const applyFilterBtn = document.getElementById('apply-filter-btn');
        if (applyFilterBtn) {
            applyFilterBtn.addEventListener('click', applyFilter);
        }
        
        // 日誌級別過濾器
        const levelFilter = document.getElementById('log-level-filter');
        if (levelFilter) {
            levelFilter.addEventListener('change', function() {
                filterOptions.level = this.value;
            });
        }
        
        // 搜索框
        const searchInput = document.getElementById('log-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                filterOptions.search = this.value;
            });
            
            // 按Enter鍵應用過濾
            searchInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    applyFilter();
                }
            });
        }
        
        // 日期過濾器
        const startDateInput = document.getElementById('log-date-start');
        if (startDateInput) {
            startDateInput.addEventListener('change', function() {
                filterOptions.startDate = this.value ? new Date(this.value) : null;
            });
        }
        
        const endDateInput = document.getElementById('log-date-end');
        if (endDateInput) {
            endDateInput.addEventListener('change', function() {
                filterOptions.endDate = this.value ? new Date(this.value) : null;
            });
        }
        
        // 分頁按鈕
        const prevPageBtn = document.getElementById('prev-page-btn');
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', function() {
                if (filterOptions.offset >= filterOptions.limit) {
                    filterOptions.offset -= filterOptions.limit;
                    loadLogs();
                }
            });
        }
        
        const nextPageBtn = document.getElementById('next-page-btn');
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', function() {
                filterOptions.offset += filterOptions.limit;
                loadLogs();
            });
        }
        
        // 模態框關閉按鈕
        const modalCloseButtons = document.querySelectorAll('.modal .close, .modal .modal-close');
        modalCloseButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                logModal.style.display = 'none';
            });
        });
        
        // 點擊模態框外部關閉
        window.addEventListener('click', function(event) {
            if (event.target === logModal) {
                logModal.style.display = 'none';
            }
        });
    }
    
    // 應用過濾器
    function applyFilter() {
        filterOptions.offset = 0; // 重置分頁
        loadLogs();
    }
    
    // 加載日誌
    function loadLogs() {
        try {
            console.log('加載系統日誌', filterOptions);
            
            // 從本地存儲獲取日誌
            let logs = [];
            
            if (typeof ErrorLogger !== 'undefined' && ErrorLogger.getLogs) {
                logs = ErrorLogger.getLogs(filterOptions);
            } else {
                // 嘗試從localStorage獲取
                const logsStr = localStorage.getItem('urDiary_systemLogs');
                if (logsStr) {
                    try {
                        logs = JSON.parse(logsStr);
                    } catch (e) {
                        console.error('解析日誌數據出錯:', e);
                        logs = [];
                    }
                }
                
                // 應用過濾器
                if (logs.length > 0) {
                    // 過濾級別
                    if (filterOptions.level !== 'all') {
                        logs = logs.filter(log => log.level === filterOptions.level);
                    }
                    
                    // 過濾搜索詞
                    if (filterOptions.search) {
                        const searchTerm = filterOptions.search.toLowerCase();
                        logs = logs.filter(log => 
                            (log.message && log.message.toLowerCase().includes(searchTerm)) ||
                            (log.context && log.context.toLowerCase().includes(searchTerm)) ||
                            (log.details && JSON.stringify(log.details).toLowerCase().includes(searchTerm))
                        );
                    }
                    
                    // 過濾日期
                    if (filterOptions.startDate) {
                        logs = logs.filter(log => new Date(log.timestamp) >= filterOptions.startDate);
                    }
                    
                    if (filterOptions.endDate) {
                        logs = logs.filter(log => new Date(log.timestamp) <= filterOptions.endDate);
                    }
                    
                    // 排序 (最新的在前面)
                    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    
                    // 分頁
                    logs = logs.slice(filterOptions.offset, filterOptions.offset + filterOptions.limit);
                }
            }
            
            // 保存日誌數據
            logsData = logs;
            
            // 渲染日誌
            renderLogs();
            
            // 更新分頁信息
            updatePagination();
            
            return true;
        } catch (error) {
            console.error('加載日誌時出錯:', error);
            if (typeof ErrorLogger !== 'undefined') {
                ErrorLogger.captureError(error, { type: 'ui', context: 'load-logs' });
            }
            return false;
        }
    }
    
    // 渲染日誌
    function renderLogs() {
        const tbody = document.getElementById('logs-tbody');
        if (!tbody) {
            console.error('找不到日誌表格體');
            return;
        }
        
        // 清空表格
        tbody.innerHTML = '';
        
        // 檢查是否有日誌
        if (logsData.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `<td colspan="5" class="empty-message">沒有找到日誌記錄</td>`;
            tbody.appendChild(emptyRow);
            return;
        }
        
        // 添加日誌行
        logsData.forEach((log, index) => {
            const row = document.createElement('tr');
            row.className = `log-row log-level-${log.level || 'info'}`;
            row.dataset.logIndex = index;
            
            // 格式化時間
            const timestamp = log.timestamp ? new Date(log.timestamp) : new Date();
            const timeStr = formatTime(timestamp);
            
            // 格式化消息
            const message = log.message || '無消息';
            const shortMessage = message.length > 50 ? message.substring(0, 47) + '...' : message;
            
            row.innerHTML = `
                <td>${timeStr}</td>
                <td class="log-level">${log.level || 'info'}</td>
                <td>${log.context || '-'}</td>
                <td>${shortMessage}</td>
                <td>
                    <button class="btn btn-sm btn-info view-log-btn" data-index="${index}">查看</button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        // 綁定查看按鈕事件
        const viewButtons = tbody.querySelectorAll('.view-log-btn');
        viewButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                const index = parseInt(this.dataset.index);
                showLogDetail(index);
            });
        });
    }
    
    // 顯示日誌詳情
    function showLogDetail(index) {
        const log = logsData[index];
        if (!log) {
            console.error('找不到指定的日誌:', index);
            return;
        }
        
        // 格式化時間
        const timestamp = log.timestamp ? new Date(log.timestamp) : new Date();
        const timeStr = formatTime(timestamp, true);
        
        // 準備詳情內容
        let detailsHtml = '';
        if (log.details) {
            try {
                if (typeof log.details === 'string') {
                    detailsHtml = `<pre>${log.details}</pre>`;
                } else {
                    detailsHtml = `<pre>${JSON.stringify(log.details, null, 2)}</pre>`;
                }
            } catch (e) {
                detailsHtml = `<p>無法顯示詳情: ${e.message}</p>`;
            }
        }
        
        // 設置模態框內容
        const detailContent = document.getElementById('log-detail-content');
        if (detailContent) {
            detailContent.innerHTML = `
                <div class="log-detail">
                    <div class="log-detail-header">
                        <span class="log-level log-level-${log.level || 'info'}">${log.level || 'info'}</span>
                        <span class="log-timestamp">${timeStr}</span>
                    </div>
                    <div class="log-detail-context">
                        <strong>來源:</strong> ${log.context || '-'}
                    </div>
                    <div class="log-detail-message">
                        <strong>消息:</strong>
                        <p>${log.message || '無消息'}</p>
                    </div>
                    ${detailsHtml ? `
                    <div class="log-detail-details">
                        <strong>詳情:</strong>
                        ${detailsHtml}
                    </div>
                    ` : ''}
                </div>
            `;
        }
        
        // 顯示模態框
        logModal.style.display = 'block';
    }
    
    // 更新分頁信息
    function updatePagination() {
        const pageInfo = document.getElementById('page-info');
        if (pageInfo) {
            const currentPage = Math.floor(filterOptions.offset / filterOptions.limit) + 1;
            pageInfo.textContent = `第 ${currentPage} 頁`;
        }
        
        // 禁用/啟用上一頁按鈕
        const prevPageBtn = document.getElementById('prev-page-btn');
        if (prevPageBtn) {
            prevPageBtn.disabled = filterOptions.offset === 0;
        }
        
        // 禁用/啟用下一頁按鈕
        const nextPageBtn = document.getElementById('next-page-btn');
        if (nextPageBtn) {
            nextPageBtn.disabled = logsData.length < filterOptions.limit;
        }
    }
    
    // 清空日誌
    function clearLogs() {
        if (confirm('確定要清空所有系統日誌嗎？此操作不可撤銷。')) {
            try {
                if (typeof ErrorLogger !== 'undefined' && ErrorLogger.clearLogs) {
                    ErrorLogger.clearLogs();
                } else {
                    localStorage.removeItem('urDiary_systemLogs');
                }
                
                // 重新加載日誌
                loadLogs();
                
                console.log('系統日誌已清空');
            } catch (error) {
                console.error('清空日誌時出錯:', error);
                if (typeof ErrorLogger !== 'undefined') {
                    ErrorLogger.captureError(error, { type: 'ui', context: 'clear-logs' });
                }
            }
        }
    }
    
    // 格式化時間
    function formatTime(date, includeSeconds = false) {
        if (!date) return '-';
        
        try {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            
            if (includeSeconds) {
                const seconds = String(date.getSeconds()).padStart(2, '0');
                return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
            
            return `${year}-${month}-${day} ${hours}:${minutes}`;
        } catch (e) {
            console.error('格式化時間出錯:', e);
            return date.toString();
        }
    }
    
    // 返回公共API
    return {
        init: init,
        loadLogs: loadLogs,
        clearLogs: clearLogs
    };
})();

// 當DOM加載完成後初始化
document.addEventListener('DOMContentLoaded', function() {
    LogsModule.init();
}); 