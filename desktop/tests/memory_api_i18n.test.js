// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

describe('memory api wrappers + i18n keys', () => {
    beforeAll(() => {
        loadCoreScripts();
        loadScript('js/error_logger.js');
        loadScript('js/secure_store.js');
        // RULING R4：accessToken 是 api_service.js 載入當下從 localStorage 讀進
        // 閉包變數的快照，必須在 loadScript('js/api_service.js') 之前設定，且
        // 鍵名是 'auth_token'（不是 'urDiary_accessToken'），才會生效。
        localStorage.setItem('auth_token', 't');
        loadScript('js/api_service.js');
    });

    it('exposes memory api functions', () => {
        for (const fn of ['getMemory', 'saveMemoryFile', 'saveMemorySettings',
                          'getMemoryOps', 'memoryOpAction', 'memoryBatchAction']) {
            expect(typeof window.ApiService[fn], fn).toBe('function');
        }
    });

    it('hits the right endpoints with the right methods', async () => {
        const calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
            return new Response(JSON.stringify({ ok: true, ops: [] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
        }));
        await window.ApiService.getMemory();
        await window.ApiService.saveMemoryFile('user_profile', 'abc');
        await window.ApiService.saveMemorySettings('approval');
        await window.ApiService.getMemoryOps();
        await window.ApiService.memoryOpAction(7, 'approve');
        await window.ApiService.memoryBatchAction('b-1', 'reject');
        const urls = calls.map(c => `${c.method} ${c.url}`);
        expect(urls.some(u => u.includes('GET') && u.includes('/users/me/memory') && !u.includes('/ops'))).toBe(true);
        expect(urls.some(u => u.includes('PUT') && u.includes('/users/me/memory/files/user_profile'))).toBe(true);
        expect(urls.some(u => u.includes('PUT') && u.includes('/users/me/memory/settings'))).toBe(true);
        expect(urls.some(u => u.includes('GET') && u.includes('/users/me/memory/ops'))).toBe(true);
        expect(urls.some(u => u.includes('POST') && u.includes('/users/me/memory/ops/7/approve'))).toBe(true);
        expect(urls.some(u => u.includes('POST') && u.includes('/users/me/memory/batches/b-1/reject'))).toBe(true);
        const putBody = JSON.parse(calls.find(c => c.url.includes('/files/user_profile')).body);
        expect(putBody).toEqual({ content: 'abc' });
        vi.unstubAllGlobals();
    });

    it('i18n has every memory key in both languages', () => {
        loadScript('js/i18n.js');
        const keys = ['memory.title', 'memory.tabProfile', 'memory.tabCompanion', 'memory.tabLedger',
            'memory.profileHint', 'memory.companionHint', 'memory.count', 'memory.nearLimit',
            'memory.save', 'memory.revert', 'memory.saved', 'memory.tooLong',
            'memory.askFirst', 'memory.askFirstNote', 'memory.manage', 'memory.pendingCount',
            'memory.ledgerHint', 'memory.approvalBanner', 'memory.opAdd', 'memory.opReplace',
            'memory.opRemove', 'memory.opUserEdit', 'memory.stApplied', 'memory.stPending',
            'memory.stRejected', 'memory.stUndone', 'memory.stStale', 'memory.stFailed',
            'memory.undo', 'memory.approve', 'memory.reject', 'memory.approveAll', 'memory.rejectAll',
            'memory.fromDiary', 'memory.selfEdit', 'memory.pendingNotice', 'memory.goSee',
            'memory.emptyLedger', 'memory.actionFailed', 'memory.fileProfile', 'memory.fileCompanion'];
        for (const lang of ['zh-TW', 'en']) {
            // RULING R3：真正的切換函式是 setLang（i18n.js:604），不是 setLanguage
            window.I18N.setLang(lang);
            for (const key of keys) {
                const value = window.I18N.t(key);
                expect(value, `${lang} ${key}`).not.toBe(key); // 缺鍵時 t() 回鍵名
            }
        }
    });
});
