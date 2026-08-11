// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * SecureStore 的刷新令牌保管（v2.3 認證強化）。
 *
 * 這裡跑在 jsdom：沒有 window.require、沒有 Electron safeStorage，走的正是
 * 手機瀏覽器 / PWA 那條 localStorage 後備路徑 —— 也是最容易寫壞而沒人發現
 * 的一條（令牌沒存成功的話，使用者每 30 分鐘就會被踢回登入畫面）。
 */
beforeAll(() => {
    loadScript('js/secure_store.js');
});

beforeEach(async () => {
    localStorage.clear();
    await SecureStore.clearAuthRefreshToken();
});

describe('SecureStore 刷新令牌（非 Electron 後備）', () => {
    it('存進去就讀得回來', async () => {
        await SecureStore.setAuthRefreshToken('refresh-token-abc');
        expect(SecureStore.getAuthRefreshToken()).toBe('refresh-token-abc');
    });

    it('沒有安全儲存時落在 localStorage（而不是靜默丟掉）', async () => {
        await SecureStore.setAuthRefreshToken('refresh-token-abc');
        expect(localStorage.getItem('auth_refresh_token')).toBe('refresh-token-abc');
    });

    it('清除後讀到空字串，localStorage 也不留殘渣', async () => {
        await SecureStore.setAuthRefreshToken('refresh-token-abc');
        await SecureStore.clearAuthRefreshToken();

        expect(SecureStore.getAuthRefreshToken()).toBe('');
        expect(localStorage.getItem('auth_refresh_token')).toBeNull();
    });

    it('未曾存過時回空字串，不是 null/undefined', () => {
        expect(SecureStore.getAuthRefreshToken()).toBe('');
    });

    it('不會被誤認成某個供應商的 API Key', async () => {
        // 保留鍵與 CONFIG.PROVIDERS 的 id 共用同一個加密檔，撞名的話
        // fetchAPI 會把刷新令牌當成 X-LLM-Api-Key 送給 LLM 供應商
        await SecureStore.setAuthRefreshToken('refresh-token-abc');

        ['grok', 'claude', 'openai', 'gemini', 'local'].forEach(provider => {
            expect(SecureStore.hasKey(provider)).toBe(false);
            expect(SecureStore.getKey(provider)).toBe('');
        });
    });
});
