// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 離線容忍（v2.3 task 2.3）：聊天送出失敗時，保留草稿＋氣泡上的「點擊
 * 重試」，而不是把訊息憑空丟掉或需要使用者重新輸入一次。
 *
 * 核心規則：聊天送出是非冪等的 POST，重試永遠是使用者主動點擊觸發（見
 * ApiService.sendChatMessage 本身已移除自動重試——tests/api_retry.test.js
 * 的 POST 矩陣已經涵蓋那一層）。這裡驗證的是 ChatModule 這一層：氣泡的
 * 傳送中/失敗視覺狀態，以及點擊重試會不會用「原始文字」正確重送。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/chat_module.js');
});

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

/** 讓已排入佇列的 microtask/巨集任務跑完（點擊重試是 fire-and-forget）。 */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

let toastSpy;

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = CHAT_HTML;
    toastSpy = vi.fn();
    window.UIManager = { showToast: toastSpy, showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
    // 某些測試會刻意讓 sendChatMessage 的 mock 永遠不 resolve（觀察傳送中
    // 狀態），attemptSend 的 finally 因此永遠不會跑到、isProcessing 會卡在
    // true——ChatModule 是整份測試檔案共用同一份模組狀態（beforeAll 只載入
    // 一次），reset() 確保每個測試都從乾淨狀態開始，不受前一個測試影響。
    ChatModule.reset();
    ChatModule.init();
});

function userInput() {
    return document.getElementById('user-input');
}

function lastUserBubble() {
    const bubbles = document.querySelectorAll('.chat-message.user-message');
    return bubbles[bubbles.length - 1];
}

