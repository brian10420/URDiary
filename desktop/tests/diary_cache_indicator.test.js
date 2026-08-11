// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 離線容忍（v2.3 task 2.3）：日記列表的「本機快取」標籤。
 *
 * ApiService.getDiaries() 在連不上伺服器時會回退到本機快取，並在回傳的
 * 陣列上標記 _fromCache = true（見 api_service.js getDiaries 的實作說明）。
 * 這裡驗證 DiaryModule 把這個旗標轉成畫面上看得到的標籤：快取資料顯示時
 * 出現、新鮮資料顯示時消失/隱藏，不會「說謊」（該顯示卻沒顯示，或該隱藏
 * 卻黏著不走）。
 */
beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/diary_module.js');
});

const DIARY_VIEW_HTML = `
    <div id="diary-view">
        <h2 class="view-title"></h2>
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

function freshDiary(overrides = {}) {
    return {
        id: 'd1', title: '標題', summary: '', content: '內容',
        date: '2026-08-10T00:00:00Z', mood: 'calm', valence: 0.6, arousal: 0.5,
        ...overrides
    };
}

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

function getIndicator() {
    return document.getElementById('diary-cache-indicator');
}

describe('DiaryModule：_fromCache 標籤', () => {
    it('新鮮資料（陣列上沒有 _fromCache）→ 標籤隱藏', async () => {
        const diaries = [freshDiary()];
        window.ApiService = { getDiaries: vi.fn().mockResolvedValue(diaries) };

        await DiaryModule.loadDiaries();

        expect(getIndicator().style.display).toBe('none');
    });

    it('快取資料（陣列上有 _fromCache = true）→ 標籤顯示', async () => {
        const diaries = [freshDiary()];
        diaries._fromCache = true;
        window.ApiService = { getDiaries: vi.fn().mockResolvedValue(diaries) };

        await DiaryModule.loadDiaries();

        expect(getIndicator().style.display).not.toBe('none');
    });

    it('先顯示快取標籤，下一次載入拿到新鮮資料 → 標籤要跟著隱藏（不會黏著不走）', async () => {
        const cached = [freshDiary()];
        cached._fromCache = true;
        const fresh = [freshDiary()];

        window.ApiService = { getDiaries: vi.fn().mockResolvedValueOnce(cached).mockResolvedValueOnce(fresh) };

        await DiaryModule.loadDiaries();
        expect(getIndicator().style.display).not.toBe('none');

        await DiaryModule.loadDiaries();
        expect(getIndicator().style.display).toBe('none');
    });

    it('先顯示新鮮資料，下一次剛好離線改拿快取 → 標籤要跟著顯示', async () => {
        const fresh = [freshDiary()];
        const cached = [freshDiary()];
        cached._fromCache = true;

        window.ApiService = { getDiaries: vi.fn().mockResolvedValueOnce(fresh).mockResolvedValueOnce(cached) };

        await DiaryModule.loadDiaries();
        expect(getIndicator().style.display).toBe('none');

        await DiaryModule.loadDiaries();
        expect(getIndicator().style.display).not.toBe('none');
    });

    it('完全載入失敗（連快取都沒有，getDiaries 拋出）→ 標籤隱藏（沒有資料可顯示）', async () => {
        window.ApiService = { getDiaries: vi.fn().mockRejectedValue(new Error('無法連線到伺服器')) };

        await DiaryModule.loadDiaries();

        expect(getIndicator().style.display).toBe('none');
    });

    it('沒有 #diary-cache-indicator 元素時不拋錯（防禦性 guard）', async () => {
        document.getElementById('diary-cache-indicator').remove();
        const diaries = [freshDiary()];
        diaries._fromCache = true;
        window.ApiService = { getDiaries: vi.fn().mockResolvedValue(diaries) };

        // 若 loadDiaries() 拋錯/rejected，下面這行 await 會讓測試自然失敗
        await DiaryModule.loadDiaries();
    });
});
