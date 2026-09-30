// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 8：存日記彩蛋升級（翻頁＋書籤飄動＋金星依序亮）。
 * 不變的硬規則：quiet（valence<0.45）沒有彩蛋、夜間版照舊、1.2 秒開始淡出 1.8 秒移除、
 * 浮層 pointer-events:none 不擋操作；翻頁紙在靜止畫面不畫（opacity="0"）。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('存日記彩蛋', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        loadScript('js/mascot.js');
    });
    afterEach(() => { vi.useRealTimers(); });

    it('開心版：兩張翻頁紙（靜止不畫）、書籤在、只用書頁色＋描邊色', () => {
        MascotModule.showSaveEgg('happy');
        const egg = document.querySelector('.mascot-egg');
        expect(egg.classList.contains('mascot-egg-happy')).toBe(true);    // 翻頁 CSS 只認這個 class
        expect(egg.classList.contains('mascot-egg-night')).toBe(false);
        const pages = egg.querySelectorAll('.mm-flip .mm-flip-page');
        expect(pages.length).toBe(2);
        pages.forEach((p) => {
            expect(p.getAttribute('opacity')).toBe('0');
            expect(p.getAttribute('fill')).toBe('#f9f3e6');
            expect(p.getAttribute('stroke')).toBe('#4b2e1e');
            expect(p.hasAttribute('transform')).toBe(false);   // CSS 翻頁動畫才掛得上
        });
        expect(egg.querySelector('.mm-bookmark')).not.toBeNull();
    });

    it('晚安版：照舊（沒有翻頁紙）', () => {
        MascotModule.showSaveEgg('goodnight');
        const egg = document.querySelector('.mascot-egg.mascot-egg-night');
        expect(egg).not.toBeNull();
        expect(egg.querySelector('.mm-flip-page')).toBeNull();
    });

    it('quiet：沒有彩蛋', () => {
        MascotModule.showSaveEgg('quiet');
        expect(document.querySelector('.mascot-egg')).toBeNull();
    });

    it('時間軸不變：1200ms 加 fade、1800ms 移除', () => {
        MascotModule.showSaveEgg('happy');
        const egg = document.querySelector('.mascot-egg');
        vi.advanceTimersByTime(1199);
        expect(egg.classList.contains('fade')).toBe(false);
        vi.advanceTimersByTime(1);
        expect(egg.classList.contains('fade')).toBe(true);
        vi.advanceTimersByTime(600);
        expect(document.querySelector('.mascot-egg')).toBeNull();
    });

    it('浮層永不擋操作：mascot.css 的 .mascot-egg 帶 pointer-events: none', () => {
        const css = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'mascot.css'), 'utf8');
        const rule = css.match(/\.mascot-egg\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/pointer-events:\s*none/);
    });
});
