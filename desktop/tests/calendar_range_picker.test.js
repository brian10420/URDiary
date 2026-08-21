// @vitest-environment jsdom
/** 航空訂票式日期區間選擇器（v2.5 驗收回饋第二輪）。
 *
 * 點日期/結束日期欄開啟自製日曆彈窗：第一次點選起點（保持開啟並標記），
 * 第二次點選終點後自動依前後排序寫回兩欄並關閉；同一天點兩次＝單日
 * （結束日清空）。跨天結果要觸發 syncMultiDayState 的整天鎖定。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

function pickerEl() { return document.getElementById('event-range-picker'); }
function dayBtn(iso) { return pickerEl().querySelector(`[data-range-date="${iso}"]`); }

describe('event date range picker', () => {
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
            <div class="form-group" id="event-date-group">
                <input type="text" id="event-date" readonly>
                <div id="event-range-picker" class="event-range-picker" style="display:none"></div>
            </div>
            <input type="checkbox" id="event-all-day" checked><input type="time" id="event-time">
            <select id="event-recurrence"><option value="none" selected>none</option><option value="weekly">weekly</option></select>
            <input type="date" id="event-until"><select id="event-reminder"><option value="" selected></option></select>
            <input type="text" id="event-end-date" readonly>
            <div id="event-color-swatches"><input type="radio" name="event-color" value="" checked></div>
            <small id="event-multiday-hint" style="display:none"></small>
            <div id="event-error"></div>`;
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
        document.getElementById('event-date').value = '2026-09-15';
        document.getElementById('event-end-date').value = '';
    });

    function openPicker(fieldId = 'event-date') {
        document.getElementById(fieldId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    test('點日期欄開啟彈窗：42 天鈕、含當月日期、月份標籤', () => {
        openPicker();
        expect(pickerEl().style.display).not.toBe('none');
        expect(pickerEl().querySelectorAll('[data-range-date]').length).toBe(42);
        expect(dayBtn('2026-09-15')).toBeTruthy();
        expect(pickerEl().querySelector('.range-picker-label').textContent).toContain('2026');
    });

    test('點結束日期欄也會開啟同一個彈窗', () => {
        openPicker('event-end-date');
        expect(pickerEl().style.display).not.toBe('none');
    });

    test('第一次點選：保持開啟並標記該日', () => {
        openPicker();
        dayBtn('2026-09-22').click();
        expect(pickerEl().style.display).not.toBe('none');
        expect(dayBtn('2026-09-22').classList.contains('range-selected')).toBe(true);
    });

    test('先 22 再 25：起訖寫回、關閉、整天鎖定啟動', () => {
        openPicker();
        dayBtn('2026-09-22').click();
        dayBtn('2026-09-25').click();
        expect(document.getElementById('event-date').value).toBe('2026-09-22');
        expect(document.getElementById('event-end-date').value).toBe('2026-09-25');
        expect(pickerEl().style.display).toBe('none');
        expect(document.getElementById('event-all-day').checked).toBe(true);
        expect(document.getElementById('event-all-day').disabled).toBe(true);
        expect(document.getElementById('event-recurrence').disabled).toBe(true);
    });

    test('先 25 再 22：自動依前後排序（起=22、訖=25）', () => {
        openPicker();
        dayBtn('2026-09-25').click();
        dayBtn('2026-09-22').click();
        expect(document.getElementById('event-date').value).toBe('2026-09-22');
        expect(document.getElementById('event-end-date').value).toBe('2026-09-25');
    });

    test('同一天點兩次＝單日：結束日清空、不鎖整天', () => {
        openPicker();
        dayBtn('2026-09-22').click();
        dayBtn('2026-09-22').click();
        expect(document.getElementById('event-date').value).toBe('2026-09-22');
        expect(document.getElementById('event-end-date').value).toBe('');
        expect(pickerEl().style.display).toBe('none');
        expect(document.getElementById('event-all-day').disabled).toBe(false);
    });

    test('月份導覽：往前再往回，第一次選取保留', () => {
        openPicker();
        dayBtn('2026-09-22').click();
        pickerEl().querySelector('[data-range-nav="-1"]').click();
        expect(pickerEl().style.display).not.toBe('none');
        expect(dayBtn('2026-08-15')).toBeTruthy();   // 8 月格出現
        pickerEl().querySelector('[data-range-nav="1"]').click();
        expect(dayBtn('2026-09-22').classList.contains('range-selected')).toBe(true);
    });

    test('Esc 關閉且欄位不變', () => {
        openPicker();
        dayBtn('2026-09-22').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(pickerEl().style.display).toBe('none');
        expect(document.getElementById('event-date').value).toBe('2026-09-15');
        expect(document.getElementById('event-end-date').value).toBe('');
    });

    test('點彈窗外部關閉', () => {
        openPicker();
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(pickerEl().style.display).toBe('none');
    });
});
