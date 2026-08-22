// @vitest-environment jsdom
/** 日記可愛化 (v2.5)：formatContent 小標美化＋日記區印章顯示。
 *
 * - 舊日記的「## 1. 今日事件」markdown 行 → 樣式化小標（顯示端回溯，資料不動）
 * - 新日記的純文字標題行（中英白名單）→ 同款小標
 * - 列表卡片 20px 小印章（有章才顯示）；內文頁 40px 印章卡＋小語
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

beforeAll(() => {
    loadCoreScripts(); // security_utils -> i18n -> config
    loadScript('js/mascot.js');
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
                <div class="diary-stamp-slot" style="display:none;"></div>
                <div class="detail-content"></div>
                <div class="detail-date"></div>
                <div class="detail-mood"></div>
            </div>
        </div>
    </div>
`;

function freshDiary(overrides = {}) {
    return {
        id: 'd1', title: '標題', summary: '摘要', content: '內容',
        date: '2026-08-22T00:00:00Z', mood: 'calm', valence: 0.6, arousal: 0.5,
        stamp: null, stamp_phrase: null,
        ...overrides
    };
}

describe('formatContent 小標美化', () => {
    beforeEach(() => { document.body.innerHTML = DIARY_VIEW_HTML; });

    it('舊日記的「## N. 標題」行轉樣式化小標，符號與編號消失', () => {
        const html = DiaryModule.formatContent('## 1. 今日事件\n吃了牛肉湯。\n\n## 2. 情緒與感受\n很放鬆。');
        expect(html).toContain('<span class="diary-section-title">今日事件</span>');
        expect(html).toContain('<span class="diary-section-title">情緒與感受</span>');
        expect(html).not.toContain('##');
        expect(html).not.toContain('1.');
    });

    it('新日記的純文字標題行（中英白名單）也轉小標', () => {
        const zh = DiaryModule.formatContent('今日事件\n吃了牛肉湯。');
        expect(zh).toContain('<span class="diary-section-title">今日事件</span>');
        const en = DiaryModule.formatContent('Today\nHad beef soup.');
        expect(en).toContain('<span class="diary-section-title">Today</span>');
    });

    it('一般句子不會被誤判成小標', () => {
        const html = DiaryModule.formatContent('今天去了台南。\n晚上早睡。');
        expect(html).not.toContain('diary-section-title');
    });

    it('HTML 轉義不因小標轉換而失守', () => {
        const html = DiaryModule.formatContent('## 1. <b>今日事件</b>\n內容 <script>x</script>');
        expect(html).not.toContain('<b>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;b&gt;');
    });
});

describe('日記區印章顯示', () => {
    beforeEach(async () => {
        document.body.innerHTML = DIARY_VIEW_HTML;
        window.alert = vi.fn();
        window.UIManager = {
            showToast: vi.fn(),
            handleNavigation: vi.fn(),
            showSpinner: vi.fn(),
            hideSpinner: vi.fn(),
            showError: vi.fn(),
            showDiaryDetail: vi.fn(),
            showDiaryList: vi.fn(),
            getCurrentState: () => 'diary',
            VIEW_STATE: { DIARY: 'diary' },
        };
        window.ApiService = {
            isAuthenticated: () => true,
            getDiaries: vi.fn(async () => [
                freshDiary({ id: 'd1', title: '有章的一天', stamp: 'food', stamp_phrase: '牛肉湯的一天' }),
                freshDiary({ id: 'd2', title: '無章的一天' }),
            ]),
        };
        DiaryModule.init();
        await DiaryModule.loadDiaries();
    });

    it('列表卡片：有章顯示 20px 小印章、無章不顯示', () => {
        const cards = document.querySelectorAll('.diary-card');
        expect(cards.length).toBe(2);
        const stamped = document.querySelector('.diary-card[data-id="d1"]');
        const plain = document.querySelector('.diary-card[data-id="d2"]');
        expect(stamped.innerHTML).toContain('mascot-stamp');
        expect(stamped.innerHTML).toContain('width="20"');
        expect(plain.innerHTML).not.toContain('mascot-stamp');
    });

    it('內文頁：有章顯示 40px 印章卡＋小語；無章隱藏', async () => {
        DiaryModule.showDiaryDetails('d1');
        const slot = document.querySelector('.diary-stamp-slot');
        expect(slot.innerHTML).toContain('mascot-stamp');
        expect(slot.innerHTML).toContain('width="40"');
        expect(slot.innerHTML).toContain('牛肉湯的一天');
        expect(slot.style.display).not.toBe('none');

        DiaryModule.showDiaryDetails('d2');
        expect(slot.style.display).toBe('none');
        expect(slot.innerHTML).toBe('');
    });
});
