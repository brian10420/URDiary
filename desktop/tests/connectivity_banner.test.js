// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 離線容忍（v2.3 task 2.3）：連線狀態橫幅。
 *
 * 兩個獨立訊號都可能不準：navigator.onLine 在部分平台/瀏覽器離線時仍回報
 * true；反過來，瀏覽器回報「online」也不保證真的連得上後端（可能連上路由器
 * 但後端掛了）。所以橫幅同時觀察 window 的 online/offline 事件，以及
 * fetchAPI 每次請求觀察到的網路層成敗（見 api_service.js 的
 * reportConnectivity()）。「該不該顯示」這個決策是純函式
 * （reduceConnectivityState + isConnectivityBannerVisible），這裡先驗證
 * 純函式本身的每一種狀態轉移，再驗證 DOM layer 真的把它接對。
 */
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/ui_manager.js');
});

describe('UIManager.reduceConnectivityState（純函式：連線狀態 reducer）', () => {
    it('browser-offline：只設定 browserOffline，不動 fetchFailing', () => {
        const next = UIManager.reduceConnectivityState(
            { browserOffline: false, fetchFailing: false },
            { type: 'browser-offline' }
        );
        expect(next).toEqual({ browserOffline: true, fetchFailing: false });
    });

    it('browser-offline 疊加在既有的 fetchFailing 之上（不會清掉它）', () => {
        const next = UIManager.reduceConnectivityState(
            { browserOffline: false, fetchFailing: true },
            { type: 'browser-offline' }
        );
        expect(next).toEqual({ browserOffline: true, fetchFailing: true });
    });

    it('browser-online：強訊號，兩個旗標一起清掉', () => {
        const next = UIManager.reduceConnectivityState(
            { browserOffline: true, fetchFailing: true },
            { type: 'browser-online' }
        );
        expect(next).toEqual({ browserOffline: false, fetchFailing: false });
    });

    it('fetch-network-fail：只設定 fetchFailing，不動 browserOffline', () => {
        const next = UIManager.reduceConnectivityState(
            { browserOffline: false, fetchFailing: false },
            { type: 'fetch-network-fail' }
        );
        expect(next).toEqual({ browserOffline: false, fetchFailing: true });
    });

    it('fetch-network-fail 疊加在既有的 browserOffline 之上（不會清掉它）', () => {
        const next = UIManager.reduceConnectivityState(
            { browserOffline: true, fetchFailing: false },
            { type: 'fetch-network-fail' }
        );
        expect(next).toEqual({ browserOffline: true, fetchFailing: true });
    });

    it('fetch-ok：兩個旗標一起清掉（請求成功是最直接的連得上證據）', () => {
        const next = UIManager.reduceConnectivityState(
            { browserOffline: true, fetchFailing: true },
            { type: 'fetch-ok' }
        );
        expect(next).toEqual({ browserOffline: false, fetchFailing: false });
    });

    it('未知的 action.type 原樣傳回狀態（新物件，內容不變）', () => {
        const state = { browserOffline: true, fetchFailing: false };
        const next = UIManager.reduceConnectivityState(state, { type: 'nonexistent' });
        expect(next).toEqual(state);
        expect(next).not.toBe(state);
    });

    it('缺少 state（undefined）時安全預設為兩個旗標皆 false 再套用動作', () => {
        expect(UIManager.reduceConnectivityState(undefined, { type: 'browser-offline' }))
            .toEqual({ browserOffline: true, fetchFailing: false });
    });

    it('缺少/畸形 action 時原樣傳回狀態', () => {
        const state = { browserOffline: false, fetchFailing: true };
        expect(UIManager.reduceConnectivityState(state, undefined)).toEqual(state);
        expect(UIManager.reduceConnectivityState(state, {})).toEqual(state);
    });

    it('純函式性質：同樣輸入永遠得到同樣輸出，且不修改傳入的 state 物件', () => {
        const state = { browserOffline: false, fetchFailing: false };
        const frozen = Object.freeze({ ...state });
        const next1 = UIManager.reduceConnectivityState(frozen, { type: 'fetch-network-fail' });
        const next2 = UIManager.reduceConnectivityState(frozen, { type: 'fetch-network-fail' });
        expect(next1).toEqual(next2);
        expect(frozen).toEqual({ browserOffline: false, fetchFailing: false }); // 沒被改到
    });
});

describe('UIManager.isConnectivityBannerVisible（純函式：該不該顯示橫幅）', () => {
    it('兩個旗標皆 false → 不顯示', () => {
        expect(UIManager.isConnectivityBannerVisible({ browserOffline: false, fetchFailing: false })).toBe(false);
    });

    it('任一旗標為 true → 顯示', () => {
        expect(UIManager.isConnectivityBannerVisible({ browserOffline: true, fetchFailing: false })).toBe(true);
        expect(UIManager.isConnectivityBannerVisible({ browserOffline: false, fetchFailing: true })).toBe(true);
        expect(UIManager.isConnectivityBannerVisible({ browserOffline: true, fetchFailing: true })).toBe(true);
    });

    it('缺少/undefined 的 state 安全預設為不顯示，不拋錯', () => {
        expect(UIManager.isConnectivityBannerVisible(undefined)).toBe(false);
        expect(UIManager.isConnectivityBannerVisible(null)).toBe(false);
        expect(UIManager.isConnectivityBannerVisible({})).toBe(false);
    });
});

describe('UIManager 連線橫幅 DOM 接線', () => {
    const BANNER_HTML = `
        <div id="connectivity-banner" role="status" aria-live="polite">
            <span id="connectivity-banner-text">目前無法連線到伺服器，部分功能可能無法使用</span>
        </div>
    `;

    beforeEach(() => {
        document.body.innerHTML = BANNER_HTML;
        // 每個測試都重新初始化（含重新查詢 DOM 元素、重置內部 state）——
        // window 的事件監聽器有防重複綁定的 guard，重複呼叫是安全的
        // （見 ui_manager.js initConnectivityBanner 的實作說明）。
        UIManager.initConnectivityBanner();
    });

    it('初始狀態（navigator.onLine 預設為 true）：橫幅不顯示', () => {
        const el = document.getElementById('connectivity-banner');
        expect(el.classList.contains('visible')).toBe(false);
    });

    it('reportNetworkStatus(false) → 橫幅顯示；reportNetworkStatus(true) → 橫幅隱藏', () => {
        const el = document.getElementById('connectivity-banner');

        UIManager.reportNetworkStatus(false);
        expect(el.classList.contains('visible')).toBe(true);
        expect(el.getAttribute('aria-hidden')).toBe('false');

        UIManager.reportNetworkStatus(true);
        expect(el.classList.contains('visible')).toBe(false);
        expect(el.getAttribute('aria-hidden')).toBe('true');
    });

    it('window "offline" 事件 → 橫幅顯示；"online" 事件 → 橫幅隱藏', () => {
        const el = document.getElementById('connectivity-banner');

        window.dispatchEvent(new Event('offline'));
        expect(el.classList.contains('visible')).toBe(true);

        window.dispatchEvent(new Event('online'));
        expect(el.classList.contains('visible')).toBe(false);
    });

    it('offline 事件 + fetch 仍然失敗 → online 事件到達後兩者一起清除（橫幅隱藏）', () => {
        const el = document.getElementById('connectivity-banner');

        window.dispatchEvent(new Event('offline'));
        UIManager.reportNetworkStatus(false);
        expect(el.classList.contains('visible')).toBe(true);

        window.dispatchEvent(new Event('online'));
        expect(el.classList.contains('visible')).toBe(false);
    });

    it('沒有 #connectivity-banner 元素時不拋錯（防禦性 guard）', () => {
        document.body.innerHTML = '';
        expect(() => UIManager.initConnectivityBanner()).not.toThrow();
        expect(() => UIManager.reportNetworkStatus(false)).not.toThrow();
    });
});
