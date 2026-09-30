// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 11：分頁切換的視圖轉場。
 *   - resolveNavigation：handleNavigation 原本的 switch 原樣抽成純函式（逐條鎖住）
 *   - shouldUseViewTransition：API 不在／reduced-motion／同狀態 → 退回同步 class 切換
 *   - transitionToState：以「待套用狀態」為準收斂連續導覽；只有分頁切換走轉場
 * jsdom 沒有 document.startViewTransition；需要時用行為相同的替身（callback 延到 microtask）。
 */
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/ui_manager.js');
});

describe('resolveNavigation（純函式，行為與 v2.5 handleNavigation 相同）', () => {
    const S = () => UIManager.VIEW_STATE;
    it.each([
        ['chat_full', 'diary', 'chat_diary'],
        ['chat_full', 'chat', null],
        ['chat_diary', 'chat', 'chat_full'],
        ['chat_diary', 'diary', null],
        ['diary_detail', 'chat', 'chat_detail'],
        ['diary_detail', 'diary', null],
        ['chat_detail', 'chat', 'chat_full'],
        ['chat_detail', 'diary', 'chat_diary'],
        ['calendar_full', 'chat', 'chat_full'],
        ['calendar_full', 'diary', 'chat_diary'],
        ['calendar_full', 'calendar', 'calendar_full'],   // 已在行事曆再點＝重新載入（沿用）
        ['chat_full', 'calendar', 'calendar_full'],
        ['diary_detail', 'calendar', 'calendar_full'],
        ['bogus_state', 'chat', 'chat_full'],             // 未知狀態一律回聊天
        ['chat_full', 'settings', null],                  // 未知分頁不動
    ])('%s + 點 %s → %s', (state, view, expected) => {
        expect(UIManager.resolveNavigation(state, view)).toBe(expected);
        expect(Object.values(S())).toContain(expected === null ? 'chat_full' : expected);
    });
});

describe('shouldUseViewTransition（純函式）', () => {
    it.each([
        [{ hasApi: true, reducedMotion: false, sameState: false }, true],
        [{ hasApi: false, reducedMotion: false, sameState: false }, false],
        [{ hasApi: true, reducedMotion: true, sameState: false }, false],
        [{ hasApi: true, reducedMotion: false, sameState: true }, false],
        [undefined, false],
    ])('%j → %s', (opts, expected) => {
        expect(UIManager.shouldUseViewTransition(opts)).toBe(expected);
    });
});

