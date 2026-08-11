// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 離線容忍（v2.3 task 2.3）：fetchAPI 內建的 GET 重試機制。
 *
 * 核心安全規則貫穿整份檔案：POST/PUT/DELETE 絕不自動重試（有副作用，重試
 * 可能造成後端真的收到兩次請求）。這條規則有三層防線，這裡分別測試：
 *   1. isRetryableFailure() 純函式：method 不是 GET 一律回 false（矩陣測試）
 *   2. fetchAPI 整合測試：POST 在各種失敗情境下，fetch 都只會被呼叫一次
 *   3. computeBackoffDelay()：延遲時間有界，重試不會無限拖長或衝過上限
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

describe('ApiService.computeBackoffDelay（純函式：指數退避 + 上限 + 抖動）', () => {
    it('attempt=0 回傳 baseMs 本身（jitterRatio=0 時確定值）', () => {
        expect(ApiService.computeBackoffDelay(0, 300, { jitterRatio: 0 })).toBe(300);
    });

    it('每多一次 attempt，延遲翻倍（指數成長）', () => {
        expect(ApiService.computeBackoffDelay(1, 300, { jitterRatio: 0 })).toBe(600);
        expect(ApiService.computeBackoffDelay(2, 300, { jitterRatio: 0 })).toBe(1200);
        expect(ApiService.computeBackoffDelay(3, 300, { jitterRatio: 0 })).toBe(2400);
    });

    it('超過上限時夾住在 capMs（不會無限增長）', () => {
        expect(ApiService.computeBackoffDelay(4, 300, { jitterRatio: 0 })).toBe(4000); // 未夾住應為 4800
        expect(ApiService.computeBackoffDelay(10, 300, { jitterRatio: 0 })).toBe(4000);
        expect(ApiService.computeBackoffDelay(100, 300, { jitterRatio: 0 })).toBe(4000);
    });

    it('自訂 capMs 生效', () => {
        expect(ApiService.computeBackoffDelay(5, 1000, { capMs: 2000, jitterRatio: 0 })).toBe(2000);
    });

    it('負數或 NaN 的 attempt 視為 0', () => {
        expect(ApiService.computeBackoffDelay(-1, 300, { jitterRatio: 0 })).toBe(300);
        expect(ApiService.computeBackoffDelay(NaN, 300, { jitterRatio: 0 })).toBe(300);
    });

    it('非正數的 baseMs 退回預設值 300', () => {
        expect(ApiService.computeBackoffDelay(0, 0, { jitterRatio: 0 })).toBe(300);
        expect(ApiService.computeBackoffDelay(0, -50, { jitterRatio: 0 })).toBe(300);
        expect(ApiService.computeBackoffDelay(0, undefined, { jitterRatio: 0 })).toBe(300);
    });

    it('預設參數（含預設抖動 ±20%）結果落在合理範圍內、恆為非負整數', () => {
        for (let i = 0; i < 200; i++) {
            const delay = ApiService.computeBackoffDelay(0);
            expect(Number.isInteger(delay)).toBe(true);
            expect(delay).toBeGreaterThanOrEqual(0);
            // baseMs=300 的 ±20% 抖動：合理範圍是 [240, 360]
            expect(delay).toBeGreaterThanOrEqual(240);
            expect(delay).toBeLessThanOrEqual(360);
        }
    });

    it('抖動即使設超過 100%，結果仍被 [0, capMs] 夾住（不會變負數或衝過上限）', () => {
        for (let i = 0; i < 200; i++) {
            const delay = ApiService.computeBackoffDelay(0, 300, { capMs: 4000, jitterRatio: 5 });
            expect(delay).toBeGreaterThanOrEqual(0);
            expect(delay).toBeLessThanOrEqual(4000);
        }
    });

    it('jitterRatio=0 時，同樣輸入永遠得到同樣輸出（無隨機性洩漏）', () => {
        const a = ApiService.computeBackoffDelay(2, 500, { jitterRatio: 0 });
        const b = ApiService.computeBackoffDelay(2, 500, { jitterRatio: 0 });
        expect(a).toBe(b);
    });
});

