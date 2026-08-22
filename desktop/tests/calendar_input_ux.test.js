// @vitest-environment jsdom
/** v2.5 驗收回饋修正：日期欄位點擊即開原生選擇器＋日面板移除重複的新增事件按鈕。 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

describe('calendar input UX fixes', () => {
    beforeEach(async () => {
        delete window.CalendarModule;
        document.body.innerHTML = `
            <div id="calendar-view"></div>
            <div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-day-panel"></div>
            <span class="calendar-month-label"></span>
            <input id="event-title"><textarea id="event-note"></textarea>
            <select id="event-category"><option value="other" selected>其他</option></select>
            <input type="date" id="event-date">
            <input type="checkbox" id="event-all-day" checked><input type="time" id="event-time">
            <select id="event-recurrence"><option value="none" selected>none</option></select>
            <input type="date" id="event-until"><select id="event-reminder"><option value="" selected></option></select>
            <input type="date" id="event-end-date">
            <div id="event-color-swatches"><input type="radio" name="event-color" value="" checked></div>
            <small id="event-multiday-hint" style="display:none"></small>
            <div id="event-error"></div>`;
        // jsdom 沒有 showPicker——綁定在 init 時以 typeof 檢查，先補上 spy
        HTMLInputElement.prototype.showPicker = vi.fn();
        window.ApiService = {
            isAuthenticated: () => true,
            getCalendarEvents: vi.fn(async () => ({ occurrences: [] })),
            getDayNotes: vi.fn(async () => ({ notes: [] })),
        };
        loadScript('js/security_utils.js');
        loadScript('js/mascot.js');
        loadScript('js/i18n.js');
        loadScript('js/calendar_module.js');
        CalendarModule.init();
        await CalendarModule.loadMonth();
    });

    test('「重複到」欄位點任意處＝開啟原生日期選擇器', () => {
        HTMLInputElement.prototype.showPicker.mockClear();
        document.getElementById('event-until').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalled();
    });

    test('日期／結束日期欄位不再走原生 showPicker（改開自製區間選擇器）', () => {
        for (const id of ['event-date', 'event-end-date']) {
            HTMLInputElement.prototype.showPicker.mockClear();
            document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(HTMLInputElement.prototype.showPicker, `${id} 不應呼叫 showPicker`).not.toHaveBeenCalled();
        }
    });

    test('日面板 header 不再有新增事件按鈕（只留工具列右上綠鈕）', () => {
        const panel = document.querySelector('.calendar-day-panel');
        expect(panel.querySelector('.day-panel-header')).toBeTruthy();
        expect(panel.querySelector('[data-action="add"]')).toBeNull();
    });
});
