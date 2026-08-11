// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * UIManager.resolvePaneClasses(state, layoutMode) 的單元測試（v2.3 task 2.1）。
 *
 * ui_manager.js 在這次改版之前完全沒有測試——switchToState 原本是一個
 * ~130 行、五個 case 各自手寫 classList.add/remove 組合的函式，新增
 * 「窄螢幕只顯示單一面板」邏輯前，先把「狀態 + 版面模式 → 該套哪些 class」
 * 這個決策抽成純函式，讓每一種組合都能在沒有真實 DOM/瀏覽器的情況下驗證。
 *
 * 覆蓋範圍：五個視圖狀態 × 兩種 layoutMode（'wide'／'mobile'）= 10 組，
 * 外加寬螢幕回歸測試（逐一比對 v2.3 之前 switchToState 寫死的 class
 * 組合，確保這次重構沒有改變桌面行為）、「窄螢幕絕不輸出 half」的全狀態
 * 掃描，與純函式邊界檢查（未知輸入時的安全預設、重複呼叫的一致性）。
 */
describe('UIManager.resolvePaneClasses', () => {
    beforeAll(() => {
        loadCoreScripts();
        loadScript('js/ui_manager.js');
    });

    describe('寬螢幕（wide）—— 與 v2.3 之前 switchToState 的桌面行為逐一比對', () => {
        it('CHAT_FULL：聊天全螢幕，日記/行事曆/詳情皆無', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_FULL, 'wide')).toEqual({
                chat: 'active', diary: '', calendar: '', detail: ''
            });
        });

        it('CHAT_DIARY_SPLIT：聊天/日記各半、左右並排，詳情無', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DIARY_SPLIT, 'wide')).toEqual({
                chat: 'half left', diary: 'half right', calendar: '', detail: ''
            });
        });

        it('DIARY_DETAIL_SPLIT：日記視圖容器全螢幕，容器內部再分列表/詳情', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.DIARY_DETAIL_SPLIT, 'wide')).toEqual({
                chat: '', diary: 'active', calendar: '', detail: 'active'
            });
        });

        it('CHAT_DETAIL_SPLIT：聊天/日記各半，日記內部再分列表/詳情', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DETAIL_SPLIT, 'wide')).toEqual({
                chat: 'half left', diary: 'half right', calendar: '', detail: 'active'
            });
        });

        it('CALENDAR_FULL：行事曆全螢幕，不與聊天/日記分割', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CALENDAR_FULL, 'wide')).toEqual({
                chat: '', diary: '', calendar: 'active', detail: ''
            });
        });
    });

    describe('窄螢幕（mobile）—— 五個狀態收斂成單一可見面板，只用 .active', () => {
        it('CHAT_FULL：顯示聊天', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_FULL, 'mobile')).toEqual({
                chat: 'active', diary: '', calendar: '', detail: ''
            });
        });

        it('CHAT_DIARY_SPLIT：顯示日記（列表）—— 這是使用者剛點進日記分頁的狀態', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DIARY_SPLIT, 'mobile')).toEqual({
                chat: '', diary: 'active', calendar: '', detail: ''
            });
        });

        it('DIARY_DETAIL_SPLIT：日記詳情全螢幕（diary 面板 active 且 detail active）', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.DIARY_DETAIL_SPLIT, 'mobile')).toEqual({
                chat: '', diary: 'active', calendar: '', detail: 'active'
            });
        });

        it('CHAT_DETAIL_SPLIT：與 DIARY_DETAIL_SPLIT 收斂成同一個畫面（日記詳情全螢幕）', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DETAIL_SPLIT, 'mobile')).toEqual({
                chat: '', diary: 'active', calendar: '', detail: 'active'
            });
        });

        it('CALENDAR_FULL：與寬螢幕相同，行事曆本來就已經是單一全螢幕面板', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CALENDAR_FULL, 'mobile')).toEqual({
                chat: '', diary: '', calendar: 'active', detail: ''
            });
        });
    });

    it('窄螢幕：五個狀態的輸出都不含 "half"（不能裂成兩個擠壓的窄欄）', () => {
        Object.values(UIManager.VIEW_STATE).forEach(state => {
            const result = UIManager.resolvePaneClasses(state, 'mobile');
            Object.values(result).forEach(value => {
                expect(value, `state=${state} 的回傳值 "${value}"`).not.toMatch(/half/);
            });
        });
    });

    describe('純函式性質與邊界', () => {
        it('同樣的輸入永遠得到同樣的輸出（不依賴任何外部/隱藏狀態）', () => {
            const first = UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DETAIL_SPLIT, 'wide');
            const second = UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DETAIL_SPLIT, 'wide');
            expect(first).toEqual(second);
            // 也確認回傳的不是同一個物件參照被意外共用/之後被改動
            expect(first).not.toBe(second);
        });

        it('未知的 state 時安全預設為聊天全螢幕（wide 與 mobile 皆同），不拋錯', () => {
            expect(UIManager.resolvePaneClasses('nonexistent_state', 'wide')).toEqual({
                chat: 'active', diary: '', calendar: '', detail: ''
            });
            expect(UIManager.resolvePaneClasses('nonexistent_state', 'mobile')).toEqual({
                chat: 'active', diary: '', calendar: '', detail: ''
            });
        });

        it('未知的 layoutMode 時安全預設為寬螢幕行為，不會誤套用手機版面', () => {
            expect(UIManager.resolvePaneClasses(UIManager.VIEW_STATE.CHAT_DIARY_SPLIT, 'nonexistent_mode')).toEqual({
                chat: 'half left', diary: 'half right', calendar: '', detail: ''
            });
        });
    });
});

/**
 * UIManager.getLayoutMode() —— matchMedia 不存在時的安全預設（jsdom 預設
 * 環境本身就沒有 window.matchMedia，天然覆蓋這個 guard；見 task-2.1-report.md
 * 的 TDD 證據一節）。這不是純函式（會讀 matchMedia 的快取結果），但guard
 * 本身值得一個直接測試：init() 都還沒呼叫過的情況下，getLayoutMode() 也
 * 不該拋錯，且要回傳 WIDE。
 */
describe('UIManager.getLayoutMode（環境無 matchMedia 時的安全預設）', () => {
    beforeAll(() => {
        loadCoreScripts();
        loadScript('js/ui_manager.js');
    });

    it('jsdom 沒有 window.matchMedia，getLayoutMode() 不拋錯且回傳 wide', () => {
        expect(typeof window.matchMedia).toBe('undefined');
        expect(() => UIManager.getLayoutMode()).not.toThrow();
        expect(UIManager.getLayoutMode()).toBe(UIManager.LAYOUT_MODE.WIDE);
    });
});
