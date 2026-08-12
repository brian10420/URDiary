/**
 * Playwright 設定（v2.3 task 3.2：手機 E2E）。
 *
 * 這份設定會啟動一個**完全隔離**的後端做為 webServer：獨立埠號 (8123，
 * 不碰 owner 手動跑著的 8001 --reload dev server)、獨立的暫存資料目錄
 * (URDIARY_DATA_DIR，e2e-env.js 用 mkdtempSync 產生，物理上不可能等於/
 * 位於 repo 的 data/ 之下)、env-gated 的 stub LLM 供應商 (task 3.2 新增，
 * 見 backend/app/providers/stub_provider.py) 讓整條對話→日記管線不需要
 * 真實 API Key 也能決定性地跑完。
 *
 * globalSetup 會在啟動 webServer 前再驗一次資料目錄的安全性
 * （global-setup.js），globalTeardown 在整個執行結束後清掉暫存目錄
 * （global-teardown.js）。
 */
'use strict';

const { defineConfig } = require('@playwright/test');
const {
    PORT, HOST, BASE_URL, DATA_DIR, BACKEND_APP_DIR, VENV_PYTHON,
} = require('./e2e/e2e-env');
const { IPHONE_14, PIXEL_7 } = require('./e2e/device-profiles');

module.exports = defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.js',
    outputDir: './e2e/test-results',

    // 三個階段都吃同一支隔離後端，測試之間有意共用登入狀態（見
    // urdiary.spec.js 檔頭說明），不能被打散到不同 worker 並行執行。
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,

    // 曾在除錯過程中一度把這裡設成 workers: 1（懷疑是兩個 project 併發
    // 打同一支後端造成的競態）。追下去後發現真正的原因跟並行與否無關：
    // 是 urdiary.spec.js 「結束對話」流程裡的斷言寫法問題（見該檔案的
    // 說明——曾經用 .chat-message 元素「數量」判斷送出完成，但「思考中」
    // 佔位氣泡也算進同一個數量，導致斷言在真正回覆送達前就提早滿足）。
    // 修好之後兩個 project 並行跑也一樣穩定（多次重跑驗證），因此維持
    // Playwright 預設的並行行為，不再人為限制成 1。

    reporter: [
        ['list'],
        ['html', { outputFolder: './e2e/playwright-report', open: 'never' }],
    ],

    // 啟動閉環 App 較慢的第一次 splash/登入對話框 (main.js 有 ~1.8s 的
    // setTimeout 鏈) 在較慢的環境下需要更寬裕的預設等待時間。
    expect: { timeout: 10000 },

    use: {
        baseURL: BASE_URL,
        actionTimeout: 10000,
        navigationTimeout: 15000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },

    projects: [
        { name: 'iPhone 14', use: { ...IPHONE_14 } },
        { name: 'Pixel 7', use: { ...PIXEL_7 } },
    ],

    globalSetup: require.resolve('./e2e/global-setup.js'),
    globalTeardown: require.resolve('./e2e/global-teardown.js'),

    // 隔離後端：見本檔案檔頭與 e2e-env.js/global-setup.js 的說明。
    webServer: {
        command: [
            JSON.stringify(VENV_PYTHON), '-m', 'uvicorn', 'main:app',
            '--host', HOST, '--port', String(PORT),
        ].join(' '),
        cwd: BACKEND_APP_DIR,
        url: `${BASE_URL}/health`,
        timeout: 60000,
        // 絕不重用「剛好已經在監聽這個埠號」的既有行程——每次執行都要是
        // 全新、乾淨的行程 + 全新的暫存資料目錄。
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            URDIARY_DATA_DIR: DATA_DIR,
            URDIARY_ALLOW_STUB_LLM: '1',
            URDIARY_RATE_LIMIT_ENABLED: '0',
            URDIARY_REQUIRE_INVITE: '0',
            ENV: 'development',
            // 防禦性覆蓋：backend/.env 的 XAI_API_KEY 目前是註解掉的
            // （已確認），但明確蓋成空字串，讓 llm.default_config() 的
            // stub 後備行為不會受呼叫端 shell 環境是否剛好 export 過
            // XAI_API_KEY 影響——E2E 的決定性不該依賴「這台機器的環境
            // 變數剛好乾淨」這個前提。
            XAI_API_KEY: '',
        },
    },
});