describe('ChatModule：送出失敗保留草稿 + 氣泡重試', () => {
    it('送出當下：輸入框清空，氣泡立刻出現且標記為 pending（傳送中）', async () => {
        window.ApiService = {
            sendChatMessage: vi.fn(() => new Promise(() => {})) // 故意永遠不 resolve，觀察傳送中狀態
        };

        userInput().value = '今天過得不錯';
        const sendPromise = ChatModule.sendMessage();
        await flush();

        expect(userInput().value).toBe('');
        const bubble = lastUserBubble();
        expect(bubble).toBeTruthy();
        expect(bubble.classList.contains('pending')).toBe(true);
        expect(bubble.classList.contains('send-failed')).toBe(false);
        // sendPromise 不需要在這個測試裡 await 完成（mock 永遠不 resolve）
        void sendPromise;
    });

    it('送出失敗：氣泡標記 send-failed，出現重試按鈕，文字內容仍在（沒有被丟掉）', async () => {
        window.ApiService = {
            sendChatMessage: vi.fn().mockRejectedValue(new Error('無法連線到伺服器'))
        };

        userInput().value = '今天心情不太好';
        await ChatModule.sendMessage();

        const bubble = lastUserBubble();
        expect(bubble.classList.contains('pending')).toBe(false);
        expect(bubble.classList.contains('send-failed')).toBe(true);
        expect(bubble.textContent).toContain('今天心情不太好');

        const retryBtn = bubble.querySelector('.send-retry-btn');
        expect(retryBtn).toBeTruthy();
        expect(retryBtn.textContent).toBe(I18N.t('chat.retrySend'));
        expect(bubble.querySelector('.send-failure-label').textContent).toBe(I18N.t('chat.sendFailed'));

        // 原始文字被存起來，重試不必使用者重新輸入
        expect(bubble.dataset.pendingText).toBe('今天心情不太好');
    });

    it('送出失敗不會清空/覆蓋輸入框（使用者可以繼續打下一句）', async () => {
        window.ApiService = { sendChatMessage: vi.fn().mockRejectedValue(new Error('offline')) };

        userInput().value = '第一句話';
        await ChatModule.sendMessage();

        // 輸入框在送出當下就已清空（不是失敗才清空），失敗後也不會被重新填回
        expect(userInput().value).toBe('');

        userInput().value = '第二句正在打的話';
        expect(userInput().value).toBe('第二句正在打的話'); // 沒有被失敗流程動過
    });

    it('點擊重試：用原始文字重送，成功後失敗標記消失、出現系統回應', async () => {
        const sendMock = vi.fn()
            .mockRejectedValueOnce(new Error('無法連線到伺服器'))
            .mockResolvedValueOnce({ response: '聽起來很不容易，願意多說一點嗎？' });
        window.ApiService = { sendChatMessage: sendMock };

        userInput().value = '今天很累';
        await ChatModule.sendMessage();

        const bubble = lastUserBubble();
        expect(bubble.classList.contains('send-failed')).toBe(true);

        const retryBtn = bubble.querySelector('.send-retry-btn');
        retryBtn.click();
        await flush();

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(sendMock).toHaveBeenNthCalledWith(2, '今天很累');
        expect(bubble.classList.contains('send-failed')).toBe(false);
        expect(bubble.classList.contains('pending')).toBe(false);
        expect(bubble.querySelector('.send-retry-btn')).toBeNull();

        const systemBubbles = document.querySelectorAll('.chat-message.system-message:not(.thinking)');
        const lastSystem = systemBubbles[systemBubbles.length - 1];
        expect(lastSystem.textContent).toContain('聽起來很不容易，願意多說一點嗎？');
    });

    it('重試不會用輸入框「目前」的內容（使用者失敗後改打別的話，重試仍送原始文字）', async () => {
        const sendMock = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ response: 'ok' });
        window.ApiService = { sendChatMessage: sendMock };

        userInput().value = '原始那句話';
        await ChatModule.sendMessage();

        // 使用者在重試之前，於輸入框打了完全不同的內容
        userInput().value = '這句還沒送出，只是草稿';

        const bubble = lastUserBubble();
        bubble.querySelector('.send-retry-btn').click();
        await flush();

        expect(sendMock).toHaveBeenNthCalledWith(2, '原始那句話');
        // 輸入框裡使用者正在打的草稿不受重試影響
        expect(userInput().value).toBe('這句還沒送出，只是草稿');
    });

    it('重試失敗仍然失敗：再次標記 send-failed，可以再按一次（訊息始終沒有被丟掉）', async () => {
        window.ApiService = { sendChatMessage: vi.fn().mockRejectedValue(new Error('offline')) };

        userInput().value = '一直失敗的訊息';
        await ChatModule.sendMessage();

        const bubble = lastUserBubble();
        bubble.querySelector('.send-retry-btn').click();
        await flush();

        expect(bubble.classList.contains('send-failed')).toBe(true);
        expect(bubble.querySelector('.send-retry-btn')).toBeTruthy();
        expect(bubble.dataset.pendingText).toBe('一直失敗的訊息');
    });

    it('重試時若另一則訊息正在處理中，顯示忙碌提示，不會疊加發送', async () => {
        let resolveFirst;
        window.ApiService = {
            sendChatMessage: vi.fn()
                .mockRejectedValueOnce(new Error('offline'))
                .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
        };

        userInput().value = '訊息A';
        await ChatModule.sendMessage();
        const bubbleA = lastUserBubble();

        // 送出訊息B，讓它卡在「處理中」
        userInput().value = '訊息B';
        const sendBPromise = ChatModule.sendMessage();
        await flush();
        expect(document.querySelectorAll('.chat-message.user-message')).toHaveLength(2);

        // 這時候點擊 A 的重試——應該被忙碌擋下，不會真的呼叫 sendChatMessage
        bubbleA.querySelector('.send-retry-btn').click();
        await flush();

        expect(toastSpy).toHaveBeenCalledWith(I18N.t('chat.busy'));
        expect(ApiService.sendChatMessage).toHaveBeenCalledTimes(2); // A失敗那次 + B正在進行那次，沒有第三次

        resolveFirst({ response: 'B 完成' });
        await sendBPromise;
    });

    it('成功送出的訊息氣泡沒有任何失敗/重試殘留', async () => {
        window.ApiService = { sendChatMessage: vi.fn().mockResolvedValue({ response: '好的' }) };

        userInput().value = '一切順利';
        await ChatModule.sendMessage();

        const bubble = lastUserBubble();
        expect(bubble.classList.contains('pending')).toBe(false);
        expect(bubble.classList.contains('send-failed')).toBe(false);
        expect(bubble.querySelector('.send-failure')).toBeNull();
    });

    it('訊息在送出結果揭曉前就已經寫入 localStorage（草稿不會因為還沒送出而遺失）', async () => {
        window.ApiService = { sendChatMessage: vi.fn(() => new Promise(() => {})) };
        localStorage.setItem('numericUserId', '7');

        userInput().value = '寫進歷史的草稿';
        const p = ChatModule.sendMessage();
        await flush();

        const saved = JSON.parse(localStorage.getItem(`${CONFIG.STORAGE.CHAT_HISTORY}_7`));
        expect(saved.some(m => m.type === 'user' && m.content === '寫進歷史的草稿')).toBe(true);

        void p;
    });
});
