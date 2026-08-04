/**
 * 測試用的 script 載入器 —— desktop/ 沒有 build step，js/*.js 都是給
 * <script src="..."> 直接載入的 plain script（IIFE 模式）。在瀏覽器裡，
 * 多個 <script> 標籤共享同一份全域作用域，所以像 ui_manager.js 這樣
 * 只寫 `const UIManager = (function(){...})();`、從沒明確 `window.UIManager =
 * UIManager` 的檔案，照樣能被後面載入的 main.js 直接引用 UIManager。
 *
 * 但 (0, eval)(code) 的「間接 eval」不是這樣：頂層 const/let 只會進入
 * 這次 eval 呼叫自己專屬、用完即棄的宣告式環境（ECMA-262 PerformEval），
 * 既不會寫進 window，呼叫結束後也無法被下一次 eval 或呼叫端看到 ——
 * 實測 `(0, eval)('const X = 1'); (0, eval)('X')` 第二行會丟
 * ReferenceError。只有明確賦值（`window.X = X`，如 config.js/i18n.js/
 * api_service.js 的寫法）才會留下來。
 *
 * 因此這裡在「同一次」eval 呼叫的程式碼字串尾端，補一行同作用域內的
 * `window.<Name> = <Name>`（能抓到同一個宣告式環境裡的 const 綁定），
 * 讓每個模組不論原始檔案有沒有自己 `window.X = X`，測試時都確實掛上
 * window 全域 —— 這正是 loadScript 要做到的事，只是找出「要補哪一行」
 * 需要這個小小的正規表達式輔助。
 */
const fs = require('fs');
const path = require('path');

const DESKTOP_ROOT = path.join(__dirname, '..', '..');

// 匹配本專案模組的標準寫法：`const XxxModule = (function() {...})();`
const MODULE_CONST_RE = /^const (\w+)\s*=\s*\(function/m;

function loadScript(relPath) {
    let code = fs.readFileSync(path.join(DESKTOP_ROOT, relPath), 'utf8');

    const match = code.match(MODULE_CONST_RE);
    if (match) {
        const name = match[1];
        // 與被載入的程式碼同一次 eval、同一個宣告式環境，才看得到這個 const 綁定
        code += `\nif (typeof ${name} !== 'undefined' && typeof window.${name} === 'undefined') { window.${name} = ${name}; }`;
    }

    (0, eval)(code);
}

// 大多數模組都預期先有 security_utils.js（escapeHtml）→ i18n.js（I18N）→
// config.js（CONFIG）才能正常運作；提供這個標準前置，測試檔各自再載入
// 需要的模組本體。
function loadCoreScripts() {
    loadScript('js/security_utils.js');
    loadScript('js/i18n.js');
    loadScript('js/config.js');
}

module.exports = { loadScript, loadCoreScripts };
