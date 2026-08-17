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

    // --- final-review fixes（本檔是唯一有完整渲染出 grid＋day panel 的 fixture）---

    test('Fix 1 回歸鎖：月格皆帶 inline grid-row/grid-column，不依賴 CSS Grid 自動排列', () => {
        // .calendar-grid 沒有 grid-template-rows：42 格與跨天橫槓／+N 溢出徽章
        // 共用同一份隱式格線。CSS Grid 的 sparse 自動排列規則會先安置「兩軸皆
        // 定位」的顯式子項，讓沒有定位的項目跳過已佔用格依序排——一旦有橫槓，
        // 42 格會整批被擠位、列數從 6 長成 7（headless Chromium 對真實樣式表
        // 已實測證實；jsdom 不跑版面配置量不出這個回歸，這裡只鎖「每格都有
        // 顯式定位」這個前提本身，真正的視覺回歸留給 Chromium repro 顧）。
        const cells = document.querySelectorAll('.calendar-grid [data-date]');
        expect(cells.length).toBe(42);
        cells.forEach((cell, i) => {
            expect(cell.style.gridRow).toBe(String(Math.floor(i / 7) + 1));
            expect(cell.style.gridColumn).toBe(String((i % 7) + 1));
        });
    });

    test('Fix 2：日面板跨天事件帶「第 N 天／共 M 天」徽章＋左緣 4px 色條 (spec §4 P1 item 2)', async () => {
        window.ApiService.getCalendarEvents = vi.fn(async () => ({
            occurrences: [{
                event_id: 9, title: '花蓮小旅行', category: 'travel', color: '#8f62c9',
                date: NOTE.date, event_date: NOTE.date, end_date: NOTE.date,
                time: null, note: null, recurrence: 'none', reminder_minutes: null,
                span_day: 2, span_total: 3,
            }],
        }));
        await CalendarModule.loadMonth();

        const row = document.querySelector('.day-event');
        expect(row).toBeTruthy();
        // 用同引擎解析一份參照值來比較，繞開 jsdom 顏色/簡寫屬性序列化的細節
        // （不同 jsdom 版本對 "#rrggbb" 是否轉成 rgb() 字串不保證一致）。
        const probe = document.createElement('div');
        probe.style.borderLeft = '4px solid #8f62c9';
        expect(row.style.borderLeft).toBe(probe.style.borderLeft);
        expect(row.querySelector('.day-event-span-badge').textContent).toBe('第 2 天／共 3 天');
    });
});
