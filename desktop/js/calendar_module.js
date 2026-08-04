/**
 * 行事曆模塊 - 月曆視圖、事件 CRUD 與提醒通知
 *
 * 由 js/main.js 統一初始化（插在 DiaryModule.init() 之後），本檔不自啟動。
 * 資料一律走 ApiService 的 /calendar 端點；該端點不需要 LLM 標頭，
 * 因此 fetchAPI 的 LLM_ENDPOINT_PATTERNS 維持不含 '/calendar'。
 */
const CalendarModule = (function() {
    // --- 常數 -----------------------------------------------------------------

    // 與後端 services/calendar_service.py 的 CATEGORIES / RECURRENCES 對齊；
    // 順序即色點的固定排列順序（同一格內恆定，顏色不會因事件先後而跳動）
    const CATEGORIES = ['work', 'study', 'health', 'family', 'anniversary', 'other'];
    const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

    // 提醒選項（分鐘）：null = 不提醒
    const REMINDER_CHOICES = [null, 5, 10, 30, 60, 1440];

    const MAX_DOTS_PER_CELL = 3;        // 一格最多幾個色點，其餘顯示 +N
    const REMINDER_TICK_MS = 60000;     // 提醒輪詢間隔
    const REMINDED_PREFIX = 'urdiary_reminded_';

    // --- 純函式（僅為 vitest 單元測試曝光，行為不變）-------------------------

    /**
     * Date → "YYYY-MM-DD"（本地日期欄位）
     *
     * 一律用 getFullYear/getMonth/getDate，不用 toISOString()：後者是 UTC，
     * 在 UTC+8 的晚上會整個偏成隔天，讓「今天」高亮與提醒判斷全錯一天。
     * 後端 calendar_service 的日期基準也是真實本地日期，兩邊必須一致。
     */
    function toIsoDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    /**
     * 月曆 42 格（6 週 × 7 天、週一為週首）的日期邊界
     * @param {number} year - 西元年
     * @param {number} month - 月份，0-based（與 JS Date 一致：0 = 1 月）
     * @returns {{startIso: string, endIso: string}} 含頭含尾的區間
     *
     * 固定 42 格而非「剛好塞得下」的 35/42 動態格數：月份切換時格線高度
     * 不跳動。42 天跨度為 41 天差，仍在後端 GET /calendar/events 的 62 天
     * 上限內，因此一次請求就能取得整個網格所需的 occurrences。
     */
    function monthGridRange(year, month) {
        const first = new Date(year, month, 1);
        // getDay() 以週日為 0；換算成「距離本週週一幾天」
        const mondayOffset = (first.getDay() + 6) % 7;
        const start = new Date(year, month, 1 - mondayOffset);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
        return { startIso: toIsoDate(start), endIso: toIsoDate(end) };
    }

    /**
     * 算出「今天、還沒發生、且有設提醒」的 occurrence 各自的提醒觸發時刻
     * @param {Array} occurrences - 後端 /calendar/events 回傳的 occurrence 陣列
     * @param {Date} now - 現在時刻（本地）
     * @returns {Array<{key: string, fireAt: Date, eventTime: Date, occurrence: Object}>}
     *          依 fireAt 由早到晚排序
     *
     * 只負責「算」：已過事件時刻的排除，但**不**過濾「還沒到 fireAt」的
     * —— 是否該現在發通知由呼叫端 (scheduleReminders) 判斷，這樣本函式
     * 完全純粹、時間邊界能被單元測試完整覆蓋。
     */
    function computeReminderTimes(occurrences, now) {
        if (!Array.isArray(occurrences)) return [];

        const todayIso = toIsoDate(now);
        const results = [];

        occurrences.forEach(occ => {
            if (!occ || occ.date !== todayIso) return;
            // reminder_minutes 可以是 0（「準時提醒」），不能用 falsy 判斷
            if (occ.reminder_minutes === null || occ.reminder_minutes === undefined) return;

            const eventTime = parseLocalDateTime(occ.date, occ.time);
            if (!eventTime) return;                             // 全天事件或時間格式無效
            if (now.getTime() >= eventTime.getTime()) return;   // 事件時刻已過

            results.push({
                key: `${occ.date}_${occ.event_id}`,
                fireAt: new Date(eventTime.getTime() - occ.reminder_minutes * 60000),
                eventTime: eventTime,
                occurrence: occ
            });
        });

        results.sort((a, b) => a.fireAt - b.fireAt);
        return results;
    }

    /**
     * "YYYY-MM-DD" + "HH:MM" → 本地 Date；全天（time 為 null）或格式無效回 null
     *
     * 用 new Date(y, m, d, hh, mm) 逐欄建構，不用 Date 字串解析：
     * "2026-08-04T14:00" 這種無時區字串各家引擎行為曾經分歧，逐欄建構
     * 永遠是本地時間，沒有歧義。
     */
    function parseLocalDateTime(dateIso, time) {
        if (typeof dateIso !== 'string' || typeof time !== 'string') return null;

        const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
        const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
        if (!dateMatch || !timeMatch) return null;

        const hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2]);
        if (hour > 23 || minute > 59) return null;

        return new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour, minute, 0, 0);
    }

    // --- 狀態 -----------------------------------------------------------------

    let viewYear = 0;                       // 目前顯示的年
    let viewMonth = 0;                      // 目前顯示的月（0-based）
    let selectedDate = null;                // 目前選取日 "YYYY-MM-DD"
    let occurrencesByDate = new Map();      // "YYYY-MM-DD" → occurrence[]（**只**服務目前顯示的月份）
    let todaysOccurrences = [];             // 「今天」的 occurrence 快照，專供提醒用
    let todaysSnapshotDate = null;          // 上面那份快照對應的日期，null = 尚未取得
    let isRefreshingToday = false;          // refreshTodaysOccurrences 的併發防護
    let editingEventId = null;              // 表單目前編輯中的事件 id（新增時為 null）
    let loadedOnce = false;                 // 惰性首載旗標
    let isLoading = false;
    let listenersBound = false;             // init() 可重複呼叫（切換帳號時），監聽器只綁一次
    let reminderTimer = null;

    // DOM元素 - 初始化為null，將在init函數中獲取
    let viewElement = null;
    let gridElement = null;
    let weekdaysElement = null;
    let dayPanelElement = null;
    let monthLabelElement = null;
    let dialogElement = null;

    // --- 初始化 ---------------------------------------------------------------

    function init() {
        console.log('初始化行事曆模塊');

        // 重新獲取DOM元素
        viewElement = document.getElementById('calendar-view');
        gridElement = document.querySelector('.calendar-grid');
        weekdaysElement = document.querySelector('.calendar-weekdays');
        dayPanelElement = document.querySelector('.calendar-day-panel');
        monthLabelElement = document.querySelector('.calendar-month-label');
        dialogElement = document.getElementById('event-dialog');

        if (!viewElement || !gridElement || !dayPanelElement) {
            console.error('初始化時找不到行事曆視圖元素，行事曆功能停用');
            return;
        }

        // 預設顯示今天所在的月份，並選取今天
        const today = new Date();
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
        selectedDate = toIsoDate(today);

        buildReminderOptions();
        renderWeekdays();
        renderMonthLabel();

        if (!listenersBound) {
            bindListeners();
            listenersBound = true;
        }

        // 每分鐘檢查一次是否有提醒到點（重複 init 不會疊出第二個計時器）
        if (reminderTimer === null && typeof setInterval === 'function') {
            reminderTimer = setInterval(scheduleReminders, REMINDER_TICK_MS);
        }

        // 先把今天的事件抓進提醒快照：提醒不該以「使用者有沒有打開行事曆」為前提。
        // 此時若還沒登入完成會直接跳過，由每分鐘的 tick 自我修復。
        refreshTodaysOccurrences();

        // 若使用者在初始化時已經在行事曆視圖（例如重新 init），立即載入
        if (typeof UIManager !== 'undefined' && UIManager.getCurrentState &&
            UIManager.getCurrentState() === UIManager.VIEW_STATE.CALENDAR_FULL) {
            handleEnterCalendarView();
        }
    }

    // 綁定所有事件（只執行一次）
    function bindListeners() {
        // 視圖狀態機切到行事曆時才真的去要資料（惰性首載）
        document.addEventListener('viewStateChanged', function(event) {
            const state = event && event.detail ? event.detail.newState : null;
            if (typeof UIManager !== 'undefined' && state === UIManager.VIEW_STATE.CALENDAR_FULL) {
                handleEnterCalendarView();
            }
        });

        bindClick('#calendar-prev-btn', () => shiftMonth(-1));
        bindClick('#calendar-next-btn', () => shiftMonth(1));
        bindClick('#calendar-today-btn', goToToday);
        bindClick('#calendar-add-btn', () => openEventForm(null, selectedDate));

        // 格子點擊用事件委派：每次 renderGrid 重建 innerHTML 後不必重綁
        gridElement.addEventListener('click', function(event) {
            const cell = event.target.closest('[data-date]');
            if (cell && gridElement.contains(cell)) {
                selectDate(cell.getAttribute('data-date'));
            }
        });

        dayPanelElement.addEventListener('click', handleDayPanelClick);

        // 事件表單
        bindClick('#event-save', saveEvent);
        bindClick('#event-cancel', closeEventForm);
        bindClick('#close-event-dialog-btn', closeEventForm);
        bindClick('#event-delete', () => confirmDelete(editingEventId));

        const allDayInput = document.getElementById('event-all-day');
        if (allDayInput) {
            allDayInput.addEventListener('change', syncAllDayState);
        }

        const recurrenceInput = document.getElementById('event-recurrence');
        if (recurrenceInput) {
            recurrenceInput.addEventListener('change', syncRecurrenceState);
        }
    }

    function bindClick(selector, handler) {
        const el = document.querySelector(selector);
        if (el) {
            el.addEventListener('click', handler);
        } else {
            console.warn(`行事曆：找不到元素 ${selector}，該按鈕無法使用`);
        }
    }

    // 進入行事曆視圖（每次都會呼叫，不是只有第一次）
    function handleEnterCalendarView() {
        ensureNotificationPermission();
        // loadedOnce 由 loadMonth 的**成功**路徑設定：首載失敗（例如後端還沒起來）
        // 時它維持 false，使用者下次再切進來就會自動重試，不會卡在空月曆
        if (!loadedOnce && !isLoading) {
            loadMonth();
        }
    }

    // --- 資料載入 -------------------------------------------------------------

    async function loadMonth() {
        const range = monthGridRange(viewYear, viewMonth);
        console.log(`載入行事曆事件: ${range.startIso} ~ ${range.endIso}`);

        isLoading = true;
        try {
            const response = await ApiService.getCalendarEvents(range.startIso, range.endIso);
            indexOccurrences(response && response.occurrences);
            // 這次載入的範圍涵蓋今天的話，順手更新提醒用的快照（免一次額外請求）
            applyTodaysSnapshot(range.startIso, range.endIso);
            loadedOnce = true;
            renderGrid();
            renderDayPanel(selectedDate);
            scheduleReminders();
        } catch (error) {
            console.error('載入行事曆事件失敗:', error);
            // 載入失敗時不留舊月份的殘影，避免使用者誤以為新月份沒有事件。
            // 注意：**不動 todaysOccurrences** —— 提醒是背景功能，不該被某次
            // 翻月的載入失敗連坐。loadedOnce 也維持原值，讓下次進視圖能重試。
            occurrencesByDate = new Map();
            renderGrid();
            renderDayPanel(selectedDate);
            UIManager.showToast(I18N.t('calendar.loadFailed'));
        } finally {
            isLoading = false;
        }
    }

    // 把 occurrence 陣列依日期建索引，並在每日內排序（全天在前，其餘按時間）
    function indexOccurrences(occurrences) {
        occurrencesByDate = new Map();
        if (!Array.isArray(occurrences)) {
            console.warn('行事曆回應缺少 occurrences 陣列，視為空月份');
            return;
        }

        occurrences.forEach(occ => {
            if (!occ || typeof occ.date !== 'string') return;
            if (!occurrencesByDate.has(occ.date)) {
                occurrencesByDate.set(occ.date, []);
            }
            occurrencesByDate.get(occ.date).push(occ);
        });

        occurrencesByDate.forEach(list => list.sort(compareOccurrences));
    }

    /**
     * ★ 純函式：[startIso, endIso]（含兩端）是否涵蓋 dateIso
     *
     * 三個值都是 "YYYY-MM-DD"，這種格式的字典序等同日期序，直接比字串即可。
     */
    function rangeCoversDate(startIso, endIso, dateIso) {
        if (typeof startIso !== 'string' || typeof endIso !== 'string' || typeof dateIso !== 'string') {
            return false;
        }
        return startIso <= dateIso && dateIso <= endIso;
    }

    /**
     * 若本次載入的範圍涵蓋今天，就從月份索引把「今天」的 occurrence 抄進快照
     *
     * 範圍不含今天時**保留**既有快照 —— 月曆索引 occurrencesByDate 只服務目前
     * 顯示的月份，翻到別的月份就不再有今天的資料；提醒若直接讀那份索引，
     * 使用者一翻月提醒就整個工作階段失效。
     */
    function applyTodaysSnapshot(startIso, endIso) {
        const todayIso = toIsoDate(new Date());
        if (!rangeCoversDate(startIso, endIso, todayIso)) return false;

        todaysOccurrences = occurrencesByDate.get(todayIso) || [];
        todaysSnapshotDate = todayIso;
        return true;
    }

    /**
     * 單獨取「今天」的 occurrence（start=end=today 的輕量請求）
     *
     * 三種情況需要它，都與使用者有沒有打開行事曆視圖無關：
     * 1. 使用者整個工作階段都沒進過行事曆 —— 惰性首載不會發生，但提醒該照常運作
     * 2. App 開著跨過午夜 —— 快照日期不再是「今天」
     * 3. 目前顯示的月份不涵蓋今天（翻月後又做了 CRUD）
     *
     * 靜默失敗：提醒是背景功能，不該為了它跳錯誤提示打斷使用者。
     */
    async function refreshTodaysOccurrences(force) {
        const todayIso = toIsoDate(new Date());
        if (!force && todaysSnapshotDate === todayIso) return;
        if (isRefreshingToday) return;
        // 尚未登入就別打 API：401 會讓 fetchAPI 發出 auth-expired、彈出登入框
        if (typeof ApiService === 'undefined' ||
            typeof ApiService.isAuthenticated !== 'function' || !ApiService.isAuthenticated()) {
            return;
        }

        isRefreshingToday = true;
        let updated = false;
        try {
            const response = await ApiService.getCalendarEvents(todayIso, todayIso);
            const list = (response && Array.isArray(response.occurrences)) ? response.occurrences : [];
            todaysOccurrences = list.slice().sort(compareOccurrences);
            todaysSnapshotDate = todayIso;
            updated = true;
            console.log(`已更新今日提醒快照: ${todaysOccurrences.length} 筆`);
        } catch (error) {
            console.warn('更新今日提醒快照失敗（下一個 tick 會再試）:', error);
        } finally {
            isRefreshingToday = false;
        }

        // 拿到新資料就立刻檢查一次，不必再等下一個 60 秒 tick。
        // 放在 finally 之後、旗標已歸零時呼叫；此時 todaysSnapshotDate 已是今天，
        // scheduleReminders 內的 refreshTodaysOccurrences 會直接短路返回，不會遞迴。
        if (updated) scheduleReminders();
    }

    // 全天（time 為 null）排最前，其餘依時間；同時間再依標題，讓順序穩定
    function compareOccurrences(a, b) {
        if (!a.time && b.time) return -1;
        if (a.time && !b.time) return 1;
        if (a.time !== b.time) return a.time < b.time ? -1 : 1;
        return String(a.title).localeCompare(String(b.title));
    }

    // --- 渲染 -----------------------------------------------------------------

    // 週標頭：從一個已知的週一起算 7 天，用 locale 產生名稱（不進 i18n 字典）
    function renderWeekdays() {
        if (!weekdaysElement) return;

        let html = '';
        for (let i = 0; i < 7; i++) {
            const day = new Date(2026, 0, 5 + i);   // 2026-01-05 是週一，往後 7 天即週一～週日
            const label = day.toLocaleDateString(I18N.dateLocale(), { weekday: 'short' });
            const weekendClass = (i >= 5) ? ' weekend' : '';
            html += `<div class="calendar-weekday${weekendClass}">${escapeHtml(label)}</div>`;
        }
        weekdaysElement.innerHTML = html;
    }

    function renderMonthLabel() {
        if (!monthLabelElement) return;
        const label = new Date(viewYear, viewMonth, 1)
            .toLocaleDateString(I18N.dateLocale(), { year: 'numeric', month: 'long' });
        monthLabelElement.textContent = label;
    }

    function renderGrid() {
        if (!gridElement) return;

        renderMonthLabel();

        const range = monthGridRange(viewYear, viewMonth);
        const start = new Date(`${range.startIso}T00:00:00`);
        const todayIso = toIsoDate(new Date());

        let html = '';
        for (let i = 0; i < 42; i++) {
            const cellDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const iso = toIsoDate(cellDate);

            const classes = ['calendar-cell'];
            if (cellDate.getMonth() !== viewMonth) classes.push('other-month');
            if (iso === todayIso) classes.push('today');
            if (iso === selectedDate) classes.push('selected');
            if (cellDate.getDay() === 0 || cellDate.getDay() === 6) classes.push('weekend');

            html += `<button type="button" class="${classes.join(' ')}" data-date="${escapeHtml(iso)}">` +
                    `<span class="cell-day">${cellDate.getDate()}</span>` +
                    renderCellDots(occurrencesByDate.get(iso)) +
                    `</button>`;
        }

        gridElement.innerHTML = html;
    }

    /**
     * 一格的分類色點：一件事一個點、最多 MAX_DOTS_PER_CELL 個，其餘以 +N 表示
     *
     * 色點依 CATEGORIES 的固定順序排列（不是事件時間順序），同一格的顏色
     * 排列才不會因為新增事件而整排重刷。色點是「這天有事、大概是哪類」的
     * 密度指示，**不是**唯一的分類識別管道：每個點帶 title 提示，權威的
     * 分類名稱則以文字顯示在日面板每一列（六色在 8px 圓點上無法對所有
     * 色覺都兩兩可分，詳見 css/calendar.css 的色彩說明）。
     */
    function renderCellDots(list) {
        if (!list || list.length === 0) return '';

        const ordered = list.slice().sort((a, b) =>
            CATEGORIES.indexOf(categoryOf(a)) - CATEGORIES.indexOf(categoryOf(b)));
        const shown = ordered.slice(0, MAX_DOTS_PER_CELL);
        const hiddenCount = ordered.length - shown.length;

        let html = '<span class="cell-dots">';
        shown.forEach(occ => {
            const category = categoryOf(occ);
            const tip = `${I18N.t('category.' + category)}: ${occ.title}`;
            html += `<span class="cat-dot cat-${escapeHtml(category)}" title="${escapeHtml(tip)}"></span>`;
        });
        if (hiddenCount > 0) {
            html += `<span class="cell-more">+${hiddenCount}</span>`;
        }
        html += '</span>';
        return html;
    }

    // 後端已用 Literal 限制分類值，這裡再防一次未知值（例如日後新增分類但前端未更新）
    function categoryOf(occurrence) {
        return CATEGORIES.includes(occurrence.category) ? occurrence.category : 'other';
    }

    function renderDayPanel(dateIso) {
        if (!dayPanelElement) return;

        const iso = dateIso || toIsoDate(new Date());
        const list = occurrencesByDate.get(iso) || [];
        const heading = new Date(`${iso}T00:00:00`).toLocaleDateString(I18N.dateLocale(), {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
        });

        let html = `<div class="day-panel-header">
                <h3 class="day-panel-title">${escapeHtml(heading)}</h3>
                <button type="button" class="btn btn-sm" data-action="add">${escapeHtml(I18N.t('calendar.addEvent'))}</button>
            </div>`;

        if (list.length === 0) {
            html += `<div class="day-panel-empty">
                    <p>${escapeHtml(I18N.t('calendar.noEvents'))}</p>
                </div>`;
        } else {
            html += '<ul class="day-event-list">';
            list.forEach(occ => {
                const category = categoryOf(occ);
                const timeLabel = occ.time ? occ.time : I18N.t('calendar.allDayLabel');
                html += `<li class="day-event" data-event-id="${escapeHtml(occ.event_id)}">
                        <span class="day-event-time">${escapeHtml(timeLabel)}</span>
                        <span class="cat-dot cat-${escapeHtml(category)}"></span>
                        <span class="day-event-main">
                            <span class="day-event-title">${escapeHtml(occ.title)}</span>
                            <span class="day-event-meta">${escapeHtml(I18N.t('category.' + category))}${
                                occ.recurrence && occ.recurrence !== 'none'
                                    ? ' · ' + escapeHtml(I18N.t('recurrence.' + occ.recurrence))
                                    : ''
                            }</span>
                            ${occ.note ? `<span class="day-event-note">${escapeHtml(occ.note)}</span>` : ''}
                        </span>
                        <span class="day-event-actions">
                            <button type="button" class="btn btn-sm" data-action="edit"
                                    title="${escapeHtml(I18N.t('calendar.editEvent'))}">
                                <i class="fa fa-pen"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-danger" data-action="delete"
                                    title="${escapeHtml(I18N.t('calendar.deleteEvent'))}">
                                <i class="fa fa-trash"></i>
                            </button>
                        </span>
                    </li>`;
            });
            html += '</ul>';
        }

        dayPanelElement.innerHTML = html;
    }

    // --- 互動 -----------------------------------------------------------------

    function handleDayPanelClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button || !dayPanelElement.contains(button)) return;

        const action = button.getAttribute('data-action');
        if (action === 'add') {
            openEventForm(null, selectedDate);
            return;
        }

        const row = button.closest('[data-event-id]');
        if (!row) return;
        const eventId = row.getAttribute('data-event-id');

        if (action === 'edit') {
            const list = occurrencesByDate.get(selectedDate) || [];
            const occurrence = list.find(o => String(o.event_id) === String(eventId));
            if (occurrence) openEventForm(occurrence, selectedDate);
        } else if (action === 'delete') {
            confirmDelete(eventId);
        }
    }

    function selectDate(dateIso) {
        if (!dateIso) return;
        selectedDate = dateIso;

        // 點到上/下個月的日期就跟著翻月（該日已在目前 42 格內，不必重新請求）
        const clicked = new Date(`${dateIso}T00:00:00`);
        if (clicked.getMonth() !== viewMonth || clicked.getFullYear() !== viewYear) {
            viewYear = clicked.getFullYear();
            viewMonth = clicked.getMonth();
            loadMonth();
            return;
        }

        renderGrid();
        renderDayPanel(selectedDate);
    }

    function shiftMonth(delta) {
        const shifted = new Date(viewYear, viewMonth + delta, 1);
        viewYear = shifted.getFullYear();
        viewMonth = shifted.getMonth();
        loadMonth();
    }

    function goToToday() {
        const today = new Date();
        selectedDate = toIsoDate(today);
        if (today.getFullYear() === viewYear && today.getMonth() === viewMonth) {
            renderGrid();
            renderDayPanel(selectedDate);
            return;
        }
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
        loadMonth();
    }

    // --- 事件表單 -------------------------------------------------------------

    // 提醒下拉選單的選項需要 {n} 代換，無法用 data-i18n 靜態翻譯，這裡動態建
    function buildReminderOptions() {
        const select = document.getElementById('event-reminder');
        if (!select) return;

        select.innerHTML = '';
        REMINDER_CHOICES.forEach(minutes => {
            const option = document.createElement('option');
            option.value = (minutes === null) ? '' : String(minutes);
            option.textContent = reminderLabel(minutes);
            select.appendChild(option);
        });
    }

    function reminderLabel(minutes) {
        if (minutes === null) return I18N.t('calendar.reminderNone');
        if (minutes === 1440) return I18N.t('calendar.reminderDayBefore');
        return I18N.t('calendar.reminderMinutes', { n: minutes });
    }

    /**
     * ★ 純函式：依 occurrence（或新增時的預填日期）組出事件表單要顯示的欄位值
     * @param {Object|null} occurrence - 編輯時的 occurrence；新增時為 null
     * @param {string} presetDateIso - 新增時預填的日期
     * @returns {Object} 表單欄位值，形狀與後端 CalendarEventCreate/Update 一致
     *
     * 日期欄位刻意讀 occurrence.event_date（系列錨定日），不是 occurrence.date
     * （使用者點開的那一次展開日）——後端 GET /calendar/events 的每個
     * occurrence 現在都帶回系列的原始欄位（event_date/recurrence_until），
     * 編輯重複事件時使用者改的是整個系列，不是單次發生，用 event_date
     * 預填才不會在儲存時把系列起始日誤植成被點開的那一次發生日。
     */
    function buildFormValues(occurrence, presetDateIso) {
        return {
            title: occurrence ? occurrence.title : '',
            note: (occurrence && occurrence.note) ? occurrence.note : '',
            category: occurrence ? occurrence.category : 'other',
            event_date: occurrence ? occurrence.event_date : (presetDateIso || toIsoDate(new Date())),
            event_time: occurrence ? occurrence.time : null,
            recurrence: occurrence ? occurrence.recurrence : 'none',
            recurrence_until: occurrence ? occurrence.recurrence_until : null,
            reminder_minutes: occurrence ? occurrence.reminder_minutes : null
        };
    }

    /**
     * 開啟事件表單
     * @param {Object|null} occurrence - 編輯時的 occurrence；新增時為 null
     * @param {string} presetDateIso - 新增時預填的日期
     *
     * 表單欄位值交給 buildFormValues 組裝（純函式，見上）；不必再像先前
     * 那樣另外快取一份 POST/PUT 回應（rawById）來補齊 event_date /
     * recurrence_until——GET /calendar/events 的 occurrence 現在就有這兩欄。
     */
    function openEventForm(occurrence, presetDateIso) {
        if (!dialogElement) return;

        editingEventId = occurrence ? occurrence.event_id : null;
        const values = buildFormValues(occurrence, presetDateIso);

        setValue('event-title', values.title);
        setValue('event-note', values.note);
        setValue('event-category', CATEGORIES.includes(values.category) ? values.category : 'other');
        setValue('event-date', values.event_date);
        setValue('event-time', values.event_time || '09:00');
        setValue('event-recurrence', RECURRENCES.includes(values.recurrence) ? values.recurrence : 'none');
        setValue('event-until', values.recurrence_until || '');
        setValue('event-reminder', values.reminder_minutes === null || values.reminder_minutes === undefined
            ? '' : String(values.reminder_minutes));

        const allDayInput = document.getElementById('event-all-day');
        if (allDayInput) allDayInput.checked = !values.event_time;

        syncAllDayState();
        syncRecurrenceState();
        showFormError('');

        // 標題與刪除鈕依「新增 / 編輯」切換
        const heading = document.getElementById('event-dialog-title');
        if (heading) {
            heading.textContent = I18N.t(occurrence ? 'calendar.editEvent' : 'calendar.addEvent');
        }
        const deleteBtn = document.getElementById('event-delete');
        if (deleteBtn) deleteBtn.style.display = occurrence ? '' : 'none';

        dialogElement.style.display = 'block';
        const titleInput = document.getElementById('event-title');
        if (titleInput) titleInput.focus();
    }

    function closeEventForm() {
        if (dialogElement) dialogElement.style.display = 'none';
        editingEventId = null;
    }

    // 全天時停用時間欄位與提醒欄位（後端以 event_time = null 表示全天；全天事件
    // 沒有時間點可供 computeReminderTimes 換算 fireAt，提醒選了也永遠不會觸發——
    // 停用選單並讓 readForm() 把停用中的選單視為未設提醒，避免悄悄存進一個使用者
    // 以為設了、實際上永遠不會響的提醒）
    function syncAllDayState() {
        const allDayInput = document.getElementById('event-all-day');
        const timeInput = document.getElementById('event-time');
        const reminderInput = document.getElementById('event-reminder');
        if (!allDayInput || !timeInput) return;
        timeInput.disabled = allDayInput.checked;
        if (reminderInput) reminderInput.disabled = allDayInput.checked;
    }

    // 不重複時隱藏「重複到」欄位與「編輯套用整個系列」提示；兩者顯示條件相同
    function syncRecurrenceState() {
        const recurrenceInput = document.getElementById('event-recurrence');
        if (!recurrenceInput) return;
        const isRecurring = recurrenceInput.value !== 'none';

        const untilRow = document.getElementById('event-until-row');
        if (untilRow) untilRow.style.display = isRecurring ? '' : 'none';

        const seriesHint = document.getElementById('event-series-hint');
        if (seriesHint) seriesHint.style.display = isRecurring ? '' : 'none';
    }

    // 從表單讀出一份完整的事件欄位（值的形狀與後端 schema 一致）
    function readForm() {
        const allDay = document.getElementById('event-all-day');
        const recurrence = getValue('event-recurrence') || 'none';
        const until = getValue('event-until');
        const reminderInput = document.getElementById('event-reminder');
        // 全天時提醒欄位被 syncAllDayState 停用；停用中的選單即使還殘留先前選的
        // 值，也一律視為未設提醒，不能把它當成使用者這次的選擇送出。
        const reminder = (reminderInput && reminderInput.disabled) ? '' : getValue('event-reminder');
        const note = (getValue('event-note') || '').trim();

        return {
            title: (getValue('event-title') || '').trim(),
            note: note || null,
            category: getValue('event-category') || 'other',
            event_date: getValue('event-date') || '',
            event_time: (allDay && allDay.checked) ? null : (getValue('event-time') || null),
            recurrence: recurrence,
            recurrence_until: (recurrence === 'none' || !until) ? null : until,
            reminder_minutes: reminder === '' ? null : Number(reminder)
        };
    }

    async function saveEvent() {
        const payload = readForm();

        if (!payload.title) {
            showFormError(I18N.t('calendar.titleRequired'));
            return;
        }
        if (!payload.event_date) {
            showFormError(I18N.t('calendar.dateRequired'));
            return;
        }
        showFormError('');

        const saveBtn = document.getElementById('event-save');
        if (saveBtn) saveBtn.disabled = true;

        try {
            // 後端 PUT 現在明確區分「欄位缺席＝維持原值」與「欄位為 null＝清空」
            // (model_dump(exclude_unset=True))，因此可以直接送出表單完整狀態，
            // 不必再自己 diff 出「有改動的欄位」。編輯時 payload.event_date
            // 是系列錨定日（見 buildFormValues/openEventForm 的預填邏輯），
            // 不是被點開的那一次 occurrence 的日期，所以整包送出不會誤把
            // 重複事件的起始日搬到使用者點開的那一次發生日。
            if (editingEventId !== null && editingEventId !== undefined) {
                await ApiService.updateCalendarEvent(editingEventId, payload);
            } else {
                await ApiService.createCalendarEvent(payload);
            }

            UIManager.showToast(I18N.t('calendar.saved'));
            closeEventForm();
            await loadMonth();
            // CRUD 可能動到今天的事件；若這次 loadMonth 的範圍不含今天（正在看別的月份），
            // 上面的 applyTodaysSnapshot 不會更新快照，這裡強制補一次
            await refreshTodaysOccurrences(true);
        } catch (error) {
            console.error('儲存行事曆事件失敗:', error);
            showFormError(I18N.t('calendar.saveFailed'));
            UIManager.showToast(I18N.t('calendar.saveFailed'));
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function confirmDelete(eventId) {
        if (eventId === null || eventId === undefined) return;
        if (!window.confirm(I18N.t('calendar.deleteConfirm'))) return;

        try {
            await ApiService.deleteCalendarEvent(eventId);
            UIManager.showToast(I18N.t('calendar.deleted'));
            closeEventForm();
            await loadMonth();
            // 同 saveEvent：刪掉的可能是今天的事件，快照要跟著更新
            await refreshTodaysOccurrences(true);
        } catch (error) {
            console.error('刪除行事曆事件失敗:', error);
            UIManager.showToast(I18N.t('calendar.deleteFailed'));
        }
    }

    // --- 提醒通知 -------------------------------------------------------------

    // 首次進入行事曆時才詢問通知權限（不在 App 啟動時就打擾使用者）
    function ensureNotificationPermission() {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'default') return;
        if (typeof Notification.requestPermission !== 'function') return;

        try {
            const result = Notification.requestPermission();
            if (result && typeof result.catch === 'function') {
                result.catch(error => console.warn('請求通知權限失敗:', error));
            }
        } catch (error) {
            console.warn('請求通知權限失敗:', error);
        }
    }

    /**
     * 檢查今天有沒有提醒到點；到點且尚未提醒過的就發一則瀏覽器通知。
     *
     * 去重鍵含使用者 id：同一台裝置切換帳號時，A 的提醒紀錄不會壓住 B 的
     * 同日同 id 事件。每次呼叫順手清掉非今日的舊鍵，避免 localStorage 無限長大。
     */
    function scheduleReminders() {
        if (typeof Notification === 'undefined') return;

        pruneRemindedKeys();

        if (Notification.permission !== 'granted') return;

        // 快照過期（跨日）或還沒取得（沒進過行事曆視圖）時補一次；非同步，
        // 取回來會自己再呼叫一次 scheduleReminders，這裡先用手上的資料繼續
        refreshTodaysOccurrences();

        const now = new Date();

        // 讀專用快照，不讀 occurrencesByDate —— 後者只有目前顯示的月份，翻月即失效
        computeReminderTimes(todaysOccurrences, now).forEach(item => {
            if (now.getTime() < item.fireAt.getTime()) return;   // 還沒到提醒時刻

            const storageKey = REMINDED_PREFIX + currentUserKey() + '_' + item.key;
            if (localStorage.getItem(storageKey)) return;        // 這則已經提醒過

            try {
                new Notification(item.occurrence.title, {
                    body: I18N.t('calendar.reminderBody', {
                        time: item.occurrence.time,
                        title: item.occurrence.title
                    }),
                    icon: 'assets/icon.jpg'
                });
                localStorage.setItem(storageKey, '1');
                console.log(`已發出行事曆提醒: ${item.key}`);
            } catch (error) {
                console.warn('發送提醒通知失敗:', error);
            }
        });
    }

    // 清掉非今日的提醒去重鍵（鍵格式：urdiary_reminded_<userId>_<YYYY-MM-DD>_<eventId>）
    function pruneRemindedKeys() {
        const todayFragment = '_' + toIsoDate(new Date()) + '_';
        const stale = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.indexOf(REMINDED_PREFIX) === 0 && key.indexOf(todayFragment) === -1) {
                stale.push(key);
            }
        }

        stale.forEach(key => localStorage.removeItem(key));
    }

    function currentUserKey() {
        return localStorage.getItem('numericUserId') || localStorage.getItem('currentUserId') || 'anon';
    }

    // --- 小工具 ---------------------------------------------------------------

    function getValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = (value === null || value === undefined) ? '' : value;
    }

    // 表單錯誤用 textContent 寫入（非 innerHTML），不需轉義也不可能注入
    function showFormError(message) {
        const el = document.getElementById('event-error');
        if (!el) return;
        el.textContent = message || '';
        el.style.display = message ? 'block' : 'none';
    }

    // 重置行事曆模塊（切換帳號時由 main.js 呼叫，避免看到前一個帳號的事件）
    function reset() {
        console.log('重置行事曆模塊');

        occurrencesByDate = new Map();
        // 提醒快照也要清 —— 換帳號後不能再拿前一個帳號的事件發通知
        todaysOccurrences = [];
        todaysSnapshotDate = null;
        selectedDate = toIsoDate(new Date());
        loadedOnce = false;
        editingEventId = null;

        closeEventForm();
        if (gridElement) gridElement.innerHTML = '';
        if (dayPanelElement) dayPanelElement.innerHTML = '';

        console.log('行事曆模塊已重置');
    }

    // 返回公共API
    return {
        init: init,
        reset: reset,
        loadMonth: loadMonth,
        openEventForm: openEventForm,
        scheduleReminders: scheduleReminders,
        refreshTodaysOccurrences: refreshTodaysOccurrences,
        // 提醒快照的現況，供 CDP 驗證與除錯（回複本，外部改不到內部狀態）
        getReminderSnapshot: () => ({ date: todaysSnapshotDate, occurrences: todaysOccurrences.slice() }),
        // 以下五個是純函式，僅為 vitest 單元測試曝光，行為不變
        toIsoDate: toIsoDate,
        monthGridRange: monthGridRange,
        computeReminderTimes: computeReminderTimes,
        rangeCoversDate: rangeCoversDate,
        buildFormValues: buildFormValues,
        // 同樣僅為 vitest 曝光：會讀/寫 DOM，但對缺失元素安全（不丟例外），
        // 用來回歸測試「全天事件連帶停用提醒欄位」與「停用中的提醒選單一律
        // 視為未設提醒」這條規則
        syncAllDayState: syncAllDayState,
        readForm: readForm
    };
})();
