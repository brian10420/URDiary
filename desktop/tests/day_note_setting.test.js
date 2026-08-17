// @vitest-environment jsdom
/** 「AI 行事曆印章」設定開關＋endChat 請求接線 (v2.5 Spec A)。 */
import { describe, test, expect, beforeEach } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

describe('day note setting', () => {
    beforeEach(() => {
        loadCoreScripts();
        loadScript('js/chat_module.js');
        localStorage.clear();
        document.body.innerHTML = '<div id="chat-messages"></div>';
    });

    test('預設開啟；set 後持久化', () => {
        expect(ChatModule.isDayNoteEnabled()).toBe(true);
        ChatModule.setDayNoteEnabled(false);
        expect(ChatModule.isDayNoteEnabled()).toBe(false);
        expect(localStorage.getItem('urdiary_day_note_enabled')).toBe('0');
        ChatModule.setDayNoteEnabled(true);
        expect(ChatModule.isDayNoteEnabled()).toBe(true);
    });
});
