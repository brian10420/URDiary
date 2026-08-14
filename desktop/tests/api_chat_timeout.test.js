// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * fetchAPI 逾時分級（2026-08 驗收發現）：一般請求 30 秒逾時沒問題，但
 * LLM 生成類請求（聊天回覆）後端要等供應商生成，grok-4.6 等較大模型常
 * 超過 30 秒——30 秒就 abort 會把已在路上的回覆白白丟掉，使用者看到
 * 「傳送失敗」按重試還會重送一次。既有程式已為 /chat/end/ 與
 * /diary/enhanced-generate 放寬到 180 秒，這裡驗證 /chat/enhanced/（一般
 * 聊天送出）也納入同一長逾時名單，且其他端點維持 30 秒不變。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

describe('fetchAPI 逾時分級：LLM 生成類請求放寬', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** 永不 resolve 的 fetch mock：捕捉 signal，abort 時比照真實 fetch 以 AbortError reject。 */
    function pendingFetchCapturingSignal(capture) {
        return vi.fn((url, options) => new Promise((resolve, reject) => {
            capture.signal = options.signal;
            options.signal.addEventListener('abort', () => {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
            });
        }));
    }

    it('/chat/enhanced/ 在 30 秒時還不斷線，撐到 180 秒才逾時', async () => {
        const cap = {};
        window.fetch = pendingFetchCapturingSignal(cap);

        const promise = ApiService.fetchAPI('/chat/enhanced/', { method: 'POST', body: { message: 'hi' } });
        promise.catch(() => {}); // 逾時後必然 reject，先掛住避免 unhandled rejection

        await vi.advanceTimersByTimeAsync(30001);
        expect(cap.signal.aborted).toBe(false); // 舊行為（30 秒斷線）會在這裡失敗

        await vi.advanceTimersByTimeAsync(150000); // 累計 180 秒
        expect(cap.signal.aborted).toBe(true);
        await expect(promise).rejects.toBeTruthy();
    });

    it('一般請求（PUT /users/me/companion）維持 30 秒逾時不變', async () => {
        const cap = {};
        window.fetch = pendingFetchCapturingSignal(cap);

        const promise = ApiService.fetchAPI('/users/me/companion', { method: 'PUT', body: {} });
        promise.catch(() => {});

        await vi.advanceTimersByTimeAsync(30001);
        expect(cap.signal.aborted).toBe(true);
        await expect(promise).rejects.toBeTruthy();
    });
});
