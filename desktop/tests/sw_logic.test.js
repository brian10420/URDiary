// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './helpers/load.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
        '/manifest.webmanifest',
        '/favicon.ico',
        '/js/main.js',
        '/js/sw_logic.js',
        '/js/mascot.js',
        '/css/base.css',
        '/css/mascot.css',
        '/assets/icon.jpg',
        '/assets/icons/icon-192.png',
        '/assets/vendor/fonts/fonts.css',
        '/assets/vendor/fonts/noto-sans-tc-400.woff2',
        '/assets/vendor/fontawesome/fontawesome-subset.css'
    ];

    it.each(SHELL_PATHS)('%s 分類為 cache-first', (path) => {
        expect(window.SWLogic.classifyRequestPath(path)).toBe('cache-first');
    });

    // fix log（見 task-2.2-report.md）：main.py 只註冊 '/' 這個路由，沒有
    // '/index.html'；曾經誤把它跟 '/' 並列在 shell 清單裡，讓 sw.js 的
    // cache.addAll() 因為這一個 404 整批失敗，service worker 從未真正
    // 安裝成功過。這裡鎖住「/index.html 不是殼層路徑」，避免有人日後又
    // 把它加回去。
    it('/index.html 不是真實路由（backend 只有 "/"），不分類為 cache-first', () => {
        expect(window.SWLogic.classifyRequestPath('/index.html')).toBe('network-only');
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

describe('sw_logic: createControllerChangeReloadArmer（code review 修復：見 task-2.2-report.md fix log）', () => {
    beforeAll(() => {
        loadScript('js/sw_logic.js');
    });

    // sw.js 的 activate 會無條件呼叫 clients.claim()（見 sw.js 檔頭/activate
    // 註解）。對「第一次安裝」來說，這是正常、非破壞性的行為：目前開著的分頁
    // controller 從 null 變成新 worker，會觸發一次 controllerchange——但這
    // 不是使用者同意更新。這裡要鎖住的正是「沒有人呼叫 arm() 之前，這種
    // 背景事件絕對不能造成 reload」。
    it('沒有呼叫 arm()（等同使用者從未按下更新提示的按鈕）時，controllerchange 不會觸發 reload', () => {
        const container = new EventTarget();
        let reloadCount = 0;
        window.SWLogic.createControllerChangeReloadArmer(container, () => { reloadCount += 1; });

        container.dispatchEvent(new Event('controllerchange'));

        expect(reloadCount).toBe(0);
    });

    it('呼叫 arm()（等同使用者按下更新提示的動作鈕）之後，下一次 controllerchange 觸發恰好一次 reload', () => {
        const container = new EventTarget();
        let reloadCount = 0;
        const armer = window.SWLogic.createControllerChangeReloadArmer(container, () => { reloadCount += 1; });

        armer.arm();
        container.dispatchEvent(new Event('controllerchange'));

        expect(reloadCount).toBe(1);
    });

    it('arm() 之後 controllerchange 觸發多次，reload 仍然只發生一次（雙重保險，不因任何極端情況重複整理）', () => {
        const container = new EventTarget();
        let reloadCount = 0;
        const armer = window.SWLogic.createControllerChangeReloadArmer(container, () => { reloadCount += 1; });

        armer.arm();
        container.dispatchEvent(new Event('controllerchange'));
        container.dispatchEvent(new Event('controllerchange'));

        expect(reloadCount).toBe(1);
    });

    it('重複呼叫 arm() 不會疊加監聽器（不會讓單一次 controllerchange 觸發多次 reload）', () => {
        const container = new EventTarget();
        let reloadCount = 0;
        const armer = window.SWLogic.createControllerChangeReloadArmer(container, () => { reloadCount += 1; });

        armer.arm();
        armer.arm();
        armer.arm();
        container.dispatchEvent(new Event('controllerchange'));

        expect(reloadCount).toBe(1);
    });
});

describe('SHELL_ASSETS 同步檢查：index.html 載入的所有本地 CSS/JS 必須在 sw.js 的 SHELL_ASSETS 中', () => {
    it('index.html 的每個 <link href="css/*.css"> 與 <script src="js/*.js"> 都在 sw.js 的 SHELL_ASSETS 清單裡', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        // 讀取 index.html
        const indexPath = path.resolve(__dirname, '..', 'index.html');
        const indexContent = fs.readFileSync(indexPath, 'utf-8');

        // 讀取 sw.js
        const swPath = path.resolve(__dirname, '..', 'sw.js');
        const swContent = fs.readFileSync(swPath, 'utf-8');

        // 從 index.html 提取本地 CSS 與 JS（只取 href="css/" 與 src="js/" 的相對路徑）
        const cssRegex = /href="(css\/[^"]+)"/g;
        const jsRegex = /src="(js\/[^"]+)"/g;

        const cssFiles = [];
        const jsFiles = [];

        let match;
        while ((match = cssRegex.exec(indexContent)) !== null) {
            cssFiles.push(match[1]);
        }
        while ((match = jsRegex.exec(indexContent)) !== null) {
            jsFiles.push(match[1]);
        }

        // 防止迴歸測試空轉：確保提取的檔案清單非空
        // 如果標籤格式改變（單引號、絕對路徑等），正則會默默失配零個元素，
        // 迴圈零次迭代，測試仍會綠燈但實際檢查零東西——這裡鎖住該陷阱
        expect(cssFiles.length).toBeGreaterThan(0);
        expect(jsFiles.length).toBeGreaterThan(0);

        // 從 sw.js 的 SHELL_ASSETS 提取路徑
        const shellAssetsMatch = swContent.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
        expect(shellAssetsMatch).toBeTruthy();

        const shellAssetsStr = shellAssetsMatch[1];
        const shellPaths = new Set();

        // 提取 SHELL_ASSETS 中的所有字串（'...' 格式）
        const pathRegex = /'([^']+)'/g;
        let pathMatch;
        while ((pathMatch = pathRegex.exec(shellAssetsStr)) !== null) {
            shellPaths.add(pathMatch[1]);
        }

        // 驗證每個 CSS 檔案都在 SHELL_ASSETS 中
        for (const cssFile of cssFiles) {
            const shellKey = `/${cssFile}`;
            expect(
                shellPaths.has(shellKey),
                `CSS 檔案 ${cssFile} 在 index.html 中但未在 sw.js 的 SHELL_ASSETS 中發現`
            ).toBe(true);
        }

        // 驗證每個 JS 檔案都在 SHELL_ASSETS 中
        for (const jsFile of jsFiles) {
            const shellKey = `/${jsFile}`;
            expect(
                shellPaths.has(shellKey),
                `JS 檔案 ${jsFile} 在 index.html 中但未在 sw.js 的 SHELL_ASSETS 中發現`
            ).toBe(true);
        }
    });
});