describe('handleNavigation × View Transition（DOM）', () => {
    let reduce;
    let stateEvents;
    const onState = (e) => stateEvents.push(e.detail.newState);

    beforeEach(() => {
        reduce = false;
        window.matchMedia = vi.fn((q) => ({
            matches: q.includes('prefers-reduced-motion') ? reduce : false,   // 斷點查詢：一律寬螢幕
            addEventListener() {}, removeEventListener() {},
        }));
        document.body.innerHTML = `
            <nav><button class="nav-item" data-view="chat"></button>
                 <button class="nav-item" data-view="diary"></button>
                 <button class="nav-item" data-view="calendar"></button></nav>
            <div id="chat-view" class="view-container"></div>
            <div id="diary-view" class="view-container">
                <div class="diary-list"></div><div class="diary-detail" style="display:none"></div>
            </div>
            <div id="calendar-view" class="view-container"></div>`;
        UIManager.init();                        // 會 switchToState(CHAT_FULL) 歸零
        stateEvents = [];
        document.addEventListener('viewStateChanged', onState);
    });

    afterEach(async () => {
        await UIManager.viewTransitionSettled();
        document.removeEventListener('viewStateChanged', onState);
        delete document.startViewTransition;
        delete window.matchMedia;
    });

    /** 行為同 Chromium 的替身：callback 延到 microtask 才跑，finished 在 callback 之後。 */
    function stubViewTransition() {
        document.startViewTransition = vi.fn((cb) => {
            const updateCallbackDone = Promise.resolve().then(cb);
            return { updateCallbackDone, ready: updateCallbackDone,
                     finished: updateCallbackDone.then(() => {}), skipTransition() {} };
        });
    }

    it('沒有 View Transition API（jsdom／舊瀏覽器）：同步切換，與今天完全相同', () => {
        UIManager.handleNavigation('diary');
        expect(UIManager.getCurrentState()).toBe('chat_diary');
        expect(document.getElementById('diary-view').classList.contains('half')).toBe(true);
        expect(stateEvents).toEqual(['chat_diary']);
    });

    it('有 API：走轉場——期間 html.vt-running、callback 才換 class、結束清掉 vt-running', async () => {
        stubViewTransition();
        UIManager.handleNavigation('calendar');
        expect(document.startViewTransition).toHaveBeenCalledTimes(1);
        expect(document.documentElement.classList.contains('vt-running')).toBe(true);
        expect(document.getElementById('calendar-view').classList.contains('active')).toBe(false);
        await UIManager.viewTransitionSettled();
        expect(document.getElementById('calendar-view').classList.contains('active')).toBe(true);
        expect(document.documentElement.classList.contains('vt-running')).toBe(false);
        expect(stateEvents).toEqual(['calendar_full']);
    });

    it('連續兩次程式觸發的導覽（callback 還沒跑）：以最後一次的意圖收斂', async () => {
        stubViewTransition();
        UIManager.handleNavigation('diary');   // 聊天全螢幕 → 聊天＋日記
        UIManager.handleNavigation('chat');    // 以「待套用的聊天＋日記」判斷 → 回聊天全螢幕
        await UIManager.viewTransitionSettled();
        await Promise.resolve();
        expect(UIManager.getCurrentState()).toBe('chat_full');
        expect(document.getElementById('chat-view').classList.contains('active')).toBe(true);
        expect(document.getElementById('diary-view').classList.contains('half')).toBe(false);
    });

    it('reduced-motion：不開轉場，同步切換', () => {
        stubViewTransition();
        reduce = true;
        UIManager.handleNavigation('diary');
        expect(document.startViewTransition).not.toHaveBeenCalled();
        expect(UIManager.getCurrentState()).toBe('chat_diary');
    });

    it('同狀態（已在行事曆再點行事曆）：不開轉場，但仍重新套用並發 viewStateChanged（行事曆會重載）', async () => {
        stubViewTransition();
        UIManager.handleNavigation('calendar');
        await UIManager.viewTransitionSettled();
        UIManager.handleNavigation('calendar');
        expect(document.startViewTransition).toHaveBeenCalledTimes(1);
        expect(stateEvents).toEqual(['calendar_full', 'calendar_full']);
    });

    it('非分頁切換（init、斷點變化、日記詳情開關）直接 switchToState，永不轉場', () => {
        stubViewTransition();
        UIManager.switchToState('chat_diary');
        UIManager.showDiaryDetail();
        UIManager.hideDiaryDetail();
        expect(document.startViewTransition).not.toHaveBeenCalled();
    });

    it('轉場 callback 內 switchToState 丟例外：console.error 記錄、vt-running 移除、待套用清掉', async () => {
        stubViewTransition();
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = new Error('boom');
        document.getElementById('chat-view').classList.remove = () => { throw boom; };
        UIManager.handleNavigation('calendar');
        await UIManager.viewTransitionSettled();
        await Promise.resolve();
        await Promise.resolve();
        expect(err).toHaveBeenCalledWith('視圖轉場錯誤:', boom);
        expect(document.documentElement.classList.contains('vt-running')).toBe(false);
        // 待套用已清掉：之後的導覽以目前狀態判斷（chat_full → diary → chat_diary）
        delete document.getElementById('chat-view').classList.remove;
        UIManager.handleNavigation('diary');
        await UIManager.viewTransitionSettled();
        await Promise.resolve();
        expect(UIManager.getCurrentState()).toBe('chat_diary');
        err.mockRestore();
    });

    it('callback 執行前的直接 switchToState 不會被待套用狀態蓋掉', async () => {
        stubViewTransition();
        UIManager.handleNavigation('calendar');          // 待套用 calendar_full
        UIManager.switchToState('chat_diary');           // 直接切換：以它為準
        await UIManager.viewTransitionSettled();
        await Promise.resolve();
        expect(UIManager.getCurrentState()).toBe('chat_diary');
    });

    it('startViewTransition 同步丟例外：移除 vt-running、清待套用、退回同步切換', () => {
        document.startViewTransition = vi.fn(() => { throw new Error('nope'); });
        UIManager.handleNavigation('calendar');
        expect(UIManager.getCurrentState()).toBe('calendar_full');
        expect(document.documentElement.classList.contains('vt-running')).toBe(false);
        UIManager.handleNavigation('chat');              // 若待套用殘留會以它判斷
        expect(UIManager.getCurrentState()).toBe('chat_full');
    });
});
