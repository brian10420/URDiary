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
     * 取得目前保存的刷新令牌（Electron 走 safeStorage，瀏覽器退回 localStorage）
     */
    function getRefreshToken() {
        if (typeof SecureStore === 'undefined') return '';
        return SecureStore.getAuthRefreshToken();
    }

    /**
     * 保存登入／刷新回應中的一對令牌
     */
    async function setTokens(data) {
        if (data.access_token) {
            setAuthToken(data.access_token, data.expires_in);
        }
        if (data.refresh_token && typeof SecureStore !== 'undefined') {
            await SecureStore.setAuthRefreshToken(data.refresh_token);
        }
    }

    /**
     * 清除認證令牌
     *
     * 刷新令牌一定要一起清掉：後端把「已撤銷的刷新令牌又被送上來」視為
     * 令牌外洩，會連帶登出這個帳號的所有裝置。留著死掉的令牌等於埋一顆
     * 會炸到其他裝置的地雷。
     */
    function clearAuthToken() {
        accessToken = null;
        tokenExpiry = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('token_expiry');
        if (typeof SecureStore !== 'undefined') {
            SecureStore.clearAuthRefreshToken().catch(error => {
                console.warn('清除刷新令牌失敗:', error);
            });
        }
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
    
    // 進行中的刷新請求（single-flight）。刷新令牌是一次性的：後端每用一次
    // 就輪替，同一張令牌送兩次，慢的那一次必定失敗。而併發刷新在這個 app
    // 是常態不是例外 —— 啟動時 initializeAuth() 沒有被 await，後面的
    // CalendarModule.init() 會立刻再打一次 API，兩條路徑都會看到「令牌
    // 即將過期」而各自去刷新。所以同一時間只准有一個刷新在路上，其餘呼叫
    // 共用同一個 promise。
    let refreshInFlight = null;

    /**
     * 嘗試刷新令牌（併發呼叫共用同一次請求）
     * @returns {Promise<boolean>} 是否成功刷新
     */
    function refreshToken() {
        if (refreshInFlight) {
            console.log('已有刷新請求在進行中，共用其結果');
            return refreshInFlight;
        }

        refreshInFlight = doRefreshToken().finally(() => {
            refreshInFlight = null;
        });
        return refreshInFlight;
    }

    /**
     * 實際發出刷新請求（只由 refreshToken 呼叫，確保 single-flight）
     *
     * 送的是「刷新令牌」，不是過期的訪問令牌 —— 後端 v2.3 起只收
     * type=refresh 且未過期的令牌，且每次使用都會輪替（回應帶新的一對）。
     * @returns {Promise<boolean>} 是否成功刷新
     */
    async function doRefreshToken() {
        if (typeof SecureStore !== 'undefined' && SecureStore.ready) {
            await SecureStore.ready; // 首次載入後為已解決的 promise
        }

        const storedRefreshToken = getRefreshToken();
        if (!storedRefreshToken) {
            console.warn('沒有刷新令牌，無法刷新');
            return false;
        }

        try {
            console.log('嘗試刷新令牌...');

            const baseUrl = CONFIG.getApiBaseUrl();

            const response = await fetch(`${baseUrl}/users/token/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refresh_token: storedRefreshToken }),
                // 增加超時處理
                signal: AbortSignal.timeout(10000) // 10秒超時
            });

            if (!response.ok) {
                console.warn(`刷新令牌失敗: ${response.status}`);

                // 401 = 我們送出去的那張令牌已失效／已被撤銷。務必連刷新令牌
                // 一起清掉，再送一次會被後端判定為重用而撤光所有裝置。
                //
                // 但只有在「儲存的仍是我們送出去的那一張」時才清。single-flight
                // 只擋得住同一個 JS 環境裡的併發；另一個分頁／視窗有自己的旗標
                // 卻共用同一份儲存，它可能在我們這個請求還在路上時就贏得輪替並
                // 存進新令牌 —— 這時清掉等於把贏家的工作階段一起弄丟，兩邊都被
                // 踢回登入畫面。輸的一方安靜退場就好，令牌歸贏家。
                if (response.status === 401) {
                    if (getRefreshToken() === storedRefreshToken) {
                        console.warn('刷新令牌已失效，需要重新登入');
                        clearAuthToken();
                        // session 真死必須立刻帶使用者回登入畫面。少了這步，
                        // 後續請求因 accessToken 已清空而走不進 fetchAPI 的
                        // 強制登出分支（`&& accessToken` guard），使用者只會
                        // 看到一個默默 401 的空殼 UI——行事曆被錯誤路徑清空，
                        // 看起來像「資料不見了」（2026-08-22 實際事故）。
                        if (typeof UIManager !== 'undefined' && UIManager.showToast && typeof I18N !== 'undefined') {
                            UIManager.showToast(I18N.t('errors.authFailed'));
                        }
                        try {
                            window.dispatchEvent(new CustomEvent('urdiary:auth-expired',
                                { detail: { endpoint: '/users/token/refresh' } }));
                        } catch (dispatchError) {
                            console.warn('無法發送認證失效事件 (refresh):', dispatchError);
                        }
                    } else {
                        console.warn('刷新令牌已被其他分頁換新，保留較新的令牌');
                    }
                }

                return false;
            }

            const data = await response.json();

            if (!data.access_token) {
                console.error('刷新令牌響應中缺少訪問令牌');
                return false;
            }

            // 保存輪替後的新令牌對
            await setTokens(data);
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

    // ------------------------------------------------------------------
    // v2.3 task 2.3：離線容忍 —— 以下都是不碰 DOM/window 的純函式，供
    // fetchAPI 內部的重試迴圈使用，也直接曝光給 vitest 單元測試（見檔案
    // 最下方「以下為純函式」的匯出區塊）。
    // ------------------------------------------------------------------

    /**
     * 算出第 attempt 次重試前要等待的毫秒數（指數退避 + 上限 + 可選抖動）。
     * 純函式：只吃參數、只回傳數字，不讀寫任何外部狀態（Math.random 除外——
     * 有抖動時本來就該是隨機的，測試想要確定值時把 jitterRatio 設 0）。
     *
     * @param {number} attempt - 第幾次重試，從 0 開始（0 = 第一次嘗試失敗後，
     *   準備發出第二次嘗試前的延遲）
     * @param {number} [baseMs=300] - 基礎延遲（毫秒）；非正數時退回預設值
     * @param {Object} [options]
     * @param {number} [options.capMs=4000] - 延遲上限（毫秒）——不管指數長到
     *   多大，實際等待永遠不會超過這個值，讓最壞情況下的總重試時間有界。
     * @param {number} [options.jitterRatio=0.2] - 抖動比例（0~1 之間為典型值，
     *   但更大的值也會被安全夾住，見下方實作）。實際延遲會落在 capped 值的
     *   ±jitterRatio 範圍內隨機，同時仍被 [0, capMs] 夾住上下限。傳 0 停用
     *   抖動，回傳確定值（方便測試）。
     * @returns {number} 毫秒數，恆為 >= 0 的有限整數
     */
    function computeBackoffDelay(attempt, baseMs = 300, options = {}) {
        const capMs = Number.isFinite(options.capMs) ? options.capMs : 4000;
        const jitterRatio = Number.isFinite(options.jitterRatio) ? options.jitterRatio : 0.2;

        const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
        const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 300;

        const exponential = safeBase * Math.pow(2, safeAttempt);
        const capped = Math.min(exponential, capMs);

        if (jitterRatio <= 0) {
            return Math.round(capped);
        }

        const spread = capped * jitterRatio;
        const jittered = capped + (Math.random() * 2 - 1) * spread;
        return Math.round(Math.min(capMs, Math.max(0, jittered)));
    }

    /**
     * 這個 (method, 失敗原因) 組合是否應該重試。純函式，不碰 DOM/window。
     *
     * method/status 矩陣（完整測試見 tests/api_retry.test.js）：
     *   - method 不是 GET → 一律不重試。這是最重要的一條規則：POST/PUT/DELETE
     *     有副作用，自動重試可能讓伺服器真的收到兩次請求（雙重寫入、聊天訊息
     *     重複送出、雙重扣費……），絕不能鬆動。
     *   - GET + 網路層失敗（連不上/逾時/離線）→ 重試（暫時性，值得再試）。
     *   - GET + 5xx → 重試（伺服器端暫時性錯誤，值得再試）。
     *   - GET + 429 → 只有帶 Retry-After 才重試；沒有就不知道要等多久，
     *     寧可如實回報，也不要用猜的延遲繼續打伺服器。
     *   - GET + 其餘 4xx（400/401/403/404/409/422...）→ 一律不重試（應用層
     *     拒絕，重試只會得到一樣的結果，白白浪費一次往返）。
     *   - 2xx/3xx（沒有失敗）→ 不適用，回傳 false。
     *
     * @param {Object} [params]
     * @param {string} [params.method='GET']
     * @param {boolean} [params.isNetworkFailure=false] - true 代表這次失敗
     *   發生在拿到 HTTP 回應「之前」（fetch() 本身 reject，例如逾時/斷線），
     *   與 status 互斥——網路層失敗時沒有 status 可看。
     * @param {number|null} [params.status=null] - HTTP 狀態碼（有拿到回應時）
     * @param {number|null} [params.retryAfterMs=null] - 解析後的 Retry-After
     *   （毫秒），只有 status===429 時有意義
     * @returns {boolean}
     */
    function isRetryableFailure(params) {
        const { method = 'GET', isNetworkFailure = false, status = null, retryAfterMs = null } = params || {};
        const normalizedMethod = String(method || 'GET').toUpperCase();
        if (normalizedMethod !== 'GET') {
            return false;
        }
        if (isNetworkFailure) {
            return true;
        }
        if (typeof status !== 'number' || !Number.isFinite(status)) {
            return false;
        }
        if (status >= 500 && status <= 599) {
            return true;
        }
        if (status === 429) {
            return Number.isFinite(retryAfterMs) && retryAfterMs >= 0;
        }
        return false;
    }

    /**
     * 解析 Retry-After 標頭 —— 只支援秒數格式（本專案後端目前也只送秒數）；
     * HTTP-date 格式（例如 "Wed, 21 Oct 2026 07:28:00 GMT"）回傳 null，交由
     * 呼叫端視為「沒有 Retry-After」，不強行猜測日期字串的意圖。純函式。
     * @param {string|null|undefined} headerValue
     * @returns {number|null} 毫秒數，或 null（沒有/無法解析/負值）
     */
    function parseRetryAfterMs(headerValue) {
        if (!headerValue) return null;
        const seconds = Number(headerValue);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return seconds * 1000;
        }
        return null;
    }

    // GET 重試的基礎退避延遲（毫秒）——實際等待時間由 computeBackoffDelay()
    // 算出（指數成長、有上限、含抖動），這裡只提供「第一次重試等多久」的基準。
    //
    // 搭配預設 CONFIG.API.MAX_RETRIES=2：兩次重試的延遲分別約 300ms/600ms
    // （抖動 ±20%），退避本身累積多花的時間 < 1.1 秒。每次嘗試若真的卡住，
    // 個別上限仍是前面算出的 timeoutDuration（預設 30 秒）——但離線/斷線時
    // fetch() 幾乎立即 reject，不會真的等到逾時，所以現實中的離線重試總耗時
    // 遠低於「每次都真的等滿 30 秒」這個理論最壞值（(MAX_RETRIES+1) ×
    // timeoutDuration + 退避總和）。
    const RETRY_BASE_DELAY_MS = 300;

    // 429 帶 Retry-After 時，實際會尊重的等待時間上限（毫秒）——code review
    // 修復（見 resolveRetryDelayMs）：本專案後端全域限流窗口是 60 秒
    // （backend/app/middleware/rate_limit.py GLOBAL_LIMIT=300/60s），真實的
    // 429 理論上可以帶到 ~60 秒的 Retry-After。但 fetchAPI 是使用者正在等待
    // 的前景操作（日記列表、行事曆讀取…），照單全收等一整分鐘不像「有耐心
    // 重試」，比較像「當機」。夾在跟 computeBackoffDelay 預設 capMs 同一個
    // 量級（4 秒）：遠小於整個限流窗口，但足以正確尊重「窗口快關閉」時
    // 伺服器給的較短等待（例如 1~2 秒）——這是最常見的 429 情境。窗口剛被
    // 打滿的極端情況會在這個上限重試、大機率再拿一次 429，最終由既有的
    // 「重試次數用盡就如實拋錯」機制收尾（呼叫端看到錯誤或本機快取），
    // 而不是讓這一次 fetchAPI 呼叫本身卡住到接近一分鐘。
    const RETRY_AFTER_CAP_MS = 4000;

    // 純粹把 setTimeout 包成 Promise，讓重試迴圈可以 await。vitest 用
    // vi.useFakeTimers() + advanceTimersByTimeAsync() 控制它，不必真的等待。
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 算出「這次重試」實際要等待的毫秒數。純函式，不碰 DOM/window。
     *
     * 一般情況（非 429，或 429 但沒有可用的 Retry-After）就是呼叫端已經算好
     * 的 backoffDelayMs（來自 computeBackoffDelay）原樣送回。
     *
     * 429 且帶了有效 Retry-After 時，改用 `Math.max(夾住上限的 retryAfterMs,
     * backoffDelayMs)`——尊重伺服器明確要求的等待時間（不會比它講的還快
     * 重試，白白再撞進同一個還沒解除的限流窗口），同時：
     *   1. 用 RETRY_AFTER_CAP_MS 夾住上限，避免誇張/惡意的標頭把單次
     *      fetchAPI 呼叫卡住太久（理由見該常數上方註解）。
     *   2. 仍取 Math.max 而不是直接採用，確保絕不會比一般退避還快——
     *      即使伺服器送出 "Retry-After: 0"，也不會因此變成無延遲的
     *      立即重試。
     *
     * @param {Object} [params]
     * @param {number} [params.status] - HTTP 狀態碼
     * @param {number|null} [params.retryAfterMs] - parseRetryAfterMs() 的結果
     * @param {number} [params.backoffDelayMs] - computeBackoffDelay() 算出的
     *   一般退避值（呼叫端負責算好再傳進來，這裡不重複計算）
     * @returns {number} 毫秒數，恆為 >= 0 的有限數字
     */
    function resolveRetryDelayMs(params) {
        const { status = null, retryAfterMs = null, backoffDelayMs = 0 } = params || {};
        const safeBackoff = Number.isFinite(backoffDelayMs) && backoffDelayMs >= 0 ? backoffDelayMs : 0;

        if (status === 429 && Number.isFinite(retryAfterMs)) {
            const cappedRetryAfterMs = Math.min(Math.max(retryAfterMs, 0), RETRY_AFTER_CAP_MS);
            return Math.max(cappedRetryAfterMs, safeBackoff);
        }

        return safeBackoff;
    }

    /**
     * 這次請求最多可以重試幾次（只給 GET 用；呼叫端會再乘上「method 是否為
     * GET」這個條件——這裡只負責從設定值算出一個安全的次數）。
     * CONFIG.API.AUTO_RETRY 明確設為 false 時整個停用（0 次）；MAX_RETRIES
     * 不是合法的非負數時退回與 config.js 預設值一致的 2。
     * @returns {number}
     */
    function getConfiguredMaxRetries() {
        if (CONFIG && CONFIG.API && CONFIG.API.AUTO_RETRY === false) {
            return 0;
        }
        const configured = CONFIG && CONFIG.API ? CONFIG.API.MAX_RETRIES : undefined;
        if (!Number.isFinite(configured) || configured < 0) {
            return 2;
        }
        return configured;
    }

    // 回報「這次請求觀察到的連線狀態」給 UIManager 的離線橫幅（v2.3 task
    // 2.3）。navigator.onLine 在部分平台/瀏覽器離線時仍可能回報 true，實際
    // 打 API 成功/失敗才是更準的訊號。UIManager 可能尚未載入（例如純後端
    // 測試情境），typeof 檢查是這個檔案一貫的防禦寫法。
    function reportConnectivity(isOnline) {
        try {
            if (typeof UIManager !== 'undefined' && typeof UIManager.reportNetworkStatus === 'function') {
                UIManager.reportNetworkStatus(isOnline);
            }
        } catch (reportError) {
            console.warn('回報連線狀態失敗:', reportError);
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

        // 與 doRefreshToken 401 分支同一套 compare-and-clear 保護（理由見該函式
        // 內的註解）：記下這個情境「送出這次請求時」以為有效的刷新令牌。下面
        // 這次請求若收到 401、正要清除認證時，要先確認儲存的刷新令牌是否仍是
        // 這一張——不是的話，代表另一個分頁／視窗已經搶先完成輪替並存入新
        // 令牌對，這裡清除只會把贏家剛存好的工作階段一起弄丟。doRefreshToken
        // 401 分支關的是「刷新請求本身」的這個洞，這裡補的是 fetchAPI 原本
        // 發起的請求 401 時、先前還沒關過的另一半（clearAuthToken 之前在這裡
        // 是無條件呼叫）。
        const refreshTokenAtRequestStart = getRefreshToken();

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
            // （訪問令牌只有 30 分鐘，靠刷新令牌續命是常態而非例外）
            if ((accessToken || getRefreshToken()) && isTokenExpiringSoon()) {
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

            // v2.4 spec②：body 是 FormData 時（例如 voice_module.js 上傳錄音檔到
            // /voice/stt）絕不能手動設 Content-Type——瀏覽器需要自己在送出前
            // 附上 multipart/form-data 的 boundary 參數，一旦被下面固定的
            // 'application/json' 蓋掉，後端連 multipart 都解析不了。
            const isFormDataBody = (typeof FormData !== 'undefined') && options.body instanceof FormData;

            // 設置默認選項
            // X-Memory-Semantic / X-Language 為無條件基礎標頭（不放進被 hasKey
            // 閘住的 X-LLM-* 區塊）：即使走後端後備供應商，偏好也要生效
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    ...(isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
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
            // 未存金鑰且非本地供應商時不附標頭 → 後端依序走「使用者存在伺服器的
            // 憑證 → 伺服器預設 → .env Grok 後備」（見 api/deps.get_llm_config）。
            //
            // 沒有安全儲存的環境（手機瀏覽器 / PWA）整段跳過：那裡的金鑰本來就
            // 存在伺服器上，硬送標頭只會讓後端改用「這台手機的 localStorage 偏好」
            // ——例如 local 供應商的 http://localhost:11434 在手機上指的是手機自己，
            // 不是跑後端的那台機器，送出去只會壞掉。
            const LLM_ENDPOINT_PATTERNS = ['/chat/', '/generate', '/interaction-notes/update', '/analytics/emotion/'];
            const hasSecureStore = (typeof SecureStore !== 'undefined') && SecureStore.isAvailable();
            if (hasSecureStore && LLM_ENDPOINT_PATTERNS.some(p => endpoint.includes(p))) {
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

            // 語音端點永遠用 xAI 金鑰（v2.4 spec ②）；僅桌面（有 secure store）帶標頭，
            // PWA 走後端 DB 憑證/env 後備。
            if (hasSecureStore && endpoint.startsWith('/voice/')) {
                const grokKey = SecureStore.getKey('grok');
                if (grokKey) fetchOptions.headers['X-Voice-Api-Key'] = grokKey;
            }

            // 如果有body，將其轉換為JSON（FormData 原樣送出——JSON.stringify 一個
            // FormData 物件只會得到 "{}"，上傳內容整個消失）
            if (options.body) {
                fetchOptions.body = isFormDataBody ? options.body : JSON.stringify(options.body);
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
            
            // 使用AbortController設置超時 - LLM 生成類請求（聊天回覆、結束對話、
            // 生成日記）統一放寬：後端要等 LLM 供應商生成，grok-4.6 等較大模型
            // 常超過 30 秒（2026-08 驗收實測），30 秒斷線會把已在路上的回覆
            // 白白丟掉，使用者按「重試」還會把訊息再送一次。
            const isLongLlmRequest = endpoint.includes('/chat/end/') ||
                endpoint.includes('/diary/enhanced-generate') ||
                endpoint.includes('/chat/enhanced');
            // 為 LLM 生成類請求設置更長的超時時間
            const timeoutDuration = isLongLlmRequest ?
                180000 : // 180秒（3分鐘）
                (CONFIG && CONFIG.API && CONFIG.API.TIMEOUT ? CONFIG.API.TIMEOUT : 30000); // 默認30秒

            // v2.3 task 2.3：只有 GET 才會進到下面的重試迴圈。POST/PUT/DELETE
            // 有副作用，自動重試可能讓伺服器真的收到兩次請求，絕不重試——
            // maxAttempts 在這裡直接鎖成 1（isRetryableMethod 為 false 時）
            // 是第一道防線，isRetryableFailure() 的 method 檢查是第二道，
            // 就算其中一處判斷式寫錯，另一處仍能擋下。
            const isRetryableMethod = (fetchOptions.method || 'GET').toUpperCase() === 'GET';
            const maxAttempts = 1 + (isRetryableMethod ? getConfiguredMaxRetries() : 0);

            let response = null;
            let attempt = 0;

            while (true) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    console.warn(`請求超時: ${url} (${timeoutDuration}ms)`);
                    controller.abort(`請求超時 (${timeoutDuration}ms)`);
                }, timeoutDuration);

                fetchOptions.signal = controller.signal;

                let networkFailure = null;
                try {
                    // 發送請求
                    response = await fetch(url, fetchOptions);
                } catch (fetchError) {
                    networkFailure = fetchError;
                } finally {
                    clearTimeout(timeoutId);
                }

                attempt++;

                if (networkFailure) {
                    // 尚未離線才值得重試——navigator.onLine 在重試等待期間變成
                    // false，代表裝置在這段時間離線了，繼續重試只是白燒重試
                    // 次數，不如把原始錯誤如實丟出去（外層 catch 會分類成
                    // OFFLINE_MODE/逾時等，訊息仍然正確）。
                    const canRetry = attempt < maxAttempts && navigator.onLine &&
                        isRetryableFailure({ method: fetchOptions.method, isNetworkFailure: true });
                    if (canRetry) {
                        console.warn(`網路層失敗，等待後進行第 ${attempt + 1}/${maxAttempts} 次嘗試: ${endpoint}`);
                        await sleep(computeBackoffDelay(attempt - 1, RETRY_BASE_DELAY_MS));
                        continue;
                    }
                    throw networkFailure;
                }

                // 401/403/其餘 4xx 一律不重試（isRetryableFailure 只認 5xx 與
                // 帶 Retry-After 的 429），不會被下面這段誤攔——非重試情況
                // 直接落到迴圈外，交給既有的狀態碼處理邏輯（完全不變）。
                if (!response.ok) {
                    const retryAfterMs = parseRetryAfterMs(
                        response.headers && typeof response.headers.get === 'function' ?
                            response.headers.get('Retry-After') : null
                    );
                    const canRetry = attempt < maxAttempts && navigator.onLine &&
                        isRetryableFailure({ method: fetchOptions.method, status: response.status, retryAfterMs });
                    if (canRetry) {
                        // code review 修復：429 帶 Retry-After 時，過去這裡
                        // 算出 retryAfterMs 只拿去當「該不該重試」的門檻
                        // （isRetryableFailure），實際 sleep() 卻永遠套用固定
                        // 的指數退避，等於算完就丟掉伺服器明確講的等待秒數
                        // ——resolveRetryDelayMs 把它接進來（並夾住上限，
                        // 理由見 RETRY_AFTER_CAP_MS 上方註解）。
                        const delayMs = resolveRetryDelayMs({
                            status: response.status,
                            retryAfterMs,
                            backoffDelayMs: computeBackoffDelay(attempt - 1, RETRY_BASE_DELAY_MS)
                        });
                        console.warn(`HTTP ${response.status}，等待 ${delayMs}ms 後進行第 ${attempt + 1}/${maxAttempts} 次嘗試: ${endpoint}`);
                        await sleep(delayMs);
                        continue;
                    }
                }

                break;
            }

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

                // 只有「儲存的刷新令牌仍是這次請求送出時那一張」才代表這個
                // 分頁的登入狀態真的死了。理由與 doRefreshToken 401 分支相同：
                // 不同代表另一個分頁／視窗已經贏得輪替、存入新令牌對——這個
                // 分頁其實仍握有有效的登入狀態，只是這次請求用的是已經作廢
                // 的舊 access token 而已，不該被強制登出（那會把贏家剛存好
                // 的工作階段一起弄丟，兩邊都被踢回登入畫面）。
                if (getRefreshToken() === refreshTokenAtRequestStart) {
                    // 令牌真的死了：清掉，並用 JWT_AUTH_ERROR 觸發下面 catch
                    // 區塊的強制登出流程（顯示 toast、發送
                    // urdiary:auth-expired、帶使用者回登入畫面——正確反應，
                    // 因為已經沒有有效的工作階段了）。
                    clearAuthToken();
                    throw new Error('JWT_AUTH_ERROR');
                }

                // 令牌沒清：不能再丟 JWT_AUTH_ERROR，那個錯誤碼在下面一定會
                // 觸發強制登出（見 catch 區塊的 case 'JWT_AUTH_ERROR'）——但
                // 儲存裡明明是別的分頁／視窗剛存好的有效令牌，把使用者踢回
                // 登入畫面是誤判，也違背這個保護原本的目的。改如實丟一般
                // API 錯誤（沿用「401 但沒有 accessToken」時本來就會走的同一
                // 條路徑），不會觸發 toast／urdiary:auth-expired／登入畫面，
                // 讓呼叫端照既有方式顯示這次請求失敗；下一次請求會自然讀到
                // 儲存裡最新的令牌、主動刷新後恢復正常。
                console.warn('刷新令牌已被其他分頁換新，保留較新的令牌，不觸發強制登出');
                throw new Error(`API_ERROR:${response.status}`);
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

            // v2.3 task 2.3：這次請求最終成功（可能是重試後成功）——回報連線
            // 正常，離線橫幅若正顯示中會被清除。
            reportConnectivity(true);

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

            // v2.3 task 2.3：只有網路層失敗（離線/逾時/連不上）才回報——
            // 4xx/5xx 之類「有連上但被拒絕/伺服器出錯」不算，不該讓離線橫幅
            // 在那種情況下出現（那不是連線問題，是別的問題）。
            if (isNetworkFailure) {
                reportConnectivity(false);
            }

            // 組出如實、可讀的錯誤訊息（不再以模擬數據掩蓋錯誤）
            let friendlyMessage;
            switch (errorCode) {
                case 'OFFLINE_MODE':
                    friendlyMessage = I18N.t('errors.offline');
                    break;

                case 'JWT_AUTH_ERROR':
                    // 走到這裡代表這個分頁的登入狀態真的死了，令牌已在上方
                    // fetchAPI 的 401 分支清除（見該分支的 compare-and-clear
                    // 保護）。若是另一個分頁／視窗贏得輪替、這個分頁的令牌
                    // 其實還活著，401 分支改丟 API_ERROR，不會帶著
                    // JWT_AUTH_ERROR 走到這裡，也就不會被下面的強制登出流程
                    // 誤傷。
                    friendlyMessage = I18N.t('errors.authFailed');
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast(I18N.t('errors.authFailed'));
                    }
                    // 通知主流程開啟登入對話框
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
     * fetchAPI 的「原始回應」變體：回傳 response.blob()，不解析 JSON。
     * 供二進位內容端點使用（v2.4 spec② /voice/tts 回 audio/mpeg）。
     *
     * 與 fetchAPI 共用同一套 token/base-url/401 邏輯（直接呼叫同一個閉包裡的
     * accessToken/getRefreshToken/isTokenExpiringSoon/refreshToken/
     * clearAuthToken，不重新實作一遍）。刻意保留的差異：
     *   - body 原樣送出，絕不 JSON.stringify——呼叫端若要送 JSON，自己先
     *     JSON.stringify 並自帶 Content-Type 標頭（見 voice_module.js 的
     *     speak()）；對已經是字串的 body 再 stringify 一次會變成雙重編碼，
     *     後端收到的會是一個 JSON 字串常量而不是物件。
     *   - 不含 fetchAPI 的 GET 自動重試迴圈：目前唯一呼叫端 /voice/tts 是
     *     POST（非冪等，重試可能讓使用者被重複計費/生成兩次音檔），沒有
     *     必要承接那一段複雜度。
     *   - 不含 ErrorLogger/離線快取回退/友善錯誤訊息轉換等 fetchAPI 才有的
     *     周邊功能——這些是 JSON 端點的既有慣例，Blob 端點目前用不到。
     *
     * @param {string} endpoint - API端點
     * @param {Object} [options] - { method, headers, body }，body 不會被轉換
     * @returns {Promise<Blob>}
     */
    async function fetchRaw(endpoint, options = {}) {
        ensureInitialized();

        if (!navigator.onLine) {
            throw new Error('OFFLINE_MODE');
        }

        // 與 fetchAPI 401 分支相同的 compare-and-clear 保護（理由見該函式內
        // 的註解）：記下送出這次請求時以為有效的刷新令牌。
        const refreshTokenAtRequestStart = getRefreshToken();

        const baseUrl = CONFIG.getApiBaseUrl();

        if ((accessToken || getRefreshToken()) && isTokenExpiringSoon()) {
            const refreshed = await refreshToken();
            if (!refreshed) {
                console.warn('令牌刷新失敗，將使用當前令牌繼續嘗試 (fetchRaw)');
            }
        }

        const url = `${baseUrl}${endpoint}`;
        const fetchOptions = {
            method: options.method || 'GET',
            headers: { ...options.headers }
        };
        if (accessToken) {
            fetchOptions.headers['Authorization'] = `Bearer ${accessToken}`;
        }

        // 語音端點永遠用 xAI 金鑰（v2.4 spec ②）；僅桌面（有 secure store）帶標頭，
        // PWA 走後端 DB 憑證/env 後備。與 fetchAPI 的同名區塊邏輯一致——fetchRaw
        // 是目前唯一呼叫 /voice/tts 的路徑，沒有這段的話桌面版金鑰只存在
        // Electron secure store、從未送到後端，TTS 一律 400（fix wave item 2）。
        const hasSecureStore = (typeof SecureStore !== 'undefined') && SecureStore.isAvailable();
        if (hasSecureStore && endpoint.startsWith('/voice/')) {
            const grokKey = SecureStore.getKey('grok');
            if (grokKey) fetchOptions.headers['X-Voice-Api-Key'] = grokKey;
        }

        if (options.body !== undefined) {
            fetchOptions.body = options.body;
        }

        const timeoutDuration = (CONFIG && CONFIG.API && CONFIG.API.TIMEOUT) ? CONFIG.API.TIMEOUT : 30000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort(`請求超時 (${timeoutDuration}ms)`);
        }, timeoutDuration);
        fetchOptions.signal = controller.signal;

        let response;
        try {
            response = await fetch(url, fetchOptions);
        } finally {
            clearTimeout(timeoutId);
        }

        if (response.status === 401 && accessToken) {
            // 只有「儲存的刷新令牌仍是這次請求送出時那一張」才代表這個分頁的
            // 登入狀態真的死了——理由與 fetchAPI 401 分支相同（另一分頁／
            // 視窗可能已經贏得輪替、存入新令牌對，這裡清除會把它的工作階段
            // 一起弄丟）。
            if (getRefreshToken() === refreshTokenAtRequestStart) {
                clearAuthToken();
                try {
                    window.dispatchEvent(new CustomEvent('urdiary:auth-expired', { detail: { endpoint } }));
                } catch (dispatchError) {
                    console.warn('無法發送認證失效事件 (fetchRaw):', dispatchError);
                }
                throw new Error('JWT_AUTH_ERROR');
            }
            throw new Error(`API_ERROR:${response.status}`);
        }

        if (!response.ok) {
            throw new Error(`API_ERROR:${response.status}`);
        }

        return await response.blob();
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
    //
    // v2.3 task 2.3 修復：這裡先前有一個手寫的重試迴圈，對 500 系列錯誤會
    // 自動重打 CONFIG.API.MAX_RETRIES 次（等 1 秒後再送）。POST 是非冪等
    // 請求——若第一次其實已經送達（只是回應遺失/逾時），自動重試會讓後端
    // 真的收到兩次同一句話，可能造成訊息重複或重複觸發 LLM 呼叫（雙重扣費）。
    // 這條路徑違反本次任務的核心規則（絕不自動重試非冪等請求），予以移除：
    // 現在只送一次，失敗如實拋出，交由 ChatModule 在聊天氣泡上提供「點擊
    // 重試」——那才是使用者主動決定的重送，不是背著使用者自動重來。
    async function sendChatMessage(message, model = null) {
        try {
            console.log(`開始發送聊天消息${model ? `(模型: ${model})` : ''}:`, message.substring(0, 50) + (message.length > 50 ? '...' : ''));

            // 檢查網絡連接
            if (!navigator.onLine) {
                console.warn('設備處於離線狀態，使用離線模式');
                throw new Error('網絡連接不可用');
            }

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
            console.error('發送消息錯誤:', error);
            // 如實拋出錯誤（訊息已由 fetchAPI 轉為可讀格式），由聊天模塊顯示給使用者
            throw error;
        }
    }

    // 結束聊天並生成日記
    //
    // v2.3 task 2.3 修復：理由與 sendChatMessage 相同——這同樣是非冪等的
    // POST（會觸發 LLM 產生日記、寫入資料庫），先前的自動重試迴圈同樣移除，
    // 只送一次，失敗如實拋出。對話歷史仍保留在伺服器端，使用者可以自己
    // 決定要不要再按一次「結束對話」。
    async function endChat(model = null, enableDayNote = true) {
        try {
            console.log(`調用API結束聊天並生成日記${model ? `(模型: ${model})` : ''}`);

            // 檢查網絡連接
            if (!navigator.onLine) {
                console.warn('設備處於離線狀態，使用離線模式');
                throw new Error('網絡連接不可用');
            }

            // 使用較長的超時時間
            // 身分由後端從 JWT 導出、供應商/模型由 X-LLM-* 標頭提供
            const data = await fetchAPI('/chat/end/', {
                method: 'POST',
                body: {
                    exclude_interaction_notes: true,  // 防止將互動筆記融入日記
                    enable_day_note: enableDayNote !== false  // v2.5 Spec A：AI 行事曆印章開關
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
            const cachedDiaries = response.diaries;
            // v2.3 task 2.3：把「這是快取資料」標記在陣列物件本身上，而不是
            // 改成回傳 { diaries, fromCache } 包一層——DiaryModule 既有程式碼
            // 到處假設 ApiService.getDiaries() 直接回傳陣列（Array.isArray、
            // .length、.forEach、.find...），改變回傳形狀要同步改掉好幾處
            // 呼叫端，風險比較大。陣列本身也是物件，掛一個屬性上去，不在乎
            // 這件事的呼叫端完全不受影響，想知道的（DiaryModule 的快取標籤）
            // 才需要多讀 diaries._fromCache。
            cachedDiaries._fromCache = true;
            return cachedDiaries;
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
            arousal: diary.arousal || 0.5,
            // v2.5 日記可愛化：當日 AI 印章（無章＝null）
            stamp: diary.stamp || null,
            stamp_phrase: diary.stamp_phrase || null
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

    // v2.5 Spec A：AI 日記印章（隨月載入；無 POST——寫入在 /chat/end 伺服器端）
    async function getDayNotes(start, end) {
        const path = `/calendar/day-notes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        return await fetchAPI(path, { method: 'GET' });
    }

    // 刪除某日印章 → { message }
    async function deleteDayNote(dateIso) {
        return await fetchAPI(`/calendar/day-notes/${encodeURIComponent(dateIso)}`, { method: 'DELETE' });
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
                
                // 保存令牌對（access + refresh）；伺服器未給有效期時抓 30 分鐘
                await setTokens({
                    access_token: authData.access_token,
                    expires_in: authData.expires_in || 1800,
                    refresh_token: authData.refresh_token
                });

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
            if (typeof SecureStore !== 'undefined' && SecureStore.ready) {
                await SecureStore.ready;
            }

            // 訪問令牌還夠用（留 5 分鐘餘裕）就直接用
            if (accessToken && !isTokenExpiringSoon(5)) {
                console.log('使用現有有效令牌');
                return { success: true };
            }

            // 否則只要還有刷新令牌就換一張新的（訪問令牌 30 分鐘，這是常態路徑）
            if (getRefreshToken()) {
                console.log('訪問令牌即將／已經過期，嘗試以刷新令牌換新...');
                const refreshed = await refreshToken();
                if (refreshed) {
                    console.log('令牌刷新成功');
                    return { success: true };
                }
                console.warn('令牌刷新失敗，需要重新登入');
            }

            // 密碼不會存在本機，無法代替使用者登入 —— 交回登入介面
            clearAuthToken();
            console.log('沒有可用的令牌，需要使用者輸入密碼登入');
            return { success: false, needLogin: true, error: I18N.t('auth.needLogin') };

        } catch (error) {
            console.error('自動登入過程發生錯誤:', error);
            return { success: false, needLogin: true, error: I18N.t('auth.autoLoginFailed', { error: error.message }) };
        }
    }

    /**
     * 登出：先請後端撤銷這台裝置的工作階段，再清本機令牌。
     *
     * 後端撤銷失敗（離線等）也一定要清本機 —— 使用者按了登出就該登出，
     * 剩下的訪問令牌最多 30 分鐘後自然失效。
     */
    async function logout() {
        try {
            if (accessToken) {
                await fetchAPI('/users/logout', { method: 'POST' });
            }
        } catch (error) {
            console.warn('通知後端登出失敗（仍會清除本機令牌）:', error.message);
        } finally {
            clearAuthToken();
        }
        return { success: true };
    }

    /**
     * 已登入的裝置清單（設定面板顯示用）
     */
    async function getSessions() {
        return await fetchAPI('/users/sessions');
    }

    /**
     * 撤銷指定裝置的登入狀態
     */
    async function revokeSession(sessionId) {
        return await fetchAPI(`/users/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    }

    // ---- 存在伺服器上的 LLM 金鑰（手機瀏覽器路徑；v2.3 task 1.6）----
    // 桌面版走 SecureStore + X-LLM-* 標頭，不會用到這三個。
    // 回應永遠只有遮罩後的最後 4 碼，拿不回明文金鑰。

    /**
     * 目前生效的 LLM 設定與來源（user / server / env / null）
     */
    async function getLlmCredential() {
        return await fetchAPI('/users/me/llm');
    }

    /**
     * 儲存自己的 LLM 金鑰（加密存在伺服器上，取代既有那組）
     * @param {Object} payload - { provider, api_key, base_url?, model? }
     */
    async function saveLlmCredential(payload) {
        return await fetchAPI('/users/me/llm', { method: 'PUT', body: payload });
    }

    /**
     * 刪除自己存在伺服器上的 LLM 金鑰（之後回退到伺服器預設）
     */
    async function deleteLlmCredential() {
        return await fetchAPI('/users/me/llm', { method: 'DELETE' });
    }

    // 導出API
    return {
        init,
        ensureInitialized,
        fetchAPI,
        fetchRaw,
        sendChatMessage,
        checkIn: checkIn,
        endChat: endChat,
        getDiaries: getDiaries,
        getCalendarEvents: getCalendarEvents,
        createCalendarEvent: createCalendarEvent,
        updateCalendarEvent: updateCalendarEvent,
        deleteCalendarEvent: deleteCalendarEvent,
        getDayNotes: getDayNotes,
        deleteDayNote: deleteDayNote,
        getLocalData: getLocalData,
        saveLocalData: saveLocalData,
        setUserId: setUserId,
        login: login,
        autoLogin: autoLogin,
        logout: logout,
        refreshToken: refreshToken,
        getSessions: getSessions,
        revokeSession: revokeSession,
        getLlmCredential: getLlmCredential,
        saveLlmCredential: saveLlmCredential,
        deleteLlmCredential: deleteLlmCredential,
        // 「還握有可用的憑證」：訪問令牌未過期，或還有刷新令牌可以換一張。
        // 不能再用 60 分鐘當門檻 —— 訪問令牌只有 30 分鐘，那樣永遠是 false。
        isAuthenticated: () => (!!accessToken && !isTokenExpiringSoon(0)) || !!getRefreshToken(),
        // 以下皆為純函式，僅為 vitest 單元測試曝光，行為不變（fetchAPI 內部
        // 也是這幾個函式的呼叫端，見該函式內的重試迴圈）
        deriveDiaryTitle: deriveDiaryTitle,
        getMoodFromValence: getMoodFromValence,
        computeBackoffDelay: computeBackoffDelay,
        isRetryableFailure: isRetryableFailure,
        parseRetryAfterMs: parseRetryAfterMs,
        getConfiguredMaxRetries: getConfiguredMaxRetries,
        resolveRetryDelayMs: resolveRetryDelayMs,
        RETRY_AFTER_CAP_MS: RETRY_AFTER_CAP_MS
    };
})();

// 將 ApiService 暴露為全局變量
window.ApiService = ApiService;