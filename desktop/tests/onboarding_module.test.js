// desktop/tests/onboarding_module.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/** 等 microtask＋timer 都收斂（延遲設 0 後仍有 setTimeout(0) 與 await 鏈）。 */
async function flush() {
    for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 0));
    }
}

function messagesText() {
    return document.querySelector('.chat-messages').textContent;
}

function lastApiCalls() {
    return window.__apiCalls;
}

beforeAll(() => {
    loadCoreScripts();
    loadScript('js/chat_module.js');
    loadScript('js/onboarding_module.js');
});

function installApi(state) {
    const calls = { answers: [], complete: 0, companionPuts: [], checkin: 0 };
    window.__apiCalls = calls;
    window.ApiService = {
        isAuthenticated: () => true,
        getOnboardingState: async () => state,
        saveOnboardingAnswer: async (key, text) => { calls.answers.push([key, text]); return { saved: true }; },
        // complete 之後狀態要翻成 completed:true——真實後端寫了
        // onboarding_completed_at 之後絕不會再回 completed:false。stub 若永遠回
        // false，「完成後不重演」這件事就沒有任何測試觀察得到（抑制 check-in 的
        // 斷言會被「重新啟動的 onboarding 同樣抑制 check-in」給假綠掉）。
        completeOnboarding: async () => { calls.complete += 1; state.completed = true; return { completed: true }; },
        checkIn: async () => { calls.checkin += 1; return { checkin: false }; },
        fetchAPI: async (endpoint, options) => {
            if (endpoint === '/users/me/companion') calls.companionPuts.push(options.body);
            return {};
        },
    };
    return calls;
}

beforeEach(() => {
    localStorage.clear();
    // 開場 gate 掛在 loadChatHistory() 裡、在它的「取不到用戶ID就 return」
    // 之後（見 chat_module.js），所以測試得先有 numericUserId，init() 才走得到
    // gate——比照 tests/chat_voice.test.js / chat_retry.test.js / mascot_chat.test.js
    // 讓 init() 走到 check-in 的既有作法。正式環境登入時 api_service.js 一定會
    // 寫入這個鍵，沒有它就代表沒登入，isAuthenticated() 本來也會擋下 onboarding。
    // 這個鍵名不含 CONFIG.STORAGE.CHAT_HISTORY，下面「不進持久層」的斷言不受影響。
    localStorage.setItem('numericUserId', '1');
    document.body.innerHTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-title"></div>
        </div>
        <textarea id="user-input"></textarea>
        <button id="send-button"></button>`;
    ChatModule.setScriptDelayRange(0, 0);
    OnboardingModule._test.reset();
});

describe('觸發與抑制', () => {
    it('completed=true → 不啟動，照常走 check-in', async () => {
        const calls = installApi({ completed: true, answered_keys: [] });
        ChatModule.init();
        await flush();
        expect(OnboardingModule.isActive()).toBe(false);
        expect(calls.checkin).toBe(1);
    });

    it('completed=false → 啟動（intro＋取名邀請），該次不發 check-in', async () => {
        const calls = installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        expect(OnboardingModule.isActive()).toBe(true);
        expect(calls.checkin).toBe(0);
        expect(messagesText()).toContain(I18N.t('onboarding.naming'));
        // chips 掛著
        expect(document.querySelector('.onboarding-chips')).not.toBeNull();
        // 不進聊天持久層。localStorage 這條只驗到下游——onboarding 流程本來就
        // 沒有任何路徑會走到 saveChatHistory()，就算腳本訊息改接會持久化的
        // addSystemMessage，這個 filter 一樣是空的。真正要觀察的是「有沒有進
        // 記憶體裡的 chatHistory」：一旦進去，outro 之後的第一則真實聊天訊息
        // 就會把整段 onboarding 一起存進去、重載時整條重演。
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
        expect(ChatModule._test.chatHistoryLength()).toBe(0);
    });
});

describe('取名分支', () => {
    async function startFresh() {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
    }

    it('≤12 字：upsert＋PUT companion_name＋下一則就自稱新名字', async () => {
        await startFresh();
        OnboardingModule.handleAnswer('小澄');
        await flush();
        const calls = lastApiCalls();
        expect(calls.answers).toContainEqual(['companion_naming', '小澄']);
        expect(calls.companionPuts[0]).toEqual({ companion_name: '小澄' });
        expect(messagesText()).toContain('小澄');                      // namingAck 自稱
        expect(messagesText()).toContain(I18N.t('onboarding.q.name')); // 續問 q1
    });

    it('>12 字：溫和請重試一次；仍超長只留原文並繼續 q1', async () => {
        await startFresh();
        const longName = '這個名字實在是太長了完全記不住';
        OnboardingModule.handleAnswer(longName);
        await flush();
        let calls = lastApiCalls();
        expect(calls.answers).toContainEqual(['companion_naming', longName]);
        expect(calls.companionPuts.length).toBe(0);
        expect(messagesText()).toContain(I18N.t('onboarding.namingTooLong'));
        // 第二次仍超長
        OnboardingModule.handleAnswer(longName + '真的');
        await flush();
        calls = lastApiCalls();
        expect(calls.companionPuts.length).toBe(0);
        expect(messagesText()).toContain(I18N.t('onboarding.namingStillLong'));
        expect(messagesText()).toContain(I18N.t('onboarding.q.name'));
    });
});

describe('七題流程', () => {
    it('依序七題→outro→complete；每題原文逐題 POST', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        OnboardingModule.handleAnswer('小澄'); await flush();          // naming
        const answers = ['小明', '彰化', '牛肉湯', '家人', '打羽球', '有毅力', '慢熱但真誠'];
        for (const a of answers) { OnboardingModule.handleAnswer(a); await flush(); }
        const calls = lastApiCalls();
        expect(calls.answers.map(x => x[0])).toEqual([
            'companion_naming', 'name', 'location', 'favorite_food',
            'important_people', 'hobbies', 'strengths', 'self_view']);
        expect(calls.complete).toBe(1);
        expect(OnboardingModule.isActive()).toBe(false);
        expect(messagesText()).toContain(I18N.t('onboarding.outro'));
        expect(document.querySelector('.onboarding-chips')).toBeNull(); // 收束後 chips 移除
    });

    it('「跳過這題」＝空字串 upsert；續跑不重問已答題', async () => {
        installApi({ completed: false, answered_keys: ['companion_naming', 'name'] });
        ChatModule.init();
        await flush();
        // 續跑開場後直接問第一個未答題 location
        expect(messagesText()).toContain(I18N.t('onboarding.resume'));
        expect(messagesText()).toContain(I18N.t('onboarding.q.location'));
        OnboardingModule.handleSkip();
        await flush();
        expect(lastApiCalls().answers).toContainEqual(['location', '']);
        expect(messagesText()).toContain(I18N.t('onboarding.q.favorite_food'));
    });

    it('「直接開始聊天」任何時點提前收束＋complete；已答照存', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        OnboardingModule.handleAnswer('小澄'); await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        const calls = lastApiCalls();
        expect(calls.complete).toBe(1);
        expect(calls.answers).toContainEqual(['companion_naming', '小澄']);
        expect(OnboardingModule.isActive()).toBe(false);
        expect(messagesText()).toContain(I18N.t('onboarding.outroEarly'));
    });
});

describe('sendMessage 攔截與同 session 抑制', () => {
    it('active 時打字送出＝回答當前題，不走一般聊天送出', async () => {
        installApi({ completed: false, answered_keys: ['companion_naming'] });
        window.ApiService.sendChatMessage = vi.fn();
        ChatModule.init();
        await flush();
        document.getElementById('user-input').value = '小明';
        ChatModule.sendMessage();
        await flush();
        expect(lastApiCalls().answers).toContainEqual(['name', '小明']);
        expect(window.ApiService.sendChatMessage).not.toHaveBeenCalled();
        expect(document.getElementById('user-input').value).toBe('');
        // 答案氣泡是 ephemeral：不進持久層（chatHistoryLength 才是真的在觀察
        // 這條保證本身，理由同上面「不進聊天持久層」的註解）
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
        expect(ChatModule._test.chatHistoryLength()).toBe(0);
    });

    it('完成後同一 session 再 init 不補發 check-in；maybeStart 回 true', async () => {
        const calls = installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        ChatModule.init();   // init 可能被重複呼叫（main.js 兩處）
        await flush();
        expect(calls.checkin).toBe(0);
        // 而且不是「onboarding 整段重演」換來的 checkin:0——第二次 init() 之後
        // 畫面上不該再出現一次自我介紹（completedThisSession 要擋在最前面，
        // 連狀態查詢都不必發）
        expect(messagesText()).not.toContain(I18N.t('onboarding.intro'));
        expect(OnboardingModule.isActive()).toBe(false);
    });
});

describe('腳本延遲期間的輸入保護與 chips 可見性', () => {
    it('自我介紹的假思考延遲期間送出：文字留在輸入框，稍後同一段字成為取名答案', async () => {
        const calls = installApi({ completed: false, answered_keys: [] });
        // 撐開「active 為 true、但 currentKey 還是 null」的那個窗口
        // （正式碼是 1000–3000ms，使用者完全來得及打完一句話按 Enter）
        ChatModule.setScriptDelayRange(30, 30);
        ChatModule.init();
        await new Promise(r => setTimeout(r, 0));  // maybeStart 跑完，intro 還在思考泡泡裡
        expect(OnboardingModule.isActive()).toBe(true);

        const input = document.getElementById('user-input');
        input.value = '我打太快了';
        ChatModule.sendMessage();
        // 還沒有題目可答 → 這次不算答案，文字必須原封不動留著（不得無聲吃掉）
        expect(input.value).toBe('我打太快了');
        expect(calls.answers).toEqual([]);

        // 腳本追上（intro → 取名邀請）後，同一段文字再送一次就被收下
        await new Promise(r => setTimeout(r, 120));
        await flush();
        ChatModule.sendMessage();
        await flush();
        expect(input.value).toBe('');
        expect(calls.answers).toContainEqual(['companion_naming', '我打太快了']);
    });

    it('chips 掛上之後把容器捲到底（不會掉到摺線下）', async () => {
        installApi({ completed: false, answered_keys: [] });
        const container = document.querySelector('.chat-messages');
        // jsdom 不做版面計算：scrollHeight 恆為 0、scrollTop 也不會保留寫入值，
        // 直接斷言等於白寫。這裡在 instance 上遮蔽這兩個屬性來模擬「chips 掛上
        // 之後容器才變高」——scrollHeight 只有在 chips 真的可見時才回較大值。
        // 於是 appendChatMessage 內的 scrollToBottom()（發生在 chips 掛上之前）
        // 只會捲到 500，唯有 showChips() 自己補捲那一下才會到 999。
        // 注意：這觀察的是「有沒有補捲這個行為」，不是真實的視覺位置。
        Object.defineProperty(container, 'scrollHeight', {
            get() {
                const chips = container.querySelector('.onboarding-chips');
                return (chips && chips.style.display !== 'none') ? 999 : 500;
            },
            configurable: true,
        });
        Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });

        ChatModule.init();
        await flush();
        expect(document.querySelector('.onboarding-chips')).not.toBeNull();
        expect(container.scrollTop).toBe(999);
    });
});

describe('換帳號（reset 生命週期）', () => {
    /**
     * main.js 的 loginUser() 每次登入都跑 ChatModule.reset() → ChatModule.init()
     * 且不重整頁面（js/main.js 全檔唯一的 location.reload() 是 service worker
     * 更新路徑），所以「同一個分頁換帳號」是真實情境。OnboardingModule 是活在
     * 整個分頁生命週期的 IIFE 單例，兩個旗標會各自獨立外洩到下一個帳號，
     * 因此兩條路徑分開釘。
     */
    it('A 停在 onboarding 進行中就換帳號：B 拿到自己的初次見面，不是空白對話頁', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        expect(OnboardingModule.isActive()).toBe(true);   // A 停在取名題

        // 換帳號：B 是另一個同樣還沒完成 onboarding 的帳號
        const bCalls = installApi({ completed: false, answered_keys: [] });
        ChatModule.reset();
        ChatModule.init();
        await flush();

        // active 沒歸零的話 maybeStart() 會在第一行就 return true（不查 B 的
        // 狀態、不發任何腳本訊息），而 reset()/init() 已經清空畫面＝空白對話頁
        expect(messagesText()).toContain(I18N.t('onboarding.intro'));
        expect(messagesText()).toContain(I18N.t('onboarding.naming'));
        expect(OnboardingModule.isActive()).toBe(true);
        expect(bCalls.checkin).toBe(0);
    });

    it('A 完成後換帳號：B 不被 A 的「本 session 已完成」抑制掉', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        expect(OnboardingModule.isActive()).toBe(false);  // A 已收束

        const bCalls = installApi({ completed: false, answered_keys: [] });
        ChatModule.reset();
        ChatModule.init();
        await flush();

        // completedThisSession 沒歸零的話 B 既拿不到初次見面、也不會有每日
        // 問候（maybeStart 回 true＝抑制 check-in）＝空白對話頁
        expect(OnboardingModule.isActive()).toBe(true);
        expect(messagesText()).toContain(I18N.t('onboarding.intro'));
        expect(bCalls.checkin).toBe(0);
    });
});

describe('安全：轉義與注入面', () => {
    it('答案含 HTML 時以純文字渲染、不產生節點（XSS，走既有 escape 管線）', async () => {
        installApi({ completed: false, answered_keys: ['companion_naming'] });
        ChatModule.init();
        await flush();
        OnboardingModule.handleAnswer('<img src=x onerror="window.__xss=1">');
        await flush();
        // 收斂到 .message-bubble：每則訊息都有一個我們自己產的頭像 <img>
        // （buildMessageHtml 的 .message-avatar，見 chat_module.js），
        // 「.chat-messages img」會抓到那顆而不是注入的節點。使用者內容只會
        // 出現在 .message-bubble 裡（那裡才是 formatMessageContent 的輸出），
        // 所以往下收斂反而讓這條斷言真的咬到 escape 管線：若 escape 被拿掉，
        // 注入的 <img> 就會長在 bubble 底下、這條立刻變紅。
        expect(document.querySelector('.chat-messages .message-bubble img')).toBeNull();
        expect(window.__xss).toBeUndefined();
        expect(messagesText()).toContain('<img src=x');  // 原文以純文字呈現
    });

    it('超長取名含 HTML 也走轉義（namingTooLong 分支的使用者氣泡）', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        OnboardingModule.handleAnswer('<script>window.__xss2=1</script>超過十二個字的名字啦');
        await flush();
        expect(document.querySelector('.chat-messages script')).toBeNull();
        expect(window.__xss2).toBeUndefined();
    });
});
