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

    it('401 時儲存的仍是送出去那一張 → 照常清掉（需要重新登入）', async () => {
        await SecureStore.setAuthRefreshToken('refresh-token-A');
        localStorage.setItem('auth_token', 'access-token-A');
        localStorage.setItem('token_expiry', new Date(Date.now() + 60000).toISOString());

        window.fetch = vi.fn(async () => ({ ok: false, status: 401 }));

        expect(await ApiService.refreshToken()).toBe(false);

        expect(SecureStore.getAuthRefreshToken()).toBe('');
        expect(localStorage.getItem('auth_token')).toBeNull();
        expect(localStorage.getItem('token_expiry')).toBeNull();
    });

    it('401 時儲存的已被別的分頁換成新令牌 → 保留贏家的令牌，不清', async () => {
        // single-flight 只擋得住同一個 JS 環境；兩個分頁各有自己的旗標卻
        // 共用同一份儲存。輸的那個若照清不誤，會把贏家剛存好的工作階段
        // 一起弄丟，兩邊一起被踢回登入畫面。
        await SecureStore.setAuthRefreshToken('refresh-token-A');

        // 模擬「另一個分頁在我們的請求還在路上時贏得輪替」：換上新的一對令牌
        window.fetch = vi.fn(async () => {
            await SecureStore.setAuthRefreshToken('refresh-token-B');
            localStorage.setItem('auth_token', 'access-token-B');
            localStorage.setItem('token_expiry', new Date(Date.now() + 60000).toISOString());
            return { ok: false, status: 401 };
        });

        expect(await ApiService.refreshToken()).toBe(false);

        // 贏家的刷新令牌與訪問令牌都必須原封不動
        expect(SecureStore.getAuthRefreshToken()).toBe('refresh-token-B');
        expect(localStorage.getItem('auth_token')).toBe('access-token-B');
        expect(localStorage.getItem('token_expiry')).not.toBeNull();
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

/**
 * fetchAPI 自己的 401 處理——不是上面 doRefreshToken 那次「刷新請求本身」的
 * 401，而是任何一般 API 請求（例如 /diaries/1）用既有 Authorization 標頭
 * 打過去、被伺服器判定令牌無效時觸發的分支。
 *
 * 這裡過去無條件 clearAuthToken()，沒有 doRefreshToken 401 分支那套
 * compare-and-clear 保護。多分頁情境：分頁 B 贏得輪替、存入新令牌對，
 * 分頁 A 用舊 access token 發出的原始請求這時才收到 401，若照清不誤，
 * 會把分頁 B 剛存好的工作階段一起清掉，兩邊一起被踢回登入畫面。
 */
describe('ApiService.fetchAPI 自己的 401 處理（不是 doRefreshToken 那次刷新請求的 401）', () => {
    beforeEach(async () => {
        localStorage.clear();

        // 先用一次成功的刷新，讓 accessToken 有值、tokenExpiry 夠新——避免
        // 下面的 fetchAPI 呼叫在送出原始請求前，自己又多觸發一次主動刷新，
        // 干擾「原始請求本身 401」這個測試情境要驗的東西。
        await SecureStore.setAuthRefreshToken('refresh-token-seed');
        window.fetch = vi.fn(async () => okResponse('refresh-token-current'));
        expect(await ApiService.refreshToken()).toBe(true);
    });

    it('401 時儲存的刷新令牌仍是送出請求當下那一張 → 照常清掉（需要重新登入）', async () => {
        window.fetch = vi.fn(async () => ({
            ok: false,
            status: 401,
            json: async () => ({ detail: 'invalid token' })
        }));

        await expect(ApiService.fetchAPI('/diaries/1', { method: 'GET' })).rejects.toThrow();

        expect(SecureStore.getAuthRefreshToken()).toBe('');
        expect(localStorage.getItem('auth_token')).toBeNull();
        expect(localStorage.getItem('token_expiry')).toBeNull();
    });

    it('401 時儲存的刷新令牌已被別的分頁／視窗換成新令牌 → 保留贏家的令牌，不清', async () => {
        // 模擬「另一個分頁在我們這次原始請求還在路上時贏得輪替」：fetch 被
        // 呼叫的當下，先把 storage 換成贏家的新令牌對，再回這個分頁的 401。
        window.fetch = vi.fn(async () => {
            await SecureStore.setAuthRefreshToken('refresh-token-B');
            localStorage.setItem('auth_token', 'access-token-B');
            localStorage.setItem('token_expiry', new Date(Date.now() + 60000).toISOString());
            return {
                ok: false,
                status: 401,
                json: async () => ({ detail: 'invalid token' })
            };
        });

        await expect(ApiService.fetchAPI('/diaries/1', { method: 'GET' })).rejects.toThrow();

        // 贏家的刷新令牌與訪問令牌都必須原封不動
        expect(SecureStore.getAuthRefreshToken()).toBe('refresh-token-B');
        expect(localStorage.getItem('auth_token')).toBe('access-token-B');
        expect(localStorage.getItem('token_expiry')).not.toBeNull();
    });
});
