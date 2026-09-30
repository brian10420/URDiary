// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 9：初次見面的吉祥物浮層。
 * 契約 §4：只綁兩個操作事件——onboarding 啟動（揮手進場）、取名這一步定案（帶新名字的
 * 慶祝）；不看答案內容與情緒、不進 .chat-messages；名字一律 textContent。
 * 流程 fixture 比照 tests/onboarding_module.test.js（延遲設 0、ApiService stub）。
 */
async function flush() {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

function installApi(state, completeResult) {
    window.ApiService = {
        isAuthenticated: () => true,
        getOnboardingState: async () => state,
        saveOnboardingAnswer: async () => ({ saved: true }),
        completeOnboarding: async () => { state.completed = true; return completeResult || { completed: true }; },
        checkIn: async () => ({ checkin: false }),
        fetchAPI: async () => ({}),
    };
}

const REAL = {};   // spy 之前的真實作（beforeEach 每次重新 spy）

beforeAll(() => {
    loadCoreScripts();
    loadScript('js/mascot.js');
    loadScript('js/chat_module.js');
    loadScript('js/onboarding_module.js');
    REAL.showOnboardingEgg = MascotModule.showOnboardingEgg;
});

beforeEach(() => {
    localStorage.clear();
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
    vi.spyOn(MascotModule, 'showOnboardingEgg');
    vi.spyOn(MascotModule, 'showNamingEgg');
});

afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.mascot-egg').forEach((el) => el.remove());
});

async function start(state, completeResult) {
    installApi(state, completeResult);
    ChatModule.init();
    await flush();
}

describe('揮手進場：綁在 onboarding 啟動', () => {
    it('全新開始：跟自我介紹訊息一起揮手一次，浮層在 body 上、不在聊天訊息區', async () => {
        let textAtWave = null;
        MascotModule.showOnboardingEgg.mockImplementation(function () {
            textAtWave = document.querySelector('.chat-messages').textContent;
            return REAL.showOnboardingEgg();
        });
        await start({ completed: false, answered_keys: [] });
        expect(MascotModule.showOnboardingEgg).toHaveBeenCalledTimes(1);
        expect(textAtWave).toContain(I18N.t('onboarding.intro'));   // 訊息已出現才揮手
        const egg = document.querySelector('.mascot-egg.mascot-egg-wave');
        expect(egg).not.toBeNull();
        expect(egg.parentNode).toBe(document.body);
        expect(egg.closest('.chat-messages')).toBeNull();
    });

    it('中斷續跑（已答過幾題）：同樣是 onboarding 啟動，揮手一次', async () => {
        await start({ completed: false, answered_keys: ['companion_naming', 'name'] });
        expect(MascotModule.showOnboardingEgg).toHaveBeenCalledTimes(1);
    });

    it('已完成的帳號：不啟動、不揮手', async () => {
        await start({ completed: true, answered_keys: [] });
        expect(MascotModule.showOnboardingEgg).not.toHaveBeenCalled();
    });
});

describe('換帳號（reset）之後遲到的腳本回呼', () => {
    it('reset 後才觸發的揮手回呼：不畫浮層（celebrate 先看 active）', async () => {
        ChatModule.setScriptDelayRange(30, 30);
        try {
            installApi({ completed: false, answered_keys: [] });
            ChatModule.init();
            await new Promise((r) => setTimeout(r, 5));   // 流程已啟動、腳本回呼還在假思考延遲裡
            expect(OnboardingModule.isActive()).toBe(true);
            OnboardingModule._test.reset();
            await new Promise((r) => setTimeout(r, 80));  // 回呼此時才觸發
            expect(MascotModule.showOnboardingEgg).not.toHaveBeenCalled();
            expect(document.querySelector('.mascot-egg')).toBeNull();
        } finally {
            ChatModule.setScriptDelayRange(0, 0);
        }
    });
});

