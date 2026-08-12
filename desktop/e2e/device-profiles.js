/**
 * 兩個手機裝置描述（v2.3 task 3.2）—— playwright.config.js 的 `projects`
 * 與 urdiary.spec.js（手動建立 shared page 時）共用同一份定義，避免各自
 *維護一份容易漂移的複本。
 *
 * **為什麼兩個 project 都指定 browserName: 'chromium'**：這台機器上 WebKit
 * 缺系統依賴 (libavif16)，`npx playwright install webkit` 會印出需要
 * `sudo npx playwright install-deps` 才能修的警告（見 task-3.2-report.md）
 * ——不 sudo。`devices['iPhone 14']` 描述本身帶 `defaultBrowserType:
 * 'webkit'`，Playwright test runner 沒有明講 browserName 時真的會採用它
 * （node_modules/playwright/lib/index.js 的 browserName fixture 定義：
 * `[({ defaultBrowserType }, use) => use(defaultBrowserType), ...]`），
 * 所以這裡明確覆蓋成 chromium——兩個裝置都用 chromium 引擎、只借用
 * viewport/UA/touch 描述做行動裝置模擬，這正是 task brief 明確允許的退路
 * （"chromium is the floor"）。
 */
'use strict';

const { devices } = require('@playwright/test');

const IPHONE_14 = { ...devices['iPhone 14'], browserName: 'chromium' };
const PIXEL_7 = { ...devices['Pixel 7'], browserName: 'chromium' };

/**
 * 從裝置描述挑出 `browser.newContext()` 真正認得的欄位。
 *
 * 裝置描述（以及 project.use）裡還混著 browserName/defaultBrowserType 等
 * 「測試執行器專用」的選項，不是 BrowserContextOptions 的一部分——直接把
 * 整包丟給 newContext() 不保證安全，這裡明確白名單只挑視覺/互動相關的
 * 幾個欄位（urdiary.spec.js 手動建立 shared page 時使用；一般測試若改用
 * Playwright 內建的 `page`/`context` fixture，這個函式用不到，fixture 會
 * 自動讀 project.use）。
 */
function contextOptionsFor(deviceDescriptor) {
    const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = deviceDescriptor;
    return { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor };
}

module.exports = { IPHONE_14, PIXEL_7, contextOptionsFor };
