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

    test('startRecording 錄音中被重複呼叫：第二次拒絕，且不再次取用麥克風（避免孤兒 MediaStream）', async () => {
        let getUserMediaCalls = 0;
        navigator.mediaDevices = {
            getUserMedia: async () => {
                getUserMediaCalls += 1;
                return { getTracks: () => [] };
            },
        };
        global.MediaRecorder = class {
            static isTypeSupported() { return false; }
            constructor(stream) { this.stream = stream; }
            start() {}
        };

        await VoiceModule.startRecording();
        expect(getUserMediaCalls).toBe(1);

        await expect(VoiceModule.startRecording()).rejects.toThrow('already-recording');
        expect(getUserMediaCalls).toBe(1);
    });

    // 上一則測試涵蓋的是「第一次已經完成、mediaRecorder 已賦值」之後的重
    // 複呼叫。這一則要鎖住的是更早、更容易在真實使用情境踩到的空窗期：
    // 第一次呼叫還卡在 getUserMedia() 的授權彈窗（await 尚未 resolve），
    // 此時 mediaRecorder 仍是 null，若沒有額外的同步鎖，第二次呼叫
    // （例如麥克風鍵被快速連按兩下）一樣會通過舊的 `if (mediaRecorder)`
    // 檢查、再要一次麥克風，把第一支尚在建立中的 MediaRecorder/MediaStream
    // 孤兒化。用一個「可以從外部控制何時 resolve」的 getUserMedia 樁，在
    // 第一次呼叫還沒 resolve 前就同步呼叫第二次，藉此重現這段空窗期。
    test('startRecording 併發連點（第一次仍卡在 getUserMedia 授權彈窗）：第二次同步拒絕，不孤兒化 MediaStream', async () => {
        let getUserMediaCalls = 0;
        let resolveGetUserMedia;
        const pendingStream = new Promise((resolve) => { resolveGetUserMedia = resolve; });
        navigator.mediaDevices = {
            getUserMedia: async () => {
                getUserMediaCalls += 1;
                return pendingStream; // 呼叫端此時會卡在這裡，直到下面手動 resolve
            },
        };
        let recorderConstructions = 0;
        global.MediaRecorder = class {
            static isTypeSupported() { return false; }
            constructor(stream) { recorderConstructions += 1; this.stream = stream; }
            start() {}
        };

        const firstCall = VoiceModule.startRecording(); // 不 await：模擬授權彈窗還沒回應
        // 第一次呼叫已經同步跑到 getUserMedia()、遞增了呼叫數，才在 await 處暫停。
        expect(getUserMediaCalls).toBe(1);

        // 連點第二下：此時 mediaRecorder 仍是 null，若只靠舊的
        // `if (mediaRecorder)` 檢查會誤判成「沒在錄音」而放行。
        await expect(VoiceModule.startRecording()).rejects.toThrow('already-recording');
        expect(getUserMediaCalls).toBe(1); // 第二次不該再要一次麥克風
        expect(recorderConstructions).toBe(0); // 第一次也還沒完成，此刻不該有任何 MediaRecorder

        resolveGetUserMedia({ getTracks: () => [] }); // 使用者終於在彈窗按下「允許」
        await firstCall;
        expect(recorderConstructions).toBe(1); // 第一次呼叫完整走完、只建立了一支 MediaRecorder
    });

    test('startRecording 權限被拒絕：starting 鎖要釋放，允許使用者重新點擊重試', async () => {
        let getUserMediaCalls = 0;
        navigator.mediaDevices = {
            getUserMedia: async () => {
                getUserMediaCalls += 1;
                if (getUserMediaCalls === 1) {
                    throw new Error('Permission denied');
                }
                return { getTracks: () => [] };
            },
        };
        global.MediaRecorder = class {
            static isTypeSupported() { return false; }
            constructor(stream) { this.stream = stream; }
            start() {}
        };

        await expect(VoiceModule.startRecording()).rejects.toThrow('Permission denied');
        // 重試（第二次點擊）不該被「starting 還卡著 true」誤擋成 already-recording
        await expect(VoiceModule.startRecording()).resolves.toBeUndefined();
        expect(getUserMediaCalls).toBe(2);
    });
});
