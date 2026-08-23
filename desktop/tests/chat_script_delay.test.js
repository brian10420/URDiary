// desktop/tests/chat_script_delay.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 腳本訊息基礎設施 (v2.5 Spec B Task 8)：
 * - ephemeral 訊息只進 DOM，不進 chatHistory（重載不重演的前端保證）。
 * - withThinkingDelay：搖擺泡泡 → 1000–3000ms uniform → 替換成訊息；
 *   setScriptDelayRange 測試鉤子（硬需求）。
 */
// fix round 1（code review finding 2）：出廠預設區間只有「beforeAll 剛載完
// 模組、任何 beforeEach 都還沒跑」這一個時間點讀得到——下面的檔案層
// beforeEach 每個測試前都會呼叫 setScriptDelayRange(0, 0)，把同一個
// ChatModule 實例的 scriptDelayRange 覆寫掉。這裡趁這個唯一的窗口存一份
// 起來；setScriptDelayRange 是整個重新賦值（scriptDelayRange = [minMs,
// maxMs]），不是原地改陣列內容，所以這裡存的陣列參照不會被之後任何一次
// 呼叫追加影響，可以放心留到最後的 describe 斷言。
let factoryDefaultDelayRange;

beforeAll(() => {
    loadCoreScripts();
    loadScript('js/chat_module.js');
    factoryDefaultDelayRange = ChatModule._test.getScriptDelayRange();
});

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-title"></div>
        </div>
        <textarea id="user-input"></textarea>
        <button id="send-button"></button>`;
    // init 需要最小 DOM；ApiService 未認證 → 不發 check-in 網路請求
    window.ApiService = { isAuthenticated: () => false, checkIn: async () => ({}) };
    ChatModule.setScriptDelayRange(0, 0);
    ChatModule.init();
    document.querySelector('.chat-messages').innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    ChatModule.setScriptDelayRange(0, 0);
});

describe('ephemeral 訊息', () => {
    it('addEphemeralSystemMessage/addEphemeralUserMessage 進 DOM、不進 localStorage 持久層', () => {
        ChatModule.addEphemeralSystemMessage('腳本訊息');
        ChatModule.addEphemeralUserMessage('使用者答案');
        const msgs = document.querySelectorAll('.chat-messages .chat-message');
        expect(msgs.length).toBe(2);
        expect(msgs[0].classList.contains('system-message')).toBe(true);
        expect(msgs[1].classList.contains('user-message')).toBe(true);
        // 不寫任何 chatHistory 儲存鍵（onboarding 重載不重演的關鍵）
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
        // 上面的 localStorage 斷言只驗到下游效果——這條直接呼叫路徑本來就
        // 不會走到 saveChatHistory()，就算 chat_module.js 的 `if (!ephemeral)`
        // guard 被拿掉，localStorage 斷言依然會通過。改用 _test.chatHistoryLength()
        // 直接讀陣列本身，才是真的 pin 住「ephemeral 訊息不進 chatHistory」
        // 這個保證（fix round 1，code review finding 1；已用突變測試驗證）。
        expect(ChatModule._test.chatHistoryLength()).toBe(0);
    });
});

describe('withThinkingDelay', () => {
    it('延遲 0 時：泡泡出現後即替換為訊息', async () => {
        vi.useFakeTimers();
        ChatModule.withThinkingDelay(() => ChatModule.addEphemeralSystemMessage('哈囉'));
        expect(document.querySelector('.chat-message.thinking')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(0);
        expect(document.querySelector('.chat-message.thinking')).toBeNull();
        expect(document.querySelector('.chat-messages').textContent).toContain('哈囉');
    });

    it('預設區間 1000–3000ms：999ms 前不出現、3000ms 內必出現', async () => {
        vi.useFakeTimers();
        ChatModule.setScriptDelayRange(1000, 3000);
        ChatModule.withThinkingDelay(() => ChatModule.addEphemeralSystemMessage('慢慢來'));
        await vi.advanceTimersByTimeAsync(999);
        expect(document.querySelector('.chat-messages').textContent).not.toContain('慢慢來');
        expect(document.querySelector('.chat-message.thinking')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(2001);
        expect(document.querySelector('.chat-messages').textContent).toContain('慢慢來');
        expect(document.querySelector('.chat-message.thinking')).toBeNull();
    });
});

// fix round 1（code review finding 2）：上面「預設區間 1000–3000ms」測試其實
// 是手動呼叫 setScriptDelayRange(1000, 3000) 之後才驗證，測的是 uniform 延遲
// 的邊界機制，不是「什麼都不呼叫時」真正出廠預設值。這裡改斷言 beforeAll
// 那個唯一窗口存下來的 factoryDefaultDelayRange，確保未來若有人不小心把
// chat_module.js 的預設區間改短，這裡一定會爆（已用突變測試驗證：見
// task-8-report.md fix round 1）。
describe('scriptDelayRange 出廠預設值（未曾呼叫 setScriptDelayRange）', () => {
    it('預設區間是 1000–3000ms，不得被悄悄縮短', () => {
        expect(factoryDefaultDelayRange).toEqual([1000, 3000]);
    });
});
