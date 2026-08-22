// @vitest-environment jsdom
// 驗證：endChat 回應帶 memory_review.pending>0 → 系統訊息通知（不持久化）、
// 點氣泡開記憶 modal。
//
// DOM/stub 組裝比照既有 tests/mascot_chat.test.js／tests/chat_retry.test.js
// 的 chat_module 載入手法：loadCoreScripts()＋chat_module.js 所需最小 DOM
// （.chat-messages 容器＋#end-chat-btn 等，見 CHAT_HTML；.chat-messages 是
// class 不是 id——見 chat_module.js init() 的 document.querySelector('.chat-messages')，
// 也是既有測試檔一致採用的選擇器）；window.UIManager 三個方法一律 stub 掉
// （MascotModule 不載入，endChat 等待動畫落回全頁 spinner 分支，見該檔案
// endChat() 對 typeof MascotModule 的防禦）；window.MemoryModule 只 stub
// open/refreshBadge 兩個接線點用得到的方法。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

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

function endChatResponse(overrides = {}) {
    return {
        message: '對話已結束並生成摘要',
        model_used: 'grok-4.3',
        diary: { diary_id: 1, title: 't', summary: 's', content: 'c', valence: 0.5, arousal: 0.4 },
        memory_review: null,
        memory_review_error: null,
        ...overrides,
    };
}

function systemMessages() {
    return Array.from(document.querySelectorAll('.chat-messages .system-message'));
}

function noticeMessage() {
    return systemMessages().find(el => el.textContent.includes(I18N.t('memory.pendingNotice')));
}

describe('日記完成後的記憶通知', () => {
    beforeEach(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/chat_module.js');

        localStorage.clear();
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
        window.MemoryModule = { open: vi.fn(), refreshBadge: vi.fn() };
        // 不設 numericUserId：比照 tests/mascot_chat.test.js 的 endChat 系列
        // 測試，讓 init() 的 loadChatHistory() 略過 check-in（不需要
        // ApiService.checkIn/isAuthenticated），避免額外系統訊息干擾斷言。
        ChatModule.reset();
        ChatModule.init();
    });

    it('pending>0 顯示通知且不寫入聊天持久層', async () => {
        // 這個測試需要驗證 localStorage，因此在呼叫 endChat() 前才補上
        // numericUserId——讓 endChat 成功路徑裡的 saveChatHistory() 真的
        // 落盤，而不是因為沒有使用者 ID 而整段安靜跳過（那樣「不含通知
        // 文字」的斷言會變得沒有意義，見下方說明）。
        localStorage.setItem('numericUserId', 'notice-user');
        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve(endChatResponse({
                memory_review: { batch_id: 'b1', applied: 1, pending: 2, failed: 0, error: null },
            }))),
        };

        await ChatModule.endChat();

        // 1a. 畫面上出現含通知文字的系統訊息
        const notice = noticeMessage();
        expect(notice).toBeTruthy();
        expect(notice.classList.contains('system-message')).toBe(true);

        // 1b. 不持久化：chat_module.js 的持久層是 saveChatHistory()／
        // localStorage 鍵 `${CONFIG.STORAGE.CHAT_HISTORY}_${userId}`
        // （見 loadChatHistory/saveChatHistory）。endChat 成功路徑在
        // `addSystemMessage(diaryMessage)`（顯示「日記已生成」訊息）之前
        // 就已經呼叫過一次 saveChatHistory()——當時 chatHistory 才剛被
        // 清空成 []（見 chat_module.js endChat：`chatHistory = [];
        // saveChatHistory();` 早於 diaryMessage／通知訊息出現）。診斷結果：
        // addSystemMessage 的第二參數是「要不要捲動」，不是「要不要持久化」
        // ——appendChatMessage 一律會把訊息 push 進記憶體內的 chatHistory
        // 陣列，沒有任何參數能讓它跳過這個 push。真正讓通知「不落盤」的
        // 是 endChat 這個成功路徑之後不再呼叫 saveChatHistory()：診斷/
        // 通知訊息只停留在記憶體，直到下一次真正觸發存檔的動作（例如使用者
        // 送出下一則聊天訊息）才會被存進 localStorage——這與既有的
        // diaryMessage（「日記已結束」訊息）本身完全同構，不是通知訊息
        // 專屬的新缺口。這裡驗證的就是「呼叫 endChat 之後、在任何後續存檔
        // 動作發生之前」localStorage 裡的聊天歷史不含通知文字。
        const saved = JSON.parse(localStorage.getItem('urdiary_chat_history_notice-user'));
        expect(Array.isArray(saved)).toBe(true);
        expect(saved.some(m => typeof m.content === 'string' && m.content.includes(I18N.t('memory.pendingNotice')))).toBe(false);
    });

    it('點通知氣泡開記憶 modal', async () => {
        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve(endChatResponse({
                memory_review: { batch_id: 'b1', applied: 0, pending: 1, failed: 0, error: null },
            }))),
        };

        await ChatModule.endChat();

        const notice = noticeMessage();
        expect(notice).toBeTruthy();
        const bubble = notice.querySelector('.message-bubble');
        expect(bubble).toBeTruthy();

        bubble.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(window.MemoryModule.open).toHaveBeenCalled();
    });

    it('pending=0 或 memory_review 缺席時不顯示通知', async () => {
        // pending=0（例如自動制、沒有任何 pending 項目）
        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve(endChatResponse({
                memory_review: { batch_id: 'b1', applied: 1, pending: 0, failed: 0, error: null },
            }))),
        };
        await ChatModule.endChat();
        expect(noticeMessage()).toBeUndefined();

        // memory_review 缺席（null，例如後端整段記憶審閱失敗或未啟用）
        document.querySelector('.chat-messages').innerHTML = '';
        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve(endChatResponse({ memory_review: null }))),
        };
        await ChatModule.endChat();
        expect(noticeMessage()).toBeUndefined();

        // MemoryModule.open 兩種情況下都不該被呼叫
        expect(window.MemoryModule.open).not.toHaveBeenCalled();
    });
});
