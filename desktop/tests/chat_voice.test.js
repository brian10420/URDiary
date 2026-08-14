// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';

/** 聊天語音接線：confirm/fluent 分流、自動朗讀觸發。 */
const { loadScript } = require('./helpers/load.js');

describe('chat voice wiring', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<textarea id="user-input"></textarea>';
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/voice_module.js');
        loadScript('js/chat_module.js');   // 若 chat_module 需其他全域 stub，比照 tests/chat_helpers.test.js 現有 beforeEach 補齊
    });

    test('confirm 模式：轉寫填入輸入框不送出', () => {
        const sent = [];
        ChatModule._test.handleTranscript('今天有點累', {
            mode: 'confirm', send: (t) => sent.push(t) });
        expect(document.getElementById('user-input').value).toBe('今天有點累');
        expect(sent).toEqual([]);
    });

    test('fluent 模式：直接送出', () => {
        const sent = [];
        ChatModule._test.handleTranscript('今天有點累', {
            mode: 'fluent', send: (t) => sent.push(t) });
        expect(sent).toEqual(['今天有點累']);
    });
});