describe('ApiService.parseRetryAfterMs（純函式：解析 Retry-After 標頭）', () => {
    it('秒數字串轉毫秒', () => {
        expect(ApiService.parseRetryAfterMs('120')).toBe(120000);
        expect(ApiService.parseRetryAfterMs('0')).toBe(0);
        expect(ApiService.parseRetryAfterMs('1')).toBe(1000);
    });

    it('null/undefined/空字串回傳 null', () => {
        expect(ApiService.parseRetryAfterMs(null)).toBeNull();
        expect(ApiService.parseRetryAfterMs(undefined)).toBeNull();
        expect(ApiService.parseRetryAfterMs('')).toBeNull();
    });

    it('負數回傳 null（不支援負的等待時間）', () => {
        expect(ApiService.parseRetryAfterMs('-5')).toBeNull();
    });

    it('HTTP-date 格式（非數字字串）回傳 null，不強行猜測', () => {
        expect(ApiService.parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    });
});

describe('ApiService.resolveRetryDelayMs（純函式：這次重試實際要等待多久）', () => {
    // code review fix：先前 retryAfterMs 只當「該不該重試」的門檻，算出來
    // 之後被丟掉，實際 sleep() 永遠是固定的指數退避——等於完全沒尊重伺服器
    // 明確講的 Retry-After。這裡驗證 resolveRetryDelayMs 真的把它接進計算，
    // 同時驗證有上限（不會讓一個誇張的標頭卡住整個流程）。
    it('非 429：一律回傳 backoffDelayMs，不管 retryAfterMs 是什麼（就算是有效數字）', () => {
        expect(ApiService.resolveRetryDelayMs({ status: 500, retryAfterMs: 5000, backoffDelayMs: 300 })).toBe(300);
        expect(ApiService.resolveRetryDelayMs({ status: 503, retryAfterMs: null, backoffDelayMs: 600 })).toBe(600);
        expect(ApiService.resolveRetryDelayMs({ status: null, retryAfterMs: 5000, backoffDelayMs: 300 })).toBe(300);
    });

    it('429 但沒有 retryAfterMs（null，例如標頭缺席）：回傳 backoffDelayMs', () => {
        expect(ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: null, backoffDelayMs: 300 })).toBe(300);
    });

    it('429 且 retryAfterMs 大於 backoffDelayMs、在上限內：尊重 retryAfterMs（這是本次修復的核心行為）', () => {
        expect(ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: 1000, backoffDelayMs: 300 })).toBe(1000);
        expect(ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: 2000, backoffDelayMs: 600 })).toBe(2000);
    });

    it('429 且 retryAfterMs 小於 backoffDelayMs：取兩者較大值，不會比一般退避還快重試', () => {
        expect(ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: 100, backoffDelayMs: 600 })).toBe(600);
    });

    it('429 且 retryAfterMs 為 0（伺服器說可以立刻重試）：回傳 backoffDelayMs 作為安全下限', () => {
        expect(ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: 0, backoffDelayMs: 300 })).toBe(300);
    });

    it('429 且 retryAfterMs 超過 RETRY_AFTER_CAP_MS：夾在上限，不會讓一個誇張/惡意的標頭卡住整個流程', () => {
        const result = ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: 3600000, backoffDelayMs: 300 });
        expect(result).toBe(ApiService.RETRY_AFTER_CAP_MS);
        expect(result).toBeLessThan(3600000);
    });

    it('恆為非負整數', () => {
        const result = ApiService.resolveRetryDelayMs({ status: 429, retryAfterMs: 1500, backoffDelayMs: 300 });
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
    });

    it('未提供任何參數時不拋錯，安全預設為 0', () => {
        expect(() => ApiService.resolveRetryDelayMs()).not.toThrow();
        expect(ApiService.resolveRetryDelayMs()).toBe(0);
    });
});

