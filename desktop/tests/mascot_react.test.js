// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 6：點擊吉祥物的反應（彈跳＋開心臉＋小愛心）。
 * 契約 §4：這是「明確操作」觸發的彩蛋，只給登入歡迎與空狀態；聊天訊息區與彩蛋浮層裡
 * 的吉祥物永遠不反應；reduced-motion 下完全不動；同一隻 1.2 秒內只反應一次。
 */
function svgOf(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('svg');
}

describe('模板：誰可點、開心臉、愛心', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    it.each([
        ['welcome', () => MascotModule.welcomeHtml(), 0],
        ['empty-diary', () => MascotModule.emptyHtml('diary', 'x'), 1],
        ['empty-calendar', () => MascotModule.emptyHtml('calendar', 'x'), 1],
        ['empty-generic', () => MascotModule.emptyHtml('generic', 'x'), 1],
    ])('%s：帶 data-mm-tap；開心臉（隱藏的 .mm-face-alt）數量正確', (name, render, alts) => {
        const svg = svgOf(render());
        expect(svg.hasAttribute('data-mm-tap')).toBe(true);
        const alt = svg.querySelectorAll('.mm-face-alt');
        expect(alt.length).toBe(alts);
        if (alts) {
            expect(alt[0].getAttribute('visibility')).toBe('hidden');          // 靜止畫面不畫
            expect(alt[0].querySelector('.mm-eyes').getAttribute('data-mm-eyes')).toBe('happy');
            expect(svg.querySelectorAll('.mm-face-rest').length).toBe(1);      // CSS 反應時藏這張
        }
    });

    it.each([
        ['loading', () => MascotModule.loadingHtml(96)],
        ['thinking', () => MascotModule.thinkingBubbleHtml()],
        ['checkin', () => MascotModule.checkinHtml()],
    ])('聊天區域的 %s：不可點、沒有開心臉', (name, render) => {
        const svg = svgOf(render());
        expect(svg.hasAttribute('data-mm-tap')).toBe(false);
        expect(svg.querySelector('.mm-face-alt')).toBeNull();
    });

    it('愛心只用既有色票（#e8899a 粉紅＋#4b2e1e 描邊），動畫群組不帶 transform 屬性', () => {
        const html = MascotModule.reactionHeartSvg();
        const colors = html.match(/#[0-9a-fA-F]{6}/g);
        expect([...new Set(colors)].sort()).toEqual(['#4b2e1e', '#e8899a']);
        const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        host.innerHTML = html;
        expect(host.querySelector('[data-mm-heart]')).not.toBeNull();
        expect(host.querySelector('.mm-heart').hasAttribute('transform')).toBe(false);
    });
});

describe('MascotMotion.react＋點擊委派', () => {
    let reducedListeners;
    function setReduced(v) {
        window.matchMedia = vi.fn(() => ({
            matches: v,
            addEventListener: (t, fn) => reducedListeners.push(fn),
            removeEventListener: () => {},
        }));
    }
    beforeEach(() => {
        vi.useFakeTimers();
        reducedListeners = [];
        loadScript('js/mascot.js');
        loadScript('js/mascot_motion.js');
        document.body.innerHTML =
            `<div id="login">${MascotModule.welcomeHtml()}</div>` +
            `<div class="chat-messages"><div id="in-chat">${MascotModule.emptyHtml('calendar', 'x')}</div>` +
            `<div id="tea">${MascotModule.checkinHtml()}</div></div>` +
            `<div class="mascot-egg"><div id="in-egg">${MascotModule.welcomeHtml()}</div></div>`;
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete window.matchMedia;
        vi.useRealTimers();
    });

    const login = () => document.querySelector('#login svg');
    const clickOn = (svg) => svg.querySelector('.mm-body path').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    it('isTapAllowed：登入歡迎可以；聊天訊息區、彩蛋浮層、沒標 data-mm-tap 的都不行', () => {
        const allowed = MascotMotion._test.isTapAllowed;
        expect(allowed(login())).toBe(true);
        expect(allowed(document.querySelector('#in-chat svg'))).toBe(false);
        expect(allowed(document.querySelector('#in-egg svg'))).toBe(false);
        expect(allowed(document.querySelector('#tea svg'))).toBe(false);
    });

    it('點吉祥物任一部件：整隻加 mm-react、插入一顆愛心；900ms 後兩者都收掉', () => {
        MascotMotion.init();
        clickOn(login());
        expect(login().classList.contains('mm-react')).toBe(true);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(1);
        vi.advanceTimersByTime(899);
        expect(login().classList.contains('mm-react')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(login().classList.contains('mm-react')).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(0);
    });

    it('限流：1.2 秒內連點只反應一次，過了才再反應', () => {
        MascotMotion.init();
        expect(MascotMotion.react(login())).toBe(true);
        vi.advanceTimersByTime(500);
        expect(MascotMotion.react(login())).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(1);
        vi.advanceTimersByTime(600);                  // t=1100：上一輪已收掉，但仍在 1200ms 內
        expect(MascotMotion.react(login())).toBe(false);
        expect(login().classList.contains('mm-react')).toBe(false);
        vi.advanceTimersByTime(100);                  // t=1200
        expect(MascotMotion.react(login())).toBe(true);
    });

    it('聊天訊息區與彩蛋浮層裡的吉祥物：點了也不反應', () => {
        MascotMotion.init();
        clickOn(document.querySelector('#in-chat svg'));
        clickOn(document.querySelector('#in-egg svg'));
        clickOn(document.querySelector('#tea svg'));
        expect(document.querySelectorAll('.mm-react').length).toBe(0);
        expect(document.querySelectorAll('[data-mm-heart]').length).toBe(0);
    });

    it('reduced-motion：點了不動', () => {
        setReduced(true);
        MascotMotion.init();
        clickOn(login());
        expect(login().classList.contains('mm-react')).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(0);
    });

    it('反應進行中偏好改成 reduce：立刻拔掉 mm-react 與愛心', () => {
        setReduced(false);
        MascotMotion.init();
        clickOn(login());
        expect(login().classList.contains('mm-react')).toBe(true);
        reducedListeners.forEach((fn) => fn({ matches: true }));
        expect(login().classList.contains('mm-react')).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(0);
    });
});
