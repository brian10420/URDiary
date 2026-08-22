// @vitest-environment jsdom
import { describe, test, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.4 spec③ task 4：空狀態整合（日記／行事曆／無結果）。
 *
 * 第一個 describe 是 brief 指定的模組輸出鎖定（emptyHtml 的三種姿勢在 task 1
 * 已經定案，這裡第一次跑就會過——這是接線任務，不是新功能）。後面幾個
 * describe 是 DOM 級接線驗證：確認 diary_module.js／calendar_module.js 的
 * 「空」分支真的把 MascotModule 的輸出接進畫面，而不是只停留在「呼叫得到」。
 * 最後一個 describe 是 task 7（分類圖標兩級渲染）的接線驗證，沿用同一組
 * CalendarModule fixture，只是餵有事件而非空清單。
 *
 * 'generic' 姿勢目前沒有接線對象：diary_module.js／calendar_module.js 都
 * 沒有搜尋/篩選無結果的視圖（grep 過，兩檔都沒有 search/filter 相關字樣），
 * 因此 i18n 的 mascot.emptyGeneric 鍵已備妥（兩語），但只有第一個 describe
 * 的模組層測試會用到它；沒有第三個 DOM 接線 describe 對應它。
 */
describe('mascot empty states：模組輸出（brief 指定）', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    test('三種空狀態各用對應姿勢（睡覺 zzz／月曆紙／問號）', () => {
        expect(MascotModule.emptyHtml('diary', 'x')).toContain('>z<');
        expect(MascotModule.emptyHtml('calendar', 'x')).toContain('#e8836f');
        expect(MascotModule.emptyHtml('generic', 'x')).toContain('>?<');
    });
});

/** DiaryModule 的 DOM 測試共用 fixture（比照 tests/diary_cache_indicator.test.js）。 */
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

describe('DiaryModule 空清單接線（吉祥物插圖）', () => {
    beforeAll(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/diary_module.js');
    });

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

    /**
     * diaryListElement 是模組內部私有快取，只有在目前為 null 時 loadDiaries()
     * 才會重新查詢（見 diary_module.js 的自我修復邏輯）；DiaryModule.init()
     * 則是無條件重新查詢。這個 describe 每個 it() 的 beforeEach 都重建了
     * document.body.innerHTML（新的 .diary-list 節點），若不先呼叫 init()
     * 重新綁定，第二個以後的 it() 會讓 loadDiaries() 繼續寫入前一個 it()
     * 留下、已脫離文件的舊節點，斷言找不到東西——這不是本次改動引入的
     * 行為，是既有模組設計就有的限制，這裡用 init() 正確地繞開它。
     * isAuthenticated:false 讓 init() 內部跳過它自己的自動 loadDiaries()，
     * 改由下一行手動呼叫並 await，時序完全可控。
     */
    function bindFreshListElement() {
        // 呼叫端緊接著就會設回自己要用的 window.ApiService（見下面每個
        // it()），這裡只是借道 init() 的無條件重新查詢，不需要保留/還原。
        window.ApiService = { isAuthenticated: () => false, getDiaries: vi.fn() };
        DiaryModule.init();
    }

    it('空清單（getDiaries 回傳 []）→ 列表改用吉祥物睡覺插圖＋mascot.emptyDiary 文案', async () => {
        bindFreshListElement();
        window.ApiService = { getDiaries: vi.fn().mockResolvedValue([]) };

        await DiaryModule.loadDiaries();

        const listEl = document.querySelector('.diary-list');
        expect(listEl.innerHTML).toContain('mascot-empty');
        expect(listEl.innerHTML).toContain('>z<'); // 睡覺姿勢的 zzz 標記
        expect(listEl.innerHTML).toContain(I18N.t('mascot.emptyDiary'));
        // 舊版純文字 title/hint 不應再出現（已被單行 caption 取代）
        expect(listEl.innerHTML).not.toContain(I18N.t('diary.emptyTitle'));
    });

    it('「開始對話」按鈕保留在插圖旁，點擊仍會導覽到聊天視圖（原有功能不因加插圖而消失）', async () => {
        bindFreshListElement();
        window.ApiService = { getDiaries: vi.fn().mockResolvedValue([]) };

        await DiaryModule.loadDiaries();

        const startChatBtn = document.getElementById('start-chat-btn');
        expect(startChatBtn).not.toBeNull();
        startChatBtn.click();
        expect(window.UIManager.handleNavigation).toHaveBeenCalledWith('chat');
    });

    it('完全載入失敗（getDiaries 拋出）的空狀態一樣接吉祥物插圖', async () => {
        bindFreshListElement();
        window.ApiService = { getDiaries: vi.fn().mockRejectedValue(new Error('無法連線到伺服器')) };

        await DiaryModule.loadDiaries();

        const listEl = document.querySelector('.diary-list');
        expect(listEl.innerHTML).toContain('mascot-empty');
        expect(listEl.innerHTML).toContain(I18N.t('mascot.emptyDiary'));
    });
});