describe('ApiService.isRetryableFailure（純函式：method/status 重試矩陣）', () => {
    // ---- 最重要的規則：非 GET 一律不重試，不論失敗原因 ----
    it.each([
        ['POST', { isNetworkFailure: true }],
        ['POST', { status: 500 }],
        ['POST', { status: 503 }],
        ['POST', { status: 429, retryAfterMs: 1000 }],
        ['PUT', { isNetworkFailure: true }],
        ['PUT', { status: 500 }],
        ['DELETE', { isNetworkFailure: true }],
        ['DELETE', { status: 503 }],
        ['PATCH', { status: 500 }],
    ])('%s + %o → 絕不重試', (method, extra) => {
        expect(ApiService.isRetryableFailure({ method, ...extra })).toBe(false);
    });

    // ---- GET：可重試的情境 ----
    it('GET + 網路層失敗（連不上/逾時/離線）→ 重試', () => {
        expect(ApiService.isRetryableFailure({ method: 'GET', isNetworkFailure: true })).toBe(true);
    });

    it.each([500, 502, 503, 504, 599])('GET + HTTP %i（5xx）→ 重試', (status) => {
        expect(ApiService.isRetryableFailure({ method: 'GET', status })).toBe(true);
    });

    it('GET + 429 帶有效 Retry-After → 重試', () => {
        expect(ApiService.isRetryableFailure({ method: 'GET', status: 429, retryAfterMs: 1000 })).toBe(true);
        expect(ApiService.isRetryableFailure({ method: 'GET', status: 429, retryAfterMs: 0 })).toBe(true);
    });

    // ---- GET：不可重試的情境 ----
    it('GET + 429 沒有 Retry-After → 不重試（不知道要等多久）', () => {
        expect(ApiService.isRetryableFailure({ method: 'GET', status: 429, retryAfterMs: null })).toBe(false);
        expect(ApiService.isRetryableFailure({ method: 'GET', status: 429 })).toBe(false);
    });

    it.each([400, 401, 403, 404, 409, 422])('GET + HTTP %i（其餘 4xx）→ 不重試', (status) => {
        expect(ApiService.isRetryableFailure({ method: 'GET', status })).toBe(false);
    });

    it('GET + 2xx/3xx（沒有失敗）→ 不重試', () => {
        expect(ApiService.isRetryableFailure({ method: 'GET', status: 200 })).toBe(false);
        expect(ApiService.isRetryableFailure({ method: 'GET', status: 304 })).toBe(false);
    });

    it('method 大小寫不敏感（"get" 視同 "GET"）', () => {
        expect(ApiService.isRetryableFailure({ method: 'get', isNetworkFailure: true })).toBe(true);
        expect(ApiService.isRetryableFailure({ method: 'post', status: 500 })).toBe(false);
    });

    it('未提供 method 時預設為 GET', () => {
        expect(ApiService.isRetryableFailure({ isNetworkFailure: true })).toBe(true);
    });

    it('status 為非數字（字串/undefined）時不重試', () => {
        expect(ApiService.isRetryableFailure({ method: 'GET', status: '500' })).toBe(false);
        expect(ApiService.isRetryableFailure({ method: 'GET' })).toBe(false);
    });

    it('未提供任何參數時安全預設為不重試', () => {
        expect(ApiService.isRetryableFailure()).toBe(false);
        expect(ApiService.isRetryableFailure({})).toBe(false);
    });
});

describe('ApiService.getConfiguredMaxRetries（讀 CONFIG.API 算出有效重試次數）', () => {
    let originalMaxRetries;
    let originalAutoRetry;

    beforeEach(() => {
        originalMaxRetries = CONFIG.API.MAX_RETRIES;
        originalAutoRetry = CONFIG.API.AUTO_RETRY;
    });

    afterEach(() => {
        CONFIG.API.MAX_RETRIES = originalMaxRetries;
        CONFIG.API.AUTO_RETRY = originalAutoRetry;
    });

    it('預設值（config.js 的 MAX_RETRIES=2）', () => {
        expect(ApiService.getConfiguredMaxRetries()).toBe(2);
    });

    it('AUTO_RETRY 明確設為 false → 0（整個停用）', () => {
        CONFIG.API.AUTO_RETRY = false;
        expect(ApiService.getConfiguredMaxRetries()).toBe(0);
    });

    it('MAX_RETRIES 為合法非負整數時直接採用', () => {
        CONFIG.API.MAX_RETRIES = 5;
        expect(ApiService.getConfiguredMaxRetries()).toBe(5);
        CONFIG.API.MAX_RETRIES = 0;
        expect(ApiService.getConfiguredMaxRetries()).toBe(0);
    });

    it('MAX_RETRIES 為負數/非數字時退回預設值 2', () => {
        CONFIG.API.MAX_RETRIES = -1;
        expect(ApiService.getConfiguredMaxRetries()).toBe(2);
        CONFIG.API.MAX_RETRIES = 'nope';
        expect(ApiService.getConfiguredMaxRetries()).toBe(2);
        CONFIG.API.MAX_RETRIES = undefined;
        expect(ApiService.getConfiguredMaxRetries()).toBe(2);
    });
});

