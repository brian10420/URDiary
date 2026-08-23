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
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/chat_module.js');
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
