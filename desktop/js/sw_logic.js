/**
 * Service worker 路由與更新判斷邏輯 —— 抽成純函式，同時被兩邊使用：
 *
 *   1. sw.js 用 importScripts('/js/sw_logic.js') 載入，在 fetch handler 裡
 *      決定某個請求要 network-only 還是 cache-first。
 *   2. js/main.js（頁面主執行緒）用一般 <script> 標籤載入，在監聽
 *      registration.installing 的 statechange 事件時，決定要不要跳出
 *      「有新版本」提示。
 *
 * 抽出來的理由：這兩個判斷都是純粹的字串/狀態比對，不碰任何 I/O，最適合
 * 直接單元測試；sw.js/main.js 本體則需要真正的 ServiceWorker runtime
 * （caches、fetch、registration…），vitest 測不到那一層。
 *
 * 跟其他模塊一樣採用 `const X = (function(){...})()` IIFE 模式（本專案無
 * 建置流程，純 <script> 標籤）。這裡額外明確賦值 `self.SWLogic = api`
 * （而不是只依賴多個 <script> 共享頂層作用域這件事）：這支檔案兩種載入
 * 情境都要能拿到它——分頁上是 `<script src="js/sw_logic.js">`（此時
 * `self` 就是 `window`，jsdom 測試環境亦同），Service Worker 裡則是
 * `importScripts('/js/sw_logic.js')`（此時 `self` 是 SW 的 global scope，
 * 沒有 `window` 可用）。`self` 在两种情境下都存在且指向正確目標。
 */