// ------------------------------------------------------------------------
// fetchAPI 整合測試：驗證上面的純函式真的被接進重試迴圈，且順序/次數正確。
// 用 vi.useFakeTimers() 讓退避延遲不必真的等待，advanceTimersByTimeAsync()
// 推進「虛擬時間」讓 await sleep(...) resolve。
// ------------------------------------------------------------------------
describe('ApiService.fetchAPI 整合：GET 重試迴圈', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
        return {
            ok, status,
            json: async () => body,
            text: async () => JSON.stringify(body),
            headers: { get: (name) => (Object.prototype.hasOwnProperty.call(headers, name) ? headers[name] : null) }
        };
    }

    /** 推進到所有排定的計時器都跑完（重試迴圈用得到的退避延遲遠小於這個值）。 */
    async function flushAllRetries() {
        await vi.advanceTimersByTimeAsync(60000);
    }

    it('第一次網路層失敗（fetch reject），第二次成功 → 重試後拿到資料，fetch 只被呼叫 2 次', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse({ ok: true, value: 42 }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });
        await flushAllRetries();
        const result = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true, value: 42 });
    });

    it('重試前真的有等待（不是立即重打）：時間推進不足時，第二次呼叫還沒發生', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });

        // 讓第一次嘗試的 microtask 跑完，但幾乎不推進時間
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(1); // 還在退避等待中，還沒重試

        await flushAllRetries();
        await promise;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('持續 503：重試 CONFIG.API.MAX_RETRIES 次後仍失敗，最終拋出錯誤；fetch 總共被呼叫 1+MAX_RETRIES 次', async () => {
        const maxRetries = CONFIG.API.MAX_RETRIES;
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'server down' }, { ok: false, status: 503 }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });
        // 先掛上失敗處理，避免 unhandledRejection 在 flush 期間被回報
        const settled = promise.catch(error => error);
        await flushAllRetries();
        const error = await settled;

        expect(fetchMock).toHaveBeenCalledTimes(1 + maxRetries);
        expect(error).toBeInstanceOf(Error);
    });

    it('404 不重試：fetch 只被呼叫 1 次，立即拋出', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'not found' }, { ok: false, status: 404 }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });
        const settled = promise.catch(error => error);
        await flushAllRetries();
        await settled;

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('429 帶 Retry-After：等待時間確實反映伺服器要求的秒數，不是套用一般的指數退避', async () => {
        // Retry-After: 2 → 2000ms，遠大於 attempt=0 的一般退避（基準 300ms，
        // 抖動最多 ±20% 也不會超過 360ms）。用這個量級差距證明 fetchAPI
        // 真的把 Retry-After 的值接進了 sleep()，而不是算完就丟掉。
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 429, headers: { 'Retry-After': '2' } }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });

        // 推進到遠超過一般退避、但還沒到 2000ms——若程式碼仍在用一般退避，
        // 這裡就已經重試過了；斷言還沒重試，證明等待的是 Retry-After。
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1500); // 累積推進到 2500ms，過了 2000ms
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const result = await promise;
        expect(result).toEqual({ ok: true });
    });

    it('429 帶超大 Retry-After：等待時間被夾在 RETRY_AFTER_CAP_MS，不會讓一次請求卡住到伺服器要求的那麼久', async () => {
        // Retry-After: 3600（一小時）——不應該讓 fetchAPI 這個前景操作真的
        // 卡住一小時；ApiService.RETRY_AFTER_CAP_MS 是實際會等待的上限。
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 429, headers: { 'Retry-After': '3600' } }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });

        await vi.advanceTimersByTimeAsync(ApiService.RETRY_AFTER_CAP_MS - 200);
        expect(fetchMock).toHaveBeenCalledTimes(1); // 上限前還沒重試

        await vi.advanceTimersByTimeAsync(500); // 越過上限（離 3600 秒還遠得很）
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const result = await promise;
        expect(result).toEqual({ ok: true });
    });

    it('429 沒有 Retry-After → 不重試，fetch 只被呼叫 1 次', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 429 }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });
        const settled = promise.catch(error => error);
        await flushAllRetries();
        await settled;

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('navigator.onLine 在重試前變成 false → 停止重試，不再浪費嘗試次數', async () => {
        const originalOnLine = navigator.onLine;
        const fetchMock = vi.fn().mockImplementation(() => {
            // 第一次呼叫時就模擬「這次呼叫之後裝置離線了」
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
            return Promise.reject(new TypeError('Failed to fetch'));
        });
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });
        const settled = promise.catch(error => error);
        await flushAllRetries();
        await settled;

        expect(fetchMock).toHaveBeenCalledTimes(1); // 沒有因為離線而繼續重試

        Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
    });

    // ---- 絕不重試非冪等方法：這是最重要的安全保證 ----
    it.each(['POST', 'PUT', 'DELETE'])('%s + 持續 503 → 絕不重試，fetch 只被呼叫 1 次', async (method) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'server down' }, { ok: false, status: 503 }));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/chat/enhanced/', { method, body: { message: 'hi' } });
        const settled = promise.catch(error => error);
        await flushAllRetries();
        await settled;

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('POST + 網路層失敗 → 絕不重試，fetch 只被呼叫 1 次', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/chat/enhanced/', { method: 'POST', body: { message: 'hi' } });
        const settled = promise.catch(error => error);
        await flushAllRetries();
        await settled;

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('重試耗盡的網路層失敗，GET /diaries/* 仍會照既有規則回退到本機快取', async () => {
        // getLocalData 的鍵是 `urDiary_` + endpoint 裡每個 '/' 都換成 '_'——
        // endpoint 開頭本身就有一個 '/'，所以是雙底線：urDiary_ + _diaries_1
        localStorage.setItem('urDiary__diaries_1', JSON.stringify({ diaries: [{ diary_id: 'x' }] }));
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        window.fetch = fetchMock;

        const promise = ApiService.fetchAPI('/diaries/1', { method: 'GET' });
        await flushAllRetries();
        const result = await promise;

        const maxRetries = CONFIG.API.MAX_RETRIES;
        expect(fetchMock).toHaveBeenCalledTimes(1 + maxRetries); // 重試全部用完才回退
        expect(result._fromCache).toBe(true);
        expect(result.diaries).toEqual([{ diary_id: 'x' }]);
    });

    it('回報連線狀態：最終成功時回報 true', async () => {
        const reportSpy = vi.fn();
        window.UIManager = { reportNetworkStatus: reportSpy };
        window.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));

        await ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' });

        expect(reportSpy).toHaveBeenCalledWith(true);
    });

    it('回報連線狀態：網路層失敗（重試耗盡後）回報 false；4xx 應用層錯誤不回報', async () => {
        const reportSpy = vi.fn();
        window.UIManager = { reportNetworkStatus: reportSpy };

        window.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const p1 = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' }).catch(e => e);
        await flushAllRetries();
        await p1;
        expect(reportSpy).toHaveBeenCalledWith(false);

        reportSpy.mockClear();
        window.fetch = vi.fn().mockResolvedValue(jsonResponse({ detail: 'nope' }, { ok: false, status: 404 }));
        const p2 = ApiService.fetchAPI('/calendar/events?start=2026-01-01&end=2026-01-02', { method: 'GET' }).catch(e => e);
        await flushAllRetries();
        await p2;
        expect(reportSpy).not.toHaveBeenCalled();
    });
});
