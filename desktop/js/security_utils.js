/**
 * 安全工具 - HTML 轉義
 *
 * 本應用以 nodeIntegration:true / contextIsolation:false 執行，渲染程序可直接
 * 存取 Node API (require、child_process)。任何未經轉義就寫入 innerHTML 的外部
 * 內容 — AI 回應、日記內文、用戶名、錯誤訊息 — 都可能被注入
 * `<img src=x onerror="...">` 這類標籤而導致任意程式碼執行。
 *
 * 規則：所有動態內容寫入 innerHTML 前，一律先經過 escapeHtml()。
 */
(function () {
    const HTML_ESCAPES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
    }

    window.escapeHtml = escapeHtml;
})();
