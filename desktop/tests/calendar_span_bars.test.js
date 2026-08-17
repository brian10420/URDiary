// @vitest-environment jsdom
/** 跨天橫槓：span 事件收集與週段落/lane 計算 (v2.5 Spec A)。 */
import { describe, test, beforeEach, expect } from 'vitest';
import { loadScript } from './helpers/load.js';

function occ(overrides) {
    return Object.assign({
        event_id: 1, title: '旅行', category: 'travel', color: null,
        date: '2026-09-01', event_date: '2026-09-01', end_date: '2026-09-03',
        span_day: 1, span_total: 3, time: null, recurrence: 'none',
    }, overrides);
}

describe('span bars', () => {
    beforeEach(() => { loadScript('js/calendar_module.js'); });

    test('collectSpanEvents：只收 span_total>1、依 event_id 去重', () => {
        const events = CalendarModule.collectSpanEvents([
            occ({ date: '2026-09-01', span_day: 1 }),
            occ({ date: '2026-09-02', span_day: 2 }),
            occ({ event_id: 2, span_total: 1, span_day: null, end_date: null }),
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ eventId: 1, start: '2026-09-01', end: '2026-09-03' });
    });

    test('週內段落：起訖同週＝兩端圓角、colStart/colEnd 正確（2026-08-31 是週一）', () => {
        const segs = CalendarModule.computeWeekSegments(
            [{ eventId: 1, title: '旅行', category: 'travel', color: null, start: '2026-09-01', end: '2026-09-03' }],
            '2026-08-31').segments;
        expect(segs).toHaveLength(1);
        expect(segs[0]).toMatchObject({ colStart: 2, colEnd: 4, roundLeft: true, roundRight: true, lane: 0, showTitle: true });
    });

    test('跨週事件：前段不封右圓角、後段不封左圓角、標題只在首段', () => {
        const ev = [{ eventId: 1, title: '長旅', category: 'travel', color: '#8f62c9', start: '2026-09-05', end: '2026-09-08' }];
        const w1 = CalendarModule.computeWeekSegments(ev, '2026-08-31').segments[0]; // 週六日
        const w2 = CalendarModule.computeWeekSegments(ev, '2026-09-07').segments[0]; // 週一二
        expect(w1).toMatchObject({ colStart: 6, colEnd: 7, roundRight: false, showTitle: true });
        expect(w2).toMatchObject({ colStart: 1, colEnd: 2, roundLeft: false, showTitle: false });
    });

    test('lane 分配：兩條並存、第三條進 overflow 計數', () => {
        const evs = [
            { eventId: 1, title: 'A', category: 'work', color: null, start: '2026-09-01', end: '2026-09-03' },
            { eventId: 2, title: 'B', category: 'family', color: null, start: '2026-09-02', end: '2026-09-04' },
            { eventId: 3, title: 'C', category: 'other', color: null, start: '2026-09-02', end: '2026-09-03' },
        ];
        const out = CalendarModule.computeWeekSegments(evs, '2026-08-31');
        expect(out.segments.map(s => s.lane).sort()).toEqual([0, 1]);
        expect(out.overflow.get('2026-09-02')).toBe(1);
        expect(out.overflow.get('2026-09-03')).toBe(1);
        // 同起日（B id2／C id3 皆 09-02）tie-break 鎖定：id 小者先佔道，
        // 上面三個斷言在「comparator 反過來、C 贏」的錯誤情境下也會全部通過
        // （C 的 09-02~09-03 範圍與 B 一樣會標到 overflow 的這兩天、lane 也仍是 [0,1]），
        // 唯獨「誰進了 segments／誰的尾巴 09-04 被標記」才分得出來：
        expect(out.segments.map(s => s.eventId).sort()).toEqual([1, 2]);   // B(id2) 佔到道，C(id3) 才 overflow
        expect(out.overflow.has('2026-09-04')).toBe(false);                // 若 B 才是 overflow 者，B 的尾巴 09-04 會被標記
    });

    test('與週無交集＝空結果', () => {
        const out = CalendarModule.computeWeekSegments(
            [{ eventId: 1, title: 'x', category: 'other', color: null, start: '2026-10-01', end: '2026-10-02' }],
            '2026-08-31');
        expect(out.segments).toEqual([]);
    });
});
