/**
 * Playwright globalSetup（v2.3 task 3.2）—— 在整個 E2E 執行之前跑一次。
 *
 * 這裡的檢查是**防禦性的第二道保險**，不是主要的安全機制：DATA_DIR 本身
 * 由 e2e-env.js 用 `fs.mkdtempSync(os.tmpdir())` 產生，路徑的產生方式已經
 * 讓它不可能等於/位於 repo 的 data/ 之下（見該檔案的說明）。這裡明確地
 * `assert` 出來，是為了在未來有人改壞 e2e-env.js（例如改成讀某個環境變數）
 * 時，第一時間就在啟動 webServer 前失敗並印出清楚原因，而不是悄悄把
 * 測試資料寫進真正的 data/。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR, REPO_ROOT } = require('./e2e-env');

module.exports = async function globalSetup() {
    const resolvedDataDir = path.resolve(DATA_DIR);
    const repoDataDir = path.resolve(REPO_ROOT, 'data');
    const tmpRoot = path.resolve(os.tmpdir());

    const isInsideRepoData =
        resolvedDataDir === repoDataDir || resolvedDataDir.startsWith(repoDataDir + path.sep);
    if (isInsideRepoData) {
        throw new Error(
            `REFUSING TO START E2E BACKEND: resolved data dir (${resolvedDataDir}) is inside ` +
            `the real repo data/ directory (${repoDataDir}). Aborting before any server starts.`
        );
    }

    const isUnderTmp =
        resolvedDataDir === tmpRoot || resolvedDataDir.startsWith(tmpRoot + path.sep);
    if (!isUnderTmp) {
        throw new Error(
            `REFUSING TO START E2E BACKEND: resolved data dir (${resolvedDataDir}) is not ` +
            `under the OS temp dir (${tmpRoot}). Refusing to guess whether it's safe.`
        );
    }

    if (!fs.existsSync(resolvedDataDir)) {
        throw new Error(`E2E data dir vanished before tests started: ${resolvedDataDir}`);
    }

    // 供人工檢視：`npx playwright test` 的輸出與 task-3.2-report.md 都會引用這行。
    console.log(`[urdiary-e2e] isolated URDIARY_DATA_DIR = ${resolvedDataDir}`);
};
