// @vitest-environment jsdom
/** 事件表單跨天＋顏色 (v2.5 Spec A)：readForm/buildFormValues/syncMultiDayState。 */
import { describe, test, beforeEach, expect } from 'vitest';
import { loadScript } from './helpers/load.js';

function buildFormDom() {
    document.body.innerHTML = `
        <input id="event-title" value="旅行"><textarea id="event-note"></textarea>
        <select id="event-category"><option value="travel" selected>出遊</option><option value="other">其他</option></select>
        <input id="event-date" value="2026-09-01">
        <input type="checkbox" id="event-all-day" checked><input id="event-time" value="09:00">
        <select id="event-recurrence"><option value="none" selected>none</option><option value="weekly">weekly</option></select>
        <input id="event-until"><select id="event-reminder"><option value="" selected></option></select>
        <input id="event-end-date" value="">
        <div id="event-color-swatches">
            <input type="radio" name="event-color" value="" checked>
            <input type="radio" name="event-color" value="#8f62c9">
        </div>
        <small id="event-multiday-hint" style="display:none"></small>
        <div id="event-error"></div>`;
}

describe('multi-day form', () => {
    beforeEach(() => { buildFormDom(); loadScript('js/calendar_module.js'); });

    test('readForm：空結束日＝null、預設色＝null', () => {
        const form = CalendarModule.readForm();
        expect(form.end_date).toBeNull();
        expect(form.color).toBeNull();
    });

    test('readForm：帶結束日與選色', () => {
        document.getElementById('event-end-date').value = '2026-09-03';
        document.querySelector('input[name="event-color"][value="#8f62c9"]').checked = true;
        const form = CalendarModule.readForm();
        expect(form.end_date).toBe('2026-09-03');
        expect(form.color).toBe('#8f62c9');
    });

    test('syncMultiDayState：設了結束日＝鎖全天/時間/重複/提醒＋顯示提示', () => {
        document.getElementById('event-end-date').value = '2026-09-03';
        CalendarModule.syncMultiDayState();
        expect(document.getElementById('event-all-day').checked).toBe(true);
        expect(document.getElementById('event-all-day').disabled).toBe(true);
        expect(document.getElementById('event-time').disabled).toBe(true);
        expect(document.getElementById('event-recurrence').disabled).toBe(true);
        expect(document.getElementById('event-multiday-hint').style.display).not.toBe('none');
        document.getElementById('event-end-date').value = '';
        CalendarModule.syncMultiDayState();
        expect(document.getElementById('event-all-day').disabled).toBe(false);
        expect(document.getElementById('event-recurrence').disabled).toBe(false);
    });

    test('buildFormValues：occurrence 帶 end_date/color 時預填', () => {
        const values = CalendarModule.buildFormValues({
            title: 't', note: null, category: 'travel', event_date: '2026-09-01',
            time: null, recurrence: 'none', recurrence_until: null,
            reminder_minutes: null, end_date: '2026-09-03', color: '#8f62c9',
        }, null);
        expect(values.end_date).toBe('2026-09-03');
        expect(values.color).toBe('#8f62c9');
    });
});
