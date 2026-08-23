// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

const OPS = [
    { id: 11, file_key: 'user_profile', batch_id: 'b2', action: 'add', section: '重要事件時間線',
      target_text: null, new_text: '- [2026-08-23] 模型收斂', status: 'pending', source: 'review_pass',
      source_diary_id: 5, source_diary_title: '實驗收斂的一天', error: null,
      created_at: '2026-08-23T12:00:00', decided_at: null },
    { id: 10, file_key: 'companion_notes', batch_id: 'b2', action: 'replace', section: null,
      target_text: '舊句', new_text: '新句', status: 'pending', source: 'review_pass',
      source_diary_id: 5, source_diary_title: '實驗收斂的一天', error: null,
      created_at: '2026-08-23T12:00:00', decided_at: null },
    { id: 9, file_key: 'user_profile', batch_id: 'b1', action: 'add', section: '情緒模式',
      target_text: null, new_text: '- 已生效的一筆', status: 'applied', source: 'review_pass',
      source_diary_id: 4, source_diary_title: '牛肉湯', error: null,
      created_at: '2026-08-22T12:00:00', decided_at: null },
    { id: 8, file_key: 'user_profile', batch_id: 'b1', action: 'remove', section: null,
      target_text: '比不到的原文', new_text: null, status: 'failed', source: 'review_pass',
      source_diary_id: 4, source_diary_title: '牛肉湯', error: 'target_not_found',
      created_at: '2026-08-22T12:00:00', decided_at: null },
];

function stubApi(ops = OPS, overrides = {}) {
    window.ApiService = {
        getMemory: vi.fn(async () => ({
            files: { user_profile: { content: '', limit: 800, updated_at: null },
                     companion_notes: { content: '', limit: 600, updated_at: null } },
            write_mode: 'approval', pending_count: 2,
        })),
        saveMemoryFile: vi.fn(async () => ({ ok: true })),
        saveMemorySettings: vi.fn(async () => ({ ok: true })),
        getMemoryOps: vi.fn(async () => ({ ops: structuredClone(ops) })),
        memoryOpAction: vi.fn(async () => ({ ok: true, status: 'applied' })),
        memoryBatchAction: vi.fn(async () => ({ ok: true, applied: 2, stale: 0 })),
        ...overrides,
    };
}

function mountDom() {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="settings-memory-askfirst">
        <button id="settings-memory-manage"><span id="settings-memory-badge" style="display:none"></span></button>
        <div id="memory-dialog" class="modal" style="display:none">
          <button id="memory-tab-profile" class="memory-tab"></button>
          <button id="memory-tab-companion" class="memory-tab"></button>
          <button id="memory-tab-ledger" class="memory-tab"><span id="memory-ledger-badge" style="display:none"></span></button>
          <div id="memory-pane-profile">
            <textarea id="memory-profile-text"></textarea><span id="memory-profile-count"></span>
            <span id="memory-profile-nearlimit" style="display:none"></span>
            <button id="memory-profile-revert"></button><button id="memory-profile-save"></button>
          </div>
          <div id="memory-pane-companion" style="display:none">
            <textarea id="memory-companion-text"></textarea><span id="memory-companion-count"></span>
            <span id="memory-companion-nearlimit" style="display:none"></span>
            <button id="memory-companion-revert"></button><button id="memory-companion-save"></button>
          </div>
          <div id="memory-pane-ledger" style="display:none">
            <div id="memory-approval-banner" style="display:none"></div>
            <div id="memory-ledger-list"></div>
          </div>
          <button id="memory-dialog-close"></button>
        </div>
      </div>`;
}

describe('MemoryModule 帳本', () => {
    beforeAll(() => { loadCoreScripts(); loadScript('js/i18n.js'); });
    beforeEach(() => {
        stubApi(); mountDom();
        loadScript('js/memory_module.js');
        window.MemoryModule.init();
    });

    it('按 batch 分組、渲染狀態與來源日記標題', async () => {
        await window.MemoryModule.open();
        window.MemoryModule.showTab('ledger');
        await vi.waitFor(() => {
            const list = document.getElementById('memory-ledger-list');
            expect(list.querySelectorAll('.memory-batch-header').length).toBe(2);
            expect(list.textContent).toContain('實驗收斂的一天');
            expect(list.textContent).toContain('牛肉湯');
            expect(list.querySelectorAll('.memory-op-row').length).toBe(4);
            expect(list.textContent).toContain('target_not_found' ? '未套用' : '');
        });
        expect(document.getElementById('memory-approval-banner').style.display).not.toBe('none');
    });

    it('pending op 有核可/拒絕鈕；點核可打 API 後重載', async () => {
        await window.MemoryModule.open();
        window.MemoryModule.showTab('ledger');
        await vi.waitFor(() => {
            expect(document.querySelector('[data-op-approve="11"]')).toBeTruthy();
        });
        document.querySelector('[data-op-approve="11"]').click();
        await vi.waitFor(() => {
            expect(window.ApiService.memoryOpAction).toHaveBeenCalledWith(11, 'approve');
            expect(window.ApiService.getMemoryOps.mock.calls.length).toBeGreaterThan(1); // 重載
        });
    });

    it('applied op 有撤銷鈕；批次列有全部核可', async () => {
        await window.MemoryModule.open();
        window.MemoryModule.showTab('ledger');
        await vi.waitFor(() => {
            expect(document.querySelector('[data-op-undo="9"]')).toBeTruthy();
            expect(document.querySelector('[data-batch-approve="b2"]')).toBeTruthy();
            expect(document.querySelector('[data-batch-approve="b1"]')).toBeFalsy(); // 無 pending 的批次不出批次鈕
        });
        document.querySelector('[data-batch-approve="b2"]').click();
        await vi.waitFor(() => {
            expect(window.ApiService.memoryBatchAction).toHaveBeenCalledWith('b2', 'approve');
        });
    });

    it('空帳本顯示空狀態文案', async () => {
        stubApi([]); mountDom();
        loadScript('js/memory_module.js');
        window.MemoryModule.init();
        await window.MemoryModule.open();
        window.MemoryModule.showTab('ledger');
        await vi.waitFor(() => {
            expect(document.getElementById('memory-ledger-list').textContent.length).toBeGreaterThan(0);
        });
    });

    it('核可後不必關閉重開 modal：兩個文字框跟著重新填入 (P1)', async () => {
        let call = 0;
        stubApi(OPS, {
            // 第一次 (open() 當下) 回舊內容；核可觸發的 refreshBadge() 是第二次
            // getMemory 呼叫，回「已套用新句」的內容——驗證 opAction 在
            // refreshBadge() 之後也重填了文字框，不必使用者關閉再重開 modal。
            getMemory: vi.fn(async () => {
                call += 1;
                const content = call === 1 ? '' : '- [2026-08-23] 模型收斂';
                return {
                    files: { user_profile: { content, limit: 800, updated_at: null },
                             companion_notes: { content: '', limit: 600, updated_at: null } },
                    write_mode: 'approval', pending_count: call === 1 ? 2 : 1,
                };
            }),
        });
        await window.MemoryModule.open();
        window.MemoryModule.showTab('ledger');
        await vi.waitFor(() => {
            expect(document.querySelector('[data-op-approve="11"]')).toBeTruthy();
        });
        expect(document.getElementById('memory-profile-text').value).not.toContain('模型收斂');
        document.querySelector('[data-op-approve="11"]').click();
        await vi.waitFor(() => {
            expect(document.getElementById('memory-profile-text').value).toContain('模型收斂');
        });
    });
});
