// @vitest-environment jsdom
/** ChatModule.applyCompanionTitle：聊天標題顯示陪伴者名字，沒有時落回預設標題。 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

describe('ChatModule.applyCompanionTitle', () => {
    beforeAll(() => {
        // I18N.t('chat.title') 是 fallback 用到的字典，需要走標準前置
        // （security_utils -> i18n -> config），貼近真實載入順序。
        loadCoreScripts();
        loadScript('js/chat_module.js');
    });

    beforeEach(() => {
        document.body.innerHTML = '<div class="chat-title">初始標題</div>';
    });

    it('SettingsModule.getCompanionName() 回傳名字時，標題顯示該名字', () => {
        window.SettingsModule = { getCompanionName: () => '小澄' };
        ChatModule.applyCompanionTitle();
        expect(document.querySelector('.chat-title').textContent).toBe('小澄');
    });

    it('SettingsModule.getCompanionName() 回傳 null 時，標題落回 i18n 的 chat.title', () => {
        window.SettingsModule = { getCompanionName: () => null };
        ChatModule.applyCompanionTitle();
        expect(document.querySelector('.chat-title').textContent).toBe(I18N.t('chat.title'));
    });
});
