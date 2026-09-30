// @vitest-environment jsdom
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N_CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const year = String(new Date().getFullYear());

function footerText() {
    return document.querySelector('.app-footer p').textContent;
}

describe('頁尾年份動態', () => {
    beforeEach(() => {
        localStorage.clear();
        loadScript('js/security_utils.js');
        (0, eval)(I18N_CODE + '\nwindow.I18N = I18N;');
        document.body.innerHTML = '<footer class="app-footer"><p data-i18n="app.footer">static</p></footer>';
    });

    it('zh-TW 頁尾顯示今年', () => {
        I18N.applyDom();
        expect(footerText()).toContain('© ' + year);
        expect(footerText()).not.toContain('{year}');
    });

    it('en 頁尾顯示今年', () => {
        I18N.setLang('en');
        I18N.applyDom();
        expect(footerText()).toContain('© ' + year);
        expect(footerText()).not.toContain('{year}');
    });

    it('靜態 HTML 後備文字寫 2026，且兩語字串都用 {year} 佔位', () => {
        expect(HTML).toMatch(/data-i18n="app\.footer">URDiary &copy; 2026/);
        expect(I18N_CODE.match(/'app\.footer': '[^']*\{year\}/g)).toHaveLength(2);
    });
});
