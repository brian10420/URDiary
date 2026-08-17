// @vitest-environment jsdom
/** 月格印章徽章＋日面板 P1 印章卡 (v2.5 Spec A)。 */
import { describe, test, beforeEach, expect, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

const NOTE = { date: null, stamp: 'cake', phrase: '幫媽媽慶生的這天，你把愛做成了行動', source_diary_id: 7 };

function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('calendar day notes', () => {
    beforeEach(async () => {
        document.body.innerHTML = `
            <div id="calendar-view"></div>
            <div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-day-panel"></div>
            <span class="calendar-month-label"></span>`;
        NOTE.date = isoToday();
        window.ApiService = {
            isAuthenticated: () => true,
            getCalendarEvents: vi.fn(async () => ({ occurrences: [] })),
            getDayNotes: vi.fn(async () => ({ notes: [NOTE] })),
            deleteDayNote: vi.fn(async () => ({ message: 'ok' })),
        };
        loadScript('js/security_utils.js');
        loadScript('js/mascot.js');
        loadScript('js/i18n.js');
        // calendar_module.js（不像 mascot.js／i18n.js）沒有檔尾無條件的
        // `window.CalendarModule = CalendarModule`，只靠 helpers/load.js
        // 附加的「window.CalendarModule 目前是 undefined 才賦值」保護。
        // 本檔每個 test 都在 beforeEach 重新 loadScript＋重建整個 DOM
        // （含 .calendar-day-panel），若不先清掉舊繫結，第 2 個以後的
        // test 會讓 CalendarModule 全域一直指向第 1 個 test 的舊 closure，
        // 其 bindListeners() 只執行過一次（見 listenersBound 旗標），
        // click 監聽器就停留在第 1 個 test 那個已從文件脫離的舊
        // .calendar-day-panel 節點上，後面 test 的點擊事件永遠傳不到——
        // 這裡強制清掉，讓每個 test 都拿到全新 closure、重新綁定監聽器。
        delete window.CalendarModule;
        loadScript('js/calendar_module.js');
        CalendarModule.init();
        await CalendarModule.loadMonth();
    });

    test('月格有 14px 印章徽章、title 帶小語', () => {
        const cell = document.querySelector(`[data-date="${NOTE.date}"]`);
        expect(cell.innerHTML).toContain('cell-stamp');
        expect(cell.innerHTML).toContain('width="14"');
        expect(cell.innerHTML).toContain('幫媽媽慶生');
    });

    test('日面板 P1：印章卡在最上、40px、含小語與刪除鍵', () => {
        const panel = document.querySelector('.calendar-day-panel');
        expect(panel.innerHTML).toContain('day-stamp-card');
        expect(panel.innerHTML).toContain('width="40"');
        expect(panel.innerHTML).toContain('幫媽媽慶生');
        expect(panel.querySelector('[data-action="delete-note"]')).toBeTruthy();
        // 印章卡在事件區塊之前
        const html = panel.innerHTML;
        expect(html.indexOf('day-stamp-card')).toBeLessThan(html.indexOf('day-panel-empty'));
    });

    test('刪除印章：確認後打 API 並移除卡片', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        document.querySelector('[data-action="delete-note"]').click();
        await Promise.resolve(); await Promise.resolve();
        expect(window.ApiService.deleteDayNote).toHaveBeenCalledWith(NOTE.date);
        expect(document.querySelector('.day-stamp-card')).toBeNull();
    });

    test('day-notes 載入失敗不影響月曆', async () => {
        window.ApiService.getDayNotes = vi.fn(async () => { throw new Error('boom'); });
        await CalendarModule.loadMonth();
        expect(document.querySelectorAll('[data-date]').length).toBe(42);
    });
});
