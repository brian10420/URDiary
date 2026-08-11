// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 刷新令牌的 single-flight（v2.3 認證強化）。
 *
 * 刷新令牌是一次性的：後端每用一次就輪替，同一張令牌送兩次，慢的那一次
 * 必然失敗。而併發刷新在這個 app 是常態 —— main.js 的 initializeAuth()
 * 沒有被 await，後面的 CalendarModule.init() 會立刻再打一次 API，兩條
 * 路徑都會看到「令牌即將過期」而各自去刷新。沒有 single-flight 的話，
 * 使用者只是打開 app 就可能被登出。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

function okResponse(refreshToken) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            access_token: 'access-token-new',
            refresh_token: refreshToken,
            expires_in: 1800
        })
    };
}

/** 讓已排入佇列的 microtask 跑完（第一個呼叫要走到 await fetch） */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('ApiService.refreshToken 的 single-flight', () => {
    beforeEach(async () => {
        localStorage.clear();
        await SecureStore.setAuthRefreshToken('refresh-token-1');
    });

    it('兩個併發呼叫只發出一次網路請求，且共用同一個結果', async () => {
        let resolveFetch;
        const fetchMock = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
        window.fetch = fetchMock;

        const first = ApiService.refreshToken();
        const second = ApiService.refreshToken();

        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveFetch(okResponse('refresh-token-2'));
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(firstResult).toBe(true);
        expect(secondResult).toBe(true);
        // 送出去的是原本那張令牌（沒有第二次拿同一張去換）
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).refresh_token).toBe('refresh-token-1');
        // 輪替回來的新令牌有被保存
        expect(SecureStore.getAuthRefreshToken()).toBe('refresh-token-2');
    });

    it('五個併發呼叫一樣只打一次', async () => {
        let resolveFetch;
        const fetchMock = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
        window.fetch = fetchMock;

        const calls = [1, 2, 3, 4, 5].map(() => ApiService.refreshToken());
        await flush();
        resolveFetch(okResponse('refresh-token-2'));

        const results = await Promise.all(calls);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(results).toEqual([true, true, true, true, true]);
    });

    it('上一次刷新結束後，之後的呼叫會重新發請求（in-flight 旗標有清掉）', async () => {
        const fetchMock = vi.fn(async () => okResponse('refresh-token-2'));
        window.fetch = fetchMock;

        expect(await ApiService.refreshToken()).toBe(true);
        expect(await ApiService.refreshToken()).toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        // 第二次送的是第一次輪替回來的新令牌，不是已經用掉的舊令牌
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).refresh_token).toBe('refresh-token-2');
    });

    it('刷新失敗時旗標也要清掉，不會卡住後續刷新', async () => {
        const failing = vi.fn(async () => { throw new Error('network down'); });
        window.fetch = failing;
        expect(await ApiService.refreshToken()).toBe(false);

        const succeeding = vi.fn(async () => okResponse('refresh-token-2'));
        window.fetch = succeeding;
        expect(await ApiService.refreshToken()).toBe(true);
        expect(succeeding).toHaveBeenCalledTimes(1);
    });
});
