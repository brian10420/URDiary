// @vitest-environment jsdom
import { describe, test, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 10：行事曆印章壓印——只有「剛存的那篇日記」蓋出的新章、第一次出現時
 * 壓一次；既有的章第一次打開行事曆也不動；安靜篇與沒開印章不壓；換帳號清空。
 * fixture 比照 tests/calendar_day_notes.test.js。
 */
function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('createStampPressTracker（純函式）', () => {
    let tracker;
    beforeEach(() => {
        delete window.CalendarModule;
        loadCoreScripts();
        loadScript('js/calendar_module.js');
        tracker = CalendarModule.createStampPressTracker();
    });

    const note = (date, id) => ({ date, stamp: 'cake', phrase: 'x', source_diary_id: id });

    it('沒有登記過：既有的章一律不壓（首次打開行事曆不會整片亂跳）', () => {
        expect([...tracker.take([note('2026-09-01', 3), note('2026-09-02', 4)])]).toEqual([]);
    });

    it('登記的日記 id 對上 source_diary_id：回傳那天，且只回一次（不重播）', () => {
        tracker.expect(7);
        const notes = [note('2026-09-01', 3), note('2026-09-30', 7)];
        expect([...tracker.take(notes)]).toEqual(['2026-09-30']);
        expect([...tracker.take(notes)]).toEqual([]);
        expect(tracker.size()).toBe(0);
    });

    it('id 型別寬鬆比對（後端數字、事件字串都算同一篇）', () => {
        tracker.expect('12');
        expect([...tracker.take([note('2026-09-30', 12)])]).toEqual(['2026-09-30']);
    });

    it('章還沒出現在這次清單（例如翻到別的月）：保留到真的出現那次', () => {
        tracker.expect(9);
        expect([...tracker.take([note('2026-09-01', 3)])]).toEqual([]);
        expect(tracker.size()).toBe(1);
        expect([...tracker.take([note('2026-10-02', 9)])]).toEqual(['2026-10-02']);
    });

    it('沒有 source_diary_id 的章、空 id、非陣列輸入：安全略過', () => {
        tracker.expect(null);
        tracker.expect('');
        tracker.expect(5);
        expect([...tracker.take([{ date: '2026-09-30', stamp: 'cake', source_diary_id: null }])]).toEqual([]);
        expect([...tracker.take(null)]).toEqual([]);
        tracker.clear();
        expect(tracker.size()).toBe(0);
    });
});

describe('行事曆接線：urdiary:diary-saved → 下一次載入壓印一次', () => {
    let NOTE;
    beforeEach(async () => {
        document.body.innerHTML = `
            <div id="calendar-view"></div>
            <div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-day-panel"></div>
            <span class="calendar-month-label"></span>`;
        NOTE = { date: isoToday(), stamp: 'cake', phrase: '做了一件勇敢的事', source_diary_id: 7 };
        window.ApiService = {
            isAuthenticated: () => true,
            getCalendarEvents: vi.fn(async () => ({ occurrences: [] })),
            getDayNotes: vi.fn(async () => ({ notes: [NOTE] })),
        };
        loadScript('js/security_utils.js');
        loadScript('js/mascot.js');
        loadScript('js/i18n.js');
        delete window.CalendarModule;          // 理由見 calendar_day_notes.test.js
        loadScript('js/calendar_module.js');
        CalendarModule.init();
        await CalendarModule.loadMonth();
    });
    afterEach(() => { delete window.MascotMotion; });

    const pressed = () => document.querySelectorAll('.mm-stamp-press');
    const saved = (detail) => document.dispatchEvent(new CustomEvent('urdiary:diary-saved', { detail }));

    test('首次載入（沒有剛存的日記）：既有的章不壓', () => {
        expect(document.querySelector('.cell-stamp')).not.toBeNull();
        expect(pressed().length).toBe(0);
    });

    test('存了日記 7 之後載入：月格徽章與日面板印章卡都壓一次；之後重繪／再載入都不重播', async () => {
        saved({ diaryId: 7, quiet: false, dayNote: true });
        await CalendarModule.loadMonth();
        expect(document.querySelector('.cell-stamp.mm-stamp-press')).not.toBeNull();
        expect(document.querySelector('.day-stamp-card.mm-stamp-press')).not.toBeNull();
        document.querySelector(`[data-date="${NOTE.date}"]`).click();   // selectDate → 重繪
        expect(pressed().length).toBe(0);
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('別篇日記存檔：這張章（屬於日記 7）不壓', async () => {
        saved({ diaryId: 8, quiet: false, dayNote: true });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('安靜篇（valence<0.45）與沒開 AI 印章：不壓', async () => {
        saved({ diaryId: 7, quiet: true, dayNote: true });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
        saved({ diaryId: 7, quiet: false, dayNote: false });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('換帳號（reset）：前一個帳號等著壓的章清空', async () => {
        saved({ diaryId: 7, quiet: false, dayNote: true });
        CalendarModule.reset();
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('reduced-motion：不加動畫 class，但照樣消耗（之後關掉偏好也不補播）', async () => {
        window.MascotMotion = { isReducedMotion: () => true };
        saved({ diaryId: 7, quiet: false, dayNote: true });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
        window.MascotMotion = { isReducedMotion: () => false };
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });
});

describe('chat_module：存日記成功才廣播 urdiary:diary-saved（只帶操作結果）', () => {
    const CHAT_HTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-input-area"><div class="chat-input-wrapper">
                <textarea id="user-input"></textarea><button id="send-button"></button>
            </div></div>
            <button id="end-chat-btn"></button><button id="clear-chat-btn"></button>
        </div>`;
    let events;
    const listener = (e) => events.push(e.detail);

    beforeEach(() => {
        loadCoreScripts();
        loadScript('js/mascot.js');
        loadScript('js/chat_module.js');
        localStorage.clear();
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
        ChatModule.reset();
        ChatModule.init();
        events = [];
        document.addEventListener('urdiary:diary-saved', listener);
        vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14);
    });
    afterEach(() => {
        document.removeEventListener('urdiary:diary-saved', listener);
        vi.restoreAllMocks();
    });

    it('正向日記：{diaryId, quiet:false, dayNote:true}，沒有任何內容欄位', async () => {
        window.ApiService = { endChat: vi.fn(async () => ({
            message: 'ok', diary: { diary_id: 21, title: '秘密標題', content: '秘密內容', valence: 0.8 } })) };
        await ChatModule.endChat();
        expect(events).toEqual([{ diaryId: 21, quiet: false, dayNote: true }]);
    });

    it('低落日記（valence<0.45）：quiet:true；關掉 AI 印章：dayNote:false', async () => {
        localStorage.setItem('urdiary_day_note_enabled', '0');
        window.ApiService = { endChat: vi.fn(async () => ({
            message: 'ok', diary: { diary_id: 22, valence: 0.2 } })) };
        await ChatModule.endChat();
        expect(events).toEqual([{ diaryId: 22, quiet: true, dayNote: false }]);
    });

    it('存日記失敗：不廣播', async () => {
        window.ApiService = { endChat: vi.fn(async () => { throw new Error('boom'); }) };
        await ChatModule.endChat();
        expect(events).toEqual([]);
    });
});
