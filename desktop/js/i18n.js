/**
 * i18n 模塊 - 介面與對話語言 (zh-TW / en)
 *
 * - 字典內嵌單檔（Electron file:// 環境無法 fetch 本地 JSON）
 * - 靜態節點用 data-i18n / data-i18n-placeholder / data-i18n-title 屬性，
 *   啟動時由 applyDom() 一次翻譯
 * - 動態字串在產生當下呼叫 I18N.t(key, params)
 * - 語言存 localStorage.urDiary_language；切換語言後由設定面板觸發整頁重載
 *   （Electron 重載保留 localStorage 與 token，體感無感）
 * - 對話語言：fetchAPI 以 X-Language 標頭把同一份設定送往後端，
 *   決定 AI 回覆、日記生成與危機資源的語言
 */
const I18N = (function() {
    const LANG_KEY = 'urDiary_language';
    const SUPPORTED = ['zh-TW', 'en'];

    const LOCALES = {
        'zh-TW': {
            'app.title': 'URDiary - 您的情緒日記助手',
            'app.tagline': '您的情緒陪伴與日記助手',
            'app.footer': 'URDiary © 2025 - 您的日記助手',

            'nav.chat': '對話',
            'nav.diary': '日記',

            'tools.settings': '設定',
            'tools.switchUser': '切換用戶',
            'tools.theme': '切換主題',
            'tools.debug': '開啟調試工具',
            'tools.currentUser': '當前用戶: {username}',
            'errors.themeSwitch': '主題切換失敗: {error}',

            'userDialog.title': '選擇用戶',
            'userDialog.loading': '正在載入用戶列表...',
            'userDialog.create': '創建新用戶',
            'userDialog.loggedInBefore': '此裝置登入過',
            'userDialog.noAccounts': '此裝置尚未登入過任何帳號。',
            'userDialog.otherAccount': '使用其他帳號登入…',

            'login.title': '登入',
            'login.username': '用戶名稱:',
            'login.usernamePlaceholder': '請輸入用戶名稱',
            'login.password': '密碼:',
            'login.passwordPlaceholder': '請輸入密碼',
            'login.submit': '登入',
            'login.submitting': '登入中…',
            'login.enterUsername': '請輸入用戶名稱',
            'login.enterPassword': '請輸入密碼',
            'login.failed': '登入失敗，請重試',

            'create.title': '創建新用戶',
            'create.passwordPlaceholder': '至少8字元，含大小寫字母、數字與特殊符號',
            'create.confirmPassword': '確認密碼:',
            'create.confirmPlaceholder': '請再次輸入密碼',
            'create.submit': '創建',
            'create.mismatch': '兩次輸入的密碼不一致',
            'create.failedHttp': '創建用戶失敗 (HTTP {status})',
            'create.badResponse': '創建用戶失敗: 伺服器響應缺少必要欄位',
            'create.autoLoginFailed': '帳號已建立，但自動登入失敗，請手動登入',

            'password.tooShort': '密碼長度至少需要8個字符',
            'password.needUpper': '密碼需要包含至少一個大寫字母',
            'password.needLower': '密碼需要包含至少一個小寫字母',
            'password.needDigit': '密碼需要包含至少一個數字',
            'password.needSpecial': '密碼需要包含至少一個特殊字符',

            'settings.title': '設定',
            'settings.provider': 'AI 供應商:',
            'settings.model': '模型（留空使用預設，可從建議清單選擇）:',
            'settings.modelDefaultPlaceholder': '預設: {model}',
            'settings.modelLocalPlaceholder': '請輸入模型名稱（例如 llama3）',
            'settings.apiKey': 'API Key:',
            'settings.apiKeyPlaceholder': '請輸入 API Key',
            'settings.apiKeyStoredPlaceholder': '已儲存（留空表示不變更）',
            'settings.clearKey': '刪除金鑰',
            'settings.keyNote': '金鑰以系統金鑰鏈 (safeStorage) 加密存於本機，僅隨請求送往本機後端，不會上傳伺服器。',
            'settings.keyStored': '✓ 已加密儲存於本機',
            'settings.keyNone': '尚未設定',
            'settings.keyLocalHint': '本地端點通常不需要金鑰',
            'settings.keyDeleted': '已刪除 {provider} 的金鑰',
            'settings.baseUrl': 'Base URL:',
            'settings.needBaseUrl': '本地供應商需要 Base URL（例如 http://localhost:11434/v1）',
            'settings.needModel': '本地供應商需要指定模型名稱（例如 llama3）',
            'settings.semantic': '進階記憶（語意檢索）',
            'settings.semanticNote': '以語意相似度尋找相關的過往日記（例如「上班的事」能對到「工作」）。需先在後端安裝 fastembed。',
            'settings.semanticAvailable': '✓ 後端語意檢索可用（首次啟用需下載約 220MB 模型，會在背景進行）',
            'settings.semanticUnavailable': '後端尚未安裝 fastembed，目前使用關鍵字檢索（安裝方式見 README）。',
            'settings.language': '介面與對話語言:',
            'settings.save': '儲存並使用',
            'settings.saved': '已切換到 {label}（{model}）',
            'settings.noModel': '未指定模型',
            'settings.saveFailed': '儲存設定失敗',
            'settings.clearKeyFailed': '刪除金鑰失敗',
            'settings.reloading': '設定已儲存，介面重載中…',

            'chat.title': '與AI助手對話',
            'chat.clear': '清空對話',
            'chat.inputPlaceholder': '告訴我您今天的感受...',
            'chat.endButton': '結束對話並生成日記',
            'chat.welcome': '您好！我是您的情緒日記助手。今天想聊些什麼呢？',
            'chat.confirmClear': '確定要清空當前對話嗎？',
            'chat.providerSwitched': '已切換 AI：{label}（{model}）',
            'chat.defaultModel': '預設模型',
            'chat.cantUnderstand': '抱歉，我無法理解您的請求。',
            'chat.generatingDiary': '生成日記中...',

            'diary.viewTitle': '日記記錄',
            'diary.backToList': '返回列表',
            'diary.untitled': '無標題日記',
            'diary.plain': '日記',
            'diary.dateTitle': '{month}月{day}日的日記',
            'diary.noContent': '無內容',
            'diary.emptyTitle': '尚無日記',
            'diary.emptyHint': '開始與AI助手對話，生成您的第一篇日記吧！',
            'diary.startChat': '開始對話',

            'mood.happy': '喜悅',
            'mood.excited': '興奮',
            'mood.calm': '平靜',
            'mood.neutral': '中性',
            'mood.sad': '悲傷',
            'mood.angry': '憤怒',
            'mood.anxious': '焦慮',
            'mood.unknown': '未知情緒',

            'errors.title': '錯誤信息',
            'errors.offline': '目前處於離線狀態，無法連線到伺服器',
            'errors.authFailed': '認證失敗，請重新登入',
            'errors.forbidden': '您沒有權限執行此操作',
            'errors.serverWithDetail': '伺服器發生錯誤：{detail}',
            'errors.server': '伺服器發生錯誤，請稍後再試',
            'errors.timeout': '請求超時，請稍後再試',
            'errors.cantConnect': '無法連線到伺服器，請確認後端服務是否啟動',
            'errors.cachedShown': '無法連線到伺服器，目前顯示本機快取資料',

            'ui.loading': '加載中...',
            'ui.devtoolsHint': '開發者工具無法通過按鈕打開，請嘗試使用快捷鍵 Ctrl+Shift+I 或 F12',

            'provider.local': '本地自架 (OpenAI 相容)',

            'errors.appError': '應用發生錯誤',
            'errors.validation': '驗證錯誤: {message}',
            'errors.network': '網絡請求失敗，請稍後再試',
            'errors.uiError': '界面操作錯誤，請刷新頁面',
            'errors.dataError': '數據處理錯誤，請確認數據格式',
            'errors.unknown': '應用發生未知錯誤',
            'errors.genericTitle': '錯誤',
            'errors.unknownGeneric': '發生未知錯誤',

            'chat.errorPrefix': '抱歉，我遇到了一些問題: {error}',
            'chat.tryRefresh': '請嘗試刷新頁面，或者檢查後端服務是否已啟動。如果問題持續，請聯繫技術支持。',
            'chat.busy': '正在處理中，請稍後再試',
            'chat.diaryDone': '日記已生成，您可以在日記頁面查看。',
            'chat.diaryError': '生成日記時出錯: {error}',

            'diary.loadFailedTitle': '載入失敗',
            'diary.loadFailedBody': '載入日記資料時出錯: {error}',
            'diary.loadFailedAlert': '載入日記失敗: {error}',
            'diary.notFoundTitle': '找不到日記',
            'diary.notFoundBody': '無法找到指定的日記記錄',
            'diary.detailFailedTitle': '顯示詳情失敗',
            'diary.detailFailedBody': '顯示日記詳情時出錯: {error}',

            'create.failedGeneric': '創建用戶失敗，請稍後再試。',

            'errors.offlineLogin': '設備處於離線狀態，無法進行登入',
            'errors.badToken': '伺服器響應缺少有效的認證令牌',
            'errors.loginTimeout': '登入請求超時，請確認後端服務是否啟動',
            'notes.autoGenerated': '注意: 互動筆記由系統自動生成，暫不支持手動編輯',
            'notes.cantDelete': '注意: 互動筆記不可刪除'
        },

        'en': {
            'app.title': 'URDiary — Your Emotional Diary Companion',
            'app.tagline': 'Your emotional companion & diary assistant',
            'app.footer': 'URDiary © 2025 — your diary companion',

            'nav.chat': 'Chat',
            'nav.diary': 'Diary',

            'tools.settings': 'Settings',
            'tools.switchUser': 'Switch user',
            'tools.theme': 'Toggle theme',
            'tools.debug': 'Open dev tools',
            'tools.currentUser': 'Current user: {username}',
            'errors.themeSwitch': 'Theme switch failed: {error}',

            'userDialog.title': 'Select User',
            'userDialog.loading': 'Loading users...',
            'userDialog.create': 'Create New User',
            'userDialog.loggedInBefore': 'Signed in on this device',
            'userDialog.noAccounts': 'No accounts have signed in on this device yet.',
            'userDialog.otherAccount': 'Sign in with another account…',

            'login.title': 'Sign In',
            'login.username': 'Username:',
            'login.usernamePlaceholder': 'Enter username',
            'login.password': 'Password:',
            'login.passwordPlaceholder': 'Enter password',
            'login.submit': 'Sign In',
            'login.submitting': 'Signing in…',
            'login.enterUsername': 'Please enter a username',
            'login.enterPassword': 'Please enter a password',
            'login.failed': 'Sign-in failed, please try again',

            'create.title': 'Create New User',
            'create.passwordPlaceholder': 'At least 8 characters, with upper & lower case, a number and a symbol',
            'create.confirmPassword': 'Confirm password:',
            'create.confirmPlaceholder': 'Re-enter password',
            'create.submit': 'Create',
            'create.mismatch': 'The two passwords do not match',
            'create.failedHttp': 'Failed to create user (HTTP {status})',
            'create.badResponse': 'Failed to create user: unexpected server response',
            'create.autoLoginFailed': 'Account created, but automatic sign-in failed — please sign in manually',

            'password.tooShort': 'Password must be at least 8 characters',
            'password.needUpper': 'Password needs at least one uppercase letter',
            'password.needLower': 'Password needs at least one lowercase letter',
            'password.needDigit': 'Password needs at least one number',
            'password.needSpecial': 'Password needs at least one special character',

            'settings.title': 'Settings',
            'settings.provider': 'AI provider:',
            'settings.model': 'Model (leave empty for default; pick from suggestions):',
            'settings.modelDefaultPlaceholder': 'Default: {model}',
            'settings.modelLocalPlaceholder': 'Enter a model name (e.g. llama3)',
            'settings.apiKey': 'API Key:',
            'settings.apiKeyPlaceholder': 'Enter API key',
            'settings.apiKeyStoredPlaceholder': 'Saved (leave empty to keep)',
            'settings.clearKey': 'Delete key',
            'settings.keyNote': 'Keys are encrypted with the OS keychain (safeStorage), stored only on this device, sent only to your local backend, and never uploaded.',
            'settings.keyStored': '✓ Encrypted and stored locally',
            'settings.keyNone': 'Not set',
            'settings.keyLocalHint': 'Local endpoints usually need no key',
            'settings.keyDeleted': 'Deleted the key for {provider}',
            'settings.baseUrl': 'Base URL:',
            'settings.needBaseUrl': 'A local provider needs a Base URL (e.g. http://localhost:11434/v1)',
            'settings.needModel': 'A local provider needs a model name (e.g. llama3)',
            'settings.semantic': 'Advanced memory (semantic search)',
            'settings.semanticNote': 'Finds related past diaries by meaning (e.g. "work stuff" matches "my boss"). Requires fastembed installed on the backend.',
            'settings.semanticAvailable': '✓ Semantic search available (first use downloads a ~220MB model in the background)',
            'settings.semanticUnavailable': 'fastembed is not installed on the backend — using keyword search (see README).',
            'settings.language': 'Interface & chat language:',
            'settings.save': 'Save & Apply',
            'settings.saved': 'Switched to {label} ({model})',
            'settings.noModel': 'no model set',
            'settings.saveFailed': 'Failed to save settings',
            'settings.clearKeyFailed': 'Failed to delete key',
            'settings.reloading': 'Settings saved, reloading…',

            'chat.title': 'Chat with your AI companion',
            'chat.clear': 'Clear conversation',
            'chat.inputPlaceholder': "Tell me how you're feeling today...",
            'chat.endButton': 'End chat & create diary',
            'chat.welcome': "Hi! I'm your diary companion. What's on your mind today?",
            'chat.confirmClear': 'Clear this conversation?',
            'chat.providerSwitched': 'Switched AI: {label} ({model})',
            'chat.defaultModel': 'default model',
            'chat.cantUnderstand': "Sorry, I couldn't process that.",
            'chat.generatingDiary': 'Creating your diary...',

            'diary.viewTitle': 'Diary',
            'diary.backToList': 'Back to list',
            'diary.untitled': 'Untitled entry',
            'diary.plain': 'Diary',
            'diary.dateTitle': 'Diary for {month}/{day}',
            'diary.noContent': 'No content',
            'diary.emptyTitle': 'No diary entries yet',
            'diary.emptyHint': 'Start chatting with your companion to create your first diary!',
            'diary.startChat': 'Start chatting',

            'mood.happy': 'Joyful',
            'mood.excited': 'Excited',
            'mood.calm': 'Calm',
            'mood.neutral': 'Neutral',
            'mood.sad': 'Sad',
            'mood.angry': 'Angry',
            'mood.anxious': 'Anxious',
            'mood.unknown': 'Unknown',

            'errors.title': 'Error',
            'errors.offline': 'You are offline — cannot reach the server',
            'errors.authFailed': 'Authentication failed, please sign in again',
            'errors.forbidden': "You don't have permission to do that",
            'errors.serverWithDetail': 'Server error: {detail}',
            'errors.server': 'Server error, please try again later',
            'errors.timeout': 'Request timed out, please try again later',
            'errors.cantConnect': 'Cannot reach the server — is the backend running?',
            'errors.cachedShown': 'Cannot reach the server — showing locally cached data',

            'ui.loading': 'Loading...',
            'ui.devtoolsHint': 'Dev tools could not be opened from the button — try Ctrl+Shift+I or F12',

            'provider.local': 'Self-hosted (OpenAI-compatible)',

            'errors.appError': 'Something went wrong',
            'errors.validation': 'Validation error: {message}',
            'errors.network': 'Network request failed, please try again later',
            'errors.uiError': 'Interface error — please reload the page',
            'errors.dataError': 'Data processing error — please check the data format',
            'errors.unknown': 'An unknown error occurred',
            'errors.genericTitle': 'Error',
            'errors.unknownGeneric': 'Unknown error',

            'chat.errorPrefix': 'Sorry, I ran into a problem: {error}',
            'chat.tryRefresh': 'Try reloading the page, or check that the backend service is running. If it keeps happening, please report it.',
            'chat.busy': 'Still processing — please wait a moment',
            'chat.diaryDone': 'Your diary is ready — you can view it in the Diary tab.',
            'chat.diaryError': 'Error creating the diary: {error}',

            'diary.loadFailedTitle': 'Load failed',
            'diary.loadFailedBody': 'Error loading diaries: {error}',
            'diary.loadFailedAlert': 'Failed to load diaries: {error}',
            'diary.notFoundTitle': 'Diary not found',
            'diary.notFoundBody': "Couldn't find that diary entry",
            'diary.detailFailedTitle': 'Failed to show details',
            'diary.detailFailedBody': 'Error showing diary details: {error}',

            'create.failedGeneric': 'Failed to create user, please try again later.',

            'errors.offlineLogin': 'You are offline — cannot sign in',
            'errors.badToken': 'Server response is missing a valid token',
            'errors.loginTimeout': 'Sign-in timed out — is the backend running?',
            'notes.autoGenerated': 'Note: interaction notes are generated automatically and cannot be edited',
            'notes.cantDelete': 'Note: interaction notes cannot be deleted'
        }
    };

    function getLang() {
        const saved = localStorage.getItem(LANG_KEY);
        return SUPPORTED.includes(saved) ? saved : 'zh-TW';
    }

    function setLang(lang) {
        if (SUPPORTED.includes(lang)) {
            localStorage.setItem(LANG_KEY, lang);
        }
    }

    function t(key, params) {
        const lang = getLang();
        let text = (LOCALES[lang] && LOCALES[lang][key]) ||
                   (LOCALES['zh-TW'] && LOCALES['zh-TW'][key]);
        if (text === undefined) {
            console.warn(`[i18n] missing key: ${key}`);
            return key;
        }
        if (params) {
            Object.keys(params).forEach(name => {
                text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), params[name]);
            });
        }
        return text;
    }

    // 靜態 DOM 節點翻譯 (data-i18n / data-i18n-placeholder / data-i18n-title)
    function applyDom(root) {
        const scope = root || document;
        scope.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
        });
        scope.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
        });
        document.documentElement.setAttribute('lang', getLang());
        document.title = t('app.title');
    }

    // 日期地區碼（diary_module 等的 toLocaleDateString 用）
    function dateLocale() {
        return getLang() === 'en' ? 'en-US' : 'zh-TW';
    }

    document.addEventListener('DOMContentLoaded', function() {
        applyDom();
    });

    return { t, getLang, setLang, applyDom, dateLocale };
})();

window.I18N = I18N;
