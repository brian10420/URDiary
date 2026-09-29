// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 4：MascotMotion 核心——純函式（眨眼間隔、限流、排程器）＋
 * DOM 層（reduced-motion 監看、分頁隱藏暫停、只對「在畫面上」的待機吉祥物動作）。
 * jsdom 沒有 matchMedia／checkVisibility，測試各自補上可控的替身。
 */

/** 可控的 prefers-reduced-motion 替身：set(v) 會像瀏覽器一樣發 change。 */
function stubReducedMotion(initial) {
    const listeners = [];
    const mql = {
        matches: initial,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: (type, fn) => listeners.push(fn),
        removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    };
    window.matchMedia = vi.fn(() => mql);
    return { set(v) { mql.matches = v; listeners.slice().forEach((fn) => fn({ matches: v })); } };
}

let hiddenFlag = false;
function setHidden(v) {
    hiddenFlag = v;
    document.dispatchEvent(new Event('visibilitychange'));
}

/** 一隻「待機、睜眼」的吉祥物替身（結構同 mascot.js rig：svg[data-mm-idle] > .mm-face > .mm-eyes[data-mm-eyes]）。 */
function idleSvg(eyes = 'dot') {
    const host = document.createElement('div');
    host.innerHTML = `<svg data-mm-idle viewBox="0 0 220 200"><g class="mm-rig"><g class="mm-face">` +
        `<g class="mm-eyes" data-mm-eyes="${eyes}"><circle cx="1" cy="1" r="1"/></g></g></g></svg>`;
    document.body.appendChild(host);
    return host.firstElementChild;
}

describe('純函式', () => {
    beforeEach(() => { loadScript('js/mascot_motion.js'); });

    it('nextBlinkDelay：rand 0→3000、0.5→5000、趨近 1→<7000，越界夾住', () => {
        const f = MascotMotion._test.nextBlinkDelay;
        expect(f(0)).toBe(3000);
        expect(f(0.5)).toBe(5000);
        expect(f(0.9999)).toBeLessThan(7000);
        expect(f(0.9999)).toBeGreaterThanOrEqual(6999);
        expect(f(-3)).toBe(3000);
        expect(f(5)).toBe(7000);
        expect(f(NaN)).toBe(3000);
    });

    it('createRateLimiter：同一 key 間隔內擋下、過了間隔放行；不同 key 互不影響', () => {
        const limiter = MascotMotion._test.createRateLimiter(1200);
        const a = {}; const b = {};
        expect(limiter.tryAcquire(a, 0)).toBe(true);
        expect(limiter.tryAcquire(a, 1199)).toBe(false);
        expect(limiter.tryAcquire(b, 500)).toBe(true);
        expect(limiter.tryAcquire(a, 1200)).toBe(true);
        expect(limiter.tryAcquire(a, 1300)).toBe(false);   // 放行後重新起算
    });
});

