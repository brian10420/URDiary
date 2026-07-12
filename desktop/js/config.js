/**
 * URDiary 全局配置文件
 * 包含API設置、認證配置和其他全局參數
 */
const CONFIG = (function() {
    // 默認配置
    const defaultConfig = {
        // API配置
        API: {
            BASE_URL: 'http://localhost:8001',
            TIMEOUT: 30000,  // 默認超時時間（毫秒）
            AUTO_RETRY: true, // 自動重試失敗的請求
            MAX_RETRIES: 2,  // 最大重試次數
            ENDPOINTS: {
                CHAT: '/chat/enhanced/',
                END_CHAT: '/chat/end/',
                DIARIES: '/diaries/',
                NOTES: '/interaction-notes'
            }
        },
        // LLM 供應商定義（API Key 存於 Electron safeStorage，不在此處也不進 localStorage）
        // 模型 ID 會隨時間變動，DEFAULT_MODEL 只是未自訂時的預設值，設定面板可改；
        // SUGGESTED_MODELS 供設定面板下拉建議（打錯 ID 會被供應商 404，例如
        // claude-sonnet-5 誤打成 claude-sonnet-5-0）
        PROVIDERS: {
            grok:   { LABEL: 'Grok (xAI)',            DEFAULT_MODEL: 'grok-4.3',        NEEDS_BASE_URL: false,
                      SUGGESTED_MODELS: ['grok-4.3'] },
            openai: { LABEL: 'ChatGPT (OpenAI)',      DEFAULT_MODEL: 'gpt-5.5',         NEEDS_BASE_URL: false,
                      SUGGESTED_MODELS: ['gpt-5.5', 'gpt-5.6'] },
            claude: { LABEL: 'Claude (Anthropic)',    DEFAULT_MODEL: 'claude-opus-4-8', NEEDS_BASE_URL: false,
                      SUGGESTED_MODELS: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'] },
            gemini: { LABEL: 'Gemini (Google)',       DEFAULT_MODEL: 'gemini-3-flash',  NEEDS_BASE_URL: false,
                      SUGGESTED_MODELS: ['gemini-3-flash', 'gemini-2.5-flash'] },
            local:  { LABEL: '本地自架 (OpenAI 相容)', DEFAULT_MODEL: '',                NEEDS_BASE_URL: true,
                      SUGGESTED_MODELS: [] }
        },
        // 舊版短鍵模型設定（已由 PROVIDERS + 設定面板取代，保留避免舊引用炸掉）
        MODELS: {
            DEFAULT: 'grok3',
            AVAILABLE: ['grok2', 'grok3'],
            AUTO_SWITCH: true,
            DISPLAY_NAMES: {
                'grok2': 'Grok 2',
                'grok3': 'Grok 3'
            }
        },
        // 本地存儲配置
        STORAGE: {
            CHAT_HISTORY: 'urdiary_chat_history',
            DIARIES: 'urdiary_diaries',
            USER_AVATAR: 'urdiary_user_avatar',
            THEME: 'urdiary_theme'
        },
        // 默認用戶配置
        USER: {
            DEFAULT_AVATAR: 'assets/default-avatar.png'
        },
        // 應用程序設置
        APP: {
            NAME: 'URDiary',
            VERSION: '1.0.0',
            LOG_LEVEL: 'info',
            MAX_LOGS: 1000,
            MAX_CHAT_HISTORY: 100,
            USE_MOCK_DATA: false,
            AUTO_SWITCH_TO_DIARY_AFTER_END: true,
            THEME: {
                LIGHT: 'light',
                DARK: 'dark'
            }
        },
        // 認證配置
        AUTH: {
            ENABLED: true,        // 是否啟用認證
            AUTO_LOGIN: true,     // 是否自動登入
            TOKEN_REFRESH: true,  // 是否自動刷新令牌
            SESSION_PERSIST: true // 是否在會話間保持登入狀態
        },
        // 調試選項
        DEBUG: {
            ENABLED: true,       // 是否啟用調試模式
            LOG_API_CALLS: true, // 是否記錄API調用
            MOCK_API: false      // 唯一的模擬數據開發者旗標：API 失敗時回傳模擬數據（僅供除錯，預設關閉）
        },
        // 已停用：錯誤必須如實回報，不得以模擬數據掩蓋（除錯請用 DEBUG.MOCK_API）
        USE_MOCK_DATA: false,
        AUTO_SWITCH_TO_MOCK: false
    };
    
    // 加載配置
    let loadedConfig = {};
    try {
        // 嘗試從localStorage加載設置
        // v3: 升版儲存鍵，捨棄舊快取中 USE_MOCK_DATA=true 的殘留值 (v2 為 8000→8001 埠號升版)
        const storedConfig = localStorage.getItem('urDiary_config_v3');
        if (storedConfig) {
            loadedConfig = JSON.parse(storedConfig);
            console.log('已從localStorage載入配置');
        }
    } catch (error) {
        console.warn('加載配置時出錯:', error);
    }
    
    // 合併配置
    const config = Object.assign({}, defaultConfig);
    // 深度合併配置
    if (loadedConfig.API) Object.assign(config.API, loadedConfig.API);
    if (loadedConfig.AUTH) Object.assign(config.AUTH, loadedConfig.AUTH);
    if (loadedConfig.DEBUG) Object.assign(config.DEBUG, loadedConfig.DEBUG);
    if (loadedConfig.MODELS) Object.assign(config.MODELS, loadedConfig.MODELS);
    // USE_MOCK_DATA 不再從儲存合併：避免被舊設定悄悄重新啟用，除錯一律走 DEBUG.MOCK_API
    
    // 保存配置 (鍵名須與上方載入的 urDiary_config_v3 一致，否則存了讀不回)
    function saveConfig() {
        try {
            localStorage.setItem('urDiary_config_v3', JSON.stringify(config));
            console.log('配置已保存到localStorage');
        } catch (error) {
            console.error('保存配置時出錯:', error);
        }
    }
    
    // 更新配置
    function updateConfig(newConfig) {
        // 更新配置對象
        if (newConfig.API) Object.assign(config.API, newConfig.API);
        if (newConfig.AUTH) Object.assign(config.AUTH, newConfig.AUTH);
        if (newConfig.DEBUG) Object.assign(config.DEBUG, newConfig.DEBUG);
        if (newConfig.MODELS) Object.assign(config.MODELS, newConfig.MODELS);

        // 保存到localStorage
        saveConfig();
        
        return config;
    }
    
    // 重置配置
    function resetConfig() {
        Object.assign(config, defaultConfig);
        saveConfig();
        return config;
    }
    
    // 導出配置API
    return {
        // 配置屬性
        ...config,
        
        // 配置方法
        updateConfig,
        resetConfig
    };
})();

// 確保CONFIG變量在全局範圍可用
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}

// 禁止修改配置對象
Object.freeze(CONFIG);

// 在開發環境中打印配置信息
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('應用程序配置已加載:', CONFIG);
}