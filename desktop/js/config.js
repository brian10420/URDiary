/**
 * URDiary 全局配置文件
 * 包含API設置、認證配置和其他全局參數
 */
const CONFIG = (function() {
    // 默認配置
    const defaultConfig = {
        // API配置
        API: {
            BASE_URL: 'http://localhost:8000',
            TIMEOUT: 30000,  // 默認超時時間（毫秒）
            AUTO_RETRY: true, // 自動重試失敗的請求
            MAX_RETRIES: 2,  // 最大重試次數
            ENDPOINTS: {
                CHAT: '/chat/enhanced/',
                END_CHAT: '/diary/enhanced-generate',
                DIARIES: '/diaries/'
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
            USE_MOCK_DATA: true,
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
            MOCK_API: false      // 是否使用模擬API響應
        },
        // 使用模擬數據（如果API不可用）
        USE_MOCK_DATA: true,
        // 自動切換到模擬數據模式
        AUTO_SWITCH_TO_MOCK: true
    };
    
    // 加載配置
    let loadedConfig = {};
    try {
        // 嘗試從localStorage加載設置
        const storedConfig = localStorage.getItem('urDiary_config');
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
    if (loadedConfig.USE_MOCK_DATA !== undefined) config.USE_MOCK_DATA = loadedConfig.USE_MOCK_DATA;
    
    // 保存配置
    function saveConfig() {
        try {
            localStorage.setItem('urDiary_config', JSON.stringify(config));
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
        if (newConfig.USE_MOCK_DATA !== undefined) config.USE_MOCK_DATA = newConfig.USE_MOCK_DATA;
        
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