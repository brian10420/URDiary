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

    /**
     * i18n 對等性沒有機器把關過：兩個語系字典其中一個漏了鍵，t() 有 fallback
     * 邏輯兜底（回 zh-TW 或鍵名本身），不會拋錯也不會讓既有測試變紅，錯字/
     * 漏字只能等使用者切到那個語言、剛好用到那個畫面時才會發現。這裡直接從
     * 原始碼字串裡切出 LOCALES['zh-TW'] 與 LOCALES['en'] 兩個區塊各自的鍵集合
     * 做 set-equality —— 沿用上面 fallback 測試已經在用的「讀原始碼字串」手法，
     * 不透過 I18N 的公開 API（LOCALES 本來就沒有曝光），也不必真的載入模組。
     */
    it('zh-TW 與 en 兩個字典的鍵集合完全一致（無單邊缺鍵）', () => {
        const source = fs.readFileSync(I18N_PATH, 'utf8');
        const zhHeaderIdx = source.indexOf("'zh-TW': {");
        const enHeaderIdx = source.indexOf("'en': {");
        expect(zhHeaderIdx).toBeGreaterThan(-1);
        expect(enHeaderIdx).toBeGreaterThan(-1);
        expect(zhHeaderIdx).toBeLessThan(enHeaderIdx);

        // en 區塊結束於 LOCALES 物件收尾的 `    };`（縮排 4 格，與兩個語系
        // 區塊的縮排區分開，避免切到區塊內部剛好也是 `};` 的字串）
        const enBlockEnd = source.indexOf('\n    };', enHeaderIdx);
        expect(enBlockEnd).toBeGreaterThan(-1);

        // 從各自標頭行的換行之後開始切，才不會把 `'zh-TW': {` / `'en': {`
        // 這兩行自己也當成一個鍵匹配進去
        const zhBlock = source.slice(source.indexOf('\n', zhHeaderIdx), enHeaderIdx);
        const enBlock = source.slice(source.indexOf('\n', enHeaderIdx), enBlockEnd);

        function extractKeys(block) {
            const keys = new Set();
            const keyLineRe = /^\s*'([^']+)':/gm;
            let match;
            while ((match = keyLineRe.exec(block)) !== null) {
                keys.add(match[1]);
            }
            return keys;
        }

        const zhKeys = extractKeys(zhBlock);
        const enKeys = extractKeys(enBlock);

        // 兩邊都要真的解析到東西，避免正規表達式沒對到、假綠燈
        expect(zhKeys.size).toBeGreaterThan(0);
        expect(enKeys.size).toBeGreaterThan(0);

        const onlyInZh = [...zhKeys].filter(k => !enKeys.has(k)).sort();
        const onlyInEn = [...enKeys].filter(k => !zhKeys.has(k)).sort();

        expect(onlyInZh, `en 缺少這些鍵: ${onlyInZh.join(', ')}`).toEqual([]);
        expect(onlyInEn, `zh-TW 缺少這些鍵: ${onlyInEn.join(', ')}`).toEqual([]);
    });
});
