/**
 * LLM 供應商 API Key 的安全儲存包裝（renderer 端）
 *
 * 加密由 Electron 主行程的 safeStorage (OS 金鑰鏈) 完成，
 * 密文存於 userData/provider-keys.enc。金鑰絕不進 localStorage、
 * 不寫伺服器 DB；啟動時經 IPC 解密載入記憶體，供 fetchAPI 附
 * X-LLM-Api-Key 標頭使用。
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

    // 啟動即載入（fetchAPI 使用前應 await ready 或確認 isLoaded）
    const ready = load();

    return { load, ready, setKey, deleteKey, getKey, hasKey, isLoaded };
})();

window.SecureStore = SecureStore;
