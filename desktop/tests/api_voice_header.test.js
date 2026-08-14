// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * fetchRaw 附加 X-Voice-Api-Key 標頭（v2.4 fix wave item 2 回歸測試）。
 *
 * fetchAPI 原本就有這段邏輯（附桌面使用者的 xAI 金鑰給 /voice/ 端點），
 * 但 fetchRaw（唯一呼叫 /voice/tts 的路徑，見 voice_module.js 的 speak()）
 * 漏了同一段——桌面版金鑰只存在 Electron secure store、從未送到後端，
 * 導致這些使用者的 TTS 一律 400。
 *
 * 這裡載入真正的 api_service.js + secure_store.js（不是把 ApiService 整個
 * 換成假物件），只替換 SecureStore.isAvailable/getKey 兩個純函式來模擬
 * 「桌面 + 已存 Grok 金鑰」的狀態——jsdom 沒有 window.require，
 * SecureStore.isAvailable() 原生一定回 false（見 secure_store.js 的
 * ipcRenderer 特徵檢查），這是唯一能在這個環境下踩到 hasSecureStore 分支
 * 的方法，其餘一律走真正的 fetchRaw 程式碼路徑（含 Authorization、
 * timeout、401 處理等既有邏輯不變）。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

let originalIsAvailable;
let originalGetKey;

beforeEach(() => {
    localStorage.clear();
    originalIsAvailable = SecureStore.isAvailable;
    originalGetKey = SecureStore.getKey;
});

afterEach(() => {
    SecureStore.isAvailable = originalIsAvailable;
    SecureStore.getKey = originalGetKey;
});

/** 模擬「桌面（Electron secure store 可用）+ 已存 Grok 金鑰」。 */
function simulateDesktopWithGrokKey(key) {
    SecureStore.isAvailable = () => true;
    SecureStore.getKey = (provider) => (provider === 'grok' ? key : '');
}

/** 假 fetch：一律回一個能被 fetchRaw 的 response.blob() 消化的成功回應。 */
function installFetch() {
    const calls = [];
    window.fetch = vi.fn(async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return {
            ok: true, status: 200,
            blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
        };
    });
    return calls;
}

async function callVoiceTts() {
    return ApiService.fetchRaw('/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
    });
}

describe('fetchRaw 附帶 X-Voice-Api-Key（/voice/ 端點 + 桌面 secure store）', () => {
    it('secure store 可用且已存 Grok 金鑰時，/voice/tts 請求帶上 X-Voice-Api-Key', async () => {
        simulateDesktopWithGrokKey('xai-desktop-secret');
        const calls = installFetch();

        await callVoiceTts();

        expect(calls.length).toBe(1);
        expect(calls[0].options.headers['X-Voice-Api-Key']).toBe('xai-desktop-secret');
    });

    it('沒有 secure store（手機瀏覽器/PWA）時不帶標頭，交由後端 DB 憑證/env 後備', async () => {
        // 預設狀態：isAvailable() 就是 false（jsdom 沒有 window.require），
        // 不需要另外模擬——這正是本測試要驗的「原生非 Electron」情境。
        const calls = installFetch();

        await callVoiceTts();

        expect(calls.length).toBe(1);
        expect(calls[0].options.headers['X-Voice-Api-Key']).toBeUndefined();
    });

    it('secure store 可用但沒存 Grok 金鑰時不帶標頭', async () => {
        simulateDesktopWithGrokKey(''); // getKey('grok') 回傳空字串
        const calls = installFetch();

        await callVoiceTts();

        expect(calls[0].options.headers['X-Voice-Api-Key']).toBeUndefined();
    });

    it('非 /voice/ 端點即使有 secure store + Grok 金鑰也不帶標頭', async () => {
        simulateDesktopWithGrokKey('xai-desktop-secret');
        const calls = installFetch();

        await ApiService.fetchRaw('/other/endpoint', { method: 'GET' });

        expect(calls[0].options.headers['X-Voice-Api-Key']).toBeUndefined();
    });
});