describe('取名慶祝：綁在取名定案', () => {
    it('給了名字：namingAck 出現之後才慶祝，帶剝好的名字', async () => {
        await start({ completed: false, answered_keys: [] });
        let textAtCelebration = null;
        MascotModule.showNamingEgg.mockImplementation(function (name) {
            textAtCelebration = document.querySelector('.chat-messages').textContent;
            return null;
        });
        OnboardingModule.handleAnswer('我想叫你小樹洞');
        await flush();
        expect(MascotModule.showNamingEgg).toHaveBeenCalledTimes(1);
        expect(MascotModule.showNamingEgg).toHaveBeenCalledWith('小樹洞');
        expect(textAtCelebration).toContain(I18N.t('onboarding.namingAck', { name: '小樹洞' }));
    });

    it('說「隨便」：拿到預設名字，一樣慶祝（觸發只看「這一步定案」，不看說了什麼）', async () => {
        await start({ completed: false, answered_keys: [] });
        OnboardingModule.handleAnswer('隨便');
        await flush();
        expect(MascotModule.showNamingEgg).toHaveBeenCalledWith(I18N.t('onboarding.defaultName'));
    });

    it('名字帶負面字眼也照常慶祝：不做任何情緒判斷', async () => {
        await start({ completed: false, answered_keys: [] });
        OnboardingModule.handleAnswer('難過');
        await flush();
        expect(MascotModule.showNamingEgg).toHaveBeenCalledWith('難過');
    });

    it('名字太長（重問）與第二次仍太長（放棄）：都沒有名字定案，不慶祝', async () => {
        await start({ completed: false, answered_keys: [] });
        OnboardingModule.handleAnswer('這是一個超過十二個字的非常非常長的名字');
        await flush();
        expect(MascotModule.showNamingEgg).not.toHaveBeenCalled();
        OnboardingModule.handleAnswer('這也是一個超過十二個字的非常非常長的名字');
        await flush();
        expect(MascotModule.showNamingEgg).not.toHaveBeenCalled();
    });

    it('跳過取名、收束時後端判定了名字（更正句）：不補慶祝', async () => {
        await start({ completed: false, answered_keys: [] },
                    { completed: true, companion_name: '小澄', companion_name_note: null });
        OnboardingModule.handleSkip();
        await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        expect(document.querySelector('.chat-messages').textContent)
            .toContain(I18N.t('onboarding.nameCorrected', { name: '小澄' }));
        expect(MascotModule.showNamingEgg).not.toHaveBeenCalled();
    });
});

describe('浮層本身（MascotModule）', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('名牌用 textContent：名字裡的 HTML 原樣顯示、不會變成元素', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('<b>小澄</b>');
        const tag = document.querySelector('.mascot-egg-cheer .mascot-egg-name');
        expect(tag.textContent).toBe('<b>小澄</b>');
        expect(tag.querySelector('b')).toBeNull();
    });

    it('慶祝浮層：雙手高舉姿勢、不可點；1600ms 開始淡出、2200ms 移除', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('小澄');
        const egg = document.querySelector('.mascot-egg-cheer');
        const svg = egg.querySelector('svg');
        expect(svg.getAttribute('data-mm-pose')).toBe('cheer');
        expect(svg.querySelectorAll('.mm-arm-l').length).toBe(1);
        expect(svg.querySelectorAll('.mm-arm-r').length).toBe(1);
        expect(svg.hasAttribute('data-mm-tap')).toBe(false);
        vi.advanceTimersByTime(1600);
        expect(egg.classList.contains('fade')).toBe(true);
        vi.advanceTimersByTime(600);
        expect(document.querySelector('.mascot-egg-cheer')).toBeNull();
    });

    it('Review Focus：浮層整個 aria-hidden（報讀器不會脫離上下文唸出名牌）', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('小澄');
        expect(document.querySelector('.mascot-egg-cheer').getAttribute('aria-hidden')).toBe('true');
    });

    it('Review Focus：一次只留一個浮層——初次見面慶祝中又存了日記，新的取代舊的，不疊', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('小澄');
        MascotModule.showSaveEgg('happy');
        const eggs = document.querySelectorAll('.mascot-egg');
        expect(eggs.length).toBe(1);
        expect(eggs[0].classList.contains('mascot-egg-happy')).toBe(true);
        vi.advanceTimersByTime(3000);                 // 舊浮層的計時器對已移除節點無害
        expect(document.querySelectorAll('.mascot-egg').length).toBe(0);
    });

    it('揮手浮層：揮手姿勢、不可點、1600ms 淡出', () => {
        MascotModule.showOnboardingEgg.mockRestore();
        MascotModule.showOnboardingEgg();
        const egg = document.querySelector('.mascot-egg-wave');
        expect(egg.querySelector('svg').getAttribute('data-mm-pose')).toBe('wave');
        expect(egg.querySelector('svg').hasAttribute('data-mm-tap')).toBe(false);
        vi.advanceTimersByTime(1600);
        expect(egg.classList.contains('fade')).toBe(true);
    });
});
