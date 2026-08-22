// @vitest-environment jsdom
/** 切回行事曆視圖必須重新載入（v2.5 驗收回饋）。
 *
 * 日記在 /chat/end 結束時由伺服器端蓋當日 AI 印章——使用者接著切回行事曆，
 * 資料必須重抓才看得到剛蓋的章。舊的 loadedOnce 惰性首載會讓印章直到重啟
 * 都不出現。
 *
 * 單獨成檔：viewStateChanged 監聽器綁在 document 上，同檔多次 loadScript
 * 會累積殭屍監聽器讓呼叫次數不可預測；本檔只載入一次、斷言精確 +1。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

describe('calendar view re-entry reload', () => {
    beforeEach(async () => {
        delete window.CalendarModule;
        document.body.innerHTML = `
            <div id="calendar-view"></div>
            <div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-day-panel"></div>
            <span class="calendar-month-label"></span>`;
        window.ApiService = {
            isAuthenticated: () => true,
            getCalendarEvents: vi.fn(async () => ({ occurrences: [] })),
            getDayNotes: vi.fn(async () => ({ notes: [] })),
        };
        window.UIManager = {
            VIEW_STATE: { CALENDAR_FULL: 'calendar_full' },
            getCurrentState: () => 'chat',   // init 時不在行事曆，避免多算一次載入
            showToast: () => {},
        };
        loadScript('js/security_utils.js');
        loadScript('js/mascot.js');
        loadScript('js/i18n.js');
        loadScript('js/calendar_module.js');
        CalendarModule.init();
        await CalendarModule.loadMonth();
    });

    test('viewStateChanged 進行事曆＝重新抓事件與印章（不吃惰性快取）', async () => {
        const eventsBefore = window.ApiService.getCalendarEvents.mock.calls.length;
        const notesBefore = window.ApiService.getDayNotes.mock.calls.length;
        document.dispatchEvent(new CustomEvent('viewStateChanged', { detail: { newState: 'calendar_full' } }));
        await Promise.resolve(); await Promise.resolve();
        expect(window.ApiService.getCalendarEvents.mock.calls.length).toBe(eventsBefore + 1);
        expect(window.ApiService.getDayNotes.mock.calls.length).toBe(notesBefore + 1);
    });
});
