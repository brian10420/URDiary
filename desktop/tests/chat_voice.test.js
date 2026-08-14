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

/**
 * R6（controller ruling）：自動朗讀範圍＝AI 聊天新回覆本身，不含錯誤通知／
 * 問候語／其他系統訊息——即使這些訊息也會即時（scroll=true）出現在對話串
 * 裡。既有的 scroll 閘（排除 loadChatHistory 還原今日歷史）維持不動，一併
 * 鎖住。
 *
 * 這裡需要比上面兩則測試更完整的環境（真正跑 ChatModule.init()/sendMessage()），
 * 所以獨立一個 describe，自己的 beforeEach 準備完整的 chat DOM、i18n/security_utils
 * （buildMessageHtml 會呼叫 I18N.t 與 escapeHtml）、CONFIG.STORAGE（loadChatHistory
 * 存取歷史記錄要用）。VoiceModule.speak/isAutoRead 直接覆寫成測試樁——它是模組
 * 物件的屬性賦值，不受 loadScript 對 window.VoiceModule 的「已存在就不覆蓋」影響。
 */
describe('chat voice wiring：自動朗讀範圍限縮為 AI 新回覆（R6）', () => {
    const CHAT_HTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-input-area">
                <div class="chat-input-wrapper">
                    <textarea id="user-input"></textarea>
                    <button id="send-button"></button>
                </div>
            </div>
            <button id="end-chat-btn"></button>
            <button id="clear-chat-btn"></button>
        </div>
    `;

    let speakCalls;

    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = CHAT_HTML;

        loadScript('js/security_utils.js');
        loadScript('js/i18n.js');
        // 手動 stub（不用 loadCoreScripts 的 config.js）：上面的 describe 已經用
        // plain assignment 設過 global.CONFIG，這裡只需要多補 STORAGE.CHAT_HISTORY
        // 供 loadChatHistory 存取；其餘欄位在 chat_module.js 裡都走過安全的
        // fallback（CONFIG.APP/CONFIG.PROVIDERS 缺席時各自退回預設值）。
        global.CONFIG = {
            getApiBaseUrl: () => 'http://x',
            STORAGE: { CHAT_HISTORY: 'urdiary_chat_history' }
        };
        loadScript('js/voice_module.js');
        loadScript('js/chat_module.js');

        window.ApiService = undefined;
        window.SettingsModule = undefined;

        speakCalls = [];
        VoiceModule.speak = (mid, text) => { speakCalls.push({ mid, text }); return Promise.resolve(); };
        VoiceModule.isAutoRead = () => true;

        ChatModule.reset();
        ChatModule.init();
    });

    test('(a) 即時的 AI 聊天新回覆＋自動朗讀開：呼叫 speak', async () => {
        window.ApiService = { sendChatMessage: () => Promise.resolve({ response: 'AI 的回覆內容' }) };

        document.getElementById('user-input').value = '今天過得如何';
        await ChatModule.sendMessage();

        expect(speakCalls.some(c => c.text === 'AI 的回覆內容')).toBe(true);
    });

    test('(b) 即時的系統通知（非回覆，如慢速模型提示）＋自動朗讀開：不呼叫 speak', () => {
        window.SettingsModule = { getActiveLLM: () => ({ provider: 'grok', model: 'grok-4.6', label: 'Grok (xAI)' }) };

        const hintText = ChatModule.maybeShowSlowModelHint(45000);

        expect(hintText).toBeTruthy();
        expect(speakCalls.some(c => c.text === hintText)).toBe(false);
    });

    test('(c) 歷史回放（scroll=false）：即使內容是舊回覆也不呼叫 speak（鎖住既有 scroll 閘）', () => {
        localStorage.setItem('numericUserId', '9');
        localStorage.setItem(`${CONFIG.STORAGE.CHAT_HISTORY}_9`, JSON.stringify([
            { type: 'system', content: '歷史裡的舊回覆', timestamp: new Date().toISOString() }
        ]));

        ChatModule.reset();
        ChatModule.init(); // 重新載入，觸發 loadChatHistory 還原上面種好的今日歷史

        expect(speakCalls.some(c => c.text === '歷史裡的舊回覆')).toBe(false);
    });
});
