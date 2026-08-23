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
                // fetchAPI 對 HTTP 錯誤會把數字狀態碼掛在 e.status (見
                // api_service.js fetchAPI 的 catch 區塊：apiFailure.status =
                // httpStatus ? parseInt(httpStatus, 10) : null，從
                // "API_ERROR:xxx" 這類內部訊息碼解析出來)。後端超過字數上限時
                // 回 422 (routes/memory.py put_memory_file)，只有這個狀態碼
                // 才代表「太長」；網路/認證/伺服器等其餘錯誤維持一般失敗訊息，
                // 不該被籠統地誤標成太長。
                const message = (e && e.status === 422)
                    ? I18N.t('memory.tooLong')
                    : I18N.t('memory.actionFailed', { error: e.message || e });
                UIManager.showToast(message);
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

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    const STATUS_KEYS = {
        applied: 'memory.stApplied', pending: 'memory.stPending', rejected: 'memory.stRejected',
        undone: 'memory.stUndone', stale: 'memory.stStale', failed: 'memory.stFailed',
    };

    function opChipClass(status) {
        if (status === 'applied') return 'memory-chip applied';
        if (status === 'pending') return 'memory-chip pending';
        if (status === 'failed') return 'memory-chip failed';
        return 'memory-chip';
    }

    function opDescription(op) {
        const fileName = I18N.t(op.file_key === 'user_profile' ? 'memory.fileProfile' : 'memory.fileCompanion');
        if (op.action === 'user_edit') return `${I18N.t('memory.opUserEdit')} ${fileName}`;
        if (op.action === 'add') {
            const sec = op.section ? `・${escapeHtml(op.section)}` : '';
            return `${I18N.t('memory.opAdd')} ${fileName}${sec}：「${escapeHtml(op.new_text)}」`;
        }
        if (op.action === 'replace') {
            return `${I18N.t('memory.opReplace')} ${fileName}：「${escapeHtml(op.target_text)}」→「${escapeHtml(op.new_text)}」`;
        }
        return `${I18N.t('memory.opRemove')} ${fileName}：「${escapeHtml(op.target_text)}」`;
    }

    function batchTitle(ops) {
        const first = ops[0];
        const date = (first.created_at || '').slice(0, 10);
        if (first.source === 'user_edit') return `${date}・${I18N.t('memory.selfEdit')}`;
        if (first.source_diary_title) {
            return `${date}・${I18N.t('memory.fromDiary', { title: first.source_diary_title })}`;
        }
        return date;
    }

    function opRowHtml(op) {
        const chip = `<span class="${opChipClass(op.status)}">${I18N.t(STATUS_KEYS[op.status] || 'memory.stFailed')}</span>`;
        let buttons = '';
        if (op.status === 'pending') {
            buttons = `<button class="memory-op-btn approve" data-op-approve="${op.id}">${I18N.t('memory.approve')}</button>` +
                      `<button class="memory-op-btn" data-op-reject="${op.id}">${I18N.t('memory.reject')}</button>`;
        } else if (op.status === 'applied' && op.action !== 'user_edit') {
            buttons = `<button class="memory-op-btn" data-op-undo="${op.id}">${I18N.t('memory.undo')}</button>`;
        }
        const dim = (op.status === 'rejected' || op.status === 'undone' || op.status === 'stale' || op.status === 'failed');
        const error = op.error ? `<div class="memory-op-error">${escapeHtml(op.error)}</div>` : '';
        return `<div class="memory-op-row${dim ? ' dimmed' : ''}">` +
               `<div class="memory-op-text">${opDescription(op)}${error}</div>` +
               `<div class="memory-op-side">${chip}${buttons}</div></div>`;
    }

    async function renderLedger() {
        const list = el('memory-ledger-list');
        if (!list) return;
        let ops = [];
        try {
            ops = (await ApiService.getMemoryOps()).ops || [];
        } catch (e) {
            list.innerHTML = `<div class="memory-hint">${I18N.t('memory.actionFailed', { error: escapeHtml(e.message || e) })}</div>`;
            return;
        }
        const banner = el('memory-approval-banner');
        const hasPending = ops.some(op => op.status === 'pending');
        if (banner) banner.style.display = (overview && overview.write_mode === 'approval' && hasPending) ? '' : 'none';
        if (!ops.length) {
            list.innerHTML = `<div class="memory-hint">${I18N.t('memory.emptyLedger')}</div>`;
            return;
        }
        // 依出現順序 (已是新→舊) 分組 batch
        const groups = [];
        const byBatch = {};
        ops.forEach(op => {
            if (!byBatch[op.batch_id]) { byBatch[op.batch_id] = []; groups.push(op.batch_id); }
            byBatch[op.batch_id].push(op);
        });
        list.innerHTML = groups.map(batchId => {
            const groupOps = byBatch[batchId];
            const pendingHere = groupOps.some(op => op.status === 'pending');
            const actions = pendingHere
                ? `<div class="memory-batch-actions">` +
                  `<button class="memory-op-btn approve" data-batch-approve="${escapeHtml(batchId)}">${I18N.t('memory.approveAll')}</button>` +
                  `<button class="memory-op-btn" data-batch-reject="${escapeHtml(batchId)}">${I18N.t('memory.rejectAll')}</button></div>`
                : '';
            return `<div class="memory-batch-header"><span>${escapeHtml(batchTitle(groupOps))}</span>${actions}</div>` +
                   groupOps.map(opRowHtml).join('');
        }).join('');

        list.querySelectorAll('[data-op-approve]').forEach(btn =>
            btn.addEventListener('click', () => opAction(Number(btn.dataset.opApprove), 'approve')));
        list.querySelectorAll('[data-op-reject]').forEach(btn =>
            btn.addEventListener('click', () => opAction(Number(btn.dataset.opReject), 'reject')));
        list.querySelectorAll('[data-op-undo]').forEach(btn =>
            btn.addEventListener('click', () => opAction(Number(btn.dataset.opUndo), 'undo')));
        list.querySelectorAll('[data-batch-approve]').forEach(btn =>
            btn.addEventListener('click', () => batchAction(btn.dataset.batchApprove, 'approve')));
        list.querySelectorAll('[data-batch-reject]').forEach(btn =>
            btn.addEventListener('click', () => batchAction(btn.dataset.batchReject, 'reject')));
    }

    async function opAction(opId, action) {
        try {
            await ApiService.memoryOpAction(opId, action);
        } catch (e) {
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(I18N.t('memory.actionFailed', { error: e.message || e }));
            }
        }
        await refreshBadge();
        // 核可/撤銷可能改了檔案內容——refreshBadge 已重抓 overview，順便重填
        // 兩個文字框，使用者不必關閉再重開 modal 才看得到新內容 (P1)。
        // refreshBadge 若安靜失敗，overview 會停在舊快照；guard 一下避免
        // overview 從沒抓成功過 (仍是 null) 時 fillFiles 出錯。
        if (overview) fillFiles();
        await renderLedger();
    }

    async function batchAction(batchId, action) {
        try {
            await ApiService.memoryBatchAction(batchId, action);
        } catch (e) {
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(I18N.t('memory.actionFailed', { error: e.message || e }));
            }
        }
        await refreshBadge();
        // 同 opAction：批次核可/拒絕後也要重填文字框 (P1)。
        if (overview) fillFiles();
        await renderLedger();
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
