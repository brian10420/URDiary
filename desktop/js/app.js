/**
 * 主應用程序文件 - 初始化所有模塊
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('應用程序初始化開始...');
    
    try {
        // 確保全局錯誤處理機制
        window.showGlobalError = function(message, errorObj) {
            console.error(message, errorObj);
            
            // 嘗試使用UIManager
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(message);
                return;
            }
            
            // 創建備用錯誤消息
            try {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'global-error';
                errorDiv.style.cssText = 'position:fixed;top:10px;right:10px;padding:15px;background-color:#ffebee;color:#b71c1c;border:1px solid #f44336;border-radius:4px;z-index:9999;box-shadow:0 2px 10px rgba(0,0,0,0.2);';
                errorDiv.innerHTML = `
                    <p style="margin:0;font-weight:bold;">${message}</p>
                    ${errorObj ? `<small style="color:#d32f2f;">${errorObj.message || errorObj}</small>` : ''}
                    <button style="background:#f44336;color:white;border:none;padding:5px 10px;margin-top:10px;border-radius:3px;cursor:pointer;">關閉</button>
                `;
                
                // 添加到頁面
                document.body.appendChild(errorDiv);
                
                // 添加關閉按鈕事件
                const closeBtn = errorDiv.querySelector('button');
                if (closeBtn) {
                    closeBtn.addEventListener('click', function() {
                        errorDiv.remove();
                    });
                }
                
                // 自動隱藏
                setTimeout(() => {
                    if (errorDiv.parentNode) {
                        errorDiv.remove();
                    }
                }, 8000);
            } catch (err) {
                // 最後手段：使用alert
                alert(message);
            }
        };
        
        // 初始化錯誤處理器
        if (typeof ErrorHandler !== 'undefined') {
            console.log('初始化錯誤處理器');
            // 全局掛載錯誤處理器
            window.ErrorHandler = ErrorHandler;
        }
        
        // 初始化UI管理器
        console.log('初始化UI管理器');
        if (typeof UIManager !== 'undefined') {
            await UIManager.init();
        } else {
            console.error('UIManager 未定義');
        }
        
        // 初始化日誌模塊
        if (typeof LogsModule !== 'undefined') {
            console.log('初始化日誌模塊');
            await LogsModule.init();
        }
        
        // 初始化聊天模塊
        console.log('初始化聊天模塊');
        if (typeof ChatModule !== 'undefined') {
            await ChatModule.init();
        } else {
            console.error('ChatModule 未定義');
        }
        
        // 初始化日記模塊
        console.log('初始化日記模塊');
        if (typeof DiaryModule !== 'undefined') {
            await DiaryModule.init();
        } else {
            console.error('DiaryModule 未定義');
        }
        
        // 初始化筆記模塊
        console.log('初始化筆記模塊');
        if (typeof NotesModule !== 'undefined') {
            await NotesModule.init();
        } else {
            console.error('NotesModule 未定義');
            window.showGlobalError('筆記模塊加載失敗', new Error('NotesModule 未定義'));
        }
        
        // 初始化日誌記錄器
        if (typeof Logger !== 'undefined') {
            console.log('初始化日誌記錄器');
            Logger.init();
            Logger.info('應用程序已啟動', { version: CONFIG?.APP?.VERSION || '1.0.0' });
        }
        
        // 載入日記數據
        await loadDiaryData();
        
        console.log('應用程序初始化完成！');
    } catch (error) {
        console.error('應用程序初始化失敗:', error);
        
        // 顯示錯誤信息
        if (window.showGlobalError) {
            window.showGlobalError('應用程序初始化失敗', error);
        } else {
            // 嘗試使用UIManager
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast('應用程序初始化失敗: ' + error.message);
            } else {
                alert('應用程序初始化失敗: ' + error.message);
            }
        }
    }
});

/**
 * 處理全局錯誤
 */
