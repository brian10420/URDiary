// @vitest-environment jsdom
import { describe, test, it, expect, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.4 spec③ task 3：聊天整合（思考中泡泡＋check-in 端茶＋登入歡迎）。
 *
 * 前兩則測試是 brief 指定的模組輸出鎖定（thinkingBubbleHtml/checkinHtml
 * 的契約在 task 1 已經完成，這裡第一次跑就會過——brief 承認這點，這是接
 * 線任務，不是新功能）。後面兩個 describe 是 DOM 級的接線驗證，確認
 * chat_module.js 真的把 MascotModule 的輸出接進畫面，而不是只停留在
 * 「有這個函式可以呼叫」。
 */
describe('mascot chat integration：模組輸出（brief 指定）', () => {
    beforeEach(() => {
        loadScript('js/mascot.js');
    });

    test('thinkingBubbleHtml 含搖擺吉祥物與三點', () => {
        const html = MascotModule.thinkingBubbleHtml();
        expect(html).toContain('mascot-sway');
        expect(html).toContain('mascot-dots');
    });

    test('checkinHtml 是行內小尺寸（44px）', () => {
        expect(MascotModule.checkinHtml()).toContain('width="44"');
    });
});

/** chat_module.js 的 DOM 測試共用 fixture（比照 tests/chat_retry.test.js）。 */
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

/** 讓已排入佇列的 microtask/巨集任務跑完（check-in/送出都是 fire-and-forget）。 */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('mascot chat integration：思考中泡泡的 DOM 接線', () => {
    beforeEach(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/chat_module.js');

        localStorage.clear();
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
        ChatModule.reset();
        ChatModule.init();
    });

    it('送出訊息後，思考中泡泡的內文是 MascotModule.thinkingBubbleHtml()（搖擺吉祥物＋三點）', async () => {
        window.ApiService = {
            // 故意永遠不 resolve：思考泡泡移除前有機會被這裡檢查到
            sendChatMessage: vi.fn(() => new Promise(() => {}))
        };

        document.getElementById('user-input').value = '今天過得不錯';
        const sendPromise = ChatModule.sendMessage();
        await flush();

        const thinkingBubble = document.querySelector('.chat-message.system-message.thinking .message-bubble');
        expect(thinkingBubble).toBeTruthy();
        expect(thinkingBubble.innerHTML).toContain('mascot-sway');
        expect(thinkingBubble.innerHTML).toContain('mascot-dots');
        // 思考泡泡是 showTime:false，不該被判定為「AI 新回覆」而長出朗讀鍵
        // （kind==='system' && showTime 才有 .tts-play，見 buildMessageHtml）。
        const thinkingMessage = document.querySelector('.chat-message.system-message.thinking');
        expect(thinkingMessage.querySelector('.tts-play')).toBeNull();

        void sendPromise; // 不需要 await 完成（mock 永遠不 resolve）
    });
});

describe('mascot chat integration：check-in 問候的 DOM 接線', () => {
    beforeEach(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/chat_module.js');

        localStorage.clear();
        localStorage.setItem('numericUserId', 'test-user');
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
    });

    it('checkinHtml() 前綴進畫面，但問候文字仍轉義；存進 chatHistory 的內容不含 SVG（不污染朗讀來源）', async () => {
        const rawGreeting = '<script>alert(1)</script>早安，昨天過得如何？';
        window.ApiService = {
            isAuthenticated: () => true,
            checkIn: vi.fn(() => Promise.resolve({ checkin: true, message: rawGreeting }))
        };

        ChatModule.reset();
        ChatModule.init(); // loadChatHistory() 讀不到今日歷史 → requestDailyCheckin(false)
        await flush();

        // 畫面上：check-in 泡泡（非思考中）要同時看到端茶吉祥物前綴與轉義後的問候文字
        const checkinBubble = document.querySelector('.chat-message.system-message:not(.thinking) .message-bubble');
        expect(checkinBubble).toBeTruthy();
        expect(checkinBubble.innerHTML).toContain('mascot-checkin');
        expect(checkinBubble.innerHTML).toContain('&lt;script&gt;');
        expect(checkinBubble.querySelector('script')).toBeNull(); // 沒有被當成真的 HTML 執行
        expect(checkinBubble.textContent).toContain('早安，昨天過得如何？');

        // 存檔：chatHistory/localStorage 裡的 content 必須是「原始問候文字」，
        // 不能混進 checkinHtml() 的 SVG——這是朗讀鍵（VoiceModule.speak）與
        // 下次還原歷史時實際會讀到的來源，見 appendChatMessage 對 htmlPrefix
        // 參數的說明。
        const saved = JSON.parse(localStorage.getItem('urdiary_chat_history_test-user'));
        const lastEntry = saved[saved.length - 1];
        expect(lastEntry.content).toBe(rawGreeting);
        expect(lastEntry.content).not.toContain('mascot-checkin');
        expect(lastEntry.content).not.toContain('<svg');
    });
});
