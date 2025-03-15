// 初始化應用程序
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM已加載，初始化應用程序...');
    
    // 初始化UI管理器
    UIManager.init();
    
    // 初始化API服務
    ApiService.init();
    
    // 初始化模塊 - 僅保留聊天和日記模塊
    ChatModule.init();
    DiaryModule.init();
    
    // 為視圖切換按鈕添加事件監聽器
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const view = this.dataset.view;
            UIManager.switchView(view);
        });
    });
    
    // 為主題切換按鈕添加事件監聽器
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            UIManager.toggleTheme();
        });
    }
    
    // 為調試按鈕添加事件監聽器
    const debugBtn = document.getElementById('debug-btn');
    if (debugBtn) {
        console.log('綁定Debug按鈕事件');
        debugBtn.addEventListener('click', function() {
            console.log('Debug按鈕被點擊');
            
            // 使用Electron API打開開發者工具
            try {
                if (window.require) {
                    const electron = window.require('electron');
                    console.log('electron對象獲取成功');
                    
                    // 首先嘗試使用ipcRenderer
                    if (electron.ipcRenderer) {
                        console.log('使用ipcRenderer發送打開開發者工具請求');
                        electron.ipcRenderer.send('open-dev-tools');
                    } 
                    // 備用方案：嘗試使用remote模塊
                    else if (electron.remote) {
                        console.log('使用remote模塊打開開發者工具');
                        electron.remote.getCurrentWindow().webContents.openDevTools();
                    }
                    else {
                        console.warn('無法找到合適的方法打開開發者工具');
                        // 使用快捷鍵方式
                        tryKeyboardShortcut();
                    }
                } else {
                    console.warn('window.require未定義，可能在瀏覽器中運行');
                    tryKeyboardShortcut();
                }
            } catch (error) {
                console.error('打開開發者工具時出錯:', error);
                alert('開發者工具無法通過按鈕打開，請嘗試使用快捷鍵 Ctrl+Shift+I 或 F12');
                tryKeyboardShortcut();
            }
        });
    } else {
        console.error('未找到Debug按鈕元素');
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
    
    // 為錯誤提示框關閉按鈕添加事件監聽器
    const closeErrorBtn = document.getElementById('close-error-btn');
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', function() {
            document.getElementById('error-container').style.display = 'none';
        });
    }
    
    console.log('應用程序初始化完成');
}); 