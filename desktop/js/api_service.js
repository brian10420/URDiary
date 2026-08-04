/**
 * API服務模塊 - 處理與後端的所有通信
 */
const ApiService = (function() {
    // 用戶ID（暫時靜態設置，後續可從登錄過程獲取）
    let currentUserId = localStorage.getItem('currentUserId') || 'desktop_user';
    let numericUserId = parseInt(localStorage.getItem('numericUserId') || '1');
    
    // JWT令牌存儲
    let accessToken = localStorage.getItem('auth_token') || null;
    let tokenExpiry = localStorage.getItem('token_expiry') ? new Date(localStorage.getItem('token_expiry')) : null;

    // 清除歷史版本在離線/錯誤時偽造的模擬令牌（如 mock_jwt_token_for_dev_only），
    // 這類殘留會讓客戶端誤以為已登入
    if (accessToken && accessToken.toLowerCase().includes('mock')) {
        console.warn('偵測到舊版殘留的模擬令牌，已清除');
        accessToken = null;
        tokenExpiry = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('token_expiry');
    }
    
    // 初始化狀態標誌
    let isInitialized = false;
    
    // 初始化方法
    function init() {
        if (isInitialized) {
            console.log('API 服務已初始化，跳過');
            return true;
        }
        
        console.log('初始化 API 服務');
        console.log('使用配置的 API URL:', CONFIG.getApiBaseUrl());

        // 設置初始化標誌
        isInitialized = true;

        // 顯示初始化信息
        console.log('API 服務初始化完成，基礎 URL:', CONFIG.getApiBaseUrl());
        return true;
    }

    // 確保服務已初始化
    function ensureInitialized() {
        if (!isInitialized) {
            init();
        }
        return isInitialized;
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
        if (!accessToken) {
            console.warn('沒有訪問令牌，無法刷新');
            return false;
        }
        
        try {
            console.log('嘗試刷新令牌...');

            const baseUrl = CONFIG.getApiBaseUrl();

            const response = await fetch(`${baseUrl}/users/token/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                // 增加超時處理
                signal: AbortSignal.timeout(10000) // 10秒超時
            });
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => '無法獲取錯誤詳情');
                console.warn(`刷新令牌失敗: ${response.status} - ${errorText}`);
                
                // 如果是401錯誤，令牌可能已經過期太久
                if (response.status === 401) {
                    console.warn('令牌已過期且無法刷新，需要重新登入');
                    clearAuthToken();
                }
                
                return false;
            }
            
            const data = await response.json();
            
            if (!data.access_token) {
                console.error('刷新令牌響應中缺少訪問令牌');
                return false;
            }
            
            // 保存新令牌
            setAuthToken(data.access_token, data.expires_in);
            console.log('令牌刷新成功');
            return true;
            
        } catch (error) {
            if (error.name === 'TimeoutError') {
                console.error('刷新令牌請求超時');
            } else {
                console.error('刷新令牌出錯:', error);
            }
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
            // 檢查網絡連接
            if (!navigator.onLine) {
                console.warn(`設備處於離線狀態 (${endpoint})`);
                throw new Error('OFFLINE_MODE');
            }
            
            const baseUrl = CONFIG.getApiBaseUrl();

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
            // X-Memory-Semantic / X-Language 為無條件基礎標頭（不放進被 hasKey
            // 閘住的 X-LLM-* 區塊）：即使走後端後備供應商，偏好也要生效
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Client': 'URDiary-ElectronApp',
                    'X-Memory-Semantic': (localStorage.getItem('urDiary_semantic_memory') === '1') ? '1' : '0',
                    'X-Language': (typeof I18N !== 'undefined') ? I18N.getLang() : 'zh-TW',
                    ...options.headers
                }
            };
            
            // 添加認證令牌（如果有）
            if (accessToken) {
                fetchOptions.headers['Authorization'] = `Bearer ${accessToken}`;
            }

            // 需要 LLM 的端點：附上請求範圍的供應商設定 (X-LLM-* 標頭)。
            // 金鑰從 SecureStore 記憶體快取取得（safeStorage 解密），不經 localStorage。
            // 未存金鑰且非本地供應商時不附標頭 → 後端走 .env Grok 後備（或回明確錯誤）。
            const LLM_ENDPOINT_PATTERNS = ['/chat/', '/generate', '/interaction-notes/update', '/analytics/emotion/'];
            if (LLM_ENDPOINT_PATTERNS.some(p => endpoint.includes(p))) {
                try {
                    if (typeof SecureStore !== 'undefined' && SecureStore.ready) {
                        await SecureStore.ready; // 首次載入後為已解決的 promise
                    }
                    const activeLLM = (typeof SettingsModule !== 'undefined' && SettingsModule.getActiveLLM) ?
                        SettingsModule.getActiveLLM() : null;
                    if (activeLLM && (activeLLM.hasKey || activeLLM.provider === 'local')) {
                        fetchOptions.headers['X-LLM-Provider'] = activeLLM.provider;
                        if (activeLLM.model) {
                            fetchOptions.headers['X-LLM-Model'] = activeLLM.model;
                        }
                        const llmApiKey = (typeof SecureStore !== 'undefined') ? SecureStore.getKey(activeLLM.provider) : '';
                        if (llmApiKey) {
                            fetchOptions.headers['X-LLM-Api-Key'] = llmApiKey;
                        }
                        if (activeLLM.baseUrl) {
                            fetchOptions.headers['X-LLM-Base-Url'] = activeLLM.baseUrl;
                        }
                    }
                } catch (llmHeaderError) {
                    console.warn('附加 LLM 設定標頭失敗（將走後端後備供應商）:', llmHeaderError);
                }
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
                
                // 注意：不可用錯誤文字子字串（token/auth/認證）猜測 JWT 失效 ——
                // LLM 供應商的認證錯誤（例如 Claude 的 authentication_error）會被誤判
                // 而把使用者登出。JWT 失效只信 HTTP 401 狀態碼（已在上方處理）。

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
                    
                    const serverError = new Error('SERVER_ERROR');
                    serverError.detail = errorText;
                    throw serverError;
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
                
                const apiError = new Error(`API_ERROR:${response.status}`);
                apiError.detail = errorText;
                throw apiError;
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
            
            // 獲取錯誤碼 - 從自定義錯誤中提取（error 可能不是 Error 物件，例如 abort reason 字串）
            const rawMessage = (error && error.message) ? String(error.message) : String(error);
            const errorMatches = rawMessage.match(/^([A-Z_]+)($|:)/);
            const errorCode = errorMatches ? errorMatches[1] : null;
            const httpStatus = errorCode ? rawMessage.split(':')[1] : null;
            const detail = (error && error.detail) ? String(error.detail) : '';

            console.log(`識別錯誤類型: ${errorCode || (error && error.name) || '未知'}, HTTP狀態: ${httpStatus || 'N/A'}`);

            const isTimeout = (error && error.name === 'AbortError') || rawMessage.includes('請求超時');
            const isNetworkFailure = errorCode === 'OFFLINE_MODE' || isTimeout ||
                (error && (error.name === 'TypeError' || error.name === 'NetworkError'));

            // 組出如實、可讀的錯誤訊息（不再以模擬數據掩蓋錯誤）
            let friendlyMessage;
            switch (errorCode) {
                case 'OFFLINE_MODE':
                    friendlyMessage = I18N.t('errors.offline');
                    break;

                case 'JWT_AUTH_ERROR':
                    friendlyMessage = I18N.t('errors.authFailed');
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast(I18N.t('errors.authFailed'));
                    }
                    // 令牌已在上方清除，通知主流程開啟登入對話框
                    try {
                        window.dispatchEvent(new CustomEvent('urdiary:auth-expired', { detail: { endpoint } }));
                    } catch (dispatchError) {
                        console.warn('無法發送認證失效事件:', dispatchError);
                    }
                    break;

                case 'PERMISSION_ERROR':
                    friendlyMessage = I18N.t('errors.forbidden');
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast(I18N.t('errors.forbidden'));
                    }
                    break;

                case 'SERVER_ERROR':
                    friendlyMessage = detail ? I18N.t('errors.serverWithDetail', { detail: detail }) : I18N.t('errors.server');
                    break;

                case 'API_ERROR':
                    friendlyMessage = detail ?
                        `${I18N.t('errors.server')} (HTTP ${httpStatus})：${detail}` :
                        `${I18N.t('errors.server')} (HTTP ${httpStatus})`;
                    break;

                default:
                    if (isTimeout) {
                        friendlyMessage = I18N.t('errors.timeout');
                    } else if (isNetworkFailure) {
                        friendlyMessage = I18N.t('errors.cantConnect');
                    } else {
                        friendlyMessage = rawMessage;
                    }
            }

            // 唯讀端點在「連不上伺服器」時允許回退到本機快取（明確標示 _fromCache），
            // 認證/權限/伺服器錯誤不回退 —— 必須讓使用者看見真實錯誤
            const isReadOnlyGet = (!options.method || options.method === 'GET') &&
                (endpoint.includes('/diaries') || endpoint.includes('/interaction-notes') || endpoint.includes('/notes'));
            if (isNetworkFailure && isReadOnlyGet) {
                const localData = getLocalData(endpoint);
                if (localData) {
                    console.warn(`無法連線，改用本機快取資料: ${endpoint}`);
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast(I18N.t('errors.cachedShown'));
                    }
                    return { ...localData, _fromCache: true };
                }
            }

            // 如實拋出錯誤，由呼叫端呈現給使用者
            const apiFailure = new Error(friendlyMessage);
            apiFailure.code = errorCode || (error && error.name) || 'UNKNOWN';
            apiFailure.status = httpStatus ? parseInt(httpStatus, 10) : null;
            apiFailure.detail = detail || null;
            apiFailure.cause = error;
            throw apiFailure;
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
            // 身分由後端從 JWT 導出、供應商/模型由 X-LLM-* 標頭提供，body 只需訊息本身
            const data = await fetchAPI('/chat/enhanced/', {
                method: 'POST',
                body: {
                    message: message
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
                // 伺服器回傳了非預期的格式 —— 如實回報，不偽造回應
                console.error('無法解析服務器響應:', data);
                throw new Error('伺服器回傳了無法解析的響應格式');
            }

            console.log('標準化後的響應:', response);
            return response;
                } catch (error) {
                    lastError = error;
                    retryCount++;

                    // 只有在重試次數未達到最大值且錯誤是服務器錯誤(500系列)時才重試
                    const isServerError = error.code === 'SERVER_ERROR' ||
                                         error.message.includes('500') ||
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
            // 如實拋出錯誤（訊息已由 fetchAPI 轉為可讀格式），由聊天模塊顯示給使用者
            throw error;
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
            // 身分由後端從 JWT 導出、供應商/模型由 X-LLM-* 標頭提供
            const data = await fetchAPI('/chat/end/', {
                method: 'POST',
                body: {
                    exclude_interaction_notes: true  // 防止將互動筆記融入日記
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
                    const isServerError = error.code === 'SERVER_ERROR' ||
                                         error.message.includes('500') ||
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
            // 如實拋出錯誤（訊息已由 fetchAPI 轉為可讀格式），由聊天模塊顯示給使用者；
            // 對話歷史仍保留在伺服器端，使用者可重試
            throw error;
        }
    }
    
    // 每日開場問候：今日首次開啟時後端會生成 AI 主動問候
    // 回 {checkin:false} 代表今日已問候過或 LLM 不可用（皆非錯誤）
    async function checkIn() {
        return await fetchAPI('/chat/checkin/', {
            method: 'POST',
            body: {}
        });
    }

    // 獲取日記列表
    async function getDiaries() {
        console.log('正在獲取日記列表...');

        const path = `/diaries/${numericUserId}`;
        // 失敗時如實拋出（fetchAPI 已轉為可讀錯誤），由日記模塊顯示給使用者
        const response = await fetchAPI(path, { method: 'GET' });

        // fetchAPI 在連不上伺服器時可能回傳本機快取（內容已是客戶端格式，勿再轉換）
        if (response && response._fromCache && Array.isArray(response.diaries)) {
            console.warn('顯示本機快取的日記資料');
            return response.diaries;
        }

        // 驗證響應格式 —— 格式錯誤是真實問題，如實回報
        if (!response || !response.diaries || !Array.isArray(response.diaries)) {
            console.error('日記數據格式不正確:', response);
            throw new Error('伺服器回傳的日記資料格式不正確');
        }

        // 轉換數據格式（空清單就是真實的空狀態）
        const diaries = response.diaries.map(diary => ({
            id: diary.diary_id || generateId(),
            title: diary.title || deriveDiaryTitle(diary.content, diary.diary_date),
            summary: diary.summary || '',
            content: diary.content || '',
            date: diary.diary_date || new Date().toISOString(),
            mood: getMoodFromValence(diary.valence),
            valence: diary.valence || 0.5,
            arousal: diary.arousal || 0.5
        }));

        // 保存到本地存儲，作為離線時的唯讀快取
        saveLocalData(path, { diaries });

        console.log(`成功獲取 ${diaries.length} 條日記`);
        return diaries;
    }
    
    // --- 行事曆 -------------------------------------------------------------
    // 全部走 fetchAPI（自動帶 Authorization / X-Language）。行事曆端點不需要
    // LLM，所以刻意不加進 fetchAPI 的 LLM_ENDPOINT_PATTERNS —— 不必為了看月曆
    // 就把 API 金鑰塞進請求標頭。事件的擁有者由後端從 token 導出，前端不送 user_id。

    // 查詢區間內的 occurrences (start/end 為 "YYYY-MM-DD"，後端跨度上限 62 天)
    async function getCalendarEvents(start, end) {
        const path = `/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        return await fetchAPI(path, { method: 'GET' });
    }

    // 新增事件 → { message, event }
    async function createCalendarEvent(data) {
        return await fetchAPI('/calendar/events', { method: 'POST', body: data });
    }

    // 更新事件 → { message, event }；欄位缺席代表「維持原值」，明確傳 null
    // 則清空該欄位（僅 event_time/recurrence_until/reminder_minutes/note 可清空）
    async function updateCalendarEvent(eventId, data) {
        return await fetchAPI(`/calendar/events/${encodeURIComponent(eventId)}`, { method: 'PUT', body: data });
    }

    // 刪除事件 → { message }
    async function deleteCalendarEvent(eventId) {
        return await fetchAPI(`/calendar/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    }

    /**
     * 推導日記標題
     * 後端 diaries 表沒有 title 欄位，若不推導，每篇日記都會顯示「無標題日記」。
     * 取內文第一行有意義的文字 (跳過 Markdown 標題與列點)，取不到則以日期為題。
     */
    function deriveDiaryTitle(content, dateIso) {
        if (typeof content === 'string' && content.trim()) {
            const line = content
                .split('\n')
                .map(l => l.trim())
                .find(l => l && !/^#{1,6}\s/.test(l) && !/^[-*>|]/.test(l));

            if (line) {
                const clean = line.replace(/[*_`#]/g, '').trim();
                if (clean) {
                    return clean.length > 24 ? clean.slice(0, 24) + '…' : clean;
                }
            }
        }

        const d = new Date(dateIso);
        return isNaN(d.getTime()) ? I18N.t('diary.plain') :
            I18N.t('diary.dateTitle', { month: d.getMonth() + 1, day: d.getDate() });
    }

    // 從情緒值獲取情緒標籤
    // 後端的 valence 已被夾在 0~1 之間，原本以負值判斷 sad/angry 永遠不會成立，
    // 所有偏負面的日記都會被標成 neutral。這裡改用 0~1 的分界。
    function getMoodFromValence(valence) {
        if (typeof valence !== 'number' || isNaN(valence)) {
            return 'neutral';
        }

        if (valence >= 0.7) return 'happy';
        if (valence >= 0.55) return 'calm';
        if (valence >= 0.45) return 'neutral';
        if (valence >= 0.25) return 'sad';
        return 'angry';
    }
    
    // 生成唯一ID
    function generateId() {
        return 'diary_' + Math.random().toString(36).substr(2, 9);
    }
    
    // 設置用戶ID
    function setUserId(userId, numeric_id) {
        currentUserId = userId;
        numericUserId = numeric_id;
        localStorage.setItem('currentUserId', userId);
        localStorage.setItem('numericUserId', numeric_id);
        console.log(`已設置用戶ID: ${userId}, 數字ID: ${numeric_id}`);
    }
    
    // 登入並獲取JWT令牌（真實密碼由後端 bcrypt 驗證）
    async function login(username, password) {
        try {
            console.log(`嘗試登入用戶: ${username}`);

            // 檢查參數
            if (!username) {
                console.error('登入失敗: 未提供用戶名');
                throw new Error(I18N.t('login.enterUsername'));
            }
            if (!password) {
                console.error('登入失敗: 未提供密碼');
                throw new Error(I18N.t('login.enterPassword'));
            }

            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            const baseUrl = CONFIG.getApiBaseUrl();

            // 檢查網絡連接（絕不偽造令牌 —— 登入必須由後端驗證）
            if (!navigator.onLine) {
                console.warn('設備處於離線狀態，無法進行登入');
                throw new Error(I18N.t('errors.offlineLogin'));
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
                    throw new Error(I18N.t('errors.badToken'));
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

                // 超時或網絡錯誤換成可讀訊息；絕不偽造令牌
                if (fetchError.name === 'AbortError') {
                    throw new Error(I18N.t('errors.loginTimeout'));
                }
                if (fetchError.name === 'TypeError') {
                    throw new Error(I18N.t('errors.cantConnect'));
                }

                // 重新拋出其他錯誤
                throw fetchError;
            }
        } catch (error) {
            console.error('登入過程出錯:', error);

            // 如實回報登入失敗，由登入介面顯示錯誤訊息
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 自動登入流程
    async function autoLogin() {
        console.log('開始自動登入流程...');
        
        try {
            // 如果已有令牌，嘗試使用它
            if (accessToken) {
                console.log('檢查現有令牌狀態...');
                
                // 檢查令牌是否還有較長時間有效（超過60分鐘）
                if (!isTokenExpiringSoon(60)) {
                    console.log('使用現有有效令牌');
                    return { success: true };
                }
                
                // 檢查令牌是否還沒完全過期（在5分鐘內）
                if (!isTokenExpiringSoon(5)) {
                    console.log('令牌即將過期但仍可使用');
                    return { success: true };
                }
                
                console.log('令牌即將過期，嘗試刷新...');

                // 嘗試刷新令牌
                const refreshed = await refreshToken();
                if (refreshed) {
                    console.log('令牌刷新成功');
                    return { success: true };
                } else {
                    console.warn('令牌刷新失敗，需要重新登入');
                    // 清除已過期的令牌
                    clearAuthToken();
                }
            }

            // 密碼不會存在本機，無法代替使用者登入 —— 交回登入介面
            console.log('沒有可用的令牌，需要使用者輸入密碼登入');
            return { success: false, needLogin: true, error: '請輸入密碼登入' };

        } catch (error) {
            console.error('自動登入過程發生錯誤:', error);
            return { success: false, needLogin: true, error: `自動登入失敗: ${error.message}` };
        }
    }
    
    // 導出API
    return {
        init,
        ensureInitialized,
        fetchAPI,
        sendChatMessage,
        checkIn: checkIn,
        endChat: endChat,
        getDiaries: getDiaries,
        getCalendarEvents: getCalendarEvents,
        createCalendarEvent: createCalendarEvent,
        updateCalendarEvent: updateCalendarEvent,
        deleteCalendarEvent: deleteCalendarEvent,
        getLocalData: getLocalData,
        saveLocalData: saveLocalData,
        setUserId: setUserId,
        login: login,
        autoLogin: autoLogin,
        logout: clearAuthToken,
        isAuthenticated: () => !!accessToken && !isTokenExpiringSoon(60),
        // 以下兩個是純函式，僅為 vitest 單元測試曝光，行為不變
        deriveDiaryTitle: deriveDiaryTitle,
        getMoodFromValence: getMoodFromValence
    };
})();

// 將 ApiService 暴露為全局變量
window.ApiService = ApiService;