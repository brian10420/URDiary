/**
 * API服務模塊 - 處理與後端的所有通信
 */
const ApiService = (function() {
    // API基礎URL
    let API_BASE_URL = 'http://localhost:8000';
    
    // 用戶ID（暫時靜態設置，後續可從登錄過程獲取）
    let currentUserId = localStorage.getItem('currentUserId') || 'desktop_user';
    let numericUserId = parseInt(localStorage.getItem('numericUserId') || '1');
    
    // 初始化方法
    function init() {
        console.log('初始化 API 服務');
        // 從配置中獲取 API URL
        if (typeof CONFIG !== 'undefined' && CONFIG.API && CONFIG.API.BASE_URL) {
            API_BASE_URL = CONFIG.API.BASE_URL;
            console.log('使用配置的 API URL:', API_BASE_URL);
        }
        
        // 顯示初始化信息
        console.log('API 服務初始化完成，基礎 URL:', API_BASE_URL);
        return true;
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
     * 發送API請求
     * @param {string} endpoint - API端點
     * @param {Object} options - 請求選項
     * @returns {Promise<Object>} - 響應數據
     */
    async function fetchAPI(endpoint, options = {}) {
        const startTime = Date.now();
        
        try {
            // 檢查網絡連接
            if (!navigator.onLine) {
                throw new Error('設備處於離線狀態，無法連接API');
            }
            
            // 構建完整URL
            const baseUrl = CONFIG && CONFIG.API && CONFIG.API.BASE_URL ? 
                CONFIG.API.BASE_URL : 'http://localhost:8000';
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
            
            // 如果有body，將其轉換為JSON
            if (options.body) {
                fetchOptions.body = JSON.stringify(options.body);
            }
            
            console.log(`發送請求到: ${url}`, { method: fetchOptions.method });
            
            // 將請求信息添加到系統日誌，添加安全檢查
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
            const isEndChatRequest = endpoint.includes('/diary/enhanced-generate');
            // 為結束聊天請求設置更長的超時時間
            const timeoutDuration = isEndChatRequest ? 
                60000 : // 60秒
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
            
            // 檢查響應是否成功
            if (!response.ok) {
                let errorText = '';
                try {
                    errorText = await response.text();
                } catch (textError) {
                    errorText = `無法獲取錯誤詳情: ${textError.message}`;
                }
                
                throw new Error(`API錯誤 (${response.status}): ${errorText}`);
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
            
            // 針對AbortError特殊處理
            if (error.name === 'AbortError') {
                console.warn(`請求被中止: ${endpoint}`);
                
                // 如果是生成日記的請求，嘗試使用模擬數據
                if (endpoint.includes('/diary/enhanced-generate') && CONFIG && CONFIG.USE_MOCK_DATA) {
                    console.log('使用模擬數據作為結束聊天響應');
                    return getMockDataForEndpoint('/chat/end/');
                }
            }
            
            // 針對特定端點實現本地備份策略
            if (endpoint.includes('/diaries') || endpoint.includes('/notes')) {
                console.log('嘗試使用本地數據作為備份...');
                const localData = getLocalData(endpoint);
                if (localData) {
                    console.log('使用本地備份數據:', endpoint);
                    return localData;
                }
            }
            
            // 如果是超時或網絡錯誤，且配置了使用模擬數據
            if ((error.name === 'AbortError' || error.name === 'TypeError') && 
                CONFIG && CONFIG.USE_MOCK_DATA) {
                console.log('嘗試使用模擬數據...');
                return getMockDataForEndpoint(endpoint);
            }
            
            // 重新拋出錯誤
            throw new Error(`API請求出錯: ${error.message}`);
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
    function getMockDataForEndpoint(endpoint, options) {
        switch (endpoint) {
            case '/chat/':
            case '/chat/enhanced/':
                return {
                    response: getRandomResponse()
                };
                
            case '/chat/end/':
            case '/diary/enhanced-generate':
                return {
                    success: true,
                    message: '對話已結束，日記已生成',
                    diary: {
                        diary_id: generateId(),
                        title: '今日日記',
                        content: '今天我與AI助手進行了一次愉快的對話，分享了一些想法和感受。通過對話，我更清楚地了解了自己的想法。',
                        diary_date: new Date().toISOString(),
                        valence: 0.6,
                        arousal: 0.4
                    }
                };
                
            case '/diaries/1':
                return {
                    diaries: generateSampleDiaries().map(d => ({
                        diary_id: d.id,
                        title: d.title,
                        content: d.content,
                        diary_date: d.date,
                        valence: d.valence || 0.5,
                        arousal: d.arousal || 0.5
                    }))
                };
                
            case '/interaction-notes/1':
                return {
                    success: true,
                    id: 1,
                    version: 1,
                    content: '這是一個互動筆記示例...',
                    updated_at: new Date().toISOString()
                };
                
            default:
                return { success: false, message: '未找到適合的模擬數據' };
        }
    }
    
    // 發送聊天消息
    async function sendChatMessage(message) {
        try {
            // 直接調用chat/enhanced端點
            const data = await fetchAPI('/chat/enhanced/', {
                method: 'POST',
                body: {
                    user_id: currentUserId,
                    numeric_user_id: numericUserId,
                    message: message
                }
            });
            
            return data.response || '抱歉，無法處理您的請求。';
        } catch (error) {
            console.error('發送消息錯誤:', error);
            
            // 使用模擬數據作為備份
            if (CONFIG.USE_MOCK_DATA) {
                return getRandomResponse();
            }
            
            throw error;
        }
    }
    
    // 結束聊天並生成日記
    async function endChat() {
        try {
            console.log('調用API結束聊天並生成日記');
            
            // 使用較長的超時時間
            const data = await fetchAPI('/diary/enhanced-generate', {
                method: 'POST',
                body: {
                    user_id: currentUserId,
                    numeric_user_id: numericUserId
                }
            });
            
            console.log('生成日記API響應:', data);
            
            // 檢查響應數據
            if (!data || (!data.success && !data.diary)) {
                console.warn('API返回的數據缺少必要字段');
                if (CONFIG && CONFIG.USE_MOCK_DATA) {
                    console.log('使用模擬數據替代');
                    return getMockDataForEndpoint('/chat/end/');
                }
                throw new Error('無效的API響應數據');
            }
            
            return data;
        } catch (error) {
            console.error('結束聊天錯誤:', error);
            
            // 使用模擬數據作為備份
            if (CONFIG && CONFIG.USE_MOCK_DATA) {
                console.log('使用模擬數據作為結束聊天響應');
                return getMockDataForEndpoint('/chat/end/');
            }
            
            throw error;
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
    
    // 返回公共API
    return {
        init: init,
        sendChatMessage: sendChatMessage,
        endChat: endChat,
        getDiaries: getDiaries,
        getDiaryById: getDiaryById,
        getMockData: getMockDataForEndpoint,
        getNotes: getNotes,
        saveNote: saveNote,
        deleteNote: deleteNote,
        generateId: generateId,
        showAppError: showAppError,
        validateApiData: validateApiData,
        fixDataFormat: fixDataFormat,
        getMoodFromValence: getMoodFromValence,
        setUserId: setUserId,
        getLocalData: getLocalData,
        saveLocalData: saveLocalData,
        mockApiCall: mockApiCall
    };
})();

// 將 ApiService 暴露為全局變量
window.ApiService = ApiService;