// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load.js';

/** MascotModule：彩蛋分流、分類圖標兩級渲染、未知分類 fallback。 */
describe('MascotModule', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    // 門檻對齊 getMoodFromValence()（api_service.js:1301-1311）判定 sad 的
    // 0.45 分界，不是 spec 字面的 <0——後端 valence 經 _clamp() 永遠落在
    // [0,1]，中性值 0.5（controller ruling R5，task 5 field-check 後裁定）。
    test('eggKindFor：日間正向=happy、夜間=goodnight、低於 0.45 門檻=quiet（quiet 優先於 goodnight）', () => {
        expect(MascotModule.eggKindFor(0.7, 14)).toBe('happy');
        expect(MascotModule.eggKindFor(null, 14)).toBe('happy');    // 無情緒資料視為正向
        expect(MascotModule.eggKindFor(0.7, 23)).toBe('goodnight');
        expect(MascotModule.eggKindFor(0.7, 4)).toBe('goodnight');
        expect(MascotModule.eggKindFor(0.7, 5)).toBe('happy');      // 05:00 整回日間
        expect(MascotModule.eggKindFor(0.3, 23)).toBe('quiet');     // quiet 優先於 goodnight（夜間也一樣）
        expect(MascotModule.eggKindFor(0.3, 14)).toBe('quiet');
        expect(MascotModule.eggKindFor(0.45, 14)).toBe('happy');    // 邊界：剛好 0.45 仍算正向
        expect(MascotModule.eggKindFor(0.44, 14)).toBe('quiet');    // 邊界：低於 0.45 就安靜
        expect(MascotModule.eggKindFor(-0.3, 14)).toBe('quiet');    // 量表外的負值仍要有防線（穩健性）
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
