/**
 * 全局配置模塊 - 應用程序配置項
 */
const CONFIG = {
    // API 相關配置
    API: {
        BASE_URL: 'http://localhost:8000',
        TIMEOUT: 30000,
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
    
    // 開發和調試相關
    DEBUG: {
        ENABLED: true,
        VERBOSE: true,
        MOCK_API: true
    },
    
    // 模擬數據配置
    USE_MOCK_DATA: true
};

// 禁止修改配置對象
Object.freeze(CONFIG);

// 在開發環境中打印配置信息
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('應用程序配置已加載:', CONFIG);
}