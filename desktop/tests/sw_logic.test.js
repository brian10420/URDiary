// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './helpers/load.js';

describe('sw_logic: classifyRequestPath', () => {
    beforeAll(() => {
        loadScript('js/sw_logic.js');
    });

    // v2.3 task 2.2 決策清單：這 14 個前綴一律 network-only，絕不快取。
    const API_PATHS = [
        '/users', '/users/1', '/users/1/sessions',
        '/chat', '/chat/',
        '/diaries', '/diaries/1',
        '/diary', '/diary/1',
        '/calendar', '/calendar/events',
        '/analytics', '/analytics/summary',
        '/interaction-notes', '/interaction-notes/1',
        '/generate',
        '/enhanced-generate',
        '/health',
        '/system', '/system/capabilities',
        '/docs',
        '/redoc',
        '/openapi.json'
    ];

    it.each(API_PATHS)('%s 分類為 network-only', (path) => {
        expect(window.SWLogic.classifyRequestPath(path)).toBe('network-only');
    });

    const SHELL_PATHS = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/favicon.ico',
        '/js/main.js',
        '/js/sw_logic.js',
        '/css/base.css',
        '/assets/icon.jpg',
        '/assets/icons/icon-192.png',
        '/assets/vendor/fonts/fonts.css',
        '/assets/vendor/fonts/noto-sans-tc-400.woff2',
        '/assets/vendor/fontawesome/fontawesome-subset.css'
    ];

    it.each(SHELL_PATHS)('%s 分類為 cache-first', (path) => {
        expect(window.SWLogic.classifyRequestPath(path)).toBe('cache-first');
    });

    it('/sw.js 本身不是殼層資源，分類為 network-only（伺服器已用 no-cache 提供，SW 自己也不該快取它）', () => {
        expect(window.SWLogic.classifyRequestPath('/sw.js')).toBe('network-only');
    });

    it('未知路徑預設 network-only（安全預設：不確定就不快取，不是不確定就快取）', () => {
        expect(window.SWLogic.classifyRequestPath('/some/unknown/route')).toBe('network-only');
        expect(window.SWLogic.classifyRequestPath('/robots.txt')).toBe('network-only');
    });

    it('邊界比對：/diary 與 /diaries 是清單裡兩個獨立項目，兩者及其子路徑都要分類正確', () => {
        expect(window.SWLogic.classifyRequestPath('/diary')).toBe('network-only');
        expect(window.SWLogic.classifyRequestPath('/diary/42')).toBe('network-only');
        expect(window.SWLogic.classifyRequestPath('/diaries')).toBe('network-only');
        expect(window.SWLogic.classifyRequestPath('/diaries/42')).toBe('network-only');
    });
});

describe('sw_logic: shouldPromptUpdate', () => {
    beforeAll(() => {
        loadScript('js/sw_logic.js');
    });

    it('installed + 已有 controller → 該提示（這是「更新」，舊版本正在服務中）', () => {
        expect(window.SWLogic.shouldPromptUpdate('installed', true)).toBe(true);
    });

    it('installed + 沒有 controller → 不提示（這是第一次安裝，不是更新）', () => {
        expect(window.SWLogic.shouldPromptUpdate('installed', false)).toBe(false);
    });

    it('installing 狀態尚未就緒 → 不提示', () => {
        expect(window.SWLogic.shouldPromptUpdate('installing', true)).toBe(false);
    });

    it('activated 狀態已經生效、不是「等待中的更新」→ 不提示', () => {
        expect(window.SWLogic.shouldPromptUpdate('activated', true)).toBe(false);
    });

    it('redundant/activating 等其他 state 一律不提示', () => {
        expect(window.SWLogic.shouldPromptUpdate('redundant', true)).toBe(false);
        expect(window.SWLogic.shouldPromptUpdate('activating', true)).toBe(false);
    });
});
