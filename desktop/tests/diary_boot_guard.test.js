// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 冷啟動 401 防護：main.js 在 DOMContentLoaded 無條件 DiaryModule.init()，
 * 比「有沒有有效令牌」的判斷（main.js 的 setTimeout 區塊）更早。過去這會
 * 在未登入狀態直接打 GET /diaries，吃 401 後彈「載入失敗」錯誤窗疊在登入
 * 畫面上。修正：init() 內啟動載入前先問 ApiService.isAuthenticated()，
 * 未登入就跳過（登入流程 loginUser 會 reset()+init() 重新載入）。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/diary_module.js');
});

const DIARY_VIEW_HTML = `
    <div id="diary-view">
        <div id="diary-cache-indicator" style="display:none;"></div>
        <div class="diary-container">
            <div class="diary-list"></div>
            <div class="diary-detail" style="display:none;">
                <div class="detail-title"></div>
                <div class="detail-content"></div>
                <div class="detail-date"></div>
                <div class="detail-mood"></div>
            </div>
        </div>
    </div>
`;

beforeEach(() => {
    document.body.innerHTML = DIARY_VIEW_HTML;
    window.UIManager = {
        showSpinner: vi.fn(),
        hideSpinner: vi.fn(),
        showError: vi.fn(),
        showDiaryDetail: vi.fn(),
        hideDiaryDetail: vi.fn(),
        handleNavigation: vi.fn()
    };
});

describe('DiaryModule.init()：冷啟動未登入時的日記載入防護', () => {
    it('未登入（isAuthenticated=false）→ 不打 getDiaries、不彈錯誤窗', async () => {
        window.ApiService = {
            isAuthenticated: () => false,
            getDiaries: vi.fn().mockResolvedValue([])
        };
        DiaryModule.init();
        await Promise.resolve();
        expect(window.ApiService.getDiaries).not.toHaveBeenCalled();
        expect(window.UIManager.showError).not.toHaveBeenCalled();
    });

    it('已登入（isAuthenticated=true）→ 照常載入日記', async () => {
        window.ApiService = {
            isAuthenticated: () => true,
            getDiaries: vi.fn().mockResolvedValue([])
        };
        DiaryModule.init();
        await Promise.resolve();
        expect(window.ApiService.getDiaries).toHaveBeenCalledTimes(1);
    });

    it('ApiService 沒有 isAuthenticated 方法 → 維持原行為照常載入（防禦性退路）', async () => {
        window.ApiService = {
            getDiaries: vi.fn().mockResolvedValue([])
        };
        DiaryModule.init();
        await Promise.resolve();
        expect(window.ApiService.getDiaries).toHaveBeenCalledTimes(1);
    });
});
