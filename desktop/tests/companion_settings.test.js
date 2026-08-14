// @vitest-environment jsdom
/** 陪伴者設定卡片：payload 組裝與名字快取。 */
import { describe, test, expect, beforeEach } from 'vitest';
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
