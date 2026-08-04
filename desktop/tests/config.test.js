// @vitest-environment jsdom
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'js', 'config.js');

// config.js 每次都無條件重新 eval + 覆蓋 window.CONFIG，讓每個測試各自
// 用乾淨的 localStorage 狀態驗證合併/預設值邏輯，互不干擾。
function reloadConfig() {
    const code = fs.readFileSync(CONFIG_PATH, 'utf8');
    (0, eval)(code + '\nwindow.CONFIG = CONFIG;');
}

describe('config', () => {
    beforeEach(() => {
        localStorage.clear();
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
        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://localhost:8001');

        localStorage.setItem('urDiary_config_v3', JSON.stringify({
            API: { BASE_URL: 'http://example.com:1234' }
        }));
        reloadConfig();
        expect(CONFIG.getApiBaseUrl()).toBe('http://example.com:1234');
    });
});
