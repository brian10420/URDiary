// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 慢速模型提示（2026-08 驗收回饋）：grok-4.6 回覆常等超過 30 秒。等待超過
 * 門檻（SLOW_REPLY_HINT_MS=30 秒）時，若目前模型有已知的較快替代
 * （grok-4.6 → grok-4.3），以系統訊息推薦使用者到設定切換；一個工作階段
 * 最多提示一次，模型沒有對應建議（或已在 4.3）就完全不提示。
 *
 * 注意：once-only 旗標是模組級狀態，跨 it 會殘留——依賴狀態的斷言全部
 * 收在同一個 it 內、依序驗證，檔案內執行順序即測試順序。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/chat_module.js');
});

describe('ChatModule.maybeShowSlowModelHint', () => {
    it('SettingsModule 不存在時安靜回 null（旗標不動）', () => {
        window.SettingsModule = undefined;
        expect(ChatModule.maybeShowSlowModelHint(60000)).toBeNull();
    });

    it('門檻/模型/一次性 的完整決策序列', () => {
        // (1) 未超過門檻 → null（旗標不動）
        window.SettingsModule = { getActiveLLM: () => ({ provider: 'grok', model: 'grok-4.6', label: 'Grok (xAI)' }) };
        expect(ChatModule.maybeShowSlowModelHint(10000)).toBeNull();

        // (2) 超過門檻但模型沒有更快的建議（已在 grok-4.3）→ null（旗標不動）
        window.SettingsModule = { getActiveLLM: () => ({ provider: 'grok', model: 'grok-4.3', label: 'Grok (xAI)' }) };
        expect(ChatModule.maybeShowSlowModelHint(60000)).toBeNull();

        // (3) 超過門檻且模型是 grok-4.6 → 回傳提示文字（含秒數與建議模型）
        window.SettingsModule = { getActiveLLM: () => ({ provider: 'grok', model: 'grok-4.6', label: 'Grok (xAI)' }) };
        const text = ChatModule.maybeShowSlowModelHint(45000);
        expect(text).toBeTruthy();
        expect(text).toContain('grok-4.6');
        expect(text).toContain('grok-4.3');
        expect(text).toContain('45');

        // (4) 同一工作階段第二次 → 不再提示
        expect(ChatModule.maybeShowSlowModelHint(60000)).toBeNull();
    });
});
