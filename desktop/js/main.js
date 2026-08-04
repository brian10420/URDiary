/**
 * 主程序入口 - 初始化和協調各模塊
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('初始化應用...');
    
    // 顯示啟動屏幕
    showSplashScreen();
    
    // js/main.js 是各模塊初始化的唯一 owner：以下順序為固定順序，
    // 各模塊檔尾原本的自啟動區塊（DOMContentLoaded 自行呼叫 init）已移除，
    // 避免雙重初始化（事件監聽器綁兩次、autoLogin 跑兩次等）。

    // 初始化錯誤日誌系統（唯一的未捕捉錯誤捕捉路徑，須盡早就緒）
    if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.init === 'function') {
        ErrorLogger.init();
    } else {
        console.warn('ErrorLogger未定義');
    }

    // 确保先初始化ApiService
    if (typeof ApiService !== 'undefined' && typeof ApiService.init === 'function') {
        ApiService.init();
    } else {
        console.error('ApiService未定義或init方法不可用');
    }

    // 初始化 LLM 設定模塊（供應商/模型/金鑰管理面板）
    if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.init === 'function') {
        SettingsModule.init();
    } else {
        console.warn('SettingsModule未定義');
    }

    // 初始化API認證
    initializeAuth();
    
    // 初始化UI管理器
    UIManager.init();
    
    // 初始化對話模塊
    ChatModule.init();
    
    // 初始化日記模塊
    DiaryModule.init();
    
    // 初始化用戶選擇功能
    initUserSelection();

    // 認證失效 (401) 時由 fetchAPI 發出此事件（令牌已被清除）——帶使用者回登入流程，
    // 不再以模擬數據掩蓋認證錯誤
    window.addEventListener('urdiary:auth-expired', function() {
        console.warn('認證已失效，開啟登入對話框');

        const splashScreen = document.getElementById('splash-screen');
        if (splashScreen) {
            splashScreen.style.display = 'flex';
            splashScreen.classList.add('login-background');
            document.body.classList.add('splash-active');
        }

        const userSelectDialog = document.getElementById('user-select-dialog');
        if (userSelectDialog && userSelectDialog.style.display !== 'block') {
            userSelectDialog.style.display = 'block';
            userSelectDialog.style.zIndex = '1000';
            if (typeof loadUserList === 'function') {
                loadUserList();
            }
        }
    });


    // 隱藏啟動屏幕：有未過期的 JWT 直接進入主畫面，否則顯示登入對話框
    setTimeout(() => {
        if (typeof ApiService !== 'undefined' &&
            typeof ApiService.isAuthenticated === 'function' &&
            ApiService.isAuthenticated()) {
            console.log('偵測到有效令牌，直接進入主畫面');
            enterApp(localStorage.getItem('currentUserId') || '');
            return;
        }

        // 不完全隱藏啟動畫面，而是將其轉換為背景
        const splashScreen = document.getElementById('splash-screen');
        if (splashScreen) {
            splashScreen.classList.add('login-background');
        }

        // 展示登入對話框
        setTimeout(() => {
            const userSelectDialog = document.getElementById('user-select-dialog');
            if (userSelectDialog) {
                userSelectDialog.style.display = 'block';
                // 確保對話框在啟動畫面上方
                userSelectDialog.style.zIndex = '1000';
                // 載入本機用戶清單
                if (typeof loadUserList === 'function') {
                    loadUserList();
                }
            }
        }, 800);
    }, 1000);
    
    // 導航事件已由 UIManager.init() 綁定 (含視圖狀態機)。
    // 此處不可重複綁定 switchView，否則兩個處理器會同時觸發，
    // 例如在日記詳情頁點「對話」時 switchView 會強制切回全螢幕聊天，
    // 蓋掉狀態機原本要顯示的「聊天+詳情」分割畫面。

    console.log('應用初始化完成');
});

// 顯示啟動屏幕
function showSplashScreen() {
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        splashScreen.style.display = 'flex';
        // 添加標記類，用於CSS樣式識別登錄流程中
        document.body.classList.add('splash-active');
    }
}

// 隱藏啟動屏幕
function hideSplashScreen() {
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        // 如果正在登錄流程中，不要隱藏啟動畫面
        if (document.getElementById('user-select-dialog')?.style.display === 'block' ||
            document.getElementById('password-dialog')?.style.display === 'block' ||
            document.getElementById('create-user-dialog')?.style.display === 'block') {
            // 只降低不透明度，但保持背景可見
            splashScreen.classList.add('login-background');
            return;
        }
        
        splashScreen.classList.add('fade-out');
        setTimeout(() => {
            splashScreen.style.display = 'none';
            // 移除標記類
            document.body.classList.remove('splash-active');
            splashScreen.classList.remove('login-background');
        }, 500);
    }
}

// 進入主應用界面（登入成功、或啟動時已有有效令牌）
function enterApp(username) {
    // 關閉所有登入相關對話框
    ['user-select-dialog', 'password-dialog', 'create-user-dialog'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 完全隱藏啟動畫面
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        splashScreen.classList.remove('login-background');
        splashScreen.classList.add('fade-out');
        setTimeout(() => {
            splashScreen.style.display = 'none';
            document.body.classList.remove('splash-active');
            splashScreen.classList.remove('fade-out');
        }, 500);
    }

    // 顯示主應用界面
    document.querySelectorAll('.app-header, .app-content, .app-footer').forEach(element => {
        element.style.display = '';
    });

    // 更新用戶顯示名稱
    const userBtn = document.getElementById('user-select-btn');
    if (userBtn && username) {
        userBtn.setAttribute('title', I18N.t('tools.currentUser', { username: username }));
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
    const loginUsernameInput = document.getElementById('login-username');
    const userPasswordInput = document.getElementById('user-password');
    const verifyPasswordBtn = document.getElementById('verify-password-btn');
    const selectedUserInfo = document.getElementById('selected-user-info');
    const passwordError = document.getElementById('password-error');
    const createPasswordError = document.getElementById('create-password-error');

    // ---- 本機 profile 清單：只記「這台裝置登入過誰」，密碼一律交後端驗證 ----
    const PROFILES_KEY = 'urDiary_profiles';

    function getProfiles() {
        try {
            const raw = localStorage.getItem(PROFILES_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (error) {
            console.warn('讀取本機用戶清單失敗:', error);
            return [];
        }
    }

    function saveProfile(userId, username) {
        const profiles = getProfiles().filter(p => p.username !== username);
        profiles.unshift({ id: userId, username: username });
        try {
            localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles.slice(0, 10)));
        } catch (error) {
            console.warn('保存本機用戶清單失敗:', error);
        }
    }

    // 前端即時密碼強度檢查（純 UX 提示，真正的門檻在後端 password_validator）
    function validatePasswordStrength(password) {
        if (!password || password.length < 8) return { valid: false, message: I18N.t('password.tooShort') };
        if (!/[A-Z]/.test(password)) return { valid: false, message: I18N.t('password.needUpper') };
        if (!/[a-z]/.test(password)) return { valid: false, message: I18N.t('password.needLower') };
        if (!/[0-9]/.test(password)) return { valid: false, message: I18N.t('password.needDigit') };
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return { valid: false, message: I18N.t('password.needSpecial') };
        return { valid: true };
    }

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
            // 保持啟動畫面作為背景
            if (userSelectDialog) userSelectDialog.style.display = 'block';
        });
    }
    
    // 登入：帳號與密碼送後端，由後端以 bcrypt 驗證（不再有本機明文密碼）
    if (verifyPasswordBtn) {
        verifyPasswordBtn.addEventListener('click', async function() {
            const username = loginUsernameInput ? loginUsernameInput.value.trim() : '';
            const password = userPasswordInput ? userPasswordInput.value : '';

            if (!username) {
                showPasswordError(I18N.t('login.enterUsername'));
                if (loginUsernameInput) loginUsernameInput.focus();
                return;
            }
            if (!password) {
                showPasswordError(I18N.t('login.enterPassword'));
                if (userPasswordInput) userPasswordInput.focus();
                return;
            }

            verifyPasswordBtn.disabled = true;
            const originalLabel = verifyPasswordBtn.textContent;
            verifyPasswordBtn.textContent = I18N.t('login.submitting');

            try {
                const result = await ApiService.login(username, password);
                if (result.success) {
                    saveProfile(result.userId, result.username || username);
                    loginUser(result.username || username, result.userId);
                } else {
                    showPasswordError(result.error || I18N.t('login.failed'));
                    if (userPasswordInput) {
                        userPasswordInput.value = '';
                        userPasswordInput.focus();
                    }
                }
            } catch (error) {
                console.error('登入失敗:', error);
                showPasswordError(error.message || I18N.t('login.failed'));
            } finally {
                verifyPasswordBtn.disabled = false;
                verifyPasswordBtn.textContent = originalLabel;
            }
        });
    }

    // 當用戶在帳號/密碼輸入框按下Enter鍵時送出
    [loginUsernameInput, userPasswordInput].forEach(input => {
        if (input) {
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter' && verifyPasswordBtn) {
                    verifyPasswordBtn.click();
                }
            });
        }
    });
    
    // 提交創建用戶表單
    if (submitNewUserBtn) {
        submitNewUserBtn.addEventListener('click', function() {
            const username = newUsernameInput ? newUsernameInput.value.trim() : '';
            const password = newPasswordInput ? newPasswordInput.value : '';
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';
            
            // 檢查用戶名
            if (!username) {
                showCreatePasswordError(I18N.t('login.enterUsername'));
                return;
            }

            // 前端即時強度提示（後端會再驗一次）
            const passwordValidation = validatePasswordStrength(password);
            if (!passwordValidation.valid) {
                showCreatePasswordError(passwordValidation.message);
                return;
            }

            // 檢查密碼一致性
            if (password !== confirmPassword) {
                showCreatePasswordError(I18N.t('create.mismatch'));
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
    
    // 載入本機用戶清單（不再向後端無認證列出全部使用者 —— 該端點已改為僅回傳自己）
    window.loadUserList = function() {
        if (!userListContainer) return;

        const profiles = getProfiles();
        let html = '';

        profiles.forEach(profile => {
            // 用戶名寫入 innerHTML 與 data-* 屬性，必須轉義
            const safeUsername = escapeHtml(profile.username);
            html += `
                <div class="user-item" data-username="${safeUsername}">
                    <div>${safeUsername}</div>
                    <div>${I18N.t('userDialog.loggedInBefore')}</div>
                </div>
            `;
        });

        if (profiles.length === 0) {
            html += `<p>${I18N.t('userDialog.noAccounts')}</p>`;
        }

        // 永遠提供以任意帳號登入的入口
        html += `
            <div class="user-item" data-username="">
                <div>${I18N.t('userDialog.otherAccount')}</div>
            </div>
        `;

        userListContainer.innerHTML = html;

        // 添加點擊事件：帶上用戶名開啟登入對話框
        userListContainer.querySelectorAll('.user-item').forEach(item => {
            item.addEventListener('click', function() {
                openPasswordDialog(this.dataset.username || '');
            });
        });
    }

    // 打開登入對話框（username 可為空 —— 讓使用者自行輸入帳號）
    function openPasswordDialog(username) {
        if (selectedUserInfo) {
            selectedUserInfo.textContent = '';
        }

        // 我們現在使用啟動畫面作為背景，不需要單獨的背景遮罩
        // 確保啟動畫面處於背景模式
        const splashScreen = document.getElementById('splash-screen');
        if (splashScreen) {
            splashScreen.classList.add('login-background');
        }

        // 預填帳號、清空密碼與錯誤信息
        if (loginUsernameInput) {
            loginUsernameInput.value = username || '';
        }
        if (userPasswordInput) {
            userPasswordInput.value = '';
        }
        if (passwordError) {
            passwordError.style.display = 'none';
        }

        // 隱藏用戶選擇對話框，顯示登入對話框
        if (userSelectDialog) userSelectDialog.style.display = 'none';
        if (passwordDialog) {
            passwordDialog.style.display = 'block';
            // 確保登入對話框在啟動畫面上方
            passwordDialog.style.zIndex = '1000';
        }

        // 聚焦：已有帳號聚焦密碼，否則聚焦帳號
        if (username && userPasswordInput) {
            userPasswordInput.focus();
        } else if (loginUsernameInput) {
            loginUsernameInput.focus();
        }
    }
    
    // 登入成功後的處理（JWT 已由 ApiService.login 取得並保存）
    function loginUser(username, userId) {
        console.log(`登入用戶: ${username} (ID: ${userId})`);

        if (typeof ApiService !== 'undefined' && ApiService.setUserId) {
            ApiService.setUserId(username, userId);
        }

        // 進入主應用界面
        enterApp(username);

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

    // 創建新用戶：密碼隨請求送後端做強度檢查與 bcrypt 雜湊，本機不留任何密碼
    function createNewUser(username, password) {
        console.log(`創建新用戶: ${username}`);

        const baseUrl = CONFIG.getApiBaseUrl();

        fetch(`${baseUrl}/users/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(async response => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                // 後端會回傳具體原因（重複帳號、密碼強度不足等）
                throw new Error(data.detail || I18N.t('create.failedHttp', { status: response.status }));
            }
            return data;
        })
        .then(async data => {
            if (!data.user_id || !data.username) {
                throw new Error(I18N.t('create.badResponse'));
            }

            console.log(`用戶創建成功: ${data.username} (ID: ${data.user_id})`);

            // 直接以新帳號登入取得 JWT
            const result = await ApiService.login(data.username, password);
            if (!result.success) {
                throw new Error(result.error || I18N.t('create.autoLoginFailed'));
            }

            saveProfile(data.user_id, data.username);
            if (createUserDialog) createUserDialog.style.display = 'none';
            loginUser(data.username, data.user_id);
        })
        .catch(error => {
            console.error('創建用戶出錯:', error);
            showCreatePasswordError(error.message || I18N.t('create.failedGeneric'));
        });
    }
}