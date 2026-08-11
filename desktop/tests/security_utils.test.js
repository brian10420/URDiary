// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './helpers/load.js';

describe('security_utils: escapeHtml', () => {
    beforeAll(() => {
        loadScript('js/security_utils.js');
    });

    it('中和 <img onerror> 注入嘗試（不留下可用的 < > "）', () => {
        const input = '<img src=x onerror="alert(1)">';
        const escaped = window.escapeHtml(input);
        expect(escaped).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(escaped).not.toMatch(/[<>"]/);
    });

    it('轉義引號與 &', () => {
        expect(window.escapeHtml(`"quoted" & 'single'`)).toBe('&quot;quoted&quot; &amp; &#39;single&#39;');
    });

    it('null/undefined 轉為空字串', () => {
        expect(window.escapeHtml(null)).toBe('');
        expect(window.escapeHtml(undefined)).toBe('');
    });

    it('數字轉為字串（以現行為準：只有 null/undefined 特殊處理，0 不會被當成 falsy 濾掉）', () => {
        expect(window.escapeHtml(123)).toBe('123');
        expect(window.escapeHtml(0)).toBe('0');
    });
});
