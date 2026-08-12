/**
 * vitest 設定（v2.3 task 3.2 新增）。
 *
 * 在這之前專案沒有 vitest.config.js，全部靠預設值（`vitest run` 掃描
 * `**\/*.{test,spec}.*`）。task 3.2 新增 desktop/e2e/urdiary.spec.js 之後，
 * 這個預設萬用字元會把 Playwright 的 spec 檔也當成 vitest 測試去執行——
 * 兩邊的 test()/expect() 是不同套件、介面不相容，會直接炸掉。
 *
 * 明確把 include 收斂回既有慣例（tests/ 底下的 *.test.js），e2e/ 完全不在
 * vitest 的掃描範圍內；Playwright 那邊反過來也用 testDir: './e2e'
 * （playwright.config.js）明確限定，兩邊各自只認自己的目錄，不會再有
 * 互相踩到的可能。
 */
'use strict';

module.exports = {
    test: {
        include: ['tests/**/*.test.js'],
    },
};
