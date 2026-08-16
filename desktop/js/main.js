/**
 * 主程序入口 - 初始化和協調各模塊
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('初始化應用...');

    // 顯示啟動屏幕
    showSplashScreen();

    // 品牌 logo 圖片載入失敗時換成備用圖（v2.3 task 2.2：原本是 index.html
    // 行內 onerror= 屬性，嚴格 CSP (default-src 'self'，沒有 script-src
    // 'unsafe-inline') 下行內事件處理屬性會被瀏覽器擋下，改成這裡用
    // addEventListener 掛）
    initLogoImageFallback();

    // 註冊 service worker（PWA，v2.3 task 2.2）。
    initServiceWorker();

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

    // 初始化行事曆模塊（資料在首次切到行事曆視圖時才載入）
    CalendarModule.init();

    // 初始化用戶選擇功能
    initUserSelection();

    // 認證失效 (401) 時由 fetchAPI 發出此事件（令牌已被清除）——帶使用者回登入流程，
    // 不再以模擬數據掩蓋認證錯誤
    window.addEventListener('urdiary:auth-expired', function() {
        console.warn('認證已失效，開啟登入對話框');

        // 重置行事曆模塊，避免下一位登入者仍沿用前一個帳號的月曆索引與
        // 提醒快照（提醒快照含使用者資料，換帳號流程沒有回到前一步驟時
        // 必須清掉，比照 initUserSelection 切換帳號時的既有作法）
        if (typeof CalendarModule !== 'undefined') {
            CalendarModule.reset();
        }

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

// 品牌 logo（啟動畫面 + 頁首）載入失敗時換成備用圖。兩個 <img> 共用
// .app-logo-img class（見 index.html），失敗一次就換源並解除監聽，避免
// 備用圖本身若也載入失敗時無限重試。
function initLogoImageFallback() {
    document.querySelectorAll('.app-logo-img').forEach(function(img) {
        function onLogoError() {
            img.removeEventListener('error', onLogoError);
            img.src = 'assets/default-avatar.jpg';
        }
        img.addEventListener('error', onLogoError);
    });
}

// 註冊 service worker、並串起「有新版本可用」的更新流程。
//
// 雙重 guard 才能真正讓 Electron 不受影響：
//   1. 'serviceWorker' in navigator——多數瀏覽器環境下，file:// 就是靠這個
//      判斷不存在來擋掉。
//   2. location.protocol !== 'file:'——實測發現 Electron 這組
//      webPreferences（nodeIntegration:true、contextIsolation:false）下，
//      navigator.serviceWorker 這個屬性其實「存在」，只是 register() 對
//      file:// scope 一定會 reject（"Failed to register a ServiceWorker
//      for scope ('file:///')"）。光靠第 1 個 guard 並不會擋下這次嘗試，
//      只是嘗試會失敗、被下面的 .catch() 接住印一條 console.warn，不會
//      造成任何功能性影響或未捕捉例外——但既然已經知道第 1 個 guard 不夠
//      精準，就不必每次啟動都浪費這一次註定失敗的呼叫，直接多判斷協定。
//
// install 事件本身不會 skipWaiting（見 sw.js 檔頭說明）：新 worker 裝好後
// 停在 waiting，直到使用者在下面的提示按下「重新載入」才會發訊息叫它
// skipWaiting——這是唯一能讓更新生效的路徑，確保更新不會在使用者操作到
// 一半時把整個 App 悄悄換掉。
//
// code review 修復（見 task-2.2-report.md fix log）：controllerchange 的
// reload 監聽器「不能」像先前那樣在這裡就無條件掛上去。sw.js 的 activate
// 無條件呼叫 clients.claim()，這在「第一次安裝」時也會執行到——目前開著
// 的分頁 controller 從 null 變成新 worker，一樣會觸發 controllerchange，
// 但那不是使用者同意更新，是任何人第一次造訪就會發生的背景事件。改用
// SWLogic.createControllerChangeReloadArmer() 建立一個「武裝前完全不掛
// 監聽器」的 armer，只在使用者按下更新提示的動作鈕時才呼叫 arm()——
// 第一次安裝那次 controllerchange 因為從未 arm() 過，不會有任何反應。
function initServiceWorker() {
    if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') {
        return;
    }

    const reloadArmer = SWLogic.createControllerChangeReloadArmer(
        navigator.serviceWorker,
        function() { window.location.reload(); }
    );

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function(registration) {
        registration.addEventListener('updatefound', function() {
            const newWorker = registration.installing;
            if (!newWorker) {
                return;
            }
            newWorker.addEventListener('statechange', function() {
                const hasController = Boolean(navigator.serviceWorker.controller);
                if (typeof SWLogic === 'undefined' || !SWLogic.shouldPromptUpdate(newWorker.state, hasController)) {
                    return;
                }
                UIManager.showActionToast(
                    I18N.t('pwa.updateAvailable'),
                    I18N.t('pwa.updateReload'),
                    function() {
                        // 使用者主動按下「重新載入」——現在才武裝
                        // controllerchange 監聽器，reload 才可能發生。
                        // 武裝放在 postMessage 之前/之後皆可（真正的
                        // controllerchange 要等 SW 非同步處理完
                        // skipWaiting 才會觸發），這裡選先武裝、再送
                        // 訊息，純粹避免任何理論上的時序疑慮。
                        reloadArmer.arm();
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                    }
                );
            });
        });
    }).catch(function(error) {
        console.warn('Service worker 註冊失敗:', error);
    });
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
    const inviteCodeGroup = document.getElementById('invite-code-group');
    const inviteCodeInput = document.getElementById('invite-code');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const userListContainer = document.getElementById('user-list');
    const passwordDialog = document.getElementById('password-dialog');
    const loginMascotElement = document.getElementById('login-mascot');
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

    // 查詢後端是否要求邀請碼才顯示該欄位（v2.3 task 1.4）。查不到（後端未啟動
    // 等情況）就維持欄位原本隱藏的狀態——這是 Electron 本機首次啟動流程的
    // 保護線，寧可欄位沒顯示，也不要讓一個失敗的 fetch 擋住整個建立帳號流程。
    async function refreshInviteRequirement() {
        if (!inviteCodeGroup) return;
        try {
            const baseUrl = CONFIG.getApiBaseUrl();
            const res = await fetch(`${baseUrl}/system/capabilities`);
            const caps = await res.json();
            inviteCodeGroup.style.display = caps.require_invite ? 'block' : 'none';
        } catch (error) {
            // 後端未啟動等情況：保留欄位目前的（隱藏）狀態
        }
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
            if (inviteCodeInput) inviteCodeInput.value = '';
            if (newPasswordInput) newPasswordInput.value = '';
            if (confirmPasswordInput) confirmPasswordInput.value = '';
            if (createPasswordError) createPasswordError.style.display = 'none';
            refreshInviteRequirement();
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
            const inviteCode = inviteCodeInput ? inviteCodeInput.value.trim() : '';
            const password = newPasswordInput ? newPasswordInput.value : '';
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

            // 檢查用戶名
            if (!username) {
                showCreatePasswordError(I18N.t('login.enterUsername'));
                return;
            }

            // 欄位目前顯示中才要求填寫（後端 /system/capabilities 才是真正的門檻
            // 來源，這裡只是即時提示，省一趟往返）
            if (inviteCodeGroup && inviteCodeGroup.style.display !== 'none' && !inviteCode) {
                showCreatePasswordError(I18N.t('create.inviteRequired'));
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

            createNewUser(username, password, inviteCode);
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
    if (inviteCodeInput) {
        inviteCodeInput.addEventListener('keypress', handleEnterKeyInCreateForm);
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

        // 吉祥物歡迎圖（v2.4 spec③）：每次開啟登入框都重新注入一次，innerHTML
        // 覆寫本身是 idempotent 操作，不需要判斷「是不是第一次開」。guard 只防
        // #login-mascot 節點不存在／mascot.js 尚未載入的情況。
        if (loginMascotElement && typeof MascotModule !== 'undefined') {
            loginMascotElement.innerHTML = MascotModule.welcomeHtml();
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

        // 重置和重新初始化行事曆模塊 —— 不重置的話，切換帳號後仍會顯示
        // 前一個帳號已載入的月曆事件（惰性首載旗標不會自己歸零）
        if (typeof CalendarModule !== 'undefined') {
            if (CalendarModule.reset) CalendarModule.reset();
            if (CalendarModule.init) CalendarModule.init();
        }
    }

    // 創建新用戶：密碼隨請求送後端做強度檢查與 bcrypt 雜湊，本機不留任何密碼
    function createNewUser(username, password, inviteCode) {
        console.log(`創建新用戶: ${username}`);

        const baseUrl = CONFIG.getApiBaseUrl();
        const payload = { username: username, password: password };
        if (inviteCode) {
            payload.invite_code = inviteCode;
        }

        fetch(`${baseUrl}/users/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
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