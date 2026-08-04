// @vitest-environment jsdom
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadScript } from './helpers/load.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N_PATH = path.join(__dirname, '..', 'js', 'i18n.js');

/**
 * i18n.js 不在 4-8 要曝光的 4 個純函式清單內，維持原樣不動。這裡不透過
 * helpers/load.js 的 loadScript（它「window.X 已存在就不覆蓋」，是為了
 * 避免重複載入互相干擾），而是每個測試都無條件重新 eval、覆蓋
 * window.I18N，確保測試之間互不影響彼此對語言/字典的假設。
 */
function reloadI18N(sourceOverride) {
    const code = sourceOverride !== undefined ? sourceOverride : fs.readFileSync(I18N_PATH, 'utf8');
    (0, eval)(code + '\nwindow.I18N = I18N;');
}

describe('i18n', () => {
    beforeEach(() => {
        localStorage.clear();
        loadScript('js/security_utils.js');
        reloadI18N();
    });

    it('預設語言為 zh-TW', () => {
        expect(I18N.getLang()).toBe('zh-TW');
        expect(I18N.t('nav.chat')).toBe('對話');
    });

    it('setLang("en") 切換語言', () => {
        I18N.setLang('en');
        expect(I18N.getLang()).toBe('en');
        expect(I18N.t('nav.chat')).toBe('Chat');
    });

    it('en 缺鍵時 fallback 到 zh-TW 的文字', () => {
        // zh-TW/en 目前字典鍵完全對稱（134/134 一致），沒有天然的缺鍵案例可測。
        // 這裡在載入前，從原始碼字串裡拿掉 en 區塊的 'mood.happy' 這一行
        // （只影響這次 eval 用的記憶體字串，不改動磁碟上的 i18n.js），
        // 藉此驗證 t() 內建的 `LOCALES[lang][key] || LOCALES['zh-TW'][key]`
        // fallback 邏輯，在真的遇到缺鍵時仍正確運作。
        const original = fs.readFileSync(I18N_PATH, 'utf8');
        const enStart = original.indexOf("'en': {");
        expect(enStart).toBeGreaterThan(-1);

        const enPart = original.slice(enStart);
        const patchedEnPart = enPart.replace(/\n\s*'mood\.happy':\s*'Joyful',/, '\n');
        expect(patchedEnPart).not.toBe(enPart); // 確保真的有拿掉一行，不是 regex 沒對到

        reloadI18N(original.slice(0, enStart) + patchedEnPart);
        I18N.setLang('en');

        // 拿到的是 zh-TW 的譯文「喜悅」，不是英文原文、也不是鍵名本身
        expect(I18N.t('mood.happy')).toBe('喜悅');
    });

    it('未知鍵回傳鍵名本身', () => {
        expect(I18N.t('this.key.does.not.exist.anywhere')).toBe('this.key.does.not.exist.anywhere');
    });

    it('{param} 代換', () => {
        expect(I18N.t('tools.currentUser', { username: 'brian' })).toBe('當前用戶: brian');
    });

    it('{param} 代換：同一參數在同一句重複出現時，兩次都要換掉', () => {
        // 目前字典裡沒有「同一個 {param} 在同一句重複出現」的既有鍵，這裡把
        // 'tools.currentUser' 的模板暫時改成含重複佔位符，驗證 t() 用的是
        // 帶 'g' flag 的 global regex 取代，而不是只換第一次出現。
        const original = fs.readFileSync(I18N_PATH, 'utf8');
        const patched = original.replace(
            "'tools.currentUser': '當前用戶: {username}',",
            "'tools.currentUser': '{username} / {username}',"
        );
        expect(patched).not.toBe(original);

        reloadI18N(patched);
        expect(I18N.t('tools.currentUser', { username: 'brian' })).toBe('brian / brian');
    });

    it('dateLocale() 依語言回傳對應地區碼', () => {
        expect(I18N.dateLocale()).toBe('zh-TW');
        I18N.setLang('en');
        expect(I18N.dateLocale()).toBe('en-US');
    });
});