describe('createIdleScheduler（注入依賴＋假計時器）', () => {
    let blink, collect, hidden, reduced, rand, sched;
    beforeEach(() => {
        vi.useFakeTimers();
        loadScript('js/mascot_motion.js');
        blink = vi.fn();
        collect = vi.fn(() => ['A', 'B']);
        hidden = false; reduced = false; rand = 0;
        sched = MascotMotion._test.createIdleScheduler({
            setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id),
            random: () => rand, collect, blink,
            isHidden: () => hidden, isReduced: () => reduced,
        });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('3 秒前不眨、到點對每隻各眨一次（錯開 0–400ms），並排下一輪', () => {
        sched.start();
        vi.advanceTimersByTime(2999);
        expect(blink).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(blink).toHaveBeenCalledTimes(2);
        expect(blink.mock.calls.map((c) => c[0])).toEqual(['A', 'B']);
        blink.mock.calls.forEach((c) => { expect(c[1]).toBeGreaterThanOrEqual(0); expect(c[1]).toBeLessThanOrEqual(400); });
        expect(sched.isRunning()).toBe(true);
        vi.advanceTimersByTime(3000);
        expect(blink).toHaveBeenCalledTimes(4);
    });

    it('rand 趨近 1：間隔拉到將近 7 秒', () => {
        rand = 0.9999;
        sched.start();
        vi.advanceTimersByTime(6990);
        expect(blink).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10);
        expect(blink).toHaveBeenCalled();
    });

    it('全頁只有一個計時器：重複 start 不會疊出第二個', () => {
        sched.start(); sched.start(); sched.start();
        vi.advanceTimersByTime(3000);
        expect(blink).toHaveBeenCalledTimes(2);   // 還是一輪（兩隻各一次），不是三輪
    });

    it('沒有吉祥物在畫面上：不眨但照常排下一輪（新出現的吉祥物下一輪就接得上）', () => {
        collect.mockReturnValue([]);
        sched.start();
        vi.advanceTimersByTime(3000);
        expect(blink).not.toHaveBeenCalled();
        expect(sched.isRunning()).toBe(true);
    });

    it('stop 之後不再眨', () => {
        sched.start();
        sched.stop();
        vi.advanceTimersByTime(20000);
        expect(blink).not.toHaveBeenCalled();
        expect(sched.isRunning()).toBe(false);
    });

    it('分頁隱藏或 reduced-motion：start 不排計時器', () => {
        hidden = true;
        sched.start();
        expect(sched.isRunning()).toBe(false);
        hidden = false; reduced = true;
        sched.start();
        expect(sched.isRunning()).toBe(false);
        vi.advanceTimersByTime(20000);
        expect(blink).not.toHaveBeenCalled();
    });
});

describe('DOM 層：init／reduced-motion／分頁可見度', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);   // 固定 3000ms 一輪、錯開 0ms
        hiddenFlag = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenFlag });
        // jsdom 沒有 checkVisibility：預設「在畫面上」，個別測試再覆寫
        Element.prototype.checkVisibility = function () { return true; };
        document.body.innerHTML = '';
        loadScript('js/mascot_motion.js');
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete window.matchMedia;
        delete Element.prototype.checkVisibility;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('init 冪等：呼叫兩次仍只有一個排程器，一輪只眨一次', () => {
        const svg = idleSvg();
        const spy = vi.spyOn(svg.classList, 'add');
        MascotMotion.init();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(spy.mock.calls.filter((c) => c[0] === 'mm-blink')).toHaveLength(1);
        expect(svg.classList.contains('mm-blink')).toBe(true);
        expect(svg.style.getPropertyValue('--mm-blink-delay')).toBe('0ms');
    });

    it('只眨「在畫面上、睜眼」的待機吉祥物：隱藏的、閉眼的、已移除的都不動', () => {
        const shown = idleSvg('dot');
        const closed = idleSvg('closed');
        const invisible = idleSvg('dot');
        invisible.checkVisibility = () => false;
        const detached = idleSvg('dot');
        detached.parentNode.remove();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(shown.classList.contains('mm-blink')).toBe(true);
        expect(closed.classList.contains('mm-blink')).toBe(false);
        expect(invisible.classList.contains('mm-blink')).toBe(false);
        expect(detached.classList.contains('mm-blink')).toBe(false);
    });

    it('沒有 matchMedia 的環境：isReducedMotion() 為 false、照常運作不拋錯', () => {
        delete window.matchMedia;
        expect(() => MascotMotion.init()).not.toThrow();
        expect(MascotMotion.isReducedMotion()).toBe(false);
        expect(MascotMotion._test.schedulerRunning()).toBe(true);
    });

    it('一開始就 reduced：排程器不啟動、blink() 也不加 class', () => {
        stubReducedMotion(true);
        const svg = idleSvg();
        MascotMotion.init();
        expect(MascotMotion.isReducedMotion()).toBe(true);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        MascotMotion.blink(svg, 0);
        vi.advanceTimersByTime(20000);
        expect(svg.classList.contains('mm-blink')).toBe(false);
    });

    it('偏好即時切換：開 reduce → 停排程並拔掉 mm-blink；關掉 → 恢復', () => {
        const media = stubReducedMotion(false);
        const svg = idleSvg();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(svg.classList.contains('mm-blink')).toBe(true);
        media.set(true);
        expect(MascotMotion.isReducedMotion()).toBe(true);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        expect(svg.classList.contains('mm-blink')).toBe(false);
        media.set(false);
        expect(MascotMotion._test.schedulerRunning()).toBe(true);
    });

    it('分頁隱藏：停排程、html 加 mm-paused；回來：恢復、拔 mm-paused', () => {
        const svg = idleSvg();
        MascotMotion.init();
        setHidden(true);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        expect(document.documentElement.classList.contains('mm-paused')).toBe(true);
        vi.advanceTimersByTime(30000);
        expect(svg.classList.contains('mm-blink')).toBe(false);
        setHidden(false);
        expect(document.documentElement.classList.contains('mm-paused')).toBe(false);
        vi.advanceTimersByTime(3000);
        expect(svg.classList.contains('mm-blink')).toBe(true);
    });
});

