// 初始化應用程序
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM已加載，初始化應用程序...');
    
    // 顯示啟動畫面
    const splashScreen = document.getElementById('splash-screen');
    const appContainer = document.querySelector('.app-container');
    
    // 隱藏主應用內容，直到登錄完成
    const appContent = document.querySelectorAll('.app-header, .app-content, .app-footer');
    appContent.forEach(element => {
        element.style.display = 'none';
    });
    
    // 初始化UI管理器
    UIManager.init();
    
    // 初始化API服務
    ApiService.init();
    
    // 初始化密碼管理器
    PasswordManager.init();
    
    // 初始化模塊 - 僅保留聊天和日記模塊
    ChatModule.init();
    DiaryModule.init();
    
    // 展示啟動畫面2秒後顯示登錄界面
    setTimeout(() => {
        // 淡出啟動畫面
        splashScreen.classList.add('hidden');
        
        // 初始化用戶選擇功能
        initUserSelection();
        
        // 展示用戶選擇對話框
        setTimeout(() => {
            const userSelectDialog = document.getElementById('user-select-dialog');
            userSelectDialog.style.display = 'block';
            
            // 載入用戶列表
            loadUserList();
        }, 800);
    }, 2000);
    
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

// 初始化用戶選擇功能
function initUserSelection() {
    console.log('初始化用戶選擇功能');
    
    // 獲取DOM元素
    const userSelectBtn = document.getElementById('user-select-btn');
    const userSelectDialog = document.getElementById('user-select-dialog');
    const closeUserDialogBtn = document.getElementById('close-user-dialog-btn');
    const createUserBtn = document.getElementById('create-user-btn');
    const createUserDialog = document.getElementById('create-user-dialog');
    const closeCreateUserBtn = document.getElementById('close-create-user-btn');
    const submitNewUserBtn = document.getElementById('submit-new-user');
    const newUsernameInput = document.getElementById('new-username');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const userListContainer = document.getElementById('user-list');
    const passwordDialog = document.getElementById('password-dialog');
    const closePasswordDialogBtn = document.getElementById('close-password-dialog-btn');
    const userPasswordInput = document.getElementById('user-password');
    const verifyPasswordBtn = document.getElementById('verify-password-btn');
    const selectedUserInfo = document.getElementById('selected-user-info');
    const passwordError = document.getElementById('password-error');
    const createPasswordError = document.getElementById('create-password-error');
    
    // 保存當前選擇的用戶信息
    let selectedUser = {
        id: null,
        username: null
    };
    
    // 顯示用戶選擇對話框
    userSelectBtn.addEventListener('click', function() {
        console.log('打開用戶選擇對話框');
        // 載入用戶列表
        loadUserList();
        // 顯示對話框
        userSelectDialog.style.display = 'block';
    });
    
    // 關閉用戶選擇對話框
    closeUserDialogBtn.addEventListener('click', function() {
        userSelectDialog.style.display = 'none';
    });
    
    // 顯示創建用戶對話框
    createUserBtn.addEventListener('click', function() {
        userSelectDialog.style.display = 'none';
        createUserDialog.style.display = 'block';
        // 清空輸入框
        newUsernameInput.value = '';
        newPasswordInput.value = '';
        confirmPasswordInput.value = '';
        createPasswordError.style.display = 'none';
        newUsernameInput.focus();
    });
    
    // 關閉創建用戶對話框
    closeCreateUserBtn.addEventListener('click', function() {
        createUserDialog.style.display = 'none';
        userSelectDialog.style.display = 'block';
    });
    
    // 關閉密碼驗證對話框
    closePasswordDialogBtn.addEventListener('click', function() {
        passwordDialog.style.display = 'none';
        userSelectDialog.style.display = 'block';
    });
    
    // 驗證密碼
    verifyPasswordBtn.addEventListener('click', function() {
        const password = userPasswordInput.value;
        
        // 檢查密碼是否為空
        if (!password) {
            showPasswordError('請輸入密碼');
            return;
        }
        
        // 驗證密碼
        if (PasswordManager.verifyPassword(selectedUser.id, password)) {
            // 密碼正確，登入
            loginUser(selectedUser.username, selectedUser.id);
        } else {
            // 密碼錯誤
            showPasswordError('密碼錯誤，請重試');
            userPasswordInput.value = '';
            userPasswordInput.focus();
        }
    });
    
    // 當用戶在密碼輸入框按下Enter鍵時
    userPasswordInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            verifyPasswordBtn.click();
        }
    });
    
    // 提交創建用戶表單
    submitNewUserBtn.addEventListener('click', function() {
        const username = newUsernameInput.value.trim();
        const password = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        
        // 檢查用戶名
        if (!username) {
            showCreatePasswordError('請輸入用戶名稱');
            return;
        }
        
        // 檢查密碼
        const passwordValidation = PasswordManager.validatePassword(password);
        if (!passwordValidation.valid) {
            showCreatePasswordError(passwordValidation.message);
            return;
        }
        
        // 檢查密碼一致性
        if (password !== confirmPassword) {
            showCreatePasswordError('兩次輸入的密碼不一致');
            return;
        }
        
        createNewUser(username, password);
    });
    
    // 當用戶按下Enter鍵時提交
    function handleEnterKeyInCreateForm(e) {
        if (e.key === 'Enter') {
            submitNewUserBtn.click();
        }
    }
    
    newUsernameInput.addEventListener('keypress', handleEnterKeyInCreateForm);
    newPasswordInput.addEventListener('keypress', handleEnterKeyInCreateForm);
    confirmPasswordInput.addEventListener('keypress', handleEnterKeyInCreateForm);
    
    // 顯示密碼錯誤信息
    function showPasswordError(message) {
        passwordError.textContent = message;
        passwordError.style.display = 'block';
    }
    
    // 顯示創建用戶時的錯誤信息
    function showCreatePasswordError(message) {
        createPasswordError.textContent = message;
        createPasswordError.style.display = 'block';
    }
    
    // 載入用戶列表
    window.loadUserList = function() {
        userListContainer.innerHTML = '<p>正在載入用戶列表...</p>';
        
        fetch('http://localhost:8000/users/')
            .then(response => response.json())
            .then(users => {
                if (Array.isArray(users) && users.length > 0) {
                    renderUserList(users);
                } else {
                    userListContainer.innerHTML = '<p>沒有找到用戶，請創建新用戶。</p>';
                }
            })
            .catch(error => {
                console.error('獲取用戶列表出錯:', error);
                userListContainer.innerHTML = '<p>無法載入用戶列表，請檢查API連接。</p>';
            });
    }
    
    // 渲染用戶列表
    function renderUserList(users) {
        // 獲取當前用戶ID
        const currentNumericUserId = parseInt(localStorage.getItem('numericUserId') || '1');
        
        let html = '';
        users.forEach(user => {
            const isActive = user.user_id === currentNumericUserId;
            html += `
                <div class="user-item ${isActive ? 'active' : ''}" data-id="${user.user_id}" data-username="${user.username}">
                    <div>${user.username}</div>
                    <div>ID: ${user.user_id}</div>
                </div>
            `;
        });
        
        userListContainer.innerHTML = html;
        
        // 添加點擊事件
        document.querySelectorAll('.user-item').forEach(item => {
            item.addEventListener('click', function() {
                const userId = this.dataset.id;
                const username = this.dataset.username;
                openPasswordDialog(userId, username);
            });
        });
    }
    
    // 打開密碼驗證對話框
    function openPasswordDialog(userId, username) {
        // 保存選擇的用戶信息
        selectedUser.id = userId;
        selectedUser.username = username;
        
        // 顯示用戶信息
        selectedUserInfo.innerHTML = `<strong>用戶:</strong> ${username} (ID: ${userId})`;
        
        // 清空密碼輸入框和錯誤信息
        userPasswordInput.value = '';
        passwordError.style.display = 'none';
        
        // 隱藏用戶選擇對話框，顯示密碼驗證對話框
        userSelectDialog.style.display = 'none';
        passwordDialog.style.display = 'block';
        
        // 聚焦到密碼輸入框
        userPasswordInput.focus();
    }
    
    // 登入用戶
    function loginUser(username, userId) {
        console.log(`登入用戶: ${username} (ID: ${userId})`);
        ApiService.setUserId(username, userId);
        passwordDialog.style.display = 'none';
        
        // 顯示主應用界面
        const appContent = document.querySelectorAll('.app-header, .app-content, .app-footer');
        appContent.forEach(element => {
            element.style.display = '';
        });
        
        // 更新用戶顯示名稱
        updateUserDisplay(username);
        
        // 重置和重新初始化聊天模塊
        ChatModule.reset();
        ChatModule.init();
        
        // 重置和重新初始化日記模塊
        DiaryModule.reset();
        DiaryModule.init();
        
        // 因為我們已經修改了DOM直接顯示界面，不需要刷新頁面
        // location.reload();
    }
    
    // 更新用戶顯示名稱
    function updateUserDisplay(username) {
        const userBtn = document.getElementById('user-select-btn');
        if (userBtn) {
            // 添加用戶名提示
            userBtn.setAttribute('title', `當前用戶: ${username}`);
            // 可以考慮添加一個用戶標識到按鈕中
        }
    }
    
    // 創建新用戶
    function createNewUser(username, password) {
        console.log(`創建新用戶: ${username}`);
        
        fetch('http://localhost:8000/users/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: username })
        })
        .then(response => response.json())
        .then(data => {
            if (data.user_id && data.username) {
                console.log(`用戶創建成功: ${data.username} (ID: ${data.user_id})`);
                
                // 保存密碼
                PasswordManager.setPassword(data.user_id, password);
                
                createUserDialog.style.display = 'none';
                
                // 登入新用戶
                loginUser(data.username, data.user_id);
            } else {
                showCreatePasswordError('創建用戶失敗: ' + (data.detail || '未知錯誤'));
            }
        })
        .catch(error => {
            console.error('創建用戶出錯:', error);
            showCreatePasswordError('創建用戶失敗，請稍後再試。');
        });
    }
} 