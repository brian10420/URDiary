/**
 * URDiary - 测试脚本
 * 用于本地测试 JWT 认证功能
 */
console.log('启动测试脚本...');

// 模拟配置
window.CONFIG = {
    API: {
        BASE_URL: 'http://localhost:8000',
        TIMEOUT: 30000
    },
    AUTH: {
        ENABLED: true,
        AUTO_LOGIN: true,
        TOKEN_REFRESH: true
    },
    DEBUG: {
        ENABLED: true,
        LOG_API_CALLS: true
    },
    USE_MOCK_DATA: true
};

// 监听控制台输出
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function(...args) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('JWT')) {
        args[0] = '[JWT] ' + args[0];
    }
    originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('JWT')) {
        args[0] = '[JWT-ERROR] ' + args[0];
    }
    originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('JWT')) {
        args[0] = '[JWT-WARNING] ' + args[0];
    }
    originalConsoleWarn.apply(console, args);
};

// 模拟 localStorage
const mockStorage = {};
const originalLocalStorageGetItem = localStorage.getItem;
const originalLocalStorageSetItem = localStorage.setItem;

localStorage.getItem = function(key) {
    console.log(`[测试] 读取本地存储: ${key}`);
    if (key === 'auth_token') {
        // 记录读取 token 的操作
        console.log('[JWT] 读取认证令牌');
    }
    return originalLocalStorageGetItem.call(localStorage, key);
};

localStorage.setItem = function(key, value) {
    console.log(`[测试] 写入本地存储: ${key}`);
    if (key === 'auth_token') {
        // 记录存储 token 的操作
        console.log('[JWT] 保存认证令牌');
    }
    return originalLocalStorageSetItem.call(localStorage, key, value);
};

// 模拟 JWT 验证
const verifyJwtToken = function(token) {
    if (!token) return false;
    
    // 简单检查是否是有效的 JWT 格式
    const parts = token.split('.');
    return parts.length === 3;
};

// 检测 JWT 相关的网络请求
const originalFetch = window.fetch;
window.fetch = async function(url, options) {
    if (url.includes('/users/login') || url.includes('/users/token/refresh')) {
        console.log(`[JWT] 发送认证请求: ${url}`);
    }
    
    // 检查认证头
    if (options && options.headers && options.headers['Authorization']) {
        console.log(`[JWT] 请求包含认证头: ${options.headers['Authorization'].substring(0, 20)}...`);
    }
    
    try {
        const response = await originalFetch.apply(window, arguments);
        
        // 如果是认证相关响应，记录
        if (url.includes('/users/login') || url.includes('/users/token/refresh')) {
            console.log(`[JWT] 收到认证响应: ${response.status}`);
            
            // 克隆响应以便读取
            const clonedResponse = response.clone();
            try {
                const data = await clonedResponse.json();
                if (data.access_token) {
                    console.log('[JWT] 收到新的访问令牌');
                }
            } catch (e) {
                // 忽略解析错误
            }
        }
        
        return response;
    } catch (error) {
        console.error(`[测试] 请求失败: ${url}`, error);
        throw error;
    }
};

// 启动应用
console.log('测试环境准备完成，启动应用...'); 