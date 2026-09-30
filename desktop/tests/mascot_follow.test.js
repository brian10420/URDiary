// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 7：登入頁眼睛跟隨（位移夾限、觸控看向點擊處再回正）＋揮手。
 * jsdom 量不到 SVG 幾何：getBBox／getScreenCTM 用替身，讓「臉中心」固定在螢幕 (500, 300)。
 */
const FACE = { x: 500, y: 300 };

function pointer(type, x, y, pointerType) {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    document.dispatchEvent(ev);
}

const t = (sel) => document.querySelector(`#login svg ${sel}`).style.transform;

describe('computeLookOffset（純函式）', () => {
    beforeEach(() => { loadScript('js/mascot_motion.js'); });
    const f = (to) => MascotMotion._test.computeLookOffset(FACE, to, 6, 240);

    it('遠處（超過 reach）：方向正確、長度夾在 6', () => {
        expect(f({ x: 2000, y: 300 })).toEqual({ x: 6, y: 0 });
        expect(f({ x: 500, y: -900 })).toEqual({ x: 0, y: -6 });
        const d = f({ x: -1000, y: 1800 });
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(6, 10);
        expect(d.x).toBeLessThan(0);
        expect(d.y).toBeGreaterThan(0);
    });

    it('reach 內線性縮小：距離 120（reach 一半）→ 長度 3', () => {
        const d = f({ x: 620, y: 300 });
        expect(d.x).toBeCloseTo(3, 10);
        expect(d.y).toBeCloseTo(0, 10);
    });

    it('游標就在臉上或輸入非有限值：不動', () => {
        expect(f({ x: 500.2, y: 300.1 })).toEqual({ x: 0, y: 0 });
        expect(f({ x: NaN, y: 300 })).toEqual({ x: 0, y: 0 });
    });

    it('任何方向、任何距離都不超過上限（網格掃描）', () => {
        for (let x = -3000; x <= 3000; x += 250) {
            for (let y = -3000; y <= 3000; y += 250) {
                const d = f({ x, y });
                expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(6 + 1e-9);
            }
        }
    });
});

describe('跟隨的 DOM 接線', () => {
    let reducedListeners;
    beforeEach(() => {
        vi.useFakeTimers();
        reducedListeners = [];
        Element.prototype.checkVisibility = function () { return true; };
        // 眼睛群組中心 = (500, 300)：bbox 中心 (100, 50)、父層矩陣位移 (400, 250)
        window.SVGElement.prototype.getBBox = function () { return { x: 90, y: 45, width: 20, height: 10 }; };
        window.SVGElement.prototype.getScreenCTM = function () { return { a: 1, b: 0, c: 0, d: 1, e: 400, f: 250 }; };
        loadScript('js/mascot.js');
        loadScript('js/mascot_motion.js');
        document.body.innerHTML =
            `<div id="login">${MascotModule.welcomeHtml()}</div>` +
            `<div id="empty">${MascotModule.emptyHtml('calendar', 'x')}</div>`;
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete Element.prototype.checkVisibility;
        delete window.SVGElement.prototype.getBBox;
        delete window.SVGElement.prototype.getScreenCTM;
        delete window.matchMedia;
        vi.useRealTimers();
    });

    it('只有登入歡迎帶 data-mm-follow', () => {
        expect(document.querySelector('#login svg').hasAttribute('data-mm-follow')).toBe(true);
        expect(document.querySelector('#empty svg').hasAttribute('data-mm-follow')).toBe(false);
    });

    it('滑鼠：pointermove 合併到下一個畫格才算；眼睛到上限、嘴與腮紅跟一半', () => {
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'mouse');
        expect(t('.mm-face .mm-eyes')).toBe('');          // 還沒到 rAF
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('translate(6.00px, 0.00px)');
        expect(t('.mm-face .mm-mouth')).toBe('translate(3.00px, 0.00px)');
        expect(t('.mm-blush')).toBe('translate(3.00px, 0.00px)');
        expect(document.querySelector('#empty svg .mm-eyes').style.transform).toBe('');   // 非跟隨吉祥物不動
    });

    it('觸控：pointerdown 立刻看向點擊處，700ms 後回正並帶 mm-settle', () => {
        MascotMotion.init();
        pointer('pointerdown', 500, -2000, 'touch');
        expect(t('.mm-face .mm-eyes')).toBe('translate(0.00px, -6.00px)');
        vi.advanceTimersByTime(699);
        expect(t('.mm-face .mm-eyes')).toBe('translate(0.00px, -6.00px)');
        vi.advanceTimersByTime(1);
        expect(t('.mm-face .mm-eyes')).toBe('');
        expect(document.querySelector('#login svg').classList.contains('mm-settle')).toBe(true);
    });

    it('觸控的 pointermove 不觸發滑鼠式跟隨（手指拖曳時不亂轉）', () => {
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'touch');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('');
    });

    it('不在畫面上的登入吉祥物（對話框關著）不動', () => {
        document.querySelector('#login svg').checkVisibility = () => false;
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'mouse');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('');
    });

    it('reduced-motion：不跟隨；跟隨中切成 reduce 立刻回正', () => {
        let reduce = false;
        window.matchMedia = vi.fn(() => ({ get matches() { return reduce; },
            addEventListener: (type, fn) => reducedListeners.push(fn), removeEventListener: () => {} }));
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'mouse');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('translate(6.00px, 0.00px)');
        reduce = true;
        reducedListeners.forEach((fn) => fn({ matches: true }));
        expect(t('.mm-face .mm-eyes')).toBe('');
        pointer('pointermove', 0, 300, 'mouse');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('');
        pointer('pointerdown', 0, 300, 'touch');
        expect(t('.mm-face .mm-eyes')).toBe('');
    });
});