const SWLogic = (function () {
    // 一律 network-only、絕不快取的 API 路徑前綴（v2.3 task 2.2 決策清單）。
    'use strict';

    // 用「完全相等，或後面接 '/'」比對，避免像 '/diaryapp' 這種字面上有
    // 共同前綴、但其實是不同路徑的東西被誤判成 API（目前的路由表不存在
    // 這種衝突，但比對邏輯本身選擇正確的邊界，不做字串前綴的裸比對）。
    const API_PATH_PREFIXES = [
        '/users', '/chat', '/diaries', '/diary', '/calendar', '/analytics',
        '/interaction-notes', '/generate', '/enhanced-generate', '/health',
        '/system', '/docs', '/redoc', '/openapi.json'
    ];

    // App shell：精確路徑 + 目錄前綴，對應 backend/app/main.py 的
    // StaticFiles 掛載（/js /css /assets）與明確檔案路由（/、
    // /manifest.webmanifest、/favicon.ico）。注意兩個刻意的排除：
    //   - /sw.js 不在這份清單裡——它由伺服器以 Cache-Control: no-cache
    //     提供，瀏覽器自己的「是否有新版 SW」檢查機制會繞過目前執行中的
    //     SW 直接打網路比對位元組，SW 的 fetch handler 本身也不該把自己
    //     的腳本當成可快取的殼層資源。
    //   - /index.html 也不在這份清單裡——main.py 只註冊了 '/' 這個路由
    //     (serve_frontend_index)，沒有 '/index.html'，真的打這個路徑會
    //     404。曾經誤把它跟 '/' 並列在這裡、也列進 sw.js 的 SHELL_ASSETS，
    //     導致 cache.addAll() 因為其中一個 404 而整批失敗、service worker
    //     從未真正安裝成功過（cache.addAll 是 all-or-nothing）——見
    //     task-2.2-report.md 的 fix log。
    const SHELL_EXACT_PATHS = ['/', '/manifest.webmanifest', '/favicon.ico'];
    const SHELL_PATH_PREFIXES = ['/js/', '/css/', '/assets/'];

    function _matchesPrefix(pathname, prefix) {
        return pathname === prefix || pathname.indexOf(prefix + '/') === 0;
    }

    function isApiPath(pathname) {
        return API_PATH_PREFIXES.some(function (prefix) {
            return _matchesPrefix(pathname, prefix);
        });
    }

    function isShellPath(pathname) {
        if (SHELL_EXACT_PATHS.indexOf(pathname) !== -1) return true;
        return SHELL_PATH_PREFIXES.some(function (prefix) {
            return pathname.indexOf(prefix) === 0;
        });
    }

    /**
     * 決定某個請求路徑的快取策略：
     *   - 'network-only'：絕不碰快取，一律直接打網路（API 路徑）。
     *   - 'cache-first'：殼層資源，快取優先、沒有才 fetch。
     *
     * 優先序刻意固定為「先查 API 清單、再查殼層清單、最後預設
     * network-only」——任何不在已知殼層清單內的路徑，安全的預設方向是
     * 「不快取」而不是「快取」：這樣即使未來加了新路由卻忘記更新這份清單，
     * 最壞情況只是少了一個快取優化，不會發生「意外把動態或敏感內容快取
     * 下來」這種錯誤方向的後果。
     */
    function classifyRequestPath(pathname) {
        if (isApiPath(pathname)) return 'network-only';
        if (isShellPath(pathname)) return 'cache-first';
        return 'network-only';
    }

    /**
     * 新的 service worker 進入 'installed' state 時，該不該跳出「有新版本」
     * 提示？只有在「這個分頁當下已經被某個 service worker 控制」時，這才
     * 算是一次「更新」——如果目前完全沒有 controller，代表這是這個 origin
     * 第一次安裝 service worker：新 worker 會在沒有人呼叫 skipWaiting 的
     * 情況下自動 activate（不會卡在 waiting，因為沒有既有 controlled
     * client 需要保護），下一次載入才會開始控制頁面。這是正常的 PWA 首次
     * 安裝流程，不該被當成「更新」跳出來打擾使用者。
     */
    function shouldPromptUpdate(workerState, hasExistingController) {
        return workerState === 'installed' && hasExistingController === true;
    }

    /**
     * 把「使用者同意更新」跟「真的重新整理頁面」之間的唯一合法路徑封裝
     * 起來（code review 修復，見 task-2.2-report.md 的 fix log）。
     *
     * 背景：sw.js 的 activate 無條件呼叫 self.clients.claim()——這是刻意
     * 的（見 sw.js 檔頭），因為「使用者同意更新」流程需要它才能讓已經開著
     * 的分頁從舊 worker 換到新 worker。但 clients.claim() 在「這個 origin
     * 第一次安裝 service worker」時也會執行到：目前開著的分頁原本沒有
     * controller（null），claim() 會把它變成新 worker，一樣觸發
     * controllerchange——這跟「使用者同意更新」是兩件完全不同的事，卻是
     * 同一個瀏覽器事件。如果隨頁面初始化就無條件監聽 controllerchange
     * 並直接 reload()，會讓「第一次安裝」也悄悄重新整理頁面（登入中、打字
     * 到一半都會被打斷）——這正是這個修復要擋掉的行為。
     *
     * 用法：只有在使用者按下更新提示的動作鈕時才呼叫 arm()；在那之前，
     * container 上完全沒有掛任何 controllerchange 監聽器，第一次安裝的
     * 那次 controllerchange 自然沒有人理會。
     *
     * container 只要求有 addEventListener(type, fn) 介面（正式環境傳入
     * navigator.serviceWorker，測試傳入任何 EventTarget-like 的替身），
     * 讓這段邏輯不必依賴 jsdom 沒有實作的真實 service worker API 就能
     * 單元測試。
     *
     * arm() 本身、以及回傳的 reload 觸發，兩者都是 idempotent：
     *   - 重複呼叫 arm() 只會掛一個監聽器（不會讓一次 controllerchange
     *     觸發多次 reload）。
     *   - 就算 controllerchange 因為某種極端情況觸發不只一次，reloadFn
     *     也只會被呼叫一次。
     */
    function createControllerChangeReloadArmer(container, reloadFn) {
        let armed = false;
        let reloaded = false;

        function arm() {
            if (armed) return;
            armed = true;
            container.addEventListener('controllerchange', function () {
                if (reloaded) return;
                reloaded = true;
                reloadFn();
            });
        }

        return { arm: arm };
    }

    const api = {
        API_PATH_PREFIXES: API_PATH_PREFIXES.slice(),
        classifyRequestPath: classifyRequestPath,
        shouldPromptUpdate: shouldPromptUpdate,
        createControllerChangeReloadArmer: createControllerChangeReloadArmer
    };

    // 明確賦值在 self 上（見檔頭說明）：頁面情境下 self === window，
    // Service Worker 情境下 self 是 SW 的 global scope。
    self.SWLogic = api;

    return api;
})();
