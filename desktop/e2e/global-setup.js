/**
 * Playwright globalSetup（v2.3 task 3.2）。
 *
 * **這裡不是防線本身**（v2.3 task 3.2 code review 修復——原本以為是，
 * 詳見 e2e-env.js 檔頭引用的 Playwright 原始碼與任務順序）：webServer
 * plugin 的 setup()（spawn uvicorn、等 /health 回 200）排在 Playwright
 * 的任務佇列裡，比這個檔案（自訂的 globalSetup）更早執行。等這裡真的
 * 跑起來的時候，uvicorn 早就已經用 DATA_DIR 開好了。
 *
 * 真正的防線在 e2e-env.js 的 module load 階段（`assertDataDirIsSafe()`
 * 在算出 DATA_DIR 後立刻同步呼叫，任何違規會讓 `require('./e2e-env')`
 * 直接拋出，playwright.config.js 連 webServer 設定都建構不完整，
 * Playwright 也就沒有機會把 webServer plugin 排進任務佇列）。
 *
 * 這裡改成單純的事後複查（呼叫同一個 assertDataDirIsSafe()，理論上不會
 * 再拋出——不依賴它才安全）+ 印出路徑，純粹是給人看的可視性（
 * `npx playwright test` 的輸出、task-3.2-report.md 都會引用這行），
 * 不是安全機制。
 */
'use strict';

const fs = require('fs');
const { DATA_DIR, REPO_ROOT, assertDataDirIsSafe } = require('./e2e-env');

module.exports = async function globalSetup() {
    // 事後複查：e2e-env.js 的 module load 已經檢查過一次，這裡理論上
    // 不可能再拋出。保留是防禦性的第二次確認，不是防線本身。
    assertDataDirIsSafe(DATA_DIR, REPO_ROOT);

    if (!fs.existsSync(DATA_DIR)) {
        throw new Error(`E2E data dir vanished before tests started: ${DATA_DIR}`);
    }

    // 供人工檢視：`npx playwright test` 的輸出與 task-3.2-report.md 都會引用這行。
    console.log(`[urdiary-e2e] isolated URDIARY_DATA_DIR = ${DATA_DIR}`);
};
