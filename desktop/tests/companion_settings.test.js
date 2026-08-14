// @vitest-environment jsdom
/** 陪伴者設定卡片：payload 組裝與名字快取。 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

describe('SettingsModule companion helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="companion-name"><input id="companion-nickname">
            <select id="companion-reply-length"><option value="">--</option><option value="short">s</option></select>
            <select id="companion-emoji"><option value="">--</option><option value="none">n</option></select>
            <select id="companion-formality"><option value="">--</option><option value="polite">p</option></select>`;
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/settings_module.js');
    });

    test('buildCompanionPayload 只送有值欄位、trim 名字', () => {
        document.getElementById('companion-name').value = '  小澄 ';
        document.getElementById('companion-reply-length').value = 'short';
        const payload = SettingsModule._test.buildCompanionPayload();
        expect(payload).toEqual({ companion_name: '小澄', user_nickname: '',
            style_reply_length: 'short', style_emoji: '', style_formality: '' });
    });

    test('applyCompanionData 回填欄位並快取名字', () => {
        SettingsModule._test.applyCompanionData({ companion_name: '小澄',
            user_nickname: null, style_reply_length: null,
            style_emoji: 'none', style_formality: null });
        expect(document.getElementById('companion-name').value).toBe('小澄');
        expect(SettingsModule.getCompanionName()).toBe('小澄');
    });
});

/**
 * code review 修復（controller 裁定的必修項）：防止「開面板時 GET 失敗
 * →使用者只是想改別的設定就按儲存→5 個空字串被送成 PUT」靜默洗掉伺服器
 * 上已存的陪伴者設定。loadScript 之後、任何一次成功的 GET/PUT 之前，
 * 模組內的 companionLoaded 本來就是預設的 false——這正是「GET 失敗過」
 * 與「還沒發生過 GET」在模組狀態上無法區分、也是這個 bug 的真實觸發情境，
 * 不需要另外的 setter 就能在測試裡重現。
 */
describe('SettingsModule companion helpers：未成功載入過時的儲存防護（防靜默清空）', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="companion-name"><input id="companion-nickname">
            <select id="companion-reply-length"><option value="">--</option><option value="short">s</option></select>
            <select id="companion-emoji"><option value="">--</option><option value="none">n</option></select>
            <select id="companion-formality"><option value="">--</option><option value="polite">p</option></select>`;
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/settings_module.js');
    });

    test('buildCompanionPartialPayload 只含有填值欄位，不含空字串', () => {
        document.getElementById('companion-name').value = '小澄';
        // 其餘 4 個欄位維持空白（模擬「GET 失敗、卡片還是初始空白」）
        const payload = SettingsModule._test.buildCompanionPartialPayload();
        expect(payload).toEqual({ companion_name: '小澄' });
    });

    test('buildCompanionPartialPayload 全部欄位皆空時回傳空物件', () => {
        const payload = SettingsModule._test.buildCompanionPartialPayload();
        expect(payload).toEqual({});
    });

    test('尚未成功載入過時儲存：全部欄位皆空則整個跳過 PUT，不送出任何請求', async () => {
        const fetchAPI = vi.fn();
        global.ApiService = { fetchAPI };

        await SettingsModule._test.saveCompanionSettings();

        expect(fetchAPI).not.toHaveBeenCalled();
    });

    test('尚未成功載入過時儲存：只填了名字則只送 companion_name，不會把其餘欄位當成清空指令送出空字串', async () => {
        document.getElementById('companion-name').value = '小澄';
        const fetchAPI = vi.fn(async () => ({ companion_name: '小澄' }));
        global.ApiService = { fetchAPI };

        await SettingsModule._test.saveCompanionSettings();

        expect(fetchAPI).toHaveBeenCalledTimes(1);
        expect(fetchAPI).toHaveBeenCalledWith('/users/me/companion',
            { method: 'PUT', body: { companion_name: '小澄' } });
    });
});
