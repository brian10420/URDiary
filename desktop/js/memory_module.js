/**
 * 記憶管理 modal (v2.5 Spec C)
 * 兩檔全文編輯 (上限雙層防守的前端層)＋治理模式開關＋帳本 (renderLedger)。
 * 依賴：ApiService (Task 11 封裝)、I18N。
 */
const MemoryModule = (function() {
    const FILES = [
        { key: 'user_profile', ta: 'memory-profile-text', count: 'memory-profile-count',
          save: 'memory-profile-save', revert: 'memory-profile-revert', near: 'memory-profile-nearlimit' },
        { key: 'companion_notes', ta: 'memory-companion-text', count: 'memory-companion-count',
          save: 'memory-companion-save', revert: 'memory-companion-revert', near: 'memory-companion-nearlimit' },
    ];
    const SOFT_RATIO = 0.8; // 與後端 memory_files.SOFT_RATIO 同值 (僅顯示用)
    let overview = null;          // 最近一次 getMemory 快照
    let loadedValues = {};        // fileKey -> 最近載入/儲存成功的全文 (還原用)

    function el(id) { return document.getElementById(id); }
    function limitOf(key) {
        return (overview && overview.files[key]) ? overview.files[key].limit : 800;
    }

    function updateCounter(fileDef) {
        const ta = el(fileDef.ta);
        const count = el(fileDef.count);
        const near = el(fileDef.near);
        const save = el(fileDef.save);
        if (!ta || !count) return;
        const len = ta.value.length;
        const limit = limitOf(fileDef.key);
        count.textContent = I18N.t('memory.count', { count: len, limit: limit });
        const over = len > limit;
        count.classList.toggle('over', over);
        count.classList.toggle('near', !over && len >= limit * SOFT_RATIO);
        if (near) near.style.display = (!over && len >= limit * SOFT_RATIO) ? '' : 'none';
        if (save) save.disabled = over;
    }

    function fillFiles() {
        FILES.forEach(def => {
            const info = overview.files[def.key] || { content: '' };
            loadedValues[def.key] = info.content || '';
            const ta = el(def.ta);
            if (ta) ta.value = loadedValues[def.key];
            updateCounter(def);
        });
        const box = el('settings-memory-askfirst');
        if (box) box.checked = overview.write_mode === 'approval';
        updateBadges(overview.pending_count);
    }

    function updateBadges(pending) {
        [el('settings-memory-badge'), el('memory-ledger-badge')].forEach(badge => {
            if (!badge) return;
            if (pending > 0) { badge.textContent = String(pending); badge.style.display = ''; }
            else { badge.style.display = 'none'; }
        });
    }

    async function refreshBadge() {
        try {
            overview = await ApiService.getMemory();
            updateBadges(overview.pending_count);
        } catch (e) { /* 徽章是加分項，失敗安靜 */ }
    }

    function showTab(name) {
        ['profile', 'companion', 'ledger'].forEach(tab => {
            const pane = el(`memory-pane-${tab}`);
            const btn = el(`memory-tab-${tab}`);
            if (pane) pane.style.display = (tab === name) ? 'block' : 'none';
            if (btn) btn.classList.toggle('active', tab === name);
        });
        if (name === 'ledger') renderLedger();
    }

    async function open() {
        try {
            overview = await ApiService.getMemory();
        } catch (e) {
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(I18N.t('memory.actionFailed', { error: e.message || e }));
            }
            return;
        }
        fillFiles();
        const dialog = el('memory-dialog');
        if (dialog) dialog.style.display = 'block';
        showTab('profile');
    }

    function close() {
        const dialog = el('memory-dialog');
        if (dialog) dialog.style.display = 'none';
    }

    async function saveFile(fileDef) {
        const ta = el(fileDef.ta);
        if (!ta) return;
        try {
            await ApiService.saveMemoryFile(fileDef.key, ta.value);
            loadedValues[fileDef.key] = ta.value;
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(I18N.t('memory.saved'));
            }
            refreshBadge(); // user_edit 可能讓 pending 失效
        } catch (e) {
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(I18N.t('memory.tooLong'));
            }
        }
    }

    async function onModeToggle(event) {
        const mode = event.target.checked ? 'approval' : 'auto';
        try {
            await ApiService.saveMemorySettings(mode);
            if (overview) overview.write_mode = mode;
        } catch (e) {
            event.target.checked = !event.target.checked; // 失敗回彈
        }
    }

    // Task 13 擴充為完整帳本渲染；本階段先渲染空狀態
    async function renderLedger() {
        const list = el('memory-ledger-list');
        if (!list) return;
        list.innerHTML = `<div class="memory-hint">${I18N.t('memory.emptyLedger')}</div>`;
    }

    function init() {
        const manage = el('settings-memory-manage');
        if (manage) manage.addEventListener('click', open);
        const closeBtn = el('memory-dialog-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
        const box = el('settings-memory-askfirst');
        if (box) box.addEventListener('change', onModeToggle);
        ['profile', 'companion', 'ledger'].forEach(tab => {
            const btn = el(`memory-tab-${tab}`);
            if (btn) btn.addEventListener('click', () => showTab(tab));
        });
        FILES.forEach(def => {
            const ta = el(def.ta);
            if (ta) ta.addEventListener('input', () => updateCounter(def));
            const save = el(def.save);
            if (save) save.addEventListener('click', () => saveFile(def));
            const revert = el(def.revert);
            if (revert) revert.addEventListener('click', () => {
                if (ta) { ta.value = loadedValues[def.key] || ''; updateCounter(def); }
            });
        });
    }

    return { init, open, close, refreshBadge, renderLedger, showTab };
})();

if (typeof window !== 'undefined') {
    window.MemoryModule = MemoryModule;
}
