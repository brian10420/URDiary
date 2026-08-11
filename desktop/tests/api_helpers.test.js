// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
    loadScript('js/diary_module.js');
});

describe('ApiService.deriveDiaryTitle', () => {
    it('跳過 markdown 標題（#）與列點（- * > |），取第一行有意義的文字', () => {
        const content = '# 標題不算\n- 列點不算\n> 引言不算\n真正的第一行內容';
        expect(ApiService.deriveDiaryTitle(content, '2026-01-01')).toBe('真正的第一行內容');
    });

    it('內容為空或無有效行時，以日期作為標題（fallback）', () => {
        const dateIso = '2026-03-15T10:00:00Z';
        const d = new Date(dateIso);
        // 用實作同一套 I18N.t() 算期望值，避免測試重複假設翻譯文字本身
        const expected = I18N.t('diary.dateTitle', { month: d.getMonth() + 1, day: d.getDate() });
        expect(ApiService.deriveDiaryTitle('', dateIso)).toBe(expected);
        expect(ApiService.deriveDiaryTitle('   \n   ', dateIso)).toBe(expected);
    });

    it('內容與日期都無效時，退回通用「日記」標題', () => {
        expect(ApiService.deriveDiaryTitle('', 'not-a-real-date')).toBe(I18N.t('diary.plain'));
        expect(ApiService.deriveDiaryTitle(null, 'not-a-real-date')).toBe(I18N.t('diary.plain'));
    });
});

describe('ApiService.getMoodFromValence', () => {
    it('各門檻邊界值', () => {
        expect(ApiService.getMoodFromValence(0.7)).toBe('happy');
        expect(ApiService.getMoodFromValence(0.69)).toBe('calm');
        expect(ApiService.getMoodFromValence(0.55)).toBe('calm');
        expect(ApiService.getMoodFromValence(0.54)).toBe('neutral');
        expect(ApiService.getMoodFromValence(0.45)).toBe('neutral');
        expect(ApiService.getMoodFromValence(0.44)).toBe('sad');
        expect(ApiService.getMoodFromValence(0.25)).toBe('sad');
        expect(ApiService.getMoodFromValence(0.24)).toBe('angry');
        expect(ApiService.getMoodFromValence(0)).toBe('angry');
        expect(ApiService.getMoodFromValence(1)).toBe('happy');
    });

    it('非數字或 NaN 一律回傳 neutral', () => {
        expect(ApiService.getMoodFromValence(undefined)).toBe('neutral');
        expect(ApiService.getMoodFromValence(null)).toBe('neutral');
        expect(ApiService.getMoodFromValence(NaN)).toBe('neutral');
        expect(ApiService.getMoodFromValence('0.8')).toBe('neutral');
    });
});

describe('DiaryModule.getExcerpt', () => {
    it('短文字原樣回傳，不加省略號', () => {
        expect(DiaryModule.getExcerpt('短內容', 80)).toBe('短內容');
    });

    it('超過長度時截斷並加上省略號', () => {
        const text = 'a'.repeat(30);
        expect(DiaryModule.getExcerpt(text, 10)).toBe('a'.repeat(10) + '...');
    });

    it('長度剛好等於門檻時不截斷（比較用 >，不是 >=）', () => {
        const text = 'a'.repeat(10);
        expect(DiaryModule.getExcerpt(text, 10)).toBe(text);
    });

    it('未傳 length 時預設為 100', () => {
        const text = 'b'.repeat(150);
        expect(DiaryModule.getExcerpt(text)).toBe('b'.repeat(100) + '...');
    });

    it('空字串/null/undefined 回傳空字串', () => {
        expect(DiaryModule.getExcerpt('')).toBe('');
        expect(DiaryModule.getExcerpt(null)).toBe('');
        expect(DiaryModule.getExcerpt(undefined)).toBe('');
    });
});