describe('CalendarModule 無事件視圖接線（吉祥物插圖）', () => {
    beforeAll(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/calendar_module.js');
    });

    beforeEach(() => {
        // 最小 fixture：CalendarModule.init() 只在缺少這三個元素時才提早
        // return（見 calendar_module.js init() 的 !viewElement||!gridElement||
        // !dayPanelElement 檢查），其餘（週標頭/月份標籤/事件表單相關元素）
        // 都各自對缺失元素安全，不需要在這裡搭出完整行事曆 DOM。
        document.body.innerHTML = `
            <div id="calendar-view">
                <div class="calendar-grid"></div>
                <div class="calendar-day-panel"></div>
            </div>
        `;
        window.UIManager = { showToast: vi.fn() };
    });

    it('當月無事件 → 日面板的空區改用吉祥物看月曆插圖＋mascot.emptyCalendar 文案', async () => {
        window.ApiService = { getCalendarEvents: vi.fn().mockResolvedValue({ occurrences: [] }) };

        CalendarModule.init();
        await CalendarModule.loadMonth();

        const panel = document.querySelector('.calendar-day-panel');
        const emptyBlock = panel.querySelector('.day-panel-empty');
        expect(emptyBlock).not.toBeNull();
        expect(emptyBlock.innerHTML).toContain('mascot-empty');
        expect(emptyBlock.innerHTML).toContain('#e8836f'); // 舉手看月曆姿勢的月曆紙標記
        expect(emptyBlock.innerHTML).toContain(I18N.t('mascot.emptyCalendar'));
        // 舊版純文字提示不應再出現（已被吉祥物插圖取代）
        expect(emptyBlock.innerHTML).not.toContain(I18N.t('calendar.noEvents'));
    });
});

/**
 * v2.4 spec③ task 7：月曆分類圖標兩級渲染的 DOM 級接線驗證。
 *
 * 沿用上一個 describe 的 fixture（同一組 .calendar-grid／.calendar-day-panel
 * DOM、mascot.js 先於 calendar_module.js 載入），改餵一筆「今天」的
 * occurrence，一次同時覆蓋兩個渲染點：月格（renderCellDots，18px 無臉）與
 * 日清單（renderDayPanel，24px 有臉）。guard fallback（MascotModule 未載入
 * 時退回 cat-dot）沿用本檔一貫的既有慣例，不另外對 calendar_helpers.test.js
 * 補 bare-load 渲染測試——該檔從建立以來就只測純函式／DOM-light 小函式，
 * 從未跑過 renderGrid/renderDayPanel（day-panel-empty 的既有 guard 同樣沒有
 * 對應的 bare-load 測試），這裡延續同一先例。
 */
describe('CalendarModule 分類圖標兩級渲染接線（吉祥物插圖，task 7）', () => {
    beforeAll(() => {
        loadCoreScripts(); // security_utils -> i18n -> config
        loadScript('js/mascot.js');
        loadScript('js/calendar_module.js');
    });

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="calendar-view">
                <div class="calendar-grid"></div>
                <div class="calendar-day-panel"></div>
            </div>
        `;
        window.UIManager = { showToast: vi.fn() };
    });

    it('月格保持整潔只用色點（v2.5 驗收回饋）；日清單維持 24px 有臉圖標', async () => {
        const todayIso = CalendarModule.toIsoDate(new Date());
        const occurrence = {
            event_id: 1,
            title: '晨會',
            note: null,
            category: 'work',
            date: todayIso,
            time: '09:00',
            recurrence: 'none',
            reminder_minutes: null
        };
        window.ApiService = { getCalendarEvents: vi.fn().mockResolvedValue({ occurrences: [occurrence] }) };

        CalendarModule.init(); // selectedDate 預設為今天，與 occurrence.date 對上
        await CalendarModule.loadMonth();

        // v2.5 驗收回饋：跨天橫槓會壓到月格圖標，月格改回小色點保持整潔，
        // 吉祥物圖標只留在右側日面板（24px 有臉）。
        const gridHtml = document.querySelector('.calendar-grid').innerHTML;
        expect(gridHtml).toContain('cat-dot');
        expect(gridHtml).not.toContain('mascot-cat-icon');
        // cat-dot 的 title 提示（分類名稱: 事件標題）維持不變
        expect(gridHtml).toContain(`title="${I18N.t('category.work')}: 晨會"`);

        const dayListHtml = document.querySelector('.day-event-list').innerHTML;
        expect(dayListHtml).toContain('mascot-cat-icon');
        expect(dayListHtml).toContain('width="24"');
        expect(dayListHtml).toContain('class="face"'); // 日清單是有臉版
    });
});
