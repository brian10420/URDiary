// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

describe('ChatModule.diaryDayString', () => {
    beforeAll(() => {
        // diaryDayString 本身是純函式（只用參數與內建 Date），不依賴
        // CONFIG/I18N/ApiService，但仍走一次標準前置，貼近真實載入順序。
        loadCoreScripts();
        loadScript('js/chat_module.js');
    });

    it('凌晨 04:59（本地時間）算前一天', () => {
        const date = new Date(2026, 0, 15, 4, 59); // 2026-01-15 04:59 本地
        expect(ChatModule.diaryDayString(date)).toBe('2026-1-14');
    });

    it('05:00（本地時間）算當天', () => {
        const date = new Date(2026, 0, 15, 5, 0); // 2026-01-15 05:00 本地
        expect(ChatModule.diaryDayString(date)).toBe('2026-1-15');
    });

    it('跨月邊界：3/1 04:00 減 5 小時落回 2/28', () => {
        const date = new Date(2026, 2, 1, 4, 0); // 2026-03-01 04:00 本地（2026 非閏年，2 月 28 天）
        expect(ChatModule.diaryDayString(date)).toBe('2026-2-28');
    });
});
