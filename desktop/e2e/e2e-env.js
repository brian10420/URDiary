/**
 * 單一事實來源：E2E 後端要用的隔離資料目錄與埠號（v2.3 task 3.2）。
 *
 * playwright.config.js / global-setup.js / global-teardown.js 三個檔案都
 * `require('./e2e-env')`——Node 的 module cache 保證同一個 process 內
 * `fs.mkdtempSync` 只會真的執行一次，三邊 require 到的都是同一個路徑
 * 字串，不需要另外靠檔案或環境變數在彼此之間傳遞。config.js 一定是三者
 * 中最先被 require 的（Playwright 載入設定檔本身就是第一步），所以
 * DATA_DIR 在 webServer 真正被啟動之前就已經固定。
 *
 * **第一道安全防線在這裡、在路徑「怎麼產生」這件事本身**：`os.tmpdir()`
 * 底下用 `mkdtempSync` 建立的目錄一定是全新、獨一無二的路徑，物理上不可能
 * 等於或位於 repo 既有的 `data/` 目錄之下——不必依賴後面任何程式邏輯判斷
 * 「這是不是真的資料目錄」，路徑本身的產生方式就排除了那個可能性。
 * global-setup.js 的檢查是第二道、純防禦性的保險（例如未來有人改壞這個
 * 檔案，讓 DATA_DIR 改成從環境變數讀）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 刻意不用 8001（owner 手動跑著的 --reload dev server，見 task brief）。
const PORT = 8123;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'urdiary-e2e-data-'));

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_APP_DIR = path.join(REPO_ROOT, 'backend', 'app');
const VENV_PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python');

module.exports = {
    PORT,
    HOST,
    BASE_URL,
    DATA_DIR,
    REPO_ROOT,
    BACKEND_APP_DIR,
    VENV_PYTHON,
};
