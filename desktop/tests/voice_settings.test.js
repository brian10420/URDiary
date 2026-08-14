// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';

const { loadScript } = require('./helpers/load.js');

describe('voice settings card', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = `
            <select id="voice-input-mode"><option value="confirm">c</option><option value="fluent">f</option></select>
            <input type="checkbox" id="voice-autoread">
            <input id="voice-id">`;
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/voice_module.js');
        loadScript('js/settings_module.js');
    });

    test('load 回填三欄、save 寫回 VoiceModule', () => {
        VoiceModule.setInputMode('fluent'); VoiceModule.setAutoRead(true);
        SettingsModule._test.loadVoicePrefs();
        expect(document.getElementById('voice-input-mode').value).toBe('fluent');
        expect(document.getElementById('voice-autoread').checked).toBe(true);
        document.getElementById('voice-input-mode').value = 'confirm';
        document.getElementById('voice-autoread').checked = false;
        document.getElementById('voice-id').value = 'ara';
        SettingsModule._test.saveVoicePrefs();
        expect(VoiceModule.getInputMode()).toBe('confirm');
        expect(VoiceModule.isAutoRead()).toBe(false);
        expect(VoiceModule.getVoiceId()).toBe('ara');
    });
});
