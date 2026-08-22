// @vitest-environment jsdom
/** 刷新令牌 401（session 真死）必須帶使用者回登入畫面 (v2.5 驗收回饋)。
 *
 * 實際事故：另一實例輪替了共用的 refresh token，本視窗 refresh 收到 401 後
 * 只清 token 沒發 urdiary:auth-expired；後續請求因 accessToken 已空、走不進
 * fetchAPI 的強制登出分支——使用者面對的是一個默默 401 的空殼 UI（行事曆
 * 被清空看起來像資料不見了）。這裡鎖住：refresh 401 且令牌確為本頁那張時，
 * 除了清 token 還要發 urdiary:auth-expired；若儲存的令牌已被他頁換新，維持
 * 安靜退場（不發事件、不清贏家的令牌）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

describe('doRefreshToken 401 → 強制登出通知', () => {
    let events;
    let listener;

    beforeEach(async () => {
        localStorage.clear();
        events = [];
        listener = (e) => events.push(e.detail || {});
        window.addEventListener('urdiary:auth-expired', listener);
        await SecureStore.setAuthRefreshToken('dead-token');
    });

    afterEach(() => {
        window.removeEventListener('urdiary:auth-expired', listener);
        vi.restoreAllMocks();
    });

    it('令牌真死（儲存的仍是送出的那張）：清 token＋發 urdiary:auth-expired', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));

        const ok = await ApiService.refreshToken();

        expect(ok).toBe(false);
        expect(events.length).toBe(1);
        expect(SecureStore.getAuthRefreshToken()).toBeFalsy();
    });

    it('他頁已贏得輪替（儲存的令牌變了）：安靜退場，不發事件、不清令牌', async () => {
        global.fetch = vi.fn(async () => {
            // 模擬另一個視窗在本請求在途時完成輪替並存入新令牌
            await SecureStore.setAuthRefreshToken('winner-token');
            return { ok: false, status: 401 };
        });

        const ok = await ApiService.refreshToken();

        expect(ok).toBe(false);
        expect(events.length).toBe(0);
        expect(SecureStore.getAuthRefreshToken()).toBe('winner-token');
    });

    it('非 401 的刷新失敗（如 500）：不發事件、不清令牌', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 500 }));

        const ok = await ApiService.refreshToken();

        expect(ok).toBe(false);
        expect(events.length).toBe(0);
        expect(SecureStore.getAuthRefreshToken()).toBe('dead-token');
    });
});