describe('DOM 層：補強（fix round 1）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        hiddenFlag = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenFlag });
        Element.prototype.checkVisibility = function () { return true; };
        document.body.innerHTML = '';
        loadScript('js/mascot_motion.js');
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete window.matchMedia;
        delete Element.prototype.checkVisibility;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    function animEnd(target, name) {
        const ev = new Event('animationend', { bubbles: true });
        ev.animationName = name;
        target.dispatchEvent(ev);
    }

    it('眨眼動畫結束（animationend mm-blink，自 .mm-eyes 冒泡）後拔掉 mm-blink；別的動畫結束不誤拔', () => {
        const svg = idleSvg();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(svg.classList.contains('mm-blink')).toBe(true);
        animEnd(svg, 'mm-bounce');
        expect(svg.classList.contains('mm-blink')).toBe(true);
        animEnd(svg.querySelector('.mm-eyes'), 'mm-blink');
        expect(svg.classList.contains('mm-blink')).toBe(false);
    });

    it('沒有 checkVisibility：改用 getClientRects() 判斷是否在畫面上', () => {
        delete Element.prototype.checkVisibility;
        const shown = idleSvg();
        const hiddenOne = idleSvg();
        shown.getClientRects = () => [{}];
        hiddenOne.getClientRects = () => [];
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(shown.classList.contains('mm-blink')).toBe(true);
        expect(hiddenOne.classList.contains('mm-blink')).toBe(false);
    });

    it('分頁隱藏時關掉 reduced-motion：排程器維持停止，直到分頁可見', () => {
        const media = stubReducedMotion(true);
        const svg = idleSvg();
        MascotMotion.init();
        setHidden(true);
        media.set(false);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        vi.advanceTimersByTime(30000);
        expect(svg.classList.contains('mm-blink')).toBe(false);
        setHidden(false);
        expect(MascotMotion._test.schedulerRunning()).toBe(true);
    });

    it('排程器重入保護：即使內部 schedule 被再叫也只有一個計時器（clearTimer 一次就全停）', () => {
        vi.useFakeTimers();
        const timers = [];
        const sched = MascotMotion._test.createIdleScheduler({
            setTimer: (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; },
            clearTimer: (id) => clearTimeout(id),
            random: () => 0, collect: () => [], blink: () => {},
            isHidden: () => false, isReduced: () => false,
        });
        sched.start(); sched.start();
        expect(timers).toHaveLength(1);
        sched.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('接線（house rule：呼叫端 typeof 守衛）', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

    it('main.js 以 typeof 守衛呼叫 MascotMotion.init()', () => {
        const src = read('js/main.js');
        expect(src).toMatch(/typeof MascotMotion !== 'undefined'[^\n]*\n?[^\n]*MascotMotion\.init\(\)/);
    });

    it('index.html 在 mascot.js 之後、ui_manager.js 之前載入 mascot_motion.js', () => {
        const html = read('index.html');
        const iMascot = html.indexOf('src="js/mascot.js"');
        const iMotion = html.indexOf('src="js/mascot_motion.js"');
        const iUi = html.indexOf('src="js/ui_manager.js"');
        expect(iMotion).toBeGreaterThan(iMascot);
        expect(iMotion).toBeLessThan(iUi);
    });
});
