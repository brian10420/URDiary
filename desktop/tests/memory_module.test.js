// desktop/tests/memory_module.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

const OVERVIEW = {
    files: {
        user_profile: { content: '## 稱呼與身分\n- 小B (2026-08-23)', limit: 800, updated_at: null },
        companion_notes: { content: '', limit: 600, updated_at: null },
    },
    write_mode: 'auto',
    pending_count: 0,
};

function stubApi(overrides = {}) {
    window.ApiService = {
        getMemory: vi.fn(async () => structuredClone(OVERVIEW)),
        saveMemoryFile: vi.fn(async () => ({ ok: true, stale_count: 0 })),
        saveMemorySettings: vi.fn(async () => ({ ok: true })),
        getMemoryOps: vi.fn(async () => ({ ops: [] })),
        memoryOpAction: vi.fn(async () => ({ ok: true, status: 'applied' })),
        memoryBatchAction: vi.fn(async () => ({ ok: true, applied: 0 })),
        ...overrides,
    };
}

function mountDom() {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="settings-memory-askfirst">
        <button id="settings-memory-manage"><span id="settings-memory-badge" style="display:none"></span></button>
        <div id="memory-dialog" class="modal" style="display:none">
          <button id="memory-tab-profile" class="memory-tab active"></button>
          <button id="memory-tab-companion" class="memory-tab"></button>
          <button id="memory-tab-ledger" class="memory-tab"><span id="memory-ledger-badge" style="display:none"></span></button>
          <div id="memory-pane-profile">
            <textarea id="memory-profile-text"></textarea>
            <span id="memory-profile-count"></span>
            <button id="memory-profile-revert"></button>
            <button id="memory-profile-save"></button>
          </div>
          <div id="memory-pane-companion" style="display:none">
            <textarea id="memory-companion-text"></textarea>
            <span id="memory-companion-count"></span>
            <button id="memory-companion-revert"></button>
            <button id="memory-companion-save"></button>
          </div>
          <div id="memory-pane-ledger" style="display:none"><div id="memory-ledger-list"></div></div>
          <button id="memory-dialog-close"></button>
        </div>
      </div>`;
}

describe('MemoryModule：兩檔編輯＋模式開關', () => {
    beforeAll(() => {
        loadCoreScripts();
        loadScript('js/i18n.js');
    });
    beforeEach(() => {
        vi.restoreAllMocks();
        stubApi();
        mountDom();
        loadScript('js/memory_module.js');
        window.MemoryModule.init();
    });

    it('open() 載入兩檔與模式', async () => {
        await window.MemoryModule.open();
        expect(document.getElementById('memory-dialog').style.display).toBe('block');
        expect(document.getElementById('memory-profile-text').value).toContain('小B');
        expect(document.getElementById('memory-profile-count').textContent).toContain('/ 800');
        expect(window.ApiService.getMemory).toHaveBeenCalled();
    });

    it('tab 切換顯示對應面板', async () => {
        await window.MemoryModule.open();
        document.getElementById('memory-tab-companion').click();
        expect(document.getElementById('memory-pane-companion').style.display).toBe('block');
        expect(document.getElementById('memory-pane-profile').style.display).toBe('none');
    });

    it('字數即時更新且超標時鎖存檔鈕', async () => {
        await window.MemoryModule.open();
        const ta = document.getElementById('memory-profile-text');
        ta.value = 'x'.repeat(801);
        ta.dispatchEvent(new Event('input'));
        expect(document.getElementById('memory-profile-count').textContent).toContain('801');
        expect(document.getElementById('memory-profile-save').disabled).toBe(true);
        ta.value = 'ok';
        ta.dispatchEvent(new Event('input'));
        expect(document.getElementById('memory-profile-save').disabled).toBe(false);
    });

    it('儲存呼叫 API、還原回載入值', async () => {
        await window.MemoryModule.open();
        const ta = document.getElementById('memory-profile-text');
        ta.value = '改過的內容';
        ta.dispatchEvent(new Event('input'));
        document.getElementById('memory-profile-save').click();
        await Promise.resolve();
        expect(window.ApiService.saveMemoryFile).toHaveBeenCalledWith('user_profile', '改過的內容');
        ta.value = '又亂改';
        document.getElementById('memory-profile-revert').click();
        expect(ta.value).toBe('改過的內容'); // 還原到最近一次載入/儲存的值
    });

    it('模式開關寫回 API', async () => {
        await window.MemoryModule.open();
        const box = document.getElementById('settings-memory-askfirst');
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(window.ApiService.saveMemorySettings).toHaveBeenCalledWith('approval');
    });

    it('refreshBadge：pending>0 顯示數字', async () => {
        stubApi({ getMemory: vi.fn(async () => ({ ...structuredClone(OVERVIEW), pending_count: 3 })) });
        await window.MemoryModule.refreshBadge();
        const badge = document.getElementById('settings-memory-badge');
        expect(badge.style.display).not.toBe('none');
        expect(badge.textContent).toBe('3');
    });

    it('存檔失敗依 HTTP 狀態碼分流訊息：422→太長，其餘→一般失敗附訊息 (P6)', async () => {
        const toast = vi.fn();
        window.UIManager = { showToast: toast };
        const tooLongErr = new Error('API_ERROR:422');
        tooLongErr.status = 422;
        const serverErr = new Error('伺服器出了點問題');
        serverErr.status = 500;
        stubApi({ saveMemoryFile: vi.fn()
            .mockRejectedValueOnce(tooLongErr)
            .mockRejectedValueOnce(serverErr) });
        await window.MemoryModule.open();

        document.getElementById('memory-profile-save').click();
        await vi.waitFor(() => {
            expect(toast).toHaveBeenCalledWith(I18N.t('memory.tooLong'));
        });

        toast.mockClear();
        document.getElementById('memory-profile-save').click();
        await vi.waitFor(() => {
            expect(toast).toHaveBeenCalledWith(I18N.t('memory.actionFailed', { error: '伺服器出了點問題' }));
        });
    });
});
