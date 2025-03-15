/**
 * 網絡請求工具模塊 - 提供調試功能的API請求
 */

// 建立一個獨立的fetchAPI工具
const FetchAPIUtil = {
    // API基礎URL
    baseUrl: 'http://localhost:8000',
    
    // 默認請求選項
    defaultOptions: {
        headers: {
            'Content-Type': 'application/json'
        }
    },
    
    // 設置API基礎URL
    setBaseUrl(url) {
        this.baseUrl = url;
        console.log('API基礎URL已設置為:', url);
    },
    
    // 執行API請求
    async fetch(endpoint, options = {}) {
        // 構建完整URL
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        
        // 合併選項
        const fetchOptions = {
            ...this.defaultOptions,
            ...options,
            headers: {
                ...this.defaultOptions.headers,
                ...(options.headers || {})
            }
        };
        
        // 記錄請求
        console.log(`發出請求: ${options.method || 'GET'} ${url}`, {
            options: fetchOptions,
            body: fetchOptions.body
        });
        
        try {
            // 發送請求
            const response = await fetch(url, fetchOptions);
            
            // 檢查響應狀態
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP錯誤 ${response.status}: ${errorText}`);
            }
            
            // 解析JSON響應
            const data = await response.json();
            
            // 記錄成功響應
            console.log(`請求成功: ${url}`, data);
            
            return data;
        } catch (error) {
            // 記錄錯誤
            console.error(`請求失敗: ${url}`, error);
            throw error;
        }
    },
    
    // GET請求
    async get(endpoint, params = {}) {
        // 構建查詢字符串
        const queryParams = new URLSearchParams();
        for (const key in params) {
            queryParams.append(key, params[key]);
        }
        
        // 添加查詢參數（如果有）
        const urlWithParams = params && Object.keys(params).length > 0
            ? `${endpoint}?${queryParams.toString()}`
            : endpoint;
        
        return this.fetch(urlWithParams, { method: 'GET' });
    },
    
    // POST請求
    async post(endpoint, data = {}) {
        return this.fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    // PUT請求
    async put(endpoint, data = {}) {
        return this.fetch(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },
    
    // DELETE請求
    async delete(endpoint) {
        return this.fetch(endpoint, { method: 'DELETE' });
    },
    
    // 測試連接
    async testConnection() {
        try {
            // 嘗試獲取根路徑
            const response = await fetch(this.baseUrl);
            const success = response.ok;
            console.log(`API連接測試 ${success ? '成功' : '失敗'}: ${this.baseUrl}`);
            return success;
        } catch (error) {
            console.error('API連接測試失敗:', error);
            return false;
        }
    }
};

// 全局導出
window.FetchAPIUtil = FetchAPIUtil;

// 測試函數
async function testAPIs() {
    console.log('===== 開始API測試 =====');
    
    try {
        // 測試連接
        const connectionOk = await FetchAPIUtil.testConnection();
        console.log(`API連接: ${connectionOk ? '成功' : '失敗'}`);
        
        if (connectionOk) {
            // 測試日記API
            try {
                const diaries = await FetchAPIUtil.get('/diaries/1');
                console.log('日記API測試成功:', diaries);
            } catch (error) {
                console.error('日記API測試失敗:', error);
            }
            
            // 測試筆記API
            try {
                const notes = await FetchAPIUtil.get('/interaction-notes/1');
                console.log('筆記API測試成功:', notes);
            } catch (error) {
                console.error('筆記API測試失敗:', error);
            }
        }
    } catch (error) {
        console.error('API測試失敗:', error);
    }
    
    console.log('===== 結束API測試 =====');
}

// 頁面加載完成後執行測試
document.addEventListener('DOMContentLoaded', testAPIs); 