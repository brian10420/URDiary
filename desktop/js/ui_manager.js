/**
 * UI管理器 - 處理界面元素和交互
 */
const UIManager = (function() {
    // 視圖枚舉 - 只保留聊天和日記
    const VIEWS = {
        CHAT: 'chat',
        DIARY: 'diary'
    };
    
    // DOM元素引用 - 移除不需要的引用
    const elements = {
        navItems: document.querySelectorAll('.nav-item'),
        viewContainers: document.querySelectorAll('.view-container'),
        chatContainer: document.querySelector('#chat-view'),
        diaryContainer: document.querySelector('#diary-view'),
        spinner: document.querySelector('.loading-spinner'),
        errorContainer: document.querySelector('#error-container'),
        themeToggleBtn: document.querySelector('#theme-toggle'),
        debugBtn: document.querySelector('#debug-btn')
    };
    
    // 當前活躍視圖
    let currentView = VIEWS.CHAT;
    
    // 初始化UI管理器
    function init() {
        console.log('初始化UI管理器');
        
        // 重新獲取DOM元素，避免初始化過早
        refreshDOMElements();
        
        // 設置默認視圖
        switchView(VIEWS.CHAT);
        
        // 綁定導航事件
        if (elements.navItems && elements.navItems.length > 0) {
            elements.navItems.forEach(item => {
                item.addEventListener('click', function() {
                    const view = this.getAttribute('data-view');
                    if (view) {
                        console.log(`點擊導航項: ${view}`);
                        switchView(view);
                    }
                });
            });
            console.log(`已綁定 ${elements.navItems.length} 個導航項目`);
        } else {
            console.warn('未找到導航項目，無法綁定事件');
        }
        
        // 添加色彩主題切換功能
        initializeThemeToggle();
        
        // 初始化Debug按鈕
        initializeDebugButton();
        
        // 應用初始主題
        applyTheme(getCurrentTheme());
        
        console.log('UI管理器初始化完成');
    }
    
    // 刷新DOM元素引用
    function refreshDOMElements() {
        elements.navItems = document.querySelectorAll('.nav-item');
        elements.viewContainers = document.querySelectorAll('.view-container');
        elements.chatContainer = document.querySelector('#chat-view');
        elements.diaryContainer = document.querySelector('#diary-view');
        elements.spinner = document.querySelector('.loading-spinner');
        elements.errorContainer = document.querySelector('#error-container');
        elements.themeToggleBtn = document.querySelector('#theme-toggle');
        elements.debugBtn = document.querySelector('#debug-btn');
        
        console.log('DOM元素引用已刷新:', {
            'navItems': elements.navItems ? elements.navItems.length : 0,
            'viewContainers': elements.viewContainers ? elements.viewContainers.length : 0,
            'chatContainer': !!elements.chatContainer,
            'diaryContainer': !!elements.diaryContainer,
            'spinner': !!elements.spinner,
            'errorContainer': !!elements.errorContainer,
            'themeToggleBtn': !!elements.themeToggleBtn,
            'debugBtn': !!elements.debugBtn
        });
    }
    
    // 初始化主題切換功能
    function initializeThemeToggle() {
        const themeToggleBtn = document.querySelector('#theme-toggle');
        if (themeToggleBtn) {
            console.log('找到主題切換按鈕，開始綁定事件');
            
            // 設置初始主題
            const currentTheme = getCurrentTheme();
            console.log('初始主題:', currentTheme);
            
            // 應用主題
            applyTheme(currentTheme);
            
            // 更新按鈕圖標
            updateThemeToggleIcon(currentTheme);
            
            // 移除舊事件（如果有）
            themeToggleBtn.removeEventListener('click', handleThemeToggle);
            
            // 綁定點擊事件
            themeToggleBtn.addEventListener('click', handleThemeToggle);
            console.log('主題切換按鈕事件已綁定');
            
            // 測試事件是否綁定成功
            themeToggleBtn.setAttribute('data-initialized', 'true');
        } else {
            console.warn('未找到主題切換按鈕，無法初始化主題切換功能');
        }
    }
    
    // 初始化Debug按鈕
    function initializeDebugButton() {
        const debugBtn = document.querySelector('#debug-btn');
        if (debugBtn) {
            console.log('找到Debug按鈕，開始綁定事件');
            
            // 移除舊事件（如果有）
            debugBtn.removeEventListener('click', handleDebugButtonClick);
            
            // 綁定點擊事件
            debugBtn.addEventListener('click', handleDebugButtonClick);
            console.log('Debug按鈕事件已綁定');
            
            // 測試事件是否綁定成功
            debugBtn.setAttribute('data-initialized', 'true');
        } else {
            console.warn('未找到Debug按鈕，無法初始化Debug功能');
        }
    }
    
    // 處理Debug按鈕點擊
    function handleDebugButtonClick() {
        console.log('Debug按鈕被點擊');
        
        try {
            if (window.require) {
                const electron = window.require('electron');
                console.log('electron對象獲取成功');
                
                // 首先嘗試使用ipcRenderer
                if (electron.ipcRenderer) {
                    console.log('使用ipcRenderer發送打開開發者工具請求');
                    electron.ipcRenderer.send('open-dev-tools');
                    return;
                }
                
                // 在新版Electron中，remote模塊被移除，使用@electron/remote模塊
                try {
                    const remote = window.require('@electron/remote');
                    if (remote) {
                        console.log('使用@electron/remote模塊打開開發者工具');
                        remote.getCurrentWindow().webContents.openDevTools();
                        return;
                    }
                } catch (remoteError) {
                    console.warn('加載@electron/remote模塊失敗:', remoteError);
                }
                
                console.warn('無法找到合適的方法打開開發者工具，嘗試快捷鍵');
                tryKeyboardShortcut();
            } else {
                console.warn('window.require未定義，可能在瀏覽器中運行');
                tryKeyboardShortcut();
            }
        } catch (error) {
            console.error('打開開發者工具時出錯:', error);
            alert('開發者工具無法通過按鈕打開，請嘗試使用快捷鍵 Ctrl+Shift+I 或 F12');
            tryKeyboardShortcut();
        }
    }
    
    // 嘗試使用鍵盤快捷鍵打開開發者工具
    function tryKeyboardShortcut() {
        try {
            // 模擬按下F12鍵
            const event = new KeyboardEvent('keydown', {
                key: 'F12',
                code: 'F12',
                keyCode: 123,
                which: 123,
                bubbles: true,
                cancelable: true
            });
            document.dispatchEvent(event);
            console.log('已嘗試通過F12快捷鍵打開開發者工具');
        } catch (err) {
            console.error('模擬鍵盤事件失敗:', err);
        }
    }
    
    // 處理主題切換點擊
    function handleThemeToggle() {
        try {
            console.log('主題切換按鈕被點擊');
            
            const currentTheme = getCurrentTheme();
            console.log('當前主題:', currentTheme);
            
            // 切換主題 - 明確比較字符串值
            let newTheme;
            if (currentTheme === 'dark') {
                newTheme = 'light';
            } else {
                newTheme = 'dark';
            }
            console.log('切換到新主題:', newTheme);
            
            // 先更新DOM，再保存設置，這樣可以確保用戶看到即時變化
            // 設置根元素屬性
            document.documentElement.setAttribute('data-theme', newTheme);
            
            // 更新body類
            document.body.classList.remove('theme-light', 'theme-dark');
            document.body.classList.add(`theme-${newTheme}`);
            
            // 保存到本地存儲
            try {
                const storageKey = CONFIG && CONFIG.STORAGE && CONFIG.STORAGE.THEME ? 
                    CONFIG.STORAGE.THEME : 'urdiary_theme';
                localStorage.setItem(storageKey, newTheme);
                console.log('主題已保存到本地存儲');
            } catch (error) {
                console.error('保存主題失敗:', error);
            }
            
            // 更新按鈕圖標
            updateThemeToggleIcon(newTheme);
            
            // 觸發主題變更事件
            document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: newTheme } }));
            
            // 記錄日誌
            if (window.Logger) {
                Logger.info(`主題已切換為: ${newTheme}`);
            }
            
            // 重新應用CSS變量
            applyThemeCSSVariables(newTheme);
            
            console.log(`主題成功切換為: ${newTheme}`);
        } catch (error) {
            console.error('主題切換出錯:', error);
            if (window.UIManager && UIManager.showToast) {
                UIManager.showToast('主題切換失敗: ' + error.message);
            }
        }
    }
    
    // 應用主題CSS變量
    function applyThemeCSSVariables(theme) {
        const root = document.documentElement;
        
        // 確保主題值有效
        if (theme !== 'light' && theme !== 'dark') {
            console.warn(`無效的主題值: ${theme}，使用默認值 'light'`);
            theme = 'light';
        }
        
        // 應用所有基於主題的CSS變量
        if (theme === 'dark') {
            // 夜間模式變量
            root.style.setProperty('--background-color', '#121212');
            root.style.setProperty('--card-background', '#1e1e1e');
            root.style.setProperty('--text-color', '#e0e0e0');
            root.style.setProperty('--text-secondary', '#a0a0a0');
            root.style.setProperty('--border-color', '#333333');
        } else {
            // 日間模式變量
            root.style.setProperty('--background-color', '#f5f5f5');
            root.style.setProperty('--card-background', '#ffffff');
            root.style.setProperty('--text-color', '#333333');
            root.style.setProperty('--text-secondary', '#666666');
            root.style.setProperty('--border-color', '#e0e0e0');
        }
        
        console.log(`已應用${theme}模式的CSS變量`);
    }
    
    // 獲取當前主題
    function getCurrentTheme() {
        // 從DOM獲取當前激活的主題
        const dataTheme = document.documentElement.getAttribute('data-theme');
        if (dataTheme && (dataTheme === 'light' || dataTheme === 'dark')) {
            console.log('從DOM獲取主題:', dataTheme);
            return dataTheme;
        }
        
        // 從本地存儲獲取
        const savedTheme = localStorage.getItem(CONFIG.STORAGE.THEME);
        if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
            console.log('從本地存儲獲取主題:', savedTheme);
            return savedTheme;
        }
        
        // 檢查系統偏好
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            console.log('使用系統深色偏好');
            return 'dark';
        }
        
        // 默認為亮色主題
        console.log('使用默認亮色主題');
        return 'light';
    }
    
    // 應用主題
    function applyTheme(theme) {
        try {
            if (!theme || (theme !== 'light' && theme !== 'dark')) {
                console.error('無效的主題值:', theme);
                theme = 'light';
            }
            
            console.log('正在應用主題:', theme);
            
            // 設置根元素屬性
            document.documentElement.setAttribute('data-theme', theme);
            
            // 更新body類
            document.body.classList.remove('theme-light', 'theme-dark');
            document.body.classList.add(`theme-${theme}`);
            
            // 應用CSS變量
            applyThemeCSSVariables(theme);
            
            console.log(`主題已設置為: ${theme}`);
        } catch (error) {
            console.error('應用主題時出錯:', error);
        }
    }
    
    // 更新主題切換按鈕圖標
    function updateThemeToggleIcon(theme) {
        try {
            const themeToggleBtn = document.querySelector('#theme-toggle');
            if (!themeToggleBtn) {
                console.warn('找不到主題切換按鈕');
                return;
            }
            
            // 清空按鈕內容
            themeToggleBtn.innerHTML = '';
            
            // 設置新圖標和提示文字
            if (theme === 'dark') {
                // 在深色模式時顯示太陽圖標，表示可以切換到亮色模式
                themeToggleBtn.innerHTML = '<i class="fa fa-sun"></i>';
                themeToggleBtn.title = '切換到亮色模式';
                console.log('已設置深色模式圖標 (太陽)');
            } else {
                // 在亮色模式時顯示月亮圖標，表示可以切換到深色模式
                themeToggleBtn.innerHTML = '<i class="fa fa-moon"></i>';
                themeToggleBtn.title = '切換到深色模式';
                console.log('已設置亮色模式圖標 (月亮)');
            }
        } catch (error) {
            console.error('更新主題圖標時出錯:', error);
        }
    }
    
    // 切換視圖
    function switchView(viewName) {
        // 驗證視圖名稱
        if (!VIEWS[viewName.toUpperCase()]) {
            console.error('無效的視圖名稱:', viewName);
            return;
        }
        
        // 更新當前視圖
        currentView = viewName;
        
        // 處理導航項目
        if (elements.navItems) {
            elements.navItems.forEach(item => {
                const itemView = item.getAttribute('data-view');
                if (itemView === viewName) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }
        
        // 處理視圖容器
        if (elements.viewContainers) {
            elements.viewContainers.forEach(container => {
                const containerId = container.id;
                const containerViewName = containerId.replace('-view', '');
                
                if (containerViewName === viewName) {
                    container.classList.add('active');
                    // 觸發視圖變更事件
                    document.dispatchEvent(new CustomEvent('viewChanged', { 
                        detail: { oldView: currentView, newView: viewName } 
                    }));
                } else {
                    container.classList.remove('active');
                }
            });
        }
        
        // 記錄視圖切換
        console.log(`視圖已切換到: ${viewName}`);
    }
    
    // 顯示加載動畫
    function showSpinner() {
        if (elements.spinner) {
            elements.spinner.style.display = 'flex';
        }
    }
    
    // 隱藏加載動畫
    function hideSpinner() {
        if (elements.spinner) {
            elements.spinner.style.display = 'none';
        }
    }
    
    // 顯示提示消息
    function showToast(message, duration = 3000) {
        // 移除現有的提示
        const existingToast = document.querySelector('.toast-message');
        if (existingToast) {
            existingToast.remove();
        }
        
        // 創建新的提示元素
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        
        // 添加到文檔
        document.body.appendChild(toast);
        
        // 顯示提示
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // 設置自動隱藏
        setTimeout(() => {
            toast.classList.remove('show');
            
            // 動畫結束後移除元素
            toast.addEventListener('transitionend', function() {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            });
        }, duration);
    }
    
    // 顯示錯誤訊息
    function showError(title, message, detail = null) {
        if (elements.errorContainer) {
            const errorTitle = elements.errorContainer.querySelector('.error-header h3');
            const errorContent = document.getElementById('error-content');
            
            if (errorTitle && errorContent) {
                errorTitle.textContent = title || '錯誤';
                
                let contentHtml = `<p>${message || '發生未知錯誤'}</p>`;
                if (detail) {
                    contentHtml += `<div class="error-detail"><pre>${detail}</pre></div>`;
                }
                
                errorContent.innerHTML = contentHtml;
                elements.errorContainer.style.display = 'block';
            }
        } else {
            console.error('錯誤容器不存在，無法顯示錯誤:', message);
            alert(`錯誤: ${message}`);
        }
    }
    
    // 提供公共方法
    return {
        init,
        switchView,
        getCurrentTheme,
        applyTheme,
        toggleTheme: handleThemeToggle,
        showSpinner,
        hideSpinner,
        showToast,
        showError
    };
})();

// 確保在窗口加載時初始化
if (document.readyState === 'complete') {
    UIManager.init();
} else {
    window.addEventListener('load', function() {
        UIManager.init();
    });
}