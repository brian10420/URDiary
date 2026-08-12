/**
 * 單一事實來源：E2E 後端要用的隔離資料目錄與埠號（v2.3 task 3.2）。
 *
 * playwright.config.js / global-setup.js / global-teardown.js 三個檔案都
 * `require('./e2e-env')`——Node 的 module cache 保證同一個 process 內
 * `fs.mkdtempSync` 只會真的執行一次，三邊 require 到的都是同一個路徑
 * 字串，不需要另外靠檔案或環境變數在彼此之間傳遞。
 *
 * ---------------------------------------------------------------------
 * **這個檔案的 module load 當下，才是真正防止誤用真實 data/ 的防線**
 * （v2.3 task 3.2 code review 修復：原本以為 global-setup.js 的檢查會
 * 「在 webServer 啟動前」執行，實際去讀 Playwright 1.61 的原始碼才發現
 * 不是這樣）。
 *
 * node_modules/playwright/lib/runner/index.js 的 createGlobalSetupTasks()：
 *
 *     return [
 *       createRemoveOutputDirsTask(),
 *       ...createPluginSetupTasks(config2),        // ← webServer 在這裡
 *       ...config2.globalTeardowns...,
 *       ...config2.globalSetups.map(...)            // ← global-setup.js 在這裡
 *     ];
 *
 * `webServer` 設定會被 `webServerPluginsForConfig()` 轉成一個
 * `WebServerPlugin`、push 進 `config.plugins`（見同檔案 962-976 行、
 * 6450/6494 行），而 `createPluginSetupTasks()` 會呼叫每個 plugin 的
 * `setup()`——`WebServerPlugin.setup()`（793-811 行）正是 spawn uvicorn
 * (`_startProcess()`) 並等到 `/health` 回 200 (`_waitForProcess()`) 的
 * 地方。這一整個階段排在陣列的第 2 項，自訂的 `globalSetups`（我們的
 * global-setup.js）排在第 4 項、最後才跑。
 *
 * 換句話說：等 global-setup.js 執行的時候，uvicorn 早就已經用 DATA_DIR
 * 開好了——config.py import 當下的副作用（mkdir DATA_DIR、讀/寫
 * secrets.json）也早就發生過。放在那裡的檢查只是「跑得比人眼看到結果
 * 早」，不是「跑在伺服器有機會碰到這個路徑之前」，對「未來有人把 DATA_DIR
 * 改成從環境變數讀、不小心指到真正的 data/」這種情境完全無法預防。
 *
 * 真正能在 uvicorn 有機會使用 DATA_DIR「之前」擋下去的位置，只有這個模組
 * 被 `require` 的當下：playwright.config.js 建構 `webServer` 設定物件前，
 * 第一件事就是 `require('./e2e-env')`——在這裡同步拋出的例外，會讓整個
 * 設定檔載入失敗，Playwright 連 webServer 的 plugin 都還沒機會排進任務
 * 佇列，更不用說執行它的 setup()。下面的 `assertDataDirIsSafe()` 因此在
 * DATA_DIR 算出來後立刻、同步呼叫一次，就是為了確保這件事發生在
 * module load 階段。global-setup.js 現在只做「事後」複查與印出路徑，
 * 純粹是可視性用途，不是安全機制本身（見該檔案的說明）。
 *
 * **第一道防線依然是路徑「怎麼產生」這件事本身**：`os.tmpdir()` 底下用
 * `mkdtempSync` 建立的目錄一定是全新、獨一無二的路徑，物理上不可能等於
 * 或位於 repo 既有的 `data/` 目錄之下——今天這份程式碼因此不可能真的
 * 觸發 assertDataDirIsSafe() 的例外。這個函式要防的是「未來」：例如有人
 * 把 `DATA_DIR = fs.mkdtempSync(...)` 改成從某個環境變數讀，那種情況下
 * 這個 module-load 階段的同步檢查，才是真正能在 uvicorn 被 spawn 之前
 * 擋下去的那一層。
 * ---------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 刻意不用 8001（owner 手動跑著的 --reload dev server，見 task brief）。
const PORT = 8123;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_APP_DIR = path.join(REPO_ROOT, 'backend', 'app');
const VENV_PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'urdiary-e2e-data-'));

/**
 * 拋出例外，除非 dataDir 明確是 os.tmpdir() 底下、且不在
 * `<repoRoot>/data` 之內的路徑。純同步函式（無 async、無額外 I/O），
 * 因此可以在 module load 當下直接呼叫，也可以被 global-setup.js
 * 當作「事後複查」再呼叫一次——兩處共用同一份判斷邏輯，不會各自維護
 * 一份容易漂移的複本。
 */
function assertDataDirIsSafe(dataDir, repoRoot) {
    const resolvedDataDir = path.resolve(dataDir);
    const repoDataDir = path.resolve(repoRoot, 'data');
    const tmpRoot = path.resolve(os.tmpdir());

    const isInsideRepoData =
        resolvedDataDir === repoDataDir || resolvedDataDir.startsWith(repoDataDir + path.sep);
    if (isInsideRepoData) {
        throw new Error(
            `REFUSING TO START E2E: resolved data dir (${resolvedDataDir}) is inside the real ` +
            `repo data/ directory (${repoDataDir}). Aborting at e2e-env.js module load time — ` +
            `before playwright.config.js finishes building the webServer config, so uvicorn is ` +
            `never spawned with this path.`
        );
    }

    const isUnderTmp = resolvedDataDir === tmpRoot || resolvedDataDir.startsWith(tmpRoot + path.sep);
    if (!isUnderTmp) {
        throw new Error(
            `REFUSING TO START E2E: resolved data dir (${resolvedDataDir}) is not under the OS ` +
            `temp dir (${tmpRoot}). Refusing to guess whether it's safe. Aborting at ` +
            `e2e-env.js module load time, before uvicorn is ever spawned.`
        );
    }
}

// PREVENTIVE enforcement — MUST run here, synchronously, at module load.
// See the file-header comment above for why global-setup.js (the
// Playwright globalSetup hook) runs too late to prevent anything: the
// webServer plugin's setup() — which spawns uvicorn and waits for
// /health — executes before any custom globalSetup file does.
assertDataDirIsSafe(DATA_DIR, REPO_ROOT);

module.exports = {
    PORT,
    HOST,
    BASE_URL,
    DATA_DIR,
    REPO_ROOT,
    BACKEND_APP_DIR,
    VENV_PYTHON,
    assertDataDirIsSafe,
};
