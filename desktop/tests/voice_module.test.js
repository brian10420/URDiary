// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';

/** VoiceModule：mime 選擇、偏好存取、TTS blob 快取。 */
const { loadScript } = require('./helpers/load.js');

describe('VoiceModule', () => {
    beforeEach(() => {
        localStorage.clear();
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/voice_module.js');
    });

    test('偏好預設值：confirm 模式、自動朗讀關', () => {
        expect(VoiceModule.getInputMode()).toBe('confirm');
        expect(VoiceModule.isAutoRead()).toBe(false);
    });

    test('偏好寫入 localStorage 指定鍵', () => {
        VoiceModule.setInputMode('fluent');
        VoiceModule.setAutoRead(true);
        VoiceModule.setVoiceId('ara');
        expect(localStorage.getItem('urDiary_voice_input_mode')).toBe('fluent');
        expect(localStorage.getItem('urDiary_voice_autoread')).toBe('1');
        expect(localStorage.getItem('urDiary_voice_id')).toBe('ara');
    });

    test('pickMimeType 依支援度回退（webm → mp4）', () => {
        const canWebm = { isTypeSupported: (t) => t.startsWith('audio/webm') };
        const onlyMp4 = { isTypeSupported: (t) => t === 'audio/mp4' };
        expect(VoiceModule._test.pickMimeType(canWebm)).toBe('audio/webm');
        expect(VoiceModule._test.pickMimeType(onlyMp4)).toBe('audio/mp4');
        expect(VoiceModule._test.pickMimeType({ isTypeSupported: () => false })).toBe('');
    });

    test('speak 以 messageId 快取 blob（同 id 第二次不再 fetch）', async () => {
        let fetches = 0;
        global.ApiService = { fetchRaw: async () => { fetches += 1;
            return new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }); } };
        global.Audio = class { play() { return Promise.resolve(); } pause() {} };
        global.URL.createObjectURL = () => 'blob:x';
        await VoiceModule.speak('m1', '你好');
        await VoiceModule.speak('m1', '你好');
        expect(fetches).toBe(1);
        expect(VoiceModule._test.cacheSize()).toBe(1);
    });
});
