// @vitest-environment jsdom
import { describe, test, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * v2.4 spec③ task 5：存日記彩蛋的 DOM 接線（endChat 的日記生成成功路徑）。
 *
 * eggKindFor 的分支邏輯已於 task 1（tests/mascot.test.js）覆蓋，這裡只驗證
 * chat_module.js 真的把 ApiService.endChat() 回應裡的 diary.valence 接到
 * MascotModule.eggKindFor()/showSaveEgg()，而不是停在「有函式可呼叫」。
 *
 * 欄位路徑注意：後端 /chat/end/ 回應把 valence 包在 diary 物件底下
 * （見 backend/app/services/diary_service.py 的 diary_payload），不是頂層
 * 欄位——所以下面的 mock 回應也用 diary.valence，比照真實形狀。
 */
describe('mascot chat integration：存日記彩蛋的 DOM 接線', () => {
    beforeEach(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/chat_module.js');

        localStorage.clear(); // 不設 numericUserId：比照上面思考泡泡測試，讓 init() 略過 check-in（不需要 ApiService.checkIn）
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
        ChatModule.reset();
        ChatModule.init();
    });

    afterEach(() => {
        vi.restoreAllMocks(); // 還原 Date.prototype.getHours 等 spy，避免污染其他測試
    });

    it('日間、正向 valence：eggKindFor 收到正確的 valence/hour，彩蛋（非晚安版）掛上 document.body', async () => {
        vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14); // 固定白天時段，不受實跑時間影響
        vi.spyOn(MascotModule, 'eggKindFor'); // 不覆寫實作，只用來斷言呼叫參數

        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve({
                message: '對話已結束並生成摘要',
                diary: { diary_id: 1, title: 't', summary: 's', content: 'c', valence: 0.8, arousal: 0.6 }
            }))
        };

        await ChatModule.endChat();

        // 證明 response.diary.valence 真的接到 eggKindFor 的第一個參數（不是頂層 response.valence）
        expect(MascotModule.eggKindFor).toHaveBeenCalledWith(0.8, 14);

        const egg = document.querySelector('.mascot-egg');
        expect(egg).toBeTruthy();
        expect(egg.classList.contains('mascot-egg-night')).toBe(false); // 白天版，不是晚安版
    });

    it('負向 valence：安靜略過，不掛上彩蛋（硬規則；後端 valence 實際上永遠 >=0，見 report，此處驗證接線本身遵守合約）', async () => {
        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve({
                message: '對話已結束並生成摘要',
                diary: { diary_id: 2, title: 't', summary: 's', content: 'c', valence: -0.4, arousal: 0.3 }
            }))
        };

        await ChatModule.endChat();

        expect(document.querySelector('.mascot-egg')).toBeNull();
    });

    it('回應不含 valence 欄位：視為正向（null → happy/goodnight，不當機、不當成 quiet）', async () => {
        vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14);

        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve({
                message: '對話已結束並生成摘要',
                diary: { diary_id: 3, title: 't', summary: 's', content: 'c' } // 沒有 valence 欄位
            }))
        };

        await ChatModule.endChat();

        expect(document.querySelector('.mascot-egg')).toBeTruthy();
    });
});

/**
 * v2.4 final-fix wave（Finding A / R7）：AI 生成日記等待改用吉祥物搖擺動畫
 * （MascotModule.loadingHtml()），塞進聊天區域的暫時性訊息（比照
 * addThinkingMessage 的純 DOM 佔位模式），取代原本只在全頁 spinner 出現的
 * 純文字等待畫面。
 *
 * 第一個測試用「永遠不 resolve 的 Promise」凍結在等待中途，驗證等待時
 * 畫面上真的看得到搖擺吉祥物＋既有等待文字，不是只有函式可呼叫（比照
 * 上面思考中泡泡測試的同一招）。後兩個測試驗證成功／失敗兩條路徑收尾後
 * 都不留殘留元素（endChat 的 catch/finally 對稱清除）。
 */
describe('mascot chat integration：生成日記等待的 DOM 接線', () => {
    beforeEach(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/chat_module.js');

        localStorage.clear(); // 不設 numericUserId：比照上面測試，讓 init() 略過 check-in
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
        ChatModule.reset();
        ChatModule.init();
    });

    it('等待期間：聊天區域出現吉祥物搖擺動畫＋既有等待文字，且不落回全頁 spinner（MascotModule 路徑優先）', async () => {
        window.ApiService = {
            // 故意永遠不 resolve：等待畫面移除前有機會被這裡檢查到
            endChat: vi.fn(() => new Promise(() => {}))
        };

        const endChatPromise = ChatModule.endChat();
        await flush();

        const waitBubble = document.querySelector('.chat-message.system-message.diary-generating .message-bubble');
        expect(waitBubble).toBeTruthy();
        expect(waitBubble.innerHTML).toContain('mascot-sway');
        expect(waitBubble.innerHTML).toContain(I18N.t('chat.generatingDiary'));

        // chat 區域只能有安靜的搖擺，不該疊上三點動畫（那是 thinkingBubbleHtml 的標記）
        expect(waitBubble.innerHTML).not.toContain('mascot-dots');

        // MascotModule 路徑優先：不該落回全頁 spinner
        expect(window.UIManager.showLoadingSpinner).not.toHaveBeenCalled();

        void endChatPromise; // 不需要 await 完成（mock 永遠不 resolve）
    });

    it('成功路徑：日記生成完成後，等待畫面從聊天區域移除，無殘留元素', async () => {
        window.ApiService = {
            endChat: vi.fn(() => Promise.resolve({
                message: '對話已結束並生成摘要',
                diary: { diary_id: 5, title: 't', summary: 's', content: 'c', valence: 0.8, arousal: 0.6 }
            }))
        };

        await ChatModule.endChat();

        expect(document.querySelector('.diary-generating')).toBeNull();
        expect(document.querySelector('.mascot-loading')).toBeNull();
    });

    it('失敗路徑：API 報錯後，等待畫面同樣從聊天區域移除，不留殘留元素', async () => {
        window.ApiService = {
            endChat: vi.fn(() => Promise.reject(new Error('網路錯誤')))
        };

        await ChatModule.endChat();

        expect(document.querySelector('.diary-generating')).toBeNull();
        expect(document.querySelector('.mascot-loading')).toBeNull();
        // 確認真的走了 catch 分支（既有錯誤訊息行為不變）
        expect(document.querySelector('.chat-messages').textContent)
            .toContain(I18N.t('chat.diaryError', { error: '網路錯誤' }));
    });
});
