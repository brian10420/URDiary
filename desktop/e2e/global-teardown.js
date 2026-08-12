/**
 * Playwright globalTeardown（v2.3 task 3.2）—— 整個 E2E 執行結束後跑一次，
 * 清掉 global-setup.js 驗證過、webServer 實際使用的隔離暫存資料目錄。
 *
 * 這個目錄從頭到尾只可能是 os.tmpdir() 底下 mkdtemp 出來的一個全新路徑
 * （見 e2e-env.js），絕不會是 repo 的 data/ —— 這裡才敢直接 recursive rm。
 */
'use strict';

const fs = require('fs');
const { DATA_DIR } = require('./e2e-env');

module.exports = async function globalTeardown() {
    try {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
        console.log(`[urdiary-e2e] cleaned up temp data dir: ${DATA_DIR}`);
    } catch (error) {
        // 清不掉暫存目錄不該讓整個測試回報失敗（測試結果本身已經確定）；
        // 印出來讓人知道要手動清，OS 本來也會在重開機/週期性任務時清掉
        // /tmp 底下的殘留檔案。
        console.warn(`[urdiary-e2e] failed to clean up temp data dir ${DATA_DIR}:`, error);
    }
};
