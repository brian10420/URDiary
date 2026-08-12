// @vitest-environment jsdom
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'js', 'config.js');

// config.js 每次都無條件重新 eval + 覆蓋 window.CONFIG，讓每個測試各自
// 用乾淨的 localStorage 狀態驗證合併/預設值邏輯，互不干擾。
function reloadConfig() {
    const code = fs.readFileSync(CONFIG_PATH, 'utf8');
    (0, eval)(code + '\nwindow.CONFIG = CONFIG;');
}

describe('config', () => {
    // task 3.3 稽核（task 1.2 遺留的小缺口）：下面多個測試直接改寫
    // window.location（jsdom 允許 delete 後重新賦值）。原本每個測試自己在
    // 結尾手動還原成 originalLocation；但如果中間的 expect() 先拋出例外，
    // 還原那一行永遠不會執行到，被 mock 過的 window.location 就會直接漏給
    // 同一個檔案裡後面的測試，讓後面本來無關的測試莫名其妙一起變紅、難以
    // 排查。afterEach 保證不論這次測試成功或失敗都會還原，是比「測試本體
    // 最後一行手動還原」更可靠的防線——個別測試原本的手動還原繼續保留，
    // 兩者疊加、互不衝突，只是多一層保險。
    const originalLocation = window.location;

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        window.location = originalLocation;
    });

    it('預設值：API.BASE_URL / AUTH / APP 等', () => {
        reloadConfig();
        expect(CONFIG.API.BASE_URL).toBe('http://localhost:8001');
        expect(CONFIG.API.MAX_RETRIES).toBe(2);
        expect(CONFIG.AUTH.ENABLED).toBe(true);
        expect(CONFIG.AUTH.AUTO_LOGIN).toBe(true);
        expect(CONFIG.APP.NAME).toBe('URDiary');
        expect(CONFIG.STORAGE.THEME).toBe('urdiary_theme');
    });

    it('localStorage urDiary_config_v3 覆蓋合併 API.BASE_URL（其餘 API 欄位維持預設）', () => {
        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL: 'http://localhost:9999' }
        }));
        reloadConfig();
        expect(CONFIG.API.BASE_URL).toBe('http://localhost:9999');
        expect(CONFIG.API.MAX_RETRIES).toBe(2); // 沒被覆蓋的欄位仍是預設值
    });

    it('已刪除的鍵不再出現於 CONFIG', () => {
        reloadConfig();
        expect(CONFIG.API.ENDPOINTS).toBeUndefined();
        expect(CONFIG.MODELS).toBeUndefined();
        expect(CONFIG.STORAGE.DIARIES).toBeUndefined();
        expect(CONFIG.DEBUG.MOCK_API).toBeUndefined();
        expect(CONFIG.USE_MOCK_DATA).toBeUndefined();
        expect(CONFIG.AUTO_SWITCH_TO_MOCK).toBeUndefined();
        // DEBUG 區塊本身仍在，只是少了 MOCK_API 這個鍵
        expect(CONFIG.DEBUG.ENABLED).toBe(true);
    });

    it('getApiBaseUrl()：預設值與 localStorage 覆蓋後的值', () => {
        // 模擬 file: 協議（Electron 環境）以測試預設值
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'file:', origin: 'file://' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://localhost:8001');

        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL: 'http://example.com:1234' }
        }));
        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://example.com:1234');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    it('BASE_URL_OVERRIDE 預設值為 undefined（允許 localStorage 合併）', () => {
        reloadConfig();
        expect(CONFIG.API.BASE_URL_OVERRIDE).toBeUndefined();
    });

    it('getApiBaseUrl()：http: 協議 → 返回 window.location.origin', () => {
        // 模擬 http: 協議的 window.location
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'http:', origin: 'http://example.com:3000' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://example.com:3000');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    it('getApiBaseUrl()：https: 協議 → 返回 window.location.origin', () => {
        // 模擬 https: 協議的 window.location
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'https:', origin: 'https://secure.example.com' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('https://secure.example.com');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    it('getApiBaseUrl()：file: 協議（Electron）→ 使用 config.API.BASE_URL 或預設值', () => {
        // 模擬 file: 協議的 window.location（Electron 環境）
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'file:', origin: 'file://' };

        reloadConfig();
        // 應使用預設的 http://localhost:8001
        expect(CONFIG.getApiBaseUrl()).toBe('http://localhost:8001');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    it('getApiBaseUrl()：file: 協議 + localStorage BASE_URL → 使用 localStorage 值', () => {
        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL: 'http://192.168.1.100:8001' }
        }));

        // 模擬 file: 協議的 window.location（Electron 環境）
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'file:', origin: 'file://' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://192.168.1.100:8001');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    it('getApiBaseUrl()：BASE_URL_OVERRIDE 勝過 http: 協議的 origin', () => {
        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL_OVERRIDE: 'http://custom-override.com:5000' }
        }));

        // 模擬 http: 協議的 window.location
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'http:', origin: 'http://example.com:3000' };

        reloadConfig();
        // 應優先使用 BASE_URL_OVERRIDE
        expect(CONFIG.getApiBaseUrl()).toBe('http://custom-override.com:5000');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    it('getApiBaseUrl()：BASE_URL_OVERRIDE 勝過 file: 協議的預設值', () => {
        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL_OVERRIDE: 'http://override.local:8001' }
        }));

        // 模擬 file: 協議的 window.location（Electron 環境）
        const originalLocation = window.location;
        delete window.location;
        window.location = { protocol: 'file:', origin: 'file://' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://override.local:8001');

        // 恢復原始 window.location
        window.location = originalLocation;
    });

    // --- task 3.3 稽核：getApiBaseUrl() 邊界情況（task 1.2 遺留的缺口）------

    it('getApiBaseUrl()：BASE_URL_OVERRIDE 為空字串時視為未設定，落回協定判斷', () => {
        // 空字串是 falsy，`if (config.API && config.API.BASE_URL_OVERRIDE)`
        // 判斷不會通過——這裡確認真的落回下一層 (http: 協議 → origin)，
        // 而不是把空字串本身當成一個「合法但空白」的覆蓋值原樣回傳。
        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL_OVERRIDE: '' }
        }));

        window.location = { protocol: 'http:', origin: 'http://example.com:3000' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://example.com:3000');
    });

    it('getApiBaseUrl()：非 http/https/file 協定（如 chrome-extension:）→ 落回 config 預設值', () => {
        // getApiBaseUrl 只認 'http:'/'https:' 兩種協定才用 origin；其餘一律
        // (含 file: 之外真的會遇到的協定，例如瀏覽器擴充功能環境) 落回
        // config.API.BASE_URL，與 file: 走同一個分支——proto 變數在這個
        // 分支下就是空字串，不是 'file:' 本身，源碼本來就沒有特別檢查
        // 'file:'，只檢查「是不是 http(s)」。
        window.location = { protocol: 'chrome-extension:', origin: 'chrome-extension://abcdefghijklmnop' };

        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://localhost:8001');
    });

    it('getApiBaseUrl()：非瀏覽器環境（typeof window === "undefined"）→ 落回 config 預設值', () => {
        // 先在正常環境載入一次，拿到真正的 getApiBaseUrl 函式參照——它是
        // 每次呼叫才重新讀取自由變數 window 的 closure（見 config.js 原始碼：
        // `typeof window !== 'undefined' && window.location`），不是在載入
        // 當下就把 window 綁死，所以載入完成之後才把全域 window 暫時抽掉，
        // 一樣能測到這個 guard 的另一側分支。
        //
        // 用 vi.stubGlobal 而不是 `delete window`：jsdom 的 window 就是這個
        // realm 的 globalThis 本身，把它整個刪掉會連 document 等測試環境
        // 依賴的東西一起弄壞；vi.stubGlobal('window', undefined) 只是暫時
        // 把「自由變數 window 解析到的值」換成 undefined，函式呼叫結束、
        // finally 裡 unstubAllGlobals() 一還原，jsdom 環境就完全恢復原狀。
        reloadConfig();
        const getApiBaseUrl = CONFIG.getApiBaseUrl;

        vi.stubGlobal('window', undefined);
        try {
            expect(typeof window).toBe('undefined');
            expect(getApiBaseUrl()).toBe('http://localhost:8001');
        } finally {
            vi.unstubAllGlobals();
        }

        // 環境確實復原：window 又能正常使用
        expect(typeof window).toBe('object');
    });
});
