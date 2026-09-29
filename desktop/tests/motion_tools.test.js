// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 3：影格審查工具（desktop/tools/motion/）的兩個保證——
 *   (1) 不進 app shell：index.html 不引用、sw.js 的 SHELL_ASSETS 不列。
 *   (2) harness 的每個場景在 jsdom 都能同步 setup（壞掉的場景在 vitest 就抓到，
 *       不必等 Fable 跑 Playwright 才發現）。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), 'utf8');

describe('motion 工具不進 app shell', () => {
    it('index.html 沒有任何 tools/ 引用', () => {
        expect(read('index.html')).not.toMatch(/tools\//);
    });

    it('sw.js 的 SHELL_ASSETS 沒有 /tools/ 路徑', () => {
        const sw = read('sw.js');
        const block = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1];
        expect(block).not.toMatch(/\/tools\//);
    });

    it('harness.html 直接引用 App 的 js/css（../../），不複製第二份吉祥物來源', () => {
        const html = read('tools/motion/harness.html');
        expect(html).toContain('src="../../js/mascot.js"');
        expect(html).toContain('href="../../css/mascot.css"');
        expect(fs.existsSync(path.join(DESKTOP, 'tools/motion/mascot.js'))).toBe(false);
    });
});

describe('harness 場景在 jsdom 可同步 setup', () => {
    beforeAll(() => {
        loadScript('js/mascot.js');
        loadScript('tools/motion/harness.js');
    });
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="stage"></div>';
    });
    afterEach(() => { vi.useRealTimers(); });

    it('場景表非空，每個場景都有 viewport 與遞增的 frames', () => {
        const names = window.MotionHarness.list();
        expect(names.length).toBeGreaterThanOrEqual(4);
        for (const name of names) {
            const s = window.MotionHarness.SCENES[name];
            expect(s.viewport).toHaveLength(2);
            expect(s.frames.length).toBeGreaterThanOrEqual(2);
            expect([...s.frames].sort((a, b) => a - b)).toEqual(s.frames);
        }
    });

    it.each(['sway', 'thinking', 'egg-happy', 'egg-night'])('%s：setup 不拋錯且畫面上有吉祥物 SVG', (name) => {
        window.MotionHarness.setup(name);
        expect(document.querySelector('#stage svg, .mascot-egg svg')).not.toBeNull();
    });
});
