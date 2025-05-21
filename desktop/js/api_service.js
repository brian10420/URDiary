/**
 * API服務模塊 - 處理與後端的所有通信
 */
const ApiService = (function() {
    // API基礎URL
    let API_BASE_URL = 'http://localhost:8000';
    
    // 用戶ID（暫時靜態設置，後續可從登錄過程獲取）
    let currentUserId = localStorage.getItem('currentUserId') || 'desktop_user';
    let numericUserId = parseInt(localStorage.getItem('numericUserId') || '1');
    
    // JWT令牌存儲
    let accessToken = localStorage.getItem('auth_token') || null;
    let tokenExpiry = localStorage.getItem('token_expiry') ? new Date(localStorage.getItem('token_expiry')) : null;
    
    // 初始化狀態標誌
    let isInitialized = false;
    
    // 初始化方法
    function init() {
        if (isInitialized) {
            console.log('API 服務已初始化，跳過');
            return true;
        }
        
        console.log('初始化 API 服務');
        // 從配置中獲取 API URL
        if (typeof CONFIG !== 'undefined' && CONFIG.API && CONFIG.API.BASE_URL) {
            API_BASE_URL = CONFIG.API.BASE_URL;
            console.log('使用配置的 API URL:', API_BASE_URL);
        }
        
        // 設置初始化標誌
        isInitialized = true;
        
        // 顯示初始化信息
        console.log('API 服務初始化完成，基礎 URL:', API_BASE_URL);
        return true;
    }
    
    // 確保服務已初始化
    function ensureInitialized() {
        if (!isInitialized) {
            init();
        }
        return isInitialized;
    }
    
    // 日誌
    function logAPI(type, endpoint, data, response) {
        if (window.Logger) {
            Logger.info(`API ${type}: ${endpoint}`, {
                request: data,
                response: response
            });
        } else {
            console.log(`API ${type}: ${endpoint}`, data, response);
        }
    }
    
    /**
     * 設置認證令牌
     * @param {string} token - JWT令牌
     * @param {number} expiresIn - 過期時間（秒）
     */
    function setAuthToken(token, expiresIn) {
        if (!token) return;
        
        accessToken = token;
        
        // 計算過期時間
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + expiresIn);
        tokenExpiry = expiryDate;
        
        // 保存到本地存儲
        localStorage.setItem('auth_token', token);
        localStorage.setItem('token_expiry', expiryDate.toISOString());
        
        console.log(`認證令牌已設置，有效期至: ${expiryDate.toLocaleString()}`);
    }
    
    /**
     * 清除認證令牌
     */
    function clearAuthToken() {
        accessToken = null;
        tokenExpiry = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('token_expiry');
        console.log('認證令牌已清除');
    }
    
    /**
     * 檢查令牌是否即將過期（默認閾值為5分鐘）
     * @returns {boolean} 是否即將過期
     */
    function isTokenExpiringSoon(thresholdMinutes = 5) {
        if (!accessToken || !tokenExpiry) return true;
        
        const now = new Date();
        const thresholdTime = new Date(now.getTime() + thresholdMinutes * 60 * 1000);
        
        return tokenExpiry <= thresholdTime;
    }
    
    /**
     * 嘗試刷新令牌
     * @returns {Promise<boolean>} 是否成功刷新
     */
    async function refreshToken() {
        if (!accessToken) return false;
        
        try {
            const response = await fetch(`${API_BASE_URL}/users/token/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.warn('刷新令牌失敗:', response.status);
                return false;
            }
            
            const data = await response.json();
            setAuthToken(data.access_token, data.expires_in);
            return true;
        } catch (error) {
            console.error('刷新令牌出錯:', error);
            return false;
        }
    }
    
    /**
     * 發送API請求
     * @param {string} endpoint - API端點
     * @param {Object} options - 請求選項
     * @returns {Promise<Object>} - 響應數據
     */
    async function fetchAPI(endpoint, options = {}) {
        // 確保API服務已初始化
        ensureInitialized();
    
        const startTime = Date.now();
        
        try {
            // 檢查網絡連接 - 改進檢測邏輯
            if (!navigator.onLine) {
                console.warn(`設備處於離線狀態 (${endpoint})，嘗試使用模擬數據`);
                
                // 直接拋出特定錯誤
                throw new Error('OFFLINE_MODE');
            }
            
            // 優先從配置中取得 API URL
            const baseUrl = CONFIG && CONFIG.API && CONFIG.API.BASE_URL ? 
                CONFIG.API.BASE_URL : 'http://localhost:8000';
            
            // 完全移除API可用性檢測（避免因405錯誤導致不必要的問題）
            // 相反，我們將依賴後續的真實請求來確定API是否可用
                
            // 檢查令牌，如果即將過期則嘗試刷新
            if (accessToken && isTokenExpiringSoon()) {
                console.log('令牌即將過期，嘗試刷新...');
                const refreshed = await refreshToken();
                
                // 如果令牌刷新失敗，記錄錯誤但繼續嘗試使用當前令牌
                if (!refreshed) {
                    console.warn('令牌刷新失敗，將使用當前令牌繼續嘗試');
                    // 不清除當前令牌，因為它可能仍然有效
                }
            }
            
            // 構建完整URL
            const url = `${baseUrl}${endpoint}`;
            
            // 設置默認選項
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Client': 'URDiary-ElectronApp',
                    ...options.headers
                }
            };
            
            // 添加認證令牌（如果有）
            if (accessToken) {
                fetchOptions.headers['Authorization'] = `Bearer ${accessToken}`;
            }
            
            // 如果有body，將其轉換為JSON
            if (options.body) {
                fetchOptions.body = JSON.stringify(options.body);
            }
            
            console.log(`發送請求到: ${url}`, { method: fetchOptions.method });
            
            // 將請求信息添加到系統日誌
            try {
                if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureInfo === 'function') {
                    ErrorLogger.captureInfo('API請求', { 
                        endpoint, 
                        method: fetchOptions.method,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (logError) {
                console.warn('記錄API請求信息失敗:', logError);
                // 繼續處理，不影響主流程
            }
            
            // 使用AbortController設置超時 - 增加超時時間，特別是對於結束聊天請求
            const isEndChatRequest = endpoint.includes('/chat/end/') || endpoint.includes('/diary/enhanced-generate');
            // 為結束聊天請求設置更長的超時時間
            const timeoutDuration = isEndChatRequest ? 
                180000 : // 180秒（3分鐘）
                (CONFIG && CONFIG.API && CONFIG.API.TIMEOUT ? CONFIG.API.TIMEOUT : 30000); // 默認30秒
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                console.warn(`請求超時: ${url} (${timeoutDuration}ms)`);
                controller.abort(`請求超時 (${timeoutDuration}ms)`);
            }, timeoutDuration);
            
            fetchOptions.signal = controller.signal;
            
            // 發送請求
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            // 檢查是否為401未授權錯誤
            if (response.status === 401 && accessToken) {
                console.warn('認證令牌已過期或無效 (401)');
                
                // 記錄詳細錯誤信息
                try {
                    const errorData = await response.json();
                    console.warn('認證錯誤詳情:', errorData);
                    
                    // 添加到錯誤日誌
                    if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureError === 'function') {
                        ErrorLogger.captureError(new Error('JWT認證錯誤'), {
                            type: 'auth',
                            context: endpoint,
                            details: errorData
                        });
                    }
                } catch (e) {
                    console.warn('無法獲取認證錯誤詳情');
                }
                
                // 清除令牌
                clearAuthToken();
                
                // 使用指定的錯誤碼
                throw new Error('JWT_AUTH_ERROR');
            }
            
            // 檢查是否為403禁止訪問錯誤（可能是權限問題）
            if (response.status === 403) {
                console.warn('無權訪問資源 (403)');
                
                // 擷取錯誤詳情
                try {
                    const errorData = await response.json();
                    console.warn('權限錯誤詳情:', errorData);
                    
                    // 添加到錯誤日誌
                    if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureError === 'function') {
                        ErrorLogger.captureError(new Error('權限錯誤'), {
                            type: 'permission',
                            context: endpoint,
                            details: errorData
                        });
                    }
                } catch (e) {
                    console.warn('無法獲取權限錯誤詳情');
                }
                
                throw new Error('PERMISSION_ERROR');
            }
            
            // 檢查響應是否成功
            if (!response.ok) {
                // 獲取錯誤響應
                let errorData = {};
                let errorText = '';
                
                try {
                    // 嘗試獲取JSON錯誤
                    try {
                        errorData = await response.json();
                        errorText = errorData.detail || errorData.error || errorData.message || `HTTP錯誤 ${response.status}`;
                    } catch (jsonError) {
                        // 如果不是JSON，獲取文本
                    errorText = await response.text();
                    }
                } catch (textError) {
                    errorText = `HTTP錯誤 ${response.status}`;
                }
                
                // 檢查錯誤信息中是否包含JWT相關關鍵詞
                const isJwtError = errorText.toLowerCase().includes('token') || 
                                  errorText.toLowerCase().includes('jwt') ||
                                  errorText.toLowerCase().includes('auth') || 
                                  errorText.toLowerCase().includes('認證');
                
                if (isJwtError) {
                    console.warn('JWT相關錯誤:', errorText);
                    
                    // JWT錯誤時可以嘗試清除令牌，以便下次重新獲取
                    clearAuthToken();
                    
                    throw new Error('JWT_ERROR_IN_RESPONSE');
                }
                
                // 記錄服務器錯誤
                const isServerError = response.status >= 500 && response.status < 600;
                if (isServerError) {
                    console.error(`服務器內部錯誤 (${response.status}):`, errorText);
                    
                    // 添加到錯誤日誌
                    if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureError === 'function') {
                        ErrorLogger.captureError(new Error(`服務器錯誤 ${response.status}`), {
                            type: 'server',
                            context: endpoint,
                            details: errorData
                        });
                    }
                    
                    throw new Error('SERVER_ERROR');
                }
                
                // 其他HTTP錯誤
                console.error(`API錯誤 (${response.status}):`, errorText);
                
                // 構建詳細錯誤信息
                const errorInfo = {
                    status: response.status,
                    detail: errorText,
                    error: errorData.error || 'api_error',
                    request_id: errorData.request_id || null,
                    code: errorData.code || null
                };
                
                // 添加到錯誤日誌
                if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureError === 'function') {
                    ErrorLogger.captureError(new Error(`API錯誤 ${response.status}`), {
                        type: 'api',
                        context: endpoint,
                        details: errorInfo
                    });
                }
                
                throw new Error(`API_ERROR:${response.status}`);
            }
            
            // 嘗試解析JSON響應
            let data;
            try {
                data = await response.json();
            } catch (jsonError) {
                console.warn('無法解析響應為JSON:', jsonError);
                // 嘗試獲取文本響應
                const textResponse = await response.text();
                
                if (textResponse.trim().length === 0) {
                    data = {}; // 空響應
                } else {
                    data = { text: textResponse }; // 包裝文本響應
                }
            }
            
            // 記錄請求時間
            const requestTime = Date.now() - startTime;
            console.log(`API請求完成: ${endpoint} (${requestTime}ms)`);
            
            // 將響應添加到系統日誌
            try {
                if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureInfo === 'function') {
                    ErrorLogger.captureInfo('API響應', { 
                        endpoint, 
                        status: response.status,
                        time: requestTime,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (logError) {
                console.warn('記錄API響應信息失敗:', logError);
            }
            
            return data;
        } catch (error) {
            const requestTime = Date.now() - startTime;
            console.error(`API請求失敗 (${requestTime}ms):`, error);
            
            // 將錯誤添加到系統日誌
            try {
                if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.captureError === 'function') {
                    ErrorLogger.captureError(error, { 
                        type: 'api', 
                        context: endpoint,
                        time: requestTime
                    });
                }
            } catch (logError) {
                console.warn('記錄API錯誤信息失敗:', logError);
            }
            
            // 獲取錯誤碼 - 從自定義錯誤中提取
            const errorMatches = error.message.match(/^([A-Z_]+)($|:)/);
            const errorCode = errorMatches ? errorMatches[1] : null;
            const httpStatus = error.message.split(':')[1]; // 如果是HTTP錯誤，提取狀態碼
            
            console.log(`識別錯誤類型: ${errorCode || '未知'}, HTTP狀態: ${httpStatus || 'N/A'}`);
            
            // 根據錯誤類型決定如何處理
            switch (errorCode) {
                case 'OFFLINE_MODE':
                    console.log('設備處於離線模式，使用模擬數據');
                    return getMockDataForEndpoint(endpoint, { ...options, errorType: 'offline' });
                    
                case 'JWT_AUTH_ERROR':
                case 'JWT_ERROR_IN_RESPONSE':
                    console.log('JWT認證錯誤，使用模擬數據並通知用戶');
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast('認證失敗，請重新登入');
                    }
                    return getMockDataForEndpoint(endpoint, { ...options, errorType: 'auth' });
                    
                case 'PERMISSION_ERROR':
                    console.log('權限錯誤，使用模擬數據並通知用戶');
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast('您沒有權限執行此操作');
                    }
                    return getMockDataForEndpoint(endpoint, { ...options, errorType: 'permission' });
                    
                case 'SERVER_ERROR':
                    console.log('服務器錯誤，使用模擬數據');
                    return getMockDataForEndpoint(endpoint, { ...options, errorType: 'server' });
                    
                case 'API_ERROR':
                    console.log(`API錯誤 (${httpStatus})，檢查是否可降級`);
                    
                    // 針對特定端點的降級策略
                    if (endpoint.includes('/chat/') || endpoint.includes('/diary/')) {
                        return getMockDataForEndpoint(endpoint, { ...options, errorType: 'api', status: httpStatus });
                    }
                    break;
                    
                default:
                    // 處理其他類型的錯誤
                    if (error.name === 'AbortError') {
                        console.log('請求超時，使用模擬數據');
                        return getMockDataForEndpoint(endpoint, { ...options, errorType: 'timeout' });
                    }
                    
                    if (error.name === 'TypeError' || error.name === 'NetworkError') {
                        console.log('網絡錯誤，使用模擬數據');
                        return getMockDataForEndpoint(endpoint, { ...options, errorType: 'network' });
                    }
                    
                    // 檢查是否有本地備份
            if (endpoint.includes('/diaries') || endpoint.includes('/notes')) {
                console.log('嘗試使用本地數據作為備份...');
                const localData = getLocalData(endpoint);
                if (localData) {
                    console.log('使用本地備份數據:', endpoint);
                    return localData;
                        }
                    }
            }
            
            // 如果配置了自動使用模擬數據，對所有錯誤使用模擬數據
            if (CONFIG && CONFIG.USE_MOCK_DATA) {
                console.log('使用模擬數據作為最後的後備方案');
                return getMockDataForEndpoint(endpoint, { ...options, errorType: 'fallback' });
            }
            
            // 重新拋出錯誤，如果無法處理
            throw new Error(`API請求失敗: ${error.message}`);
        }
    }
    
    /**
     * 獲取本地存儲的數據作為備份
     * @param {string} endpoint - API端點
     * @returns {Object|null} - 本地數據或null
     */
    function getLocalData(endpoint) {
        try {
            const key = `urDiary_${endpoint.replace(/\//g, '_')}`;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('獲取本地數據出錯:', error);
            return null;
        }
    }
    
    /**
     * 保存數據到本地存儲
     * @param {string} endpoint - API端點
     * @param {Object} data - 要保存的數據
     */
    function saveLocalData(endpoint, data) {
        try {
            const key = `urDiary_${endpoint.replace(/\//g, '_')}`;
            localStorage.setItem(key, JSON.stringify(data));
            console.log(`數據已保存到本地: ${key}`);
        } catch (error) {
            console.error('保存本地數據出錯:', error);
        }
    }
    
    // 模擬API調用延遲
    async function mockApiCall(data, delay = 1000) {
        console.warn('使用模擬API調用:', data);
        return new Promise(resolve => {
            setTimeout(() => resolve(data), delay);
        });
    }
    
    // 根據端點獲取模擬數據
    function getMockDataForEndpoint(endpoint, options = {}) {
        console.log(`獲取模擬數據: ${endpoint}`, options);
        
        // 提取錯誤類型（如果有）
        const { errorType, status } = options;
        
        // 檢查是否處於離線模式
        const isOffline = errorType === 'offline';
        
        // 檢查是否為認證錯誤
        const isAuthError = errorType === 'auth';
        
        // 檢查是否為權限錯誤
        const isPermissionError = errorType === 'permission';
        
        // 用於響應的通用信息
        let message = '使用模擬數據響應';
        if (isOffline) {
            message = '設備處於離線模式，使用模擬數據';
        } else if (isAuthError) {
            message = '認證失敗，請重新登入以訪問此功能';
        } else if (isPermissionError) {
            message = '您沒有權限訪問此功能';
        }
        
        // 添加通用錯誤信息到所有模擬響應
        const commonErrorInfo = {
            _mock: true,
            _error: errorType || null,
            _status: status || null,
            _message: message
        };

        // 在登錄端點中添加模擬 JWT token
        if (endpoint === '/auth/login' || endpoint.includes('/login')) {
            // 檢查登入類型的不同情況
            if (isAuthError) {
                return {
                    ...commonErrorInfo,
                    success: false,
                    error: 'AUTH_FAILED',
                    message: '用戶名或密碼錯誤'
                };
            }
            
            // 如果是離線模式，生成本地的 token
            const mockToken = 'MOCK_JWT_' + Date.now();
                return {
                ...commonErrorInfo,
                success: true,
                token: mockToken,
                user: {
                    id: 'local_user',
                    username: options.data?.username || 'local_user',
                    name: '離線用戶',
                    role: 'local'
                },
                message: '使用本地模擬登入'
            };
        }

        // 聊天相關端點的模擬數據
        if (endpoint.includes('/chat/')) {
            if (endpoint.includes('/chat/start')) {
                return {
                    ...commonErrorInfo,
                    success: true,
                    chatId: 'mock_chat_' + Date.now(),
                    message: isAuthError ? '聊天記錄無法同步到服務器' : '開始新的聊天'
                };
            }
            
            if (endpoint.includes('/chat/message')) {
                return {
                    ...commonErrorInfo,
                    success: true,
                    messageId: 'mock_msg_' + Date.now(),
                    response: options.data?.message 
                        ? `這是對"${options.data.message}"的模擬回應。${message}` 
                        : `模擬回應。${message}`,
                    save_locally: true
                };
            }
            
            if (endpoint.includes('/chat/end')) {
                const summary = isAuthError
                    ? "聊天已結束，但由於認證問題無法保存到服務器。內容已本地保存。"
                    : "聊天已結束。由於使用模擬數據，內容僅保存在本地。";
                    
                const generatedContent = {
                    title: "模擬日記標題",
                    content: options.data?.messages 
                        ? "基於您的聊天記錄生成的模擬內容。" 
                        : "模擬日記內容。",
                    summary: summary
                };
                
                return {
                    ...commonErrorInfo,
                    success: true,
                    diary: generatedContent,
                    message: summary
                };
            }
        }

        // 日記相關端點的模擬數據
        if (endpoint.includes('/diary/')) {
            if (endpoint.includes('/list')) {
                return {
                    ...commonErrorInfo,
                    success: true,
                    diaries: [],
                    message: `模擬日記列表 ${message}`
                };
            }
            
            if (endpoint.includes('/save') || endpoint.includes('/create')) {
                const saveMessage = isAuthError
                    ? "日記已本地保存，但無法同步到服務器。請登入後再次嘗試同步。"
                    : "日記已使用模擬數據保存在本地。";
                    
                return {
                    ...commonErrorInfo,
                    success: true,
                    diaryId: 'mock_diary_' + Date.now(),
                    local_only: true,
                    message: saveMessage
                };
            }
            
            if (endpoint.includes('/enhanced-generate')) {
                return {
                    ...commonErrorInfo,
                    success: true,
                    content: "這是根據您的輸入生成的模擬日記內容。",
                    title: "模擬生成的日記標題",
                    message: isAuthError 
                        ? "日記已生成，但無法使用所有增強功能。請登入以獲取完整體驗。" 
                        : "使用模擬數據生成的日記內容"
                };
            }
        }

        // 默認模擬數據
        return {
            ...commonErrorInfo,
            success: true,
            message: `${endpoint} 的默認模擬響應`
        };
    }
    
    // 發送聊天消息
    async function sendChatMessage(message, model = null) {
        try {
            console.log(`開始發送聊天消息${model ? `(模型: ${model})` : ''}:`, message.substring(0, 50) + (message.length > 50 ? '...' : ''));
            
            // 檢查網絡連接
            if (!navigator.onLine) {
                console.warn('設備處於離線狀態，使用離線模式');
                throw new Error('網絡連接不可用');
            }
            
            // 最大重試次數
            const maxRetries = CONFIG && CONFIG.API && CONFIG.API.MAX_RETRIES ? CONFIG.API.MAX_RETRIES : 1;
            let retryCount = 0;
            let lastError = null;
            
            while (retryCount <= maxRetries) {
                try {
            // 直接調用chat/enhanced端點
            const data = await fetchAPI('/chat/enhanced/', {
                method: 'POST',
                body: {
                    user_id: currentUserId,
                    numeric_user_id: numericUserId,
                    message: message,
                    model: model // 添加模型參數
                }
            });
            
            console.log('聊天API返回原始數據:', data);
            
            // 標準化響應格式
            let response;
            if (typeof data === 'string') {
                response = { message: data, response: data };
            } else if (data && data.response) {
                response = { 
                    message: data.response,
                    response: data.response,
                    ...data
                };
            } else if (data && data.message) {
                response = {
                    response: data.message,
                    ...data
                };
            } else {
                response = {
                    message: '無法解析服務器響應',
                    response: '抱歉，無法處理您的請求。'
                };
            }
            
            console.log('標準化後的響應:', response);
            return response;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    
                    // 只有在重試次數未達到最大值且錯誤是服務器錯誤(500系列)時才重試
                    const isServerError = error.message.includes('500') || 
                                         error.message.includes('服務器內部錯誤') || 
                                         error.message.includes('伺服器內部錯誤');
                    
                    if (retryCount <= maxRetries && isServerError) {
                        console.warn(`嘗試第 ${retryCount} 次重新發送消息...`);
                        // 等待一段時間再重試，避免立即重試造成服務器負擔
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        // 不再重試，拋出錯誤
                        break;
                    }
                }
            }
            
            // 如果所有重試都失敗，拋出錯誤
            throw lastError || new Error('發送消息失敗');
        } catch (error) {
            console.error('發送消息錯誤:', error);
            
            // 解析錯誤信息
            let errorDetail = '';
            try {
                if (error.message.includes('{')) {
                    const errorJson = error.message.substring(error.message.indexOf('{'));
                    const errorObj = JSON.parse(errorJson);
                    if (errorObj.detail) {
                        errorDetail = errorObj.detail;
                    }
                }
            } catch (parseError) {
                console.warn('無法解析錯誤詳情', parseError);
            }
            
            // 使用模擬數據作為備份
            if (CONFIG && (CONFIG.USE_MOCK_DATA || CONFIG.DEBUG.MOCK_API)) {
                console.log('使用模擬數據作為備份響應');
                const mockResponse = getRandomResponse();
                
                // 添加錯誤信息提示
                let responseMessage = mockResponse;
                if (errorDetail) {
                    // 將詳細錯誤信息添加到模擬響應中
                    responseMessage = `[注意: 伺服器暫時不可用 - ${errorDetail}]\n\n${mockResponse}`;
                }
                
                return {
                    message: responseMessage,
                    response: responseMessage,
                    is_mock: true,
                    error_detail: errorDetail || error.message,
                    model_used: model || 'mock'
                };
            }
            
            // 返回錯誤消息
            return {
                message: errorDetail ? `發送消息時出錯: ${errorDetail}` : '發送消息時出錯: ' + error.message,
                response: '抱歉，我遇到了技術問題。請稍後再試。',
                error: true
            };
        }
    }
    
    // 結束聊天並生成日記
    async function endChat(model = null) {
        try {
            console.log(`調用API結束聊天並生成日記${model ? `(模型: ${model})` : ''}`);
            
            // 檢查網絡連接
            if (!navigator.onLine) {
                console.warn('設備處於離線狀態，使用離線模式');
                throw new Error('網絡連接不可用');
            }
            
            // 最大重試次數
            const maxRetries = CONFIG && CONFIG.API && CONFIG.API.MAX_RETRIES ? CONFIG.API.MAX_RETRIES : 1;
            let retryCount = 0;
            let lastError = null;
            
            while (retryCount <= maxRetries) {
                try {
            // 使用較長的超時時間
            const data = await fetchAPI('/chat/end/', {
                method: 'POST',
                body: {
                    user_id: currentUserId,
                    numeric_user_id: numericUserId,
                    exclude_interaction_notes: true,  // 添加參數，防止將互動筆記融入日記
                    model: model  // 添加模型參數
                }
            });
            
            console.log('生成日記API響應:', data);
            
            // 檢查響應數據
            if (!data || (!data.success && !data.diary)) {
                console.warn('API返回的數據缺少必要字段');
                throw new Error('無效的API響應數據');
            }
            
            return data;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    
                    // 只有在重試次數未達到最大值且錯誤是服務器錯誤(500系列)時才重試
                    const isServerError = error.message.includes('500') || 
                                         error.message.includes('服務器內部錯誤') || 
                                         error.message.includes('伺服器內部錯誤');
                    
                    if (retryCount <= maxRetries && isServerError) {
                        console.warn(`嘗試第 ${retryCount} 次結束聊天...`);
                        // 等待時間稍微長一些，結束聊天是重操作
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        // 不再重試，拋出錯誤
                        break;
                    }
                }
            }
            
            // 如果所有重試都失敗，拋出錯誤
            throw lastError || new Error('結束聊天失敗');
        } catch (error) {
            console.error('結束聊天錯誤:', error);
            
            // 解析錯誤信息
            let errorDetail = '';
            try {
                if (error.message.includes('{')) {
                    const errorJson = error.message.substring(error.message.indexOf('{'));
                    const errorObj = JSON.parse(errorJson);
                    if (errorObj.detail) {
                        errorDetail = errorObj.detail;
                    }
                }
            } catch (parseError) {
                console.warn('無法解析錯誤詳情', parseError);
            }
            
            // 使用模擬數據作為備份
            if (CONFIG && CONFIG.USE_MOCK_DATA) {
                console.log('使用模擬數據作為結束聊天響應');
                const mockData = getMockDataForEndpoint('/chat/end/');
                
                // 若存在錯誤詳情，將其添加到模擬日記內容中
                if (errorDetail && mockData.diary && mockData.diary.content) {
                    const errorNote = `\n\n**系統通知**: 日記是在離線模式下生成的。伺服器錯誤: ${errorDetail}`;
                    mockData.diary.content += errorNote;
                    mockData.error_detail = errorDetail;
                }
                
                // 添加使用的模型信息
                mockData.model_used = model || 'mock';
                
                return mockData;
            }
            
            // 如果不使用模擬數據，則拋出錯誤
            throw new Error(errorDetail ? `結束聊天失敗: ${errorDetail}` : `結束聊天失敗: ${error.message}`);
        }
    }
    
    // 獲取日記列表
    async function getDiaries() {
        try {
            console.log('正在獲取日記列表...');
            
            const path = `/diaries/${numericUserId}`;
            let response;
            
            // 嘗試從 API 獲取
            try {
                response = await fetchAPI(path, { method: 'GET' });
                console.log('從 API 獲取日記成功');
            } catch (apiError) {
                console.warn('從 API 獲取日記失敗:', apiError);
                
                if (CONFIG.USE_MOCK_DATA) {
                    console.log('使用模擬數據');
                    response = getMockDataForEndpoint('/diaries/1');
                } else {
                    throw apiError;
                }
            }
            
            // 驗證響應格式
            if (!response || !response.diaries || !Array.isArray(response.diaries)) {
                console.error('日記數據格式不正確:', response);
                
                // 使用本地數據作為備份
                const localData = getLocalData(path);
                if (localData && localData.diaries && Array.isArray(localData.diaries)) {
                    console.log('使用本地備份數據');
                    return localData.diaries;
                }
                
                // 如果還是失敗，使用模擬數據
                if (CONFIG.USE_MOCK_DATA) {
                    console.log('使用空模擬日記列表');
                    return generateSampleDiaries();
                }
                
                return [];
            }
            
            // 轉換數據格式
            const diaries = response.diaries.map(diary => ({
                id: diary.diary_id || generateId(),
                title: diary.title || '無標題日記',
                content: diary.content || '',
                date: diary.diary_date || new Date().toISOString(),
                mood: getMoodFromValence(diary.valence),
                valence: diary.valence || 0.5,
                arousal: diary.arousal || 0.5
            }));
            
            // 保存到本地存儲作為備份
            saveLocalData(path, { diaries });
            
            console.log(`成功獲取 ${diaries.length} 條日記`);
            return diaries;
        } catch (error) {
            console.error('獲取日記列表失敗:', error);
            
            // 使用模擬數據
            if (CONFIG.USE_MOCK_DATA) {
                console.log('使用模擬日記列表');
                return generateSampleDiaries();
            }
            
            throw new Error(`獲取日記失敗: ${error.message}`);
        }
    }
    
    // 根據ID獲取日記詳情
    async function getDiaryById(id) {
        try {
            // 先從本地獲取
            const localDiaries = getLocalData(`/diaries/${numericUserId}`);
            if (localDiaries && localDiaries.diaries) {
                const diary = localDiaries.diaries.find(d => d.diary_id === id || d.id === id);
                if (diary) {
                    return {
                        id: diary.diary_id || diary.id,
                        title: diary.title,
                        content: diary.content,
                        date: diary.diary_date || diary.date,
                        mood: getMoodFromValence(diary.valence),
                        valence: diary.valence,
                        arousal: diary.arousal
                    };
                }
            }
            
            // 從API獲取
            const response = await fetchAPI(`/diary/${id}`, { method: 'GET' });
            
            return {
                id: response.diary_id,
                title: response.title,
                content: response.content,
                date: response.diary_date,
                mood: getMoodFromValence(response.valence),
                valence: response.valence,
                arousal: response.arousal
            };
        } catch (error) {
            console.error(`獲取日記詳情失敗 (ID: ${id}):`, error);
            throw error;
        }
    }
    
    // 獲取互動筆記列表
    async function getNotes() {
        console.log('開始獲取互動筆記列表，用戶ID:', numericUserId);
        try {
            // 檢查CONFIG是否定義
            if (typeof CONFIG === 'undefined') {
                console.warn('CONFIG未定義，無法獲取筆記');
                throw new Error('配置未初始化');
            }
            
            // 檢查用戶ID
            if (!numericUserId) {
                console.warn('用戶ID不存在，使用默認ID');
                numericUserId = 1;
            }
            
            // 構建API端點
            const notesEndpoint = CONFIG.API.ENDPOINTS.NOTES || '/api/notes';
            const endpoint = `${notesEndpoint}/${numericUserId}`;
            console.log('筆記API端點:', endpoint);
            
            // 發送請求
            const data = await fetchAPI(endpoint, { method: 'GET' });
            console.log('成功獲取筆記數據', data);
            
            // 驗證並處理響應數據
            let notes = [];
            if (data && Array.isArray(data)) {
                // 轉換為客戶端格式
                notes = data.map(note => ({
                    id: note.note_id?.toString() || note.id?.toString() || generateId(),
                    title: note.title || '未命名筆記',
                    content: note.content || '',
                    created: note.created_at || note.created || new Date().toISOString(),
                    updated: note.updated_at || note.updated || new Date().toISOString(),
                    tags: note.tags || []
                }));
                
                console.log(`處理後的筆記數據: ${notes.length}條記錄`);
            } else if (data && typeof data === 'object') {
                // 嘗試處理非數組對象
                console.warn('API返回的筆記數據不是數組，嘗試轉換');
                
                if (Array.isArray(data.notes)) {
                    notes = data.notes.map(note => ({
                        id: note.note_id?.toString() || note.id?.toString() || generateId(),
                        title: note.title || '未命名筆記',
                        content: note.content || '',
                        created: note.created_at || note.created || new Date().toISOString(),
                        updated: note.updated_at || note.updated || new Date().toISOString(),
                        tags: note.tags || []
                    }));
                } else {
                    // 將對象轉換為數組
                    const noteItems = Object.values(data).filter(item => item && typeof item === 'object');
                    notes = noteItems.map(note => ({
                        id: note.note_id?.toString() || note.id?.toString() || generateId(),
                        title: note.title || '未命名筆記',
                        content: note.content || '',
                        created: note.created_at || note.created || new Date().toISOString(),
                        updated: note.updated_at || note.updated || new Date().toISOString(),
                        tags: note.tags || []
                    }));
                }
                
                console.log(`從對象轉換的筆記數據: ${notes.length}條記錄`);
            } else {
                console.error('API返回的筆記數據格式不正確:', typeof data);
                throw new Error('API返回的筆記數據格式不正確');
            }
            
            // 存儲到本地
            try {
                const storageKey = CONFIG.STORAGE.NOTES || 'urd_notes';
                localStorage.setItem(storageKey, JSON.stringify(notes));
                console.log('筆記數據已保存到本地存儲');
            } catch (storageError) {
                console.warn('無法將筆記保存到本地存儲:', storageError);
                ErrorLogger.captureError(storageError, { type: 'storage', context: 'save-notes' });
            }
            
            return notes;
        } catch (error) {
            console.error('獲取筆記列表失敗:', error);
            if (window.Logger) {
                Logger.error('獲取筆記列表失敗', { error: error.message });
            }
            ErrorLogger.captureError(error, { type: 'api', context: 'get-notes' });
            
            // 嘗試從本地存儲獲取
            console.log('嘗試從本地存儲獲取筆記數據');
            let localNotes = [];
            try {
                const storageKey = CONFIG.STORAGE.NOTES || 'urd_notes';
                const stored = localStorage.getItem(storageKey);
                if (stored) {
                    localNotes = JSON.parse(stored);
                    console.log('成功從本地存儲獲取筆記:', localNotes.length);
                    return localNotes;
                }
            } catch (localError) {
                console.error('讀取本地筆記失敗:', localError);
                ErrorLogger.captureError(localError, { type: 'storage', context: 'read-local-notes' });
            }
            
            // 生成示例筆記
            console.log('生成示例筆記數據');
            localNotes = [
                {
                    id: generateId(),
                    title: '示例筆記 1',
                    content: '這是一個示例筆記，當無法連接到API時會顯示此內容。您可以編輯或刪除這個筆記。',
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                    tags: ['示例']
                },
                {
                    id: generateId(),
                    title: '如何使用互動筆記',
                    content: '互動筆記會記錄您與系統的重要互動。通過聊天產生的重要內容將自動保存為筆記，您也可以手動創建和編輯筆記。',
                    created: new Date(Date.now() - 86400000).toISOString(),
                    updated: new Date(Date.now() - 86400000).toISOString(),
                    tags: ['幫助', '指南']
                }
            ];
            
            // 存儲到本地
            try {
                const storageKey = CONFIG.STORAGE.NOTES || 'urd_notes';
                localStorage.setItem(storageKey, JSON.stringify(localNotes));
                console.log('示例筆記已保存到本地存儲');
            } catch (storageError) {
                console.warn('無法將示例筆記保存到本地存儲:', storageError);
                ErrorLogger.captureError(storageError, { type: 'storage', context: 'save-sample-notes' });
            }
            
            return localNotes;
        }
    }
    
    // 保存筆記 (用於手動編輯筆記，互動筆記通常由系統更新)
    async function saveNote(note) {
        // 目前互動筆記不支持手動編輯，將來可以實現
        console.warn('保存筆記:', note);
        UIManager.showToast('注意: 互動筆記由系統自動生成，暫不支持手動編輯');
        
        return {
            success: false,
            message: '互動筆記不支持手動編輯'
        };
    }
    
    // 刪除筆記 (互動筆記通常不應刪除)
    async function deleteNote(noteId) {
        console.warn('嘗試刪除筆記:', noteId);
        UIManager.showToast('注意: 互動筆記不可刪除');
        
        return {
            success: false,
            message: '互動筆記不可刪除'
        };
    }
    
    // 從情緒值獲取情緒標籤
    function getMoodFromValence(valence) {
        if (typeof valence !== 'number') {
            return 'neutral';
        }
        
        if (valence >= 0.7) return 'happy';
        if (valence >= 0.4) return 'calm';
        if (valence >= 0) return 'neutral';
        if (valence >= -0.4) return 'sad';
        return 'angry';
    }
    
    // 生成唯一ID
    function generateId() {
        return 'diary_' + Math.random().toString(36).substr(2, 9);
    }
    
    // 獲取隨機回應 (用於模擬和後備)
    function getRandomResponse() {
        const responses = [
            '我理解您的意思了。請繼續說。',
            '這是個有趣的觀點。您能詳細解釋一下嗎？',
            '謝謝您分享這個想法。還有其他方面您想討論嗎？',
            '我明白了。關於這個話題，您有什麼具體的問題嗎？',
            '這是個很好的問題。讓我想想...',
            '您的經歷非常寶貴。能分享更多細節嗎？',
            '我注意到您對這個話題很感興趣。有什麼特別的原因嗎？',
            '我們可以從另一個角度思考這個問題。',
            '這讓我想起了一個類似的情況...',
            '您的想法很有創意。我們可以進一步探討這個方向。'
        ];
        
        return responses[Math.floor(Math.random() * responses.length)];
    }
    
    // 生成示例日記數據
    function generateSampleDiaries() {
        const sampleDiaries = [
            {
                id: 'diary1',
                title: '美好的一天',
                content: '今天是個陽光明媚的日子，我心情很好。早上和朋友一起去公園散步，然後去了一家新開的咖啡店。咖啡的香氣和朋友的笑聲讓這一天變得特別美好。',
                date: new Date(Date.now() - 3600000 * 24).toISOString(),
                mood: 'happy',
                valence: 0.8,
                arousal: 0.6
            },
            {
                id: 'diary2',
                title: '工作的挑戰',
                content: '今天工作中遇到了一些挑戰，一個項目出現了意想不到的問題。雖然有些困難，但我和團隊一起找到了解決方案。這讓我意識到團隊合作的重要性。',
                date: new Date(Date.now() - 3600000 * 48).toISOString(),
                mood: 'neutral',
                valence: 0.3,
                arousal: 0.7
            },
            {
                id: 'diary3',
                title: '安靜的夜晚',
                content: '今晚很安靜，我獨自一人在家，聽著輕柔的音樂，看著最喜歡的書。有時候，這樣的獨處時光也很珍貴，讓我有機會思考和放鬆。',
                date: new Date(Date.now() - 3600000 * 72).toISOString(),
                mood: 'calm',
                valence: 0.6,
                arousal: 0.2
            }
        ];
        
        console.log('生成了示例日記數據:', sampleDiaries.length);
        return sampleDiaries;
    }
    
    // 設置用戶ID
    function setUserId(userId, numeric_id) {
        currentUserId = userId;
        numericUserId = numeric_id;
        localStorage.setItem('currentUserId', userId);
        localStorage.setItem('numericUserId', numeric_id);
        console.log(`已設置用戶ID: ${userId}, 數字ID: ${numeric_id}`);
    }
    
    // 顯示應用錯誤
    function showAppError(message) {
        console.error('應用錯誤:', message);
        if (window.UIManager && typeof UIManager.showToast === 'function') {
            UIManager.showToast(message);
        } else {
            alert(message);
        }
    }
    
    /**
     * 驗證API返回的數據格式
     * @param {Object} data - API返回的數據
     * @param {string} type - 數據類型 (diaries, notes, etc.)
     * @returns {boolean} - 是否通過驗證
     */
    function validateApiData(data, type) {
        if (!data) {
            console.error(`API數據為空: ${type}`);
            return false;
        }
        
        // 檢查數據類型
        if (typeof data !== 'object') {
            console.error(`API返回的數據不是對象: ${typeof data}`);
            return false;
        }
        
        // 根據不同類型驗證數據結構
        switch (type) {
            case 'diaries':
                // 驗證日記列表
                if (!Array.isArray(data)) {
                    console.error('API返回的日記數據不是數組');
                    return false;
                }
                
                // 檢查每個日記項目
                for (const diary of data) {
                    if (!diary.id) {
                        console.error('日記缺少ID字段');
                        return false;
                    }
                    
                    if (!diary.title) {
                        console.warn('日記缺少標題字段');
                    }
                    
                    if (!diary.date) {
                        console.warn('日記缺少日期字段');
                    }
                }
                return true;
                
            case 'notes':
                // 驗證筆記列表
                if (!Array.isArray(data)) {
                    console.error('API返回的筆記數據不是數組');
                    return false;
                }
                
                // 檢查每個筆記項目
                for (const note of data) {
                    if (!note.id) {
                        console.error('筆記缺少ID字段');
                        return false;
                    }
                    
                    if (!note.content) {
                        console.warn('筆記缺少內容字段');
                    }
                }
                return true;
                
            case 'user':
                // 驗證用戶數據
                if (!data.id) {
                    console.error('用戶數據缺少ID字段');
                    return false;
                }
                
                if (!data.username) {
                    console.warn('用戶數據缺少用戶名字段');
                }
                return true;
                
            default:
                // 默認只檢查數據是否為空
                return true;
        }
    }

    /**
     * 修復數據格式問題
     * @param {Object} data - 原始數據
     * @param {string} type - 數據類型
     * @returns {Object} - 修復後的數據
     */
    function fixDataFormat(data, type) {
        if (!data) return null;
        
        // 根據類型修復數據
        switch (type) {
            case 'diaries':
                // 確保數據是數組
                if (!Array.isArray(data)) {
                    console.log('將日記數據轉換為數組');
                    // 如果是對象，將其屬性轉為數組
                    if (typeof data === 'object') {
                        return Object.values(data);
                    }
                    // 如果不是對象，返回空數組
                    return [];
                }
                
                // 修復每個日記項目
                return data.map(diary => {
                    return {
                        id: diary.id || generateId(),
                        title: diary.title || '無標題',
                        content: diary.content || '',
                        date: diary.date || new Date().toISOString(),
                        mood: diary.mood || 'neutral',
                        valence: parseFloat(diary.valence || 0.5),
                        arousal: parseFloat(diary.arousal || 0.5)
                    };
                });
                
            case 'notes':
                // 確保數據是數組
                if (!Array.isArray(data)) {
                    console.log('將筆記數據轉換為數組');
                    if (typeof data === 'object') {
                        return Object.values(data);
                    }
                    return [];
                }
                
                // 修復每個筆記項目
                return data.map(note => {
                    return {
                        id: note.id || generateId(),
                        content: note.content || '',
                        createdAt: note.createdAt || new Date().toISOString(),
                        updatedAt: note.updatedAt || new Date().toISOString()
                    };
                });
                
            default:
                return data;
        }
    }
    
    // 登入並獲取JWT令牌
    async function login(username) {
        try {
            console.log(`嘗試登入用戶: ${username}`);
            
            // 檢查參數
            if (!username) {
                console.error('登入失敗: 未提供用戶名');
                throw new Error('登入需要用戶名');
            }
            
            // 檢查是否已經有有效令牌
            if (accessToken && !isTokenExpiringSoon(60)) { // 如果令牌還有超過60分鐘有效
                console.log('已有有效的認證令牌，無需重新登入');
                return { success: true };
            }
            
            // 使用本地密碼或默認密碼
            // 注意: 在實際生產環境中，應該使用更安全的方式處理密碼
            const password = 'desktop_client'; // 使用默認密碼，因為是電子客戶端
            
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);
            
            // 優先從配置獲取API URL
            const baseUrl = CONFIG && CONFIG.API && CONFIG.API.BASE_URL ? 
                CONFIG.API.BASE_URL : 'http://localhost:8000';
            
            // 檢查網絡連接
            if (!navigator.onLine) {
                console.warn('設備處於離線狀態，無法進行登入');
                
                // 在模擬模式下創建模擬令牌
                if (CONFIG && CONFIG.USE_MOCK_DATA) {
                    console.log('離線模式: 使用模擬令牌');
                    const mockToken = 'mock_jwt_token_for_offline_mode';
                    setAuthToken(mockToken, 86400); // 24小時
    return {
                        success: true,
                        userId: numericUserId,
                        username: username,
                        is_mock: true,
                        offline: true
                    };
                }
                
                throw new Error('設備處於離線狀態，無法進行登入');
            }
            
            // 登入請求不使用fetchAPI函數，避免循環依賴
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                console.warn('登入請求超時 (10秒)');
                controller.abort('登入請求超時');
            }, 10000);
            
            try {
                console.log(`發送登入請求到: ${baseUrl}/users/login`);
                
                const response = await fetch(`${baseUrl}/users/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    body: formData,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                // 檢查響應狀態
                if (!response.ok) {
                    let errorText = '';
                    try {
                        const errorData = await response.json();
                        errorText = errorData.detail || errorData.error || errorData.message || `HTTP錯誤 ${response.status}`;
                    } catch (jsonError) {
                        try {
                            errorText = await response.text();
                        } catch (textError) {
                            errorText = `HTTP錯誤 ${response.status}`;
                        }
                    }
                    
                    console.error(`登入失敗 (${response.status}): ${errorText}`);
                    throw new Error(`登入失敗: ${errorText}`);
                }
                
                // 解析響應
                const authData = await response.json();
                
                // 檢查令牌
                if (!authData.access_token) {
                    console.error('登入響應中缺少令牌:', authData);
                    throw new Error('伺服器響應缺少有效的認證令牌');
                }
                
                // 保存令牌 - 如果服務器未提供過期時間，使用默認值(24小時)
                const expiresIn = authData.expires_in || 86400;
                setAuthToken(authData.access_token, expiresIn);
                
                // 保存用戶信息
                if (authData.user_id && authData.username) {
                    setUserId(authData.username, authData.user_id);
                } else if (typeof numericUserId !== 'undefined') {
                    // 如果API响应中没有用户ID但我们已有本地ID，保留現有ID
                    setUserId(username, numericUserId);
                }
                
                console.log('登入成功，獲取到有效令牌');
                
                return {
                    success: true,
                    userId: authData.user_id || numericUserId,
                    username: authData.username || username
                };
            } catch (fetchError) {
                clearTimeout(timeoutId);
                
                // 如果是超時或網絡錯誤
                if (fetchError.name === 'AbortError' || fetchError.name === 'TypeError') {
                    console.warn('登入請求失敗:', fetchError.message);
                    
                    // 在開發或測試模式下使用模擬資料
                    if (CONFIG && (CONFIG.USE_MOCK_DATA || CONFIG.DEBUG.MOCK_API)) {
                        console.log('使用模擬登入數據');
                        
                        // 模擬令牌（僅用於開發和測試）
                        const mockToken = 'mock_jwt_token_for_dev_only';
                        setAuthToken(mockToken, 86400); // 24小時
                        
                        return {
                            success: true,
                            userId: numericUserId,
                            username: username,
                            is_mock: true
                        };
                    }
                }
                
                // 重新拋出其他錯誤
                throw fetchError;
            }
        } catch (error) {
            console.error('登入過程出錯:', error);
            
            // 如果是開發或測試模式，使用模擬數據
            if (CONFIG && (CONFIG.USE_MOCK_DATA || CONFIG.DEBUG.MOCK_API)) {
                console.log('使用模擬登入數據');
                
                // 模擬令牌（僅用於開發和測試）
                const mockToken = 'mock_jwt_token_for_dev_only';
                setAuthToken(mockToken, 86400); // 24小時
                
                return {
                    success: true,
                    userId: numericUserId,
                    username: currentUserId,
                    is_mock: true
                };
            }
            
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 自動登入流程
    async function autoLogin() {
        // 如果已有令牌，嘗試使用它
        if (accessToken) {
            // 檢查令牌是否已過期
            if (!isTokenExpiringSoon(60)) { // 如果令牌還有超過60分鐘有效
                console.log('使用現有令牌');
                return { success: true };
            }
            
            // 嘗試刷新令牌
            const refreshed = await refreshToken();
            if (refreshed) {
                console.log('令牌已刷新');
                return { success: true };
            }
        }
        
        // 如果沒有令牌或刷新失敗，嘗試用戶ID登入
        if (currentUserId) {
            console.log('嘗試使用現有用戶ID自動登入');
            return await login(currentUserId);
        }
        
        return { success: false, error: '無法自動登入' };
    }
    
    /**
     * 獲取指定ID的筆記
     * @param {string} noteId - 筆記ID
     * @returns {Promise<Object>} - 筆記數據
     */
    async function getNote(noteId) {
        try {
            // 檢查參數
            if (!noteId) {
                console.error('獲取筆記失敗: 未提供筆記ID');
                throw new Error('筆記ID不能為空');
            }
            
            // 構建API端點
            const endpoint = `/notes/${noteId}`;
            
            // 發送請求
            const response = await fetchAPI(endpoint);
            
            // 檢查數據
            if (validateApiData(response, 'note')) {
                return response;
            } else {
                return fixDataFormat(response, 'note');
            }
        } catch (error) {
            console.error(`獲取筆記失敗 (ID: ${noteId}):`, error);
            
            // 如果啟用了模擬數據，則返回模擬數據
            if (CONFIG.USE_MOCK_DATA) {
                const mockNotes = getMockDataForEndpoint('/notes', { method: 'GET' });
                const mockNote = mockNotes.find(note => note.id === noteId);
                
                if (mockNote) {
                    console.log('使用模擬數據代替API響應');
                    return mockNote;
                }
            }
            
            throw new Error(`無法獲取筆記: ${error.message}`);
        }
    }
    
    // 導出API
    return {
        init,
        ensureInitialized,
        fetchAPI,
        sendChatMessage,
        endChat: endChat,
        getDiaries: getDiaries,
        getDiaryById: getDiaryById,
        getNotes: getNotes,
        getNote: getNote,
        saveNote: saveNote,
        deleteNote: deleteNote,
        getLocalData: getLocalData,
        saveLocalData: saveLocalData,
        setUserId: setUserId,
        login: login,
        autoLogin: autoLogin,
        logout: clearAuthToken,
        isAuthenticated: () => !!accessToken && !isTokenExpiringSoon(60),
        generateMockData: getMockDataForEndpoint,
        validateApiData: validateApiData,
        fixDataFormat: fixDataFormat
    };
})();

// 初始化API服務
document.addEventListener('DOMContentLoaded', function() {
    ApiService.init();
    
    // 自動登入
    ApiService.autoLogin().then(result => {
        if (result.success) {
            console.log('自動登入成功');
        } else {
            console.warn('自動登入失敗:', result.error);
        }
    }).catch(error => {
        console.error('自動登入過程出錯:', error);
    });
});

// 將 ApiService 暴露為全局變量
window.ApiService = ApiService;