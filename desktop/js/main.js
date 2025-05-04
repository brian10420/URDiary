/**
 * 主程序入口 - 初始化和協調各模塊
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('初始化應用...');
    
    // 顯示啟動屏幕
    showSplashScreen();
    
    // 确保先初始化ApiService
    if (typeof ApiService !== 'undefined' && typeof ApiService.init === 'function') {
        ApiService.init();
    } else {
        console.error('ApiService未定義或init方法不可用');
    }
    
    // 初始化API認證
    initializeAuth();

    // 初始化錯誤處理 - 檢查ErrorHandler是否存在且有init方法
    if (typeof ErrorLogger !== 'undefined') {
        // ErrorLogger已在外部初始化，不需要再次調用init
        console.log('ErrorLogger已初始化');
    } else {
        console.warn('ErrorLogger未定義');
    }
    
    // 初始化UI管理器
    UIManager.init();
    
    // 初始化對話模塊
    ChatModule.init();
    
    // 初始化日記模塊
    DiaryModule.init();
    
    // 初始化用戶選擇功能
    initUserSelection();
    
    // 隱藏啟動屏幕並顯示用戶選擇對話框
    setTimeout(() => {
        hideSplashScreen();
        
        // 展示用戶選擇對話框
        setTimeout(() => {
            const userSelectDialog = document.getElementById('user-select-dialog');
            if (userSelectDialog) {
                userSelectDialog.style.display = 'block';
                // 載入用戶列表
                if (typeof loadUserList === 'function') {
                    loadUserList();
                }
            }
        }, 800);
    }, 1000);
    
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
        debugBtn.addEventListener('click', function() {
            // 使用Electron API打開開發者工具
            try {
                if (window.require) {
                    const electron = window.require('electron');
                    if (electron.ipcRenderer) {
                        electron.ipcRenderer.send('open-dev-tools');
                    } else if (electron.remote) {
                        electron.remote.getCurrentWindow().webContents.openDevTools();
                    }
                }
            } catch (error) {
                console.error('打開開發者工具時出錯:', error);
            }
        });
    }
    
    console.log('應用初始化完成');
});

// 顯示啟動屏幕
function showSplashScreen() {
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        splashScreen.style.display = 'flex';
    }
}

// 隱藏啟動屏幕
function hideSplashScreen() {
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        splashScreen.classList.add('fade-out');
        setTimeout(() => {
            splashScreen.style.display = 'none';
        }, 500);
    }
}

// 初始化API認證
async function initializeAuth() {
    console.log('初始化API認證...');
    
    try {
        // 檢查ApiService是否存在並已初始化
        if (typeof ApiService === 'undefined') {
            console.error('無法初始化認證: ApiService未定義');
            return;
        }
        
        // 確保ApiService已初始化
        if (typeof ApiService.ensureInitialized === 'function') {
            ApiService.ensureInitialized();
        } else if (typeof ApiService.init === 'function') {
            ApiService.init();
        }
        
        // 檢查配置是否啟用認證
        if (CONFIG && CONFIG.AUTH && CONFIG.AUTH.ENABLED) {
            console.log('認證已啟用，嘗試登入');
            
            // 執行自動登入
            if (CONFIG.AUTH.AUTO_LOGIN && typeof ApiService.autoLogin === 'function') {
                const authResult = await ApiService.autoLogin();
                if (authResult.success) {
                    console.log('自動登入成功');
                } else {
                    console.warn('自動登入失敗:', authResult.error);
                }
            }
        } else {
            console.log('認證未啟用');
        }
    } catch (error) {
        console.error('初始化認證時出錯:', error);
    }
}

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
    if (userSelectBtn) {
        userSelectBtn.addEventListener('click', function() {
            console.log('打開用戶選擇對話框');
            // 載入用戶列表
            if (typeof loadUserList === 'function') {
                loadUserList();
            }
            // 顯示對話框
            if (userSelectDialog) {
                userSelectDialog.style.display = 'block';
            }
        });
    }
    
    // 關閉用戶選擇對話框
    if (closeUserDialogBtn) {
        closeUserDialogBtn.addEventListener('click', function() {
            if (userSelectDialog) {
                userSelectDialog.style.display = 'none';
            }
        });
    }
    
    // 顯示創建用戶對話框
    if (createUserBtn) {
        createUserBtn.addEventListener('click', function() {
            if (userSelectDialog) userSelectDialog.style.display = 'none';
            if (createUserDialog) createUserDialog.style.display = 'block';
            // 清空輸入框
            if (newUsernameInput) newUsernameInput.value = '';
            if (newPasswordInput) newPasswordInput.value = '';
            if (confirmPasswordInput) confirmPasswordInput.value = '';
            if (createPasswordError) createPasswordError.style.display = 'none';
            if (newUsernameInput) newUsernameInput.focus();
        });
    }
    
    // 關閉創建用戶對話框
    if (closeCreateUserBtn) {
        closeCreateUserBtn.addEventListener('click', function() {
            if (createUserDialog) createUserDialog.style.display = 'none';
            if (userSelectDialog) userSelectDialog.style.display = 'block';
        });
    }
    
    // 關閉密碼驗證對話框
    if (closePasswordDialogBtn) {
        closePasswordDialogBtn.addEventListener('click', function() {
            if (passwordDialog) passwordDialog.style.display = 'none';
            if (userSelectDialog) userSelectDialog.style.display = 'block';
        });
    }
    
    // 驗證密碼
    if (verifyPasswordBtn) {
        verifyPasswordBtn.addEventListener('click', function() {
            const password = userPasswordInput ? userPasswordInput.value : '';
            
            // 檢查密碼是否為空
            if (!password) {
                showPasswordError('請輸入密碼');
                return;
            }
            
            // 驗證密碼
            if (typeof PasswordManager !== 'undefined' && 
                PasswordManager.verifyPassword && 
                PasswordManager.verifyPassword(selectedUser.id, password)) {
                // 密碼正確，登入
                loginUser(selectedUser.username, selectedUser.id);
            } else {
                // 密碼錯誤
                showPasswordError('密碼錯誤，請重試');
                if (userPasswordInput) {
                    userPasswordInput.value = '';
                    userPasswordInput.focus();
                }
            }
        });
    }
    
    // 當用戶在密碼輸入框按下Enter鍵時
    if (userPasswordInput) {
        userPasswordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && verifyPasswordBtn) {
                verifyPasswordBtn.click();
            }
        });
    }
    
    // 提交創建用戶表單
    if (submitNewUserBtn) {
        submitNewUserBtn.addEventListener('click', function() {
            const username = newUsernameInput ? newUsernameInput.value.trim() : '';
            const password = newPasswordInput ? newPasswordInput.value : '';
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';
            
            // 檢查用戶名
            if (!username) {
                showCreatePasswordError('請輸入用戶名稱');
                return;
            }
            
            // 檢查密碼
            if (typeof PasswordManager !== 'undefined' && PasswordManager.validatePassword) {
                const passwordValidation = PasswordManager.validatePassword(password);
                if (!passwordValidation.valid) {
                    showCreatePasswordError(passwordValidation.message);
                    return;
                }
            }
            
            // 檢查密碼一致性
            if (password !== confirmPassword) {
                showCreatePasswordError('兩次輸入的密碼不一致');
                return;
            }
            
            createNewUser(username, password);
        });
    }
    
    // 當用戶按下Enter鍵時提交
    function handleEnterKeyInCreateForm(e) {
        if (e.key === 'Enter' && submitNewUserBtn) {
            submitNewUserBtn.click();
        }
    }
    
    if (newUsernameInput) {
        newUsernameInput.addEventListener('keypress', handleEnterKeyInCreateForm);
    }
    if (newPasswordInput) {
        newPasswordInput.addEventListener('keypress', handleEnterKeyInCreateForm);
    }
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('keypress', handleEnterKeyInCreateForm);
    }
    
    // 顯示密碼錯誤信息
    function showPasswordError(message) {
        if (passwordError) {
            passwordError.textContent = message;
            passwordError.style.display = 'block';
        }
    }
    
    // 顯示創建用戶時的錯誤信息
    function showCreatePasswordError(message) {
        if (createPasswordError) {
            createPasswordError.textContent = message;
            createPasswordError.style.display = 'block';
        }
    }
    
    // 載入用戶列表
    window.loadUserList = function() {
        if (userListContainer) {
            userListContainer.innerHTML = '<p>正在載入用戶列表...</p>';
        }
        
        fetch('http://localhost:8000/users/')
            .then(response => response.json())
            .then(users => {
                if (Array.isArray(users) && users.length > 0) {
                    renderUserList(users);
                } else if (userListContainer) {
                    userListContainer.innerHTML = '<p>沒有找到用戶，請創建新用戶。</p>';
                }
            })
            .catch(error => {
                console.error('獲取用戶列表出錯:', error);
                if (userListContainer) {
                    userListContainer.innerHTML = '<p>無法載入用戶列表，請檢查API連接。</p>';
                }
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
        
        if (userListContainer) {
            userListContainer.innerHTML = html;
        }
        
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
        if (selectedUserInfo) {
            selectedUserInfo.innerHTML = `<strong>用戶:</strong> ${username} (ID: ${userId})`;
        }
        
        // 清空密碼輸入框和錯誤信息
        if (userPasswordInput) {
            userPasswordInput.value = '';
        }
        if (passwordError) {
            passwordError.style.display = 'none';
        }
        
        // 隱藏用戶選擇對話框，顯示密碼驗證對話框
        if (userSelectDialog) userSelectDialog.style.display = 'none';
        if (passwordDialog) passwordDialog.style.display = 'block';
        
        // 聚焦到密碼輸入框
        if (userPasswordInput) userPasswordInput.focus();
    }
    
    // 登入用戶
    function loginUser(username, userId) {
        console.log(`登入用戶: ${username} (ID: ${userId})`);
        
        if (typeof ApiService !== 'undefined' && ApiService.setUserId) {
            ApiService.setUserId(username, userId);
        }
        
        // 同時進行JWT登入
        if (typeof ApiService !== 'undefined' && ApiService.login) {
            ApiService.login(username)
                .then(result => {
                    console.log('JWT登入結果:', result);
                })
                .catch(error => {
                    console.error('JWT登入失敗:', error);
                });
        }
        
        if (passwordDialog) passwordDialog.style.display = 'none';
        
        // 顯示主應用界面
        const appContent = document.querySelectorAll('.app-header, .app-content, .app-footer');
        appContent.forEach(element => {
            element.style.display = '';
        });
        
        // 更新用戶顯示名稱
        updateUserDisplay(username);
        
        // 重置和重新初始化聊天模塊
        if (typeof ChatModule !== 'undefined') {
            if (ChatModule.reset) ChatModule.reset();
            if (ChatModule.init) ChatModule.init();
        }
        
        // 重置和重新初始化日記模塊
        if (typeof DiaryModule !== 'undefined') {
            if (DiaryModule.reset) DiaryModule.reset();
            if (DiaryModule.init) DiaryModule.init();
        }
    }
    
    // 更新用戶顯示名稱
    function updateUserDisplay(username) {
        const userBtn = document.getElementById('user-select-btn');
        if (userBtn) {
            // 添加用戶名提示
            userBtn.setAttribute('title', `當前用戶: ${username}`);
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
                if (typeof PasswordManager !== 'undefined' && PasswordManager.setPassword) {
                    PasswordManager.setPassword(data.user_id, password);
                }
                
                if (createUserDialog) createUserDialog.style.display = 'none';
                
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

// 全局錯誤處理
window.onerror = function(message, source, lineno, colno, error) {
    console.error('全局錯誤:', message, error);
    
    if (typeof ErrorLogger !== 'undefined') {
        ErrorLogger.captureError(error || new Error(message), {
            source: source,
            lineno: lineno,
            colno: colno
        });
    }
    
    return false; // 允許默認處理
}; 