// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * CalendarModule 的兩個純函式（monthGridRange / computeReminderTimes）單元測試。
 *
 * 這兩個函式是整個日曆前端唯一「錯了不會馬上看出來」的部分：
 * 月曆格邊界算錯會讓某些月份少掉月首/月末那一格，提醒時間算錯只會在
 * 真的到點的那一刻才出錯（CDP 難以覆蓋跨月/跨年與各種時間邊界）。
 * 兩者都只吃參數、只回值、不碰 DOM 與網路，因此適合在這裡完整測。
 *
 * 時間一律用本地時間建構（new Date(y, m, d, hh, mm)），不用 UTC 字串 ——
 * 實作也必須以本地牆上時間為準（後端 calendar_service 的日期基準同樣是
 * 真實本地日期），用 toISOString() 會在非 UTC 時區整個偏掉一天。
 */
describe('CalendarModule 純函式', () => {
    beforeAll(() => {
        loadCoreScripts();
        loadScript('js/calendar_module.js');
    });

    describe('monthGridRange(year, month)', () => {
        // month 為 0-based（與 JS Date 一致）
        const cases = [
            { label: '2026-02（平年 2 月，1 號是週日 → 往前補滿 6 格）', y: 2026, m: 1, startIso: '2026-01-26', endIso: '2026-03-08' },
            { label: '2024-02（閏年 2 月 29 天）', y: 2024, m: 1, startIso: '2024-01-29', endIso: '2024-03-10' },
            { label: '2026-01（跨年：起日落在前一年 12 月）', y: 2026, m: 0, startIso: '2025-12-29', endIso: '2026-02-08' },
            { label: '2025-12（跨年：迄日落在次年 1 月，且 1 號正好是週一）', y: 2025, m: 11, startIso: '2025-12-01', endIso: '2026-01-11' },
            { label: '2026-08（31 天月，1 號是週六）', y: 2026, m: 7, startIso: '2026-07-27', endIso: '2026-09-06' }
        ];

        cases.forEach(({ label, y, m, startIso, endIso }) => {
            it(`${label} 的邊界正確`, () => {
                expect(CalendarModule.monthGridRange(y, m)).toEqual({ startIso, endIso });
            });
        });

        it('恆為 42 格（6 週 × 7 天），且跨度未超過後端 62 天上限', () => {
            for (let y = 2024; y <= 2027; y++) {
                for (let m = 0; m < 12; m++) {
                    const { startIso, endIso } = CalendarModule.monthGridRange(y, m);
                    const start = new Date(`${startIso}T00:00:00`);
                    const end = new Date(`${endIso}T00:00:00`);
                    const spanDays = Math.round((end - start) / 86400000);
                    expect(spanDays, `${y}-${m + 1} 的跨度`).toBe(41); // 首尾都含 → 42 格
                    expect(spanDays).toBeLessThanOrEqual(62);
                }
            }
        });

        it('起日一定是週一、迄日一定是週日', () => {
            for (let y = 2024; y <= 2027; y++) {
                for (let m = 0; m < 12; m++) {
                    const { startIso, endIso } = CalendarModule.monthGridRange(y, m);
                    expect(new Date(`${startIso}T00:00:00`).getDay(), `${startIso} 應為週一`).toBe(1);
                    expect(new Date(`${endIso}T00:00:00`).getDay(), `${endIso} 應為週日`).toBe(0);
                }
            }
        });

        it('42 格一定完整含住該月的第一天與最後一天', () => {
            for (let y = 2024; y <= 2027; y++) {
                for (let m = 0; m < 12; m++) {
                    const { startIso, endIso } = CalendarModule.monthGridRange(y, m);
                    const firstIso = CalendarModule.toIsoDate(new Date(y, m, 1));
                    const lastIso = CalendarModule.toIsoDate(new Date(y, m + 1, 0));
                    expect(startIso <= firstIso, `${startIso} 應 <= ${firstIso}`).toBe(true);
                    expect(endIso >= lastIso, `${endIso} 應 >= ${lastIso}`).toBe(true);
                }
            }
        });
    });

    describe('toIsoDate(date)', () => {
        it('用本地日期欄位組字串，不受 UTC 位移影響', () => {
            // 本地時間 23:30 —— 若誤用 toISOString()，在 UTC+8 會變成隔天
            expect(CalendarModule.toIsoDate(new Date(2026, 7, 4, 23, 30))).toBe('2026-08-04');
            // 個位數月/日要補零
            expect(CalendarModule.toIsoDate(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
        });
    });

    describe('computeReminderTimes(occurrences, now)', () => {
        const TODAY = '2026-08-04';
        const now = new Date(2026, 7, 4, 13, 0); // 2026-08-04 13:00 本地

        function occ(overrides) {
            return Object.assign({
                event_id: 1,
                title: '事件',
                note: null,
                category: 'work',
                date: TODAY,
                time: '14:00',
                recurrence: 'none',
                reminder_minutes: 30
            }, overrides);
        }

        it('fireAt = 事件時刻 − reminder_minutes（14:00 − 30 分 = 13:30）', () => {
            const [item] = CalendarModule.computeReminderTimes([occ({})], now);
            expect(item.fireAt.getTime()).toBe(new Date(2026, 7, 4, 13, 30).getTime());
            expect(item.eventTime.getTime()).toBe(new Date(2026, 7, 4, 14, 0).getTime());
        });

        it('key 為 `${date}_${event_id}`', () => {
            const [item] = CalendarModule.computeReminderTimes([occ({ event_id: 42 })], now);
            expect(item.key).toBe('2026-08-04_42');
        });

        it('回傳項目帶著原 occurrence 物件', () => {
            const source = occ({ title: '看牙醫' });
            const [item] = CalendarModule.computeReminderTimes([source], now);
            expect(item.occurrence).toBe(source);
        });

        it('全天事件（time = null）排除', () => {
            expect(CalendarModule.computeReminderTimes([occ({ time: null })], now)).toEqual([]);
        });

        it('未設提醒（reminder_minutes = null）排除', () => {
            expect(CalendarModule.computeReminderTimes([occ({ reminder_minutes: null })], now)).toEqual([]);
        });

        it('reminder_minutes = 0 不當成「未設提醒」，fireAt 即事件時刻', () => {
            const [item] = CalendarModule.computeReminderTimes([occ({ reminder_minutes: 0 })], now);
            expect(item.fireAt.getTime()).toBe(new Date(2026, 7, 4, 14, 0).getTime());
        });

        it('非今天的 occurrence 排除（昨天與明天都不算）', () => {
            const others = [occ({ date: '2026-08-03' }), occ({ date: '2026-08-05' })];
            expect(CalendarModule.computeReminderTimes(others, now)).toEqual([]);
        });

        it('事件時刻已過的排除（12:00 的事件在 13:00 不再提醒）', () => {
            expect(CalendarModule.computeReminderTimes([occ({ time: '12:00' })], now)).toEqual([]);
        });

        it('事件時刻正好等於 now 的排除（已到點，提醒失去意義）', () => {
            expect(CalendarModule.computeReminderTimes([occ({ time: '13:00' })], now)).toEqual([]);
        });

        it('尚未到 fireAt 的仍會回傳（由呼叫端決定何時觸發）', () => {
            // 23:00 的事件、提醒 5 分 → fireAt 22:55，遠在 now 之後，但事件還沒過
            const [item] = CalendarModule.computeReminderTimes([occ({ time: '23:00', reminder_minutes: 5 })], now);
            expect(item.fireAt.getTime()).toBe(new Date(2026, 7, 4, 22, 55).getTime());
        });

        it('提醒 1440 分（1 天前）會讓 fireAt 落在昨天，仍照實回傳', () => {
            const [item] = CalendarModule.computeReminderTimes([occ({ reminder_minutes: 1440 })], now);
            expect(item.fireAt.getTime()).toBe(new Date(2026, 7, 3, 14, 0).getTime());
        });

        it('多筆結果依 fireAt 由早到晚排序', () => {
            const list = [
                occ({ event_id: 3, time: '20:00', reminder_minutes: 10 }), // fireAt 19:50
                occ({ event_id: 1, time: '14:00', reminder_minutes: 30 }), // fireAt 13:30
                occ({ event_id: 2, time: '18:00', reminder_minutes: 60 })  // fireAt 17:00
            ];
            expect(CalendarModule.computeReminderTimes(list, now).map(i => i.event_id || i.occurrence.event_id))
                .toEqual([1, 2, 3]);
        });

        it('空清單 / 非陣列輸入回傳空陣列，不丟例外', () => {
            expect(CalendarModule.computeReminderTimes([], now)).toEqual([]);
            expect(CalendarModule.computeReminderTimes(null, now)).toEqual([]);
            expect(CalendarModule.computeReminderTimes(undefined, now)).toEqual([]);
        });

        it('時間格式無效的 occurrence 排除，不產生 Invalid Date', () => {
            const bad = [occ({ time: '不是時間' }), occ({ time: '25:00' }), occ({ time: '14' })];
            expect(CalendarModule.computeReminderTimes(bad, now)).toEqual([]);
        });
    });

    /**
     * 提醒快照要不要更新的判斷。這是「翻月之後提醒就再也不會響」那個 bug 的核心：
     * 月曆索引只服務目前顯示的月份，只有當本次載入的範圍真的涵蓋今天時，
     * 才能拿它去更新提醒快照；不涵蓋時必須保留舊快照，而不是清成空的。
     */
    describe('rangeCoversDate(startIso, endIso, dateIso)', () => {
        it('今天落在範圍內（含頭含尾）→ true', () => {
            expect(CalendarModule.rangeCoversDate('2026-07-27', '2026-09-06', '2026-08-05')).toBe(true);
            expect(CalendarModule.rangeCoversDate('2026-07-27', '2026-09-06', '2026-07-27')).toBe(true); // 起日
            expect(CalendarModule.rangeCoversDate('2026-07-27', '2026-09-06', '2026-09-06')).toBe(true); // 迄日
        });

        it('今天落在範圍外 → false（翻到下個月的實際區間）', () => {
            // 2026-09 的 42 格是 08-31 ~ 10-11，不含 08-05
            expect(CalendarModule.rangeCoversDate('2026-08-31', '2026-10-11', '2026-08-05')).toBe(false);
            expect(CalendarModule.rangeCoversDate('2026-07-27', '2026-09-06', '2026-09-07')).toBe(false);
            expect(CalendarModule.rangeCoversDate('2026-07-27', '2026-09-06', '2026-07-26')).toBe(false);
        });

        it('跨年比較正確（字串比較不能在年界翻車）', () => {
            expect(CalendarModule.rangeCoversDate('2025-12-29', '2026-02-08', '2026-01-01')).toBe(true);
            expect(CalendarModule.rangeCoversDate('2025-12-29', '2026-02-08', '2025-12-28')).toBe(false);
            expect(CalendarModule.rangeCoversDate('2025-12-01', '2026-01-11', '2026-01-12')).toBe(false);
        });

        it('非字串輸入一律 false，不丟例外', () => {
            expect(CalendarModule.rangeCoversDate(null, '2026-09-06', '2026-08-05')).toBe(false);
            expect(CalendarModule.rangeCoversDate('2026-07-27', undefined, '2026-08-05')).toBe(false);
            expect(CalendarModule.rangeCoversDate('2026-07-27', '2026-09-06', null)).toBe(false);
        });
    });

    /**
     * PUT 的欄位差異計算。後端 update_event 會濾掉值為 None 的欄位，
     * 因此「只送有改動的欄位」與「哪些欄位是使用者想清空、但後端做不到」
     * 這兩件事都得在前端算對 —— 前者算錯會動到重複事件的起始日，
     * 後者算錯會讓使用者以為改動生效了。
     */
    describe('buildUpdatePayload(next, initial)', () => {
        const initial = {
            title: '看牙醫',
            note: '記得帶健保卡',
            category: 'health',
            event_date: '2026-08-05',
            event_time: '14:00',
            recurrence: 'none',
            recurrence_until: null,
            reminder_minutes: 30
        };

        function next(overrides) {
            return Object.assign({}, initial, overrides);
        }

        it('沒有任何改動 → changed 與 cleared 都是空的', () => {
            const r = CalendarModule.buildUpdatePayload(next({}), initial);
            expect(r.changed).toEqual({});
            expect(r.cleared).toEqual([]);
        });

        it('只改標題 → 只送 title（不連帶送 event_date，否則會移動重複事件的起始日）', () => {
            const r = CalendarModule.buildUpdatePayload(next({ title: '看牙醫（改期）' }), initial);
            expect(r.changed).toEqual({ title: '看牙醫（改期）' });
            expect(r.cleared).toEqual([]);
        });

        it('同時改多個欄位 → 全部送出', () => {
            const r = CalendarModule.buildUpdatePayload(
                next({ title: '回診', category: 'family', reminder_minutes: 60 }), initial);
            expect(r.changed).toEqual({ title: '回診', category: 'family', reminder_minutes: 60 });
        });

        it('把有時間的事件改成全天 → event_time 進 cleared，不進 changed', () => {
            const r = CalendarModule.buildUpdatePayload(next({ event_time: null }), initial);
            expect(r.cleared).toEqual(['event_time']);
            expect(r.changed).toEqual({});
        });

        it('清空備註與提醒 → 兩者都進 cleared', () => {
            const r = CalendarModule.buildUpdatePayload(next({ note: null, reminder_minutes: null }), initial);
            expect(r.cleared.sort()).toEqual(['note', 'reminder_minutes']);
            expect(r.changed).toEqual({});
        });

        it('混合「改一個 + 清一個」→ changed 與 cleared 同時有值（合併提示的觸發條件）', () => {
            const r = CalendarModule.buildUpdatePayload(
                next({ title: '改過的標題', event_time: null }), initial);
            expect(r.changed).toEqual({ title: '改過的標題' });
            expect(r.cleared).toEqual(['event_time']);
        });

        it('reminder_minutes 改成 0 是有效改動，不是「清空」', () => {
            const r = CalendarModule.buildUpdatePayload(next({ reminder_minutes: 0 }), initial);
            expect(r.changed).toEqual({ reminder_minutes: 0 });
            expect(r.cleared).toEqual([]);
        });

        it('把 null 的欄位設成有值 → 進 changed（recurrence_until 由無到有）', () => {
            const r = CalendarModule.buildUpdatePayload(
                next({ recurrence: 'weekly', recurrence_until: '2026-12-31' }), initial);
            expect(r.changed).toEqual({ recurrence: 'weekly', recurrence_until: '2026-12-31' });
            expect(r.cleared).toEqual([]);
        });

        it('initial 缺漏時（GET 沒回 event_date/recurrence_until）不誤判成清空', () => {
            const partial = { title: '看牙醫', event_time: '14:00' };
            const r = CalendarModule.buildUpdatePayload(
                { title: '看牙醫', event_time: '14:00', recurrence_until: null }, partial);
            expect(r.changed).toEqual({});
            expect(r.cleared).toEqual([]);
        });
    });
});
