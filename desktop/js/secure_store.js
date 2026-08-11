/**
 * 本機機密（LLM 供應商 API Key + 認證刷新令牌）的安全儲存包裝（renderer 端）
 *
 * 加密由 Electron 主行程的 safeStorage (OS 金鑰鏈) 完成，
 * 密文存於 userData/provider-keys.enc。金鑰絕不進 localStorage、
 * 不寫伺服器 DB；啟動時經 IPC 解密載入記憶體，供 fetchAPI 附
 * X-LLM-Api-Key 標頭使用。
 *
 * v2.3 起也保管「刷新令牌」：它有 30 天有效期，比 30 分鐘的訪問令牌
 * 敏感得多，能加密就不該躺在 localStorage 明文裡。非 Electron 環境
 * （手機瀏覽器 / PWA）沒有 safeStorage，退回 localStorage —— 這是那個
 * 平台本來就有的上限，至少行為明確且集中在這一處。
 */
const SecureStore = (function() {
    let ipcRenderer = null;
    try {
        if (window.require) {
            ipcRenderer = window.require('electron').ipcRenderer;
        }
    } catch (error) {
        console.error('無法取得 ipcRenderer（非 Electron 環境？）:', error);
    }

    // 解密後的金鑰快取：{ provider: apiKey }
    let cache = {};
    let loaded = false;

    async function load() {
        if (!ipcRenderer) {
            console.warn('SecureStore: 非 Electron 環境，無安全儲存可用');
            cache = {};
            loaded = true;
            return cache;
        }
        try {
            cache = (await ipcRenderer.invoke('secure-store-get')) || {};
        } catch (error) {
            console.error('載入供應商金鑰失敗:', error);
            cache = {};
        }
        loaded = true;
        console.log('SecureStore: 已載入', Object.keys(cache).length, '組金鑰');
        return cache;
    }

    /**
     * 設定金鑰（value 為空等同刪除）。寫入失敗（例如系統無金鑰鏈）會拋錯，
     * 由設定面板如實顯示。
     */
    async function setKey(provider, value) {
        if (!ipcRenderer) {
            throw new Error('無法存取安全儲存（非 Electron 環境）');
        }
        await ipcRenderer.invoke('secure-store-set', provider, value || '');
        if (value) {
            cache[provider] = value;
        } else {
            delete cache[provider];
        }
    }

    async function deleteKey(provider) {
        return setKey(provider, '');
    }

    function getKey(provider) {
        return cache[provider] || '';
    }

    function hasKey(provider) {
        return !!cache[provider];
    }

    function isLoaded() {
        return loaded;
    }

    // ---- 認證刷新令牌 ----
    // 與供應商金鑰共用同一個加密檔，但用「保留鍵」區隔：CONFIG.PROVIDERS
    // 的 id 都是小寫單字（grok/claude/…），不可能撞到雙底線開頭的名字，
    // 所以 fetchAPI 的 X-LLM-Api-Key 路徑永遠不會誤抓到它。
    const AUTH_REFRESH_KEY = '__auth_refresh_token';
    // 非 Electron（或金鑰鏈寫入失敗）時的退路
    const AUTH_REFRESH_FALLBACK_KEY = 'auth_refresh_token';

    async function setAuthRefreshToken(token) {
        if (ipcRenderer) {
            try {
                await setKey(AUTH_REFRESH_KEY, token || '');
                // 之前可能落在 localStorage（例如首次在瀏覽器登入過），一併清掉
                localStorage.removeItem(AUTH_REFRESH_FALLBACK_KEY);
                return true;
            } catch (error) {
                console.warn('刷新令牌無法寫入安全儲存，改用 localStorage:', error.message);
            }
        }
        if (token) {
            localStorage.setItem(AUTH_REFRESH_FALLBACK_KEY, token);
        } else {
            localStorage.removeItem(AUTH_REFRESH_FALLBACK_KEY);
        }
        return true;
    }

    function getAuthRefreshToken() {
        return cache[AUTH_REFRESH_KEY] || localStorage.getItem(AUTH_REFRESH_FALLBACK_KEY) || '';
    }

    async function clearAuthRefreshToken() {
        return setAuthRefreshToken('');
    }

    // 啟動即載入（fetchAPI 使用前應 await ready 或確認 isLoaded）
    const ready = load();

    return {
        load, ready, setKey, deleteKey, getKey, hasKey, isLoaded,
        setAuthRefreshToken, getAuthRefreshToken, clearAuthRefreshToken
    };
})();

window.SecureStore = SecureStore;
