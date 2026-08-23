// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * onboarding 三 wrapper (v2.5 Spec B Task 7)：路徑/方法/body 正確，且
 * /users/onboarding/complete 屬 LLM 端點（桌面 secure store 有金鑰時附
 * X-LLM-* 標頭，讓後端 complete 時能跑收納 pass）——比照
 * api_voice_header.test.js 的「載真 api_service、只換 SecureStore 純函式」手法。
 */
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

let originalIsAvailable, originalGetKey;

beforeEach(() => {
    localStorage.clear();
    originalIsAvailable = SecureStore.isAvailable;
    originalGetKey = SecureStore.getKey;
});

afterEach(() => {
    SecureStore.isAvailable = originalIsAvailable;
    SecureStore.getKey = originalGetKey;
    delete window.SettingsModule;
});

function installFetch() {
    const calls = [];
    window.fetch = vi.fn(async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return { ok: true, status: 200, json: async () => ({}),
                 headers: { get: () => 'application/json' } };
    });
    return calls;
}

describe('ApiService onboarding wrappers', () => {
    it('getOnboardingState 走 GET /users/onboarding/state', async () => {
        const calls = installFetch();
        await ApiService.getOnboardingState();
        expect(calls.length).toBe(1);
        expect(calls[0].url).toContain('/users/onboarding/state');
        expect(calls[0].options.method).toBe('GET');
    });

    it('saveOnboardingAnswer 送出 question_key/answer_text（空字串跳過也照送）', async () => {
        const calls = installFetch();
        await ApiService.saveOnboardingAnswer('favorite_food', '牛肉湯');
        await ApiService.saveOnboardingAnswer('location', '');
        expect(JSON.parse(calls[0].options.body)).toEqual(
            { question_key: 'favorite_food', answer_text: '牛肉湯' });
        expect(JSON.parse(calls[1].options.body)).toEqual(
            { question_key: 'location', answer_text: '' });
        expect(calls[0].options.method).toBe('POST');
    });

    it('completeOnboarding 是 LLM 端點：桌面有金鑰時附 X-LLM-* 標頭', async () => {
        SecureStore.isAvailable = () => true;
        SecureStore.getKey = (p) => (p === 'grok' ? 'xai-test-key' : '');
        window.SettingsModule = {
            getActiveLLM: () => ({ provider: 'grok', model: '', hasKey: true, baseUrl: '' }),
        };
        const calls = installFetch();
        await ApiService.completeOnboarding();
        expect(calls[0].url).toContain('/users/onboarding/complete');
        expect(calls[0].options.headers['X-LLM-Provider']).toBe('grok');
        expect(calls[0].options.headers['X-LLM-Api-Key']).toBe('xai-test-key');
    });

    it('state/answer 都不是 LLM 端點：即使有金鑰也不附 X-LLM 標頭', async () => {
        SecureStore.isAvailable = () => true;
        SecureStore.getKey = () => 'xai-test-key';
        window.SettingsModule = {
            getActiveLLM: () => ({ provider: 'grok', model: '', hasKey: true, baseUrl: '' }),
        };
        const calls = installFetch();
        await ApiService.getOnboardingState();
        await ApiService.saveOnboardingAnswer('favorite_food', '牛肉湯');
        expect(calls[0].options.headers['X-LLM-Provider']).toBeUndefined();
        expect(calls[1].options.headers['X-LLM-Provider']).toBeUndefined();
    });
});
