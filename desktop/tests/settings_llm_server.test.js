// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 手機瀏覽器的 LLM 金鑰路徑（v2.3 task 1.6）。
 *
 * jsdom 沒有 window.require → 沒有 Electron safeStorage，走的正是手機/PWA
 * 那條路：金鑰改為存在伺服器（加密），設定面板顯示遮罩狀態、用
 * PUT/DELETE /users/me/llm 管理，而且**絕不把金鑰寫進 localStorage**
 * ——localStorage 是同源的任何腳本都讀得到的明文儲存區。
 *
 * Electron 那條路徑（safeStorage + X-LLM-* 標頭）在這個環境測不到，
 * 因此本檔案的每個斷言都只針對「非 Electron」分支；桌面版行為不變由
 * 「這些分支都被 SecureStore.isAvailable() 閘住」這個結構保證。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
    loadScript('js/settings_module.js');
});

const SETTINGS_DIALOG_HTML = `
    <button id="settings-btn"></button>
    <div id="settings-dialog" style="display: none;">
        <button id="close-settings-btn"></button>
        <select id="settings-language"></select>
        <select id="settings-provider"></select>
        <input id="settings-model">
        <datalist id="settings-model-suggestions"></datalist>
        <input id="settings-api-key" type="password">
        <small id="settings-key-status"></small>
        <button id="settings-clear-key"></button>
        <small id="settings-key-note"></small>
        <div id="settings-base-url-row"><input id="settings-base-url"></div>
        <input id="settings-semantic-memory" type="checkbox">
        <small id="settings-semantic-status"></small>
        <div id="settings-error"></div>
        <button id="settings-save"></button>
        <div id="settings-sessions-list"></div>
        <button id="settings-logout"></button>
    </div>
`;

const STORED_STATUS = {
    configured: true,
    source: 'user',
    provider: 'openai',
    model: 'gpt-test',
    base_url: null,
    key_masked: '****1234',
    user_credential: {
        provider: 'openai', model: 'gpt-test', base_url: null,
        key_masked: '****1234', updated_at: '2026-08-12T00:00:00'
    }
};

const SERVER_DEFAULT_STATUS = {
    configured: true,
    source: 'server',
    provider: 'grok',
    model: 'grok-4.3',
    base_url: null,
    key_masked: '****9999',
    user_credential: null
};

const EMPTY_STATUS = {
    configured: false, source: null, provider: null, model: null,
    base_url: null, key_masked: '', user_credential: null
};

/** 依 method + 路徑片段回應的假 fetch；記錄每一次呼叫供斷言。 */
function installFetch(handlers) {
    const calls = [];
    window.fetch = vi.fn(async (url, options = {}) => {
        const method = (options.method || 'GET').toUpperCase();
        calls.push({ url: String(url), method, options });

        for (const [pattern, body] of handlers) {
            const [wantMethod, fragment] = pattern.split(' ');
            if (method === wantMethod && String(url).includes(fragment)) {
                return {
                    ok: true, status: 200,
                    json: async () => (typeof body === 'function' ? body(options) : body)
                };
            }
        }
        return { ok: true, status: 200, json: async () => ({}) };
    });
    return calls;
}

/** 等待 openDialog/save 裡的非同步流程跑完 */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function llmCalls(calls) {
    return calls.filter(call => call.url.includes('/users/me/llm'));
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = SETTINGS_DIALOG_HTML;
});

describe('SecureStore.isAvailable()', () => {
    it('瀏覽器環境回 false（沒有 Electron 安全儲存）', () => {
        expect(SecureStore.isAvailable()).toBe(false);
    });
});

describe('瀏覽器不送 X-LLM-* 標頭', () => {
    it('連 local 供應商也不送——金鑰與端點都由伺服器那份設定決定', async () => {
        // 這組 localStorage 偏好在 Electron 下會讓 fetchAPI 附上 X-LLM-Provider: local
        localStorage.setItem('urDiary_active_provider', 'local');
        localStorage.setItem('urDiary_local_base_url', 'http://localhost:11434/v1');

        const calls = installFetch([['POST /chat/enhanced/', { response: 'ok' }]]);
        await ApiService.fetchAPI('/chat/enhanced/', { method: 'POST', body: { message: 'hi' } });

        const headers = calls[0].options.headers;
        Object.keys(headers).forEach(name => {
            expect(name.toLowerCase().startsWith('x-llm-'), `不該出現 ${name}`).toBe(false);
        });
    });
});