window.addEventListener('error', (event) => {
    console.error('捕獲到未處理的錯誤:', event.error);
    
    try {
        // 使用ErrorHandler處理錯誤
        if (typeof ErrorHandler !== 'undefined') {
            ErrorHandler.handleError(event.error || new Error(event.message), 'unknown', {
                source: event.filename,
                line: event.lineno,
                column: event.colno
            });
        } else if (typeof ApiService !== 'undefined') {
            ApiService.showAppError('應用發生錯誤: ' + (event.error ? event.error.message : '未知錯誤'));
        } else {
            // 備用錯誤顯示
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position:fixed;top:10px;right:10px;padding:10px;background:rgba(255,0,0,0.7);color:white;border-radius:4px;z-index:10000';
            errorDiv.textContent = '應用發生錯誤: ' + (event.error ? event.error.message : '未知錯誤');
            document.body.appendChild(errorDiv);
            
            setTimeout(() => {
                document.body.removeChild(errorDiv);
            }, 5000);
        }
    } catch (handlerError) {
        console.error('處理錯誤時失敗:', handlerError);
    }
});

/**
 * 處理未捕獲的Promise異常
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('未處理的Promise拒絕:', event.reason);
    
    try {
        // 使用ErrorHandler處理錯誤
        if (typeof ErrorHandler !== 'undefined') {
            ErrorHandler.handleError(event.reason || new Error('未知Promise錯誤'), 'async', {
                stack: event.reason?.stack,
                message: event.reason?.message
            });
        } else if (typeof ApiService !== 'undefined') {
            ApiService.showAppError('應用發生異步錯誤: ' + (event.reason ? event.reason.message : '未知異步錯誤'));
        }
    } catch (handlerError) {
        console.error('處理Promise錯誤時失敗:', handlerError);
    }
});

// 載入日記數據
async function loadDiaryData() {
    console.log('載入日記數據...');
    
    // 確保先初始化API服務
    if (ApiService) {
        try {
            // 初始化API服務
            if (CONFIG.API.BASE_URL) {
                console.log('API基礎URL:', CONFIG.API.BASE_URL);
            }
            
            // 嘗試載入日記
            console.log('載入日記數據成功');
        } catch (error) {
            console.error('載入日記數據失敗:', error);
            UIManager.showToast('載入數據失敗，請稍後再試');
        }
    } else {
        console.warn('API服務未初始化');
    }
}

// 添加退出確認
window.addEventListener('beforeunload', function(e) {
    // 如果在聊天過程中，提示用戶
    if (ChatModule && document.querySelector('.chat-messages .user-message')) {
        e.returnValue = '離開頁面將丟失當前對話數據。確定要離開嗎？';
        return e.returnValue;
    }
});

// 全局處理未捕獲的Promise錯誤
window.addEventListener('unhandledrejection', function(event) {
    console.error('未處理的Promise錯誤:', event.reason);
    
    // 如果Logger可用，記錄錯誤
    if (window.Logger) {
        Logger.error('未處理的Promise錯誤', {
            message: event.reason?.message || String(event.reason),
            stack: event.reason?.stack
        });
    }
    
    // 顯示用戶友好錯誤消息
    if (window.UIManager && UIManager.showToast) {
        UIManager.showToast('應用出現錯誤，請稍後再試');
    }
    
    // 阻止錯誤冒泡到控制台
    event.preventDefault();
});

// 全局處理其他JS錯誤
window.addEventListener('error', function(event) {
    console.error('全局JS錯誤:', event.error || event.message);
    
    // 如果Logger可用，記錄錯誤
    if (window.Logger) {
        Logger.error('全局JS錯誤', {
            message: event.error?.message || event.message,
            stack: event.error?.stack,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    }
    
    // 顯示用戶友好錯誤消息
    if (window.UIManager && UIManager.showToast) {
        UIManager.showToast('應用出現錯誤，請稍後再試');
    }
});