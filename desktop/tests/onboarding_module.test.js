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

    it('名字含換行：PUT 與自稱用洗過的版本（原文照樣入庫）', async () => {
        // 輸入框是 <textarea>，Shift+Enter 就插得進換行；後端
        // CompanionSettingsIn.companion_name 帶 pattern=_NO_CTRL_PATTERN → 422，
        // 而 422 被 .catch 吞掉之後 namingAck 還是會說「從現在起我就是X了」
        // ——陪伴者頂著一個伺服器根本沒收下的名字。
        await startFresh();
        OnboardingModule.handleAnswer('小澄\n澄');
        await flush();
        const calls = lastApiCalls();
        expect(calls.answers).toContainEqual(['companion_naming', '小澄\n澄']); // 原文入庫
        expect(calls.companionPuts[0]).toEqual({ companion_name: '小澄 澄' });  // 洗過才送
        expect(messagesText()).toContain(I18N.t('onboarding.namingAck', { name: '小澄 澄' }));
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

    it('答完一題、下一題還在假思考裡就又送出：不會被誤記成那題的答案', async () => {
        // 這是比上一條更嚴重的變體：askNext() 是「同步」把 currentKey 指到
        // 下一題的，問題文字卻要等 1–3 秒假思考才現身。使用者常見的行為是
        // 補充剛剛那題（「啊對了 我姓陳」），而畫面上根本還沒問「住哪」——
        // 沒有 scriptInFlight 的話這句話會被存成 location 的答案，
        // 而且輸入框被清空、原文無從復原。
        const calls = installApi({ completed: false, answered_keys: ['companion_naming'] });
        ChatModule.setScriptDelayRange(30, 30);
        ChatModule.init();
        // resume → q.name 兩段假思考；用 waitFor 等條件成立（不用固定圈數的
        // flush，理由同下一條測試的說明：全套件併發時 timer 會落得晚）
        await vi.waitFor(() => {
            expect(messagesText()).toContain(I18N.t('onboarding.q.name'));
        });

        const input = document.getElementById('user-input');
        input.value = '小明';
        ChatModule.sendMessage();                     // 攔截分支是同步的
        expect(input.value).toBe('');                 // 第一題正常被收下
        expect(calls.answers).toEqual([['name', '小明']]);
        // 此刻 currentKey 已是 location，但「你住在哪個城市」還在思考泡泡裡
        expect(messagesText()).not.toContain(I18N.t('onboarding.q.location'));

        input.value = '啊對了 我姓陳';
        ChatModule.sendMessage();
        // 不得被收下：文字留在輸入框，也不得產生 location 這一筆
        expect(input.value).toBe('啊對了 我姓陳');
        expect(calls.answers).toEqual([['name', '小明']]);
        expect(calls.answers.some(a => a[0] === 'location')).toBe(false);

        // 題目真的現身之後，同一段文字再送一次才成為 location 的答案
        await vi.waitFor(() => {
            expect(messagesText()).toContain(I18N.t('onboarding.q.location'));
        });
        ChatModule.sendMessage();
        expect(input.value).toBe('');
        expect(calls.answers).toContainEqual(['location', '啊對了 我姓陳']);
    });

    it('取名太長的重試提示還在假思考裡就又送出：不會被當成第二次取名', async () => {
        // namingTooLong 分支：currentKey 停在取名題（重試一次），但「太長囉」
        // 那句話同樣壓著假思考——這段空窗期送出會直接吃掉使用者的第二次命名。
        const calls = installApi({ completed: false, answered_keys: [] });
        ChatModule.setScriptDelayRange(30, 30);
        ChatModule.init();
        await vi.waitFor(() => {
            expect(messagesText()).toContain(I18N.t('onboarding.naming'));
        });

        const input = document.getElementById('user-input');
        input.value = '這個名字實在是太長了完全記不住';
        ChatModule.sendMessage();
        expect(calls.answers.length).toBe(1);

        input.value = '小澄';
        ChatModule.sendMessage();
        expect(input.value).toBe('小澄');             // 留著，等提示出現
        expect(calls.answers.length).toBe(1);         // 沒有第二筆 companion_naming
        expect(calls.companionPuts.length).toBe(0);

        await vi.waitFor(() => {
            expect(messagesText()).toContain(I18N.t('onboarding.namingTooLong'));
        });
        ChatModule.sendMessage();
        expect(calls.answers).toContainEqual(['companion_naming', '小澄']);
        expect(calls.companionPuts[0]).toEqual({ companion_name: '小澄' });
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
        // 不能用固定圈數的 flush()：整條開場鏈是「假思考 timer → 訊息 → chips」
        // 兩層，scrollTop 的寫入序列實測為 500 → 500 → 999 → 500 → 500 → 999，
        // 中間存在兩段「值還停在 chips 掛上前的 500」的空檔。機器閒置時整條鏈
        // 第 2 圈就收斂（所以單獨跑 8/8 綠），但全套件併發時 timer 相對於 flush
        // 迴圈落得晚，8 圈有機率剛好在其中一段空檔用盡 → 偶發 expected 500 to
        // be 999。改成輪詢等待條件成立，對「timer 晚到」免疫。
        // 這不會弱化斷言：條件若永遠不成立（例如 showChips() 補捲那行被拿掉，
        // 最後一次寫入就永遠是 500），vi.waitFor 會逾時並失敗，不是假綠——
        // 見報告 §R4 的突變複驗。
        await vi.waitFor(() => {
            expect(document.querySelector('.onboarding-chips')).not.toBeNull();
            expect(container.scrollTop).toBe(999);
        });
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

describe('收束後的待核可記憶通知', () => {
    /**
     * /onboarding/complete 會順手跑一次收納 pass；核可制下這批初次見面答案
     * 會變成 pending ops（記憶檔案這時還是空的）。finish() 原本把回應整個
     * 丟掉，Spec C 的通知又只掛在 endChat 那條路上，使用者因此完全不知道
     * 有東西等著他核可——徽章也不會刷新。
     */
    async function finishWith(completeImpl) {
        const calls = installApi({ completed: false, answered_keys: [] });
        window.ApiService.completeOnboarding = completeImpl;
        window.MemoryModule = { open: vi.fn(), refreshBadge: vi.fn() };
        ChatModule.init();
        await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        return calls;
    }

    function noticeText() {
        return `${I18N.t('memory.pendingNotice')} ${I18N.t('memory.goSee')}`;
    }

    it('pending>0：outro 之後出現可點的通知並刷新徽章，且不進持久層', async () => {
        await finishWith(async () => ({
            completed: true,
            memory_review: { batch_id: 'b1', applied: 0, pending: 3, failed: 0, error: null },
        }));

        expect(messagesText()).toContain(I18N.t('onboarding.outroEarly'));
        expect(messagesText()).toContain(noticeText());
        expect(window.MemoryModule.refreshBadge).toHaveBeenCalled();

        // 通知排在 outro 後面（不會插到收束語之前）
        expect(messagesText().indexOf(I18N.t('onboarding.outroEarly')))
            .toBeLessThan(messagesText().indexOf(I18N.t('memory.pendingNotice')));

        // 整顆泡泡可點 → 開記憶 modal（沿用 endChat 那條既有接線）
        const notice = Array.from(document.querySelectorAll('.chat-messages .system-message'))
            .find(el => el.textContent.includes(I18N.t('memory.pendingNotice')));
        expect(notice).toBeTruthy();
        notice.querySelector('.message-bubble')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(window.MemoryModule.open).toHaveBeenCalled();

        // 初次見面全程不進持久層——這則通知也一樣（重載不重演）
        expect(ChatModule._test.chatHistoryLength()).toBe(0);
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
    });

    it('pending=0 / memory_review 缺席：不通知、不刷徽章', async () => {
        await finishWith(async () => ({
            completed: true,
            memory_review: { batch_id: 'b1', applied: 2, pending: 0, failed: 0, error: null },
        }));
        expect(messagesText()).not.toContain(I18N.t('memory.pendingNotice'));
        expect(window.MemoryModule.refreshBadge).not.toHaveBeenCalled();

        OnboardingModule._test.reset();
        document.querySelector('.chat-messages').innerHTML = '';
        await finishWith(async () => ({ completed: true, memory_review: null }));
        expect(messagesText()).not.toContain(I18N.t('memory.pendingNotice'));
        expect(window.MemoryModule.refreshBadge).not.toHaveBeenCalled();
    });

    it('complete 送出失敗：不通知也不擋主流程（outro 照樣出現）', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await finishWith(async () => { throw new Error('network down'); });
        expect(messagesText()).toContain(I18N.t('onboarding.outroEarly'));
        expect(messagesText()).not.toContain(I18N.t('memory.pendingNotice'));
        expect(window.MemoryModule.refreshBadge).not.toHaveBeenCalled();
        expect(OnboardingModule.isActive()).toBe(false);
        warn.mockRestore();
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
