// @vitest-environment jsdom
/** 年月 picker (v2.5 Spec A #9)。 */
import { describe, test, beforeEach, expect } from 'vitest';
import { loadScript } from './helpers/load.js';

describe('year picker', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="calendar-view"></div><div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div><div class="calendar-day-panel"></div>
            <button id="calendar-ym-btn"><span class="calendar-month-label"></span></button>
            <div id="calendar-ym-picker" style="display:none"></div>`;
        window.ApiService = { isAuthenticated: () => false, getCalendarEvents: async () => ({ occurrences: [] }) };
        window.I18N = { t: k => k, dateLocale: () => 'zh-TW' };   // picker 與週標頭都會用到
        loadScript('js/security_utils.js');   // renderWeekdays 等會呼叫 escapeHtml
        // 見 calendar_day_notes.test.js 同段註解：每個 test 都重建 DOM，
        // 若不清掉舊繫結，第 2 個以後的 test 會拿到第 1 個 test 的舊
        // closure（listenersBound 已是 true），click 監聽器停留在已脫離
        // 文件的舊按鈕節點上，新按鈕點了沒反應。
        delete window.CalendarModule;
        loadScript('js/calendar_module.js');
        CalendarModule.init();
    });

    test('點年月鈕開 picker：含 21 個年份與 12 個月份鈕', () => {
        document.getElementById('calendar-ym-btn').click();
        const picker = document.getElementById('calendar-ym-picker');
        expect(picker.style.display).not.toBe('none');
        expect(picker.querySelectorAll('[data-ym-year]').length).toBe(21);
        expect(picker.querySelectorAll('[data-ym-month]').length).toBe(12);
    });

    test('選年再選月＝跳轉並關閉', () => {
        document.getElementById('calendar-ym-btn').click();
        const picker = document.getElementById('calendar-ym-picker');
        picker.querySelector('[data-ym-year="2030"]').click();
        expect(picker.style.display).not.toBe('none');       // 選年不關
        picker.querySelector('[data-ym-month="3"]').click();  // 0-based：3 = 4 月
        expect(picker.style.display).toBe('none');
        expect(document.querySelector('.calendar-month-label').textContent).toContain('2030');
    });
});
