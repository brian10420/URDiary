// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load.js';

/** MascotModule：彩蛋分流、分類圖標兩級渲染、未知分類 fallback。 */
describe('MascotModule', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    test('eggKindFor：日間正向=happy、夜間=goodnight、負向永遠 quiet', () => {
        expect(MascotModule.eggKindFor(0.5, 14)).toBe('happy');
        expect(MascotModule.eggKindFor(null, 14)).toBe('happy');   // 無情緒資料視為正向
        expect(MascotModule.eggKindFor(0.5, 23)).toBe('goodnight');
        expect(MascotModule.eggKindFor(0.5, 4)).toBe('goodnight');
        expect(MascotModule.eggKindFor(0.5, 5)).toBe('happy');     // 05:00 整回日間
        expect(MascotModule.eggKindFor(-0.3, 23)).toBe('quiet');
        expect(MascotModule.eggKindFor(-0.3, 14)).toBe('quiet');
    });

    test('categoryIcon 兩級渲染：18px 無臉、24px 有臉', () => {
        const small = MascotModule.categoryIcon('work', 18);
        const big = MascotModule.categoryIcon('work', 24);
        expect(small).toContain('svg');
        expect(small).not.toContain('class="face"');
        expect(big).toContain('class="face"');
        expect(big).toContain('#2a78d6');
    });

    test('categoryIcon 未知分類 fallback other、七分類都有圖', () => {
        expect(MascotModule.categoryIcon('nonsense', 18))
            .toBe(MascotModule.categoryIcon('other', 18));
        for (const c of ['work','study','health','family','anniversary','other','travel']) {
            expect(MascotModule.categoryIcon(c, 24)).toContain('<svg');
        }
    });

    test('emptyHtml 帶 caption 且做 HTML escape', () => {
        const html = MascotModule.emptyHtml('diary', '<b>還沒有日記</b>');
        expect(html).toContain('&lt;b&gt;');
        expect(html).toContain('mascot-empty');
    });
});