describe('ApiService 的 /users/me/llm 包裝', () => {
    it('讀取用 GET', async () => {
        const calls = installFetch([['GET /users/me/llm', STORED_STATUS]]);
        const status = await ApiService.getLlmCredential();

        expect(llmCalls(calls)[0].method).toBe('GET');
        expect(status.key_masked).toBe('****1234');
    });

    it('儲存用 PUT，body 是 provider/api_key/base_url/model', async () => {
        const calls = installFetch([['PUT /users/me/llm', STORED_STATUS]]);
        await ApiService.saveLlmCredential({
            provider: 'openai', api_key: 'sk-browser-key-1234', model: 'gpt-test'
        });

        const call = llmCalls(calls)[0];
        expect(call.method).toBe('PUT');
        expect(JSON.parse(call.options.body)).toEqual({
            provider: 'openai', api_key: 'sk-browser-key-1234', model: 'gpt-test'
        });
    });

    it('刪除用 DELETE', async () => {
        const calls = installFetch([['DELETE /users/me/llm', EMPTY_STATUS]]);
        await ApiService.deleteLlmCredential();

        expect(llmCalls(calls)[0].method).toBe('DELETE');
    });
});

describe('設定面板（瀏覽器模式）', () => {
    it('開啟面板時查詢伺服器狀態，顯示遮罩後的金鑰', async () => {
        installFetch([['GET /users/me/llm', STORED_STATUS]]);
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        const status = document.getElementById('settings-key-status').textContent;
        expect(status).toContain('****1234');
        expect(status).not.toContain('sk-');
    });

    it('用伺服器預設金鑰時如實說明「這不是你自己的金鑰」', async () => {
        installFetch([['GET /users/me/llm', SERVER_DEFAULT_STATUS]]);
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        const status = document.getElementById('settings-key-status').textContent;
        expect(status.length).toBeGreaterThan(0);
        expect(status).not.toContain('****1234');
        expect(status).toContain('grok');
    });

    it('金鑰說明文字換成「存在伺服器」的版本，不再說系統金鑰鏈', async () => {
        installFetch([['GET /users/me/llm', EMPTY_STATUS]]);
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        const note = document.getElementById('settings-key-note').textContent;
        expect(note).not.toContain('safeStorage');
        expect(note.length).toBeGreaterThan(0);
    });

    it('儲存金鑰：PUT 到伺服器，且不留在 localStorage 或輸入框', async () => {
        const calls = installFetch([
            ['GET /users/me/llm', EMPTY_STATUS],
            ['PUT /users/me/llm', STORED_STATUS],
        ]);
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        document.getElementById('settings-provider').value = 'openai';
        document.getElementById('settings-api-key').value = 'sk-browser-key-5678';
        document.getElementById('settings-save').click();
        await flush();

        const put = llmCalls(calls).find(call => call.method === 'PUT');
        expect(put, '沒有送出 PUT /users/me/llm').toBeTruthy();
        expect(JSON.parse(put.options.body).api_key).toBe('sk-browser-key-5678');

        // 金鑰絕不可以落在 localStorage（同源任何腳本都讀得到）
        const dump = JSON.stringify(localStorage);
        expect(dump).not.toContain('sk-browser-key-5678');
        expect(document.getElementById('settings-api-key').value).toBe('');
    });

    it('刪除金鑰：DELETE 到伺服器', async () => {
        const calls = installFetch([
            ['GET /users/me/llm', STORED_STATUS],
            ['DELETE /users/me/llm', EMPTY_STATUS],
        ]);
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        document.getElementById('settings-clear-key').click();
        await flush();

        expect(llmCalls(calls).some(call => call.method === 'DELETE')).toBe(true);
    });

    it('沒填金鑰又改了供應商時，明說「要重新輸入金鑰」而不是假裝存好了', async () => {
        const calls = installFetch([
            ['GET /users/me/llm', STORED_STATUS],
            ['PUT /users/me/llm', STORED_STATUS],
        ]);
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        document.getElementById('settings-provider').value = 'claude';
        document.getElementById('settings-api-key').value = '';
        document.getElementById('settings-save').click();
        await flush();

        expect(llmCalls(calls).some(call => call.method === 'PUT')).toBe(false);
        const error = document.getElementById('settings-error');
        expect(error.textContent.length).toBeGreaterThan(0);
        expect(error.style.display).not.toBe('none');
    });

    it('查詢狀態失敗時如實顯示，不會整個面板掛掉', async () => {
        window.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        SettingsModule.init();
        SettingsModule.openDialog();
        await flush();

        expect(document.getElementById('settings-dialog').style.display).toBe('block');
        expect(document.getElementById('settings-key-status').textContent.length).toBeGreaterThan(0);
    });
});
