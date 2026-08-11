/**
 * UI管理器 - 處理界面元素和交互
 */
const UIManager = (function() {
    // 視圖狀態枚舉
    const VIEW_STATE = {
        CHAT_FULL: 'chat_full',             // 狀態1: 全螢幕聊天
        CHAT_DIARY_SPLIT: 'chat_diary',     // 狀態2: 聊天+日記列表分割
        DIARY_DETAIL_SPLIT: 'diary_detail', // 狀態3: 日記列表+日記詳情分割
        CHAT_DETAIL_SPLIT: 'chat_detail',   // 狀態4: 聊天+日記詳情分割
        CALENDAR_FULL: 'calendar_full'      // 狀態5: 全螢幕行事曆 (不與聊天/日記分割)
    };

    // 視圖基本類型
    const VIEW_TYPE = {
        CHAT: 'chat',
        DIARY: 'diary',
        CALENDAR: 'calendar'
    };

    // 版面模式（v2.3 task 2.1）：寬螢幕（桌面/平板橫向）vs 窄螢幕（手機）。
    // 斷點跟 css/mobile.css 的 @media (max-width: 768px) 必須保持一致——
    // 兩邊沒有共用來源（本專案無建置流程），修改其中一處務必同步修改另一處。
    const LAYOUT_MODE = {
        WIDE: 'wide',
        MOBILE: 'mobile'
    };
    const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

    // matchMedia 回傳的 MediaQueryList，惰性建立於 initLayoutModeWatcher()。
    // 環境沒有 window.matchMedia（jsdom 預設環境、極舊瀏覽器）時維持 null，
    // getLayoutMode() 會因此固定回傳 WIDE —— 也就是今天的桌面版面，不會
    // 拋錯，也不會誤判成手機版面。
    let mobileMediaQuery = null;

    // DOM元素引用
    const elements = {
        navItems: document.querySelectorAll('.nav-item'),
        viewContainers: document.querySelectorAll('.view-container'),
        chatContainer: document.querySelector('#chat-view'),
        diaryContainer: document.querySelector('#diary-view'),
        calendarContainer: document.querySelector('#calendar-view'),
        spinner: document.querySelector('.loading-spinner'),
        errorContainer: document.querySelector('#error-container'),
        themeToggleBtn: document.querySelector('#theme-toggle'),
        debugBtn: document.querySelector('#debug-btn')
    };
    
    // 當前視圖狀態
    let currentViewState = VIEW_STATE.CHAT_FULL;
    
    // 初始化UI管理器
    function init() {
        console.log('初始化UI管理器');
        
        // 重新獲取DOM元素，避免初始化過早
        refreshDOMElements();

        // 監看寬/窄螢幕斷點（v2.3 task 2.1）——必須在第一次 switchToState
        // 之前就緒，第一次套版面才會用對 layoutMode
        initLayoutModeWatcher();

        // 設置默認視圖
        switchToState(VIEW_STATE.CHAT_FULL);
        
        // 綁定導航事件
        if (elements.navItems && elements.navItems.length > 0) {
            elements.navItems.forEach(item => {
                item.addEventListener('click', function() {
                    const view = this.getAttribute('data-view');
                    if (view) {
                        console.log(`點擊導航項: ${view}`);
                        handleNavigation(view);
                    }
                });
            });
            console.log(`已綁定 ${elements.navItems.length} 個導航項目`);
        } else {
            console.warn('未找到導航項目，無法綁定事件');
        }
        
        // 綁定錯誤視窗的關閉按鈕 (原本 index.html 有此按鈕但無任何處理器，
        // 導致錯誤提示一旦出現就無法關閉)
        const closeErrorBtn = document.getElementById('close-error-btn');
        if (closeErrorBtn && !closeErrorBtn.dataset.bound) {
            closeErrorBtn.dataset.bound = 'true';
            closeErrorBtn.addEventListener('click', hideError);
        }

        // 添加色彩主題切換功能
        initializeThemeToggle();

        // 初始化Debug按鈕
        initializeDebugButton();

        // 鍵盤感知聊天輸入框（v2.3 task 2.1）
        initKeyboardAwareInput();

        // 應用初始主題
        applyTheme(getCurrentTheme());
        
        console.log('UI管理器初始化完成');
    }
    
    // 處理導航點擊
    function handleNavigation(view) {
        console.log(`處理導航點擊: ${view}, 當前狀態: ${currentViewState}`);
        
        try {
            // 行事曆是獨立的全螢幕狀態，不與聊天/日記組合分割 ——
            // 任何狀態點「行事曆」都直接進 CALENDAR_FULL，不必逐狀態列舉
            if (view === VIEW_TYPE.CALENDAR) {
                switchToState(VIEW_STATE.CALENDAR_FULL);
                return;
            }

            // 根據當前狀態和點擊的導航項目決定下一個狀態
            switch (currentViewState) {
                case VIEW_STATE.CHAT_FULL:
                    // 狀態1: 全螢幕聊天 (點擊日記→狀態2，點擊聊天→維持狀態1)
                    if (view === VIEW_TYPE.DIARY) {
                        switchToState(VIEW_STATE.CHAT_DIARY_SPLIT);
                    }
                    break;
                    
                case VIEW_STATE.CHAT_DIARY_SPLIT:
                    // 狀態2: 聊天+日記列表分割 (點擊聊天→狀態1)
                    if (view === VIEW_TYPE.CHAT) {
                        switchToState(VIEW_STATE.CHAT_FULL);
                    }
                    break;
                    
                case VIEW_STATE.DIARY_DETAIL_SPLIT:
                    // 狀態3: 日記列表+日記詳情分割 (點擊聊天→狀態4)
                    if (view === VIEW_TYPE.CHAT) {
                        switchToState(VIEW_STATE.CHAT_DETAIL_SPLIT);
                    }
                    break;
                    
                case VIEW_STATE.CHAT_DETAIL_SPLIT:
                    // 狀態4: 聊天+日記詳情分割 (點擊聊天→狀態1，點擊日記→狀態2)
                    if (view === VIEW_TYPE.CHAT) {
                        switchToState(VIEW_STATE.CHAT_FULL);
                    } else if (view === VIEW_TYPE.DIARY) {
                        switchToState(VIEW_STATE.CHAT_DIARY_SPLIT);
                    }
                    break;

                case VIEW_STATE.CALENDAR_FULL:
                    // 狀態5: 全螢幕行事曆 (點擊聊天→狀態1，點擊日記→狀態2)
                    // 註：離開行事曆一律回到「列表」型的狀態，不還原離開前開著的
                    // 日記詳情 —— 行事曆是全螢幕狀態，switchToState 進來時已把詳情收起
                    if (view === VIEW_TYPE.CHAT) {
                        switchToState(VIEW_STATE.CHAT_FULL);
                    } else if (view === VIEW_TYPE.DIARY) {
                        switchToState(VIEW_STATE.CHAT_DIARY_SPLIT);
                    }
                    break;

                default:
                    // 默認回到全螢幕聊天
                    switchToState(VIEW_STATE.CHAT_FULL);
                    break;
            }
        } catch (error) {
            console.error('導航處理錯誤:', error);
        }
    }

    // ------------------------------------------------------------------
    // resolvePaneClasses（v2.3 task 2.1）
    //
    // 狀態機的「決定要套哪些 class」與「真的去操作 DOM」拆成兩層：這個函式
    // 只負責前者，是純函式——只吃 (state, layoutMode) 兩個字串參數、只回傳
    // 一個 plain object，完全不碰 document/window/matchMedia，因此可以在
    // vitest 裡直接呼叫、不需要 DOM 環境也不需要 mock 任何瀏覽器 API。
    // switchToState()（下面）是唯一的呼叫端，負責把回傳值套到真正的 DOM
    // 元素上、處理轉場時序（display:none 的延遲等）。
    //
    // 回傳形狀：{ chat, diary, calendar, detail }，四個 key 分別對應
    // #chat-view / #diary-view / #calendar-view 三個頂層 .view-container，
    // 與 .diary-detail 面板。每個值都是「要 add 上去的 class 名稱字串」：
    //   - ''            不需要任何額外 class（維持 view-container 的預設
    //                    隱藏樣式，或 detail 維持未展開）
    //   - 'active'      該面板全螢幕顯示
    //   - 'half left' / 'half right'
    //                    （只有寬螢幕會出現）該面板佔 50% 寬、並列在左/右
    // switchToState 呼叫端用 String.split(' ') 拆開後逐一 classList.add，
    // 所以這裡回傳的字串必須是合法的、以單一空白分隔的 class 名稱列表。
    //
    // 寬螢幕（layoutMode === LAYOUT_MODE.WIDE）分支逐一複製 v2.3 之前
    // switchToState 各個 case 裡原本寫死的 classList.add 組合，行為不變
    // （regression 測試見 tests/ui_manager_helpers.test.js）。
    //
    // 窄螢幕（layoutMode === LAYOUT_MODE.MOBILE）分支把五個狀態收斂成
    // 「同一時間只顯示一個面板、只用 .active、絕不用 .half」：
    //   - CHAT_FULL / CHAT_DIARY_SPLIT      → 顯示這個狀態原本要高亮的那個
    //                                          面板（聊天或日記列表）單獨全螢幕
    //   - DIARY_DETAIL_SPLIT / CHAT_DETAIL_SPLIT
    //                                        → 兩者都收斂成「日記詳情全螢幕」
    //                                          （diary 面板 active 且 detail
    //                                          active），退出靠既有的
    //                                          #back-to-list-btn（觸發
    //                                          hideDiaryDetail，與桌面版
    //                                          共用同一套退出邏輯，不必為
    //                                          手機另外做一顆返回鈕）
    //   - CALENDAR_FULL                      → 不變（本來就已經是單一全螢幕
    //                                          面板，寬窄螢幕沒有差異）
    function resolvePaneClasses(state, layoutMode) {
        const S = VIEW_STATE;

        if (layoutMode === LAYOUT_MODE.MOBILE) {
            switch (state) {
                case S.CHAT_FULL:
                    return { chat: 'active', diary: '', calendar: '', detail: '' };
                case S.CHAT_DIARY_SPLIT:
                    return { chat: '', diary: 'active', calendar: '', detail: '' };
                case S.DIARY_DETAIL_SPLIT:
                case S.CHAT_DETAIL_SPLIT:
                    return { chat: '', diary: 'active', calendar: '', detail: 'active' };
                case S.CALENDAR_FULL:
                    return { chat: '', diary: '', calendar: 'active', detail: '' };
                default:
                    return { chat: 'active', diary: '', calendar: '', detail: '' };
            }
        }

        // layoutMode === LAYOUT_MODE.WIDE（或任何非 'mobile' 的值，含未知/
        // 缺省輸入——安全預設是今天的桌面行為，而不是靜默切到手機版面）
        switch (state) {
            case S.CHAT_FULL:
                return { chat: 'active', diary: '', calendar: '', detail: '' };
            case S.CHAT_DIARY_SPLIT:
                return { chat: 'half left', diary: 'half right', calendar: '', detail: '' };
            case S.DIARY_DETAIL_SPLIT:
                return { chat: '', diary: 'active', calendar: '', detail: 'active' };
            case S.CHAT_DETAIL_SPLIT:
                return { chat: 'half left', diary: 'half right', calendar: '', detail: 'active' };
            case S.CALENDAR_FULL:
                return { chat: '', diary: '', calendar: 'active', detail: '' };
            default:
                return { chat: 'active', diary: '', calendar: '', detail: '' };
        }
    }

    // 這個狀態在導覽列/分頁列該高亮哪個 data-view——純粹是「語意上屬於哪個
    // 分類」，跟 layoutMode 無關（DIARY_DETAIL_SPLIT 在手機上雖然畫面收斂成
    // 「日記詳情全螢幕」，高亮的仍是「日記」分頁，跟桌面一致）。
    function navHighlightForState(state) {
        switch (state) {
            case VIEW_STATE.CHAT_DIARY_SPLIT:
            case VIEW_STATE.DIARY_DETAIL_SPLIT:
                return VIEW_TYPE.DIARY;
            case VIEW_STATE.CALENDAR_FULL:
                return VIEW_TYPE.CALENDAR;
            case VIEW_STATE.CHAT_FULL:
            case VIEW_STATE.CHAT_DETAIL_SPLIT:
            default:
                return VIEW_TYPE.CHAT;
        }
    }

    // 把 resolvePaneClasses 回傳的 class 字串套到單一元素上（空字串代表
    // 不需要加任何 class，元素維持 switchToState 開頭已清空的預設狀態）。
    function applyPaneClass(element, classString) {
        if (!element || !classString) {
            return;
        }
        classString.split(' ').forEach(function(cls) {
            if (cls) {
                element.classList.add(cls);
            }
        });
    }

    // 套用 detail 面板狀態（.diary-detail 的 active/display，以及連動
    // .diary-list 的 with-detail）。兩個方向的時序刻意跟 v2.3 之前完全一樣：
    //   展開：先 display:flex，下一輪事件迴圈才加 active class（讓
    //         transition 從「剛變成 flex 但還沒 active」的起始狀態動畫過去，
    //         而不是瞬間跳到最終狀態）。
    //   收合：先移除 active class 觸發 CSS transition，等 300ms（配合
    //         diary.css 的 `transition: all 0.3s ease`）淡出動畫播完才真的
    //         display:none，避免動畫播到一半就被切斷。
    function applyDetailPane(detailClass, diaryDetail, diaryList) {
        const shouldBeActive = detailClass === 'active';

        if (shouldBeActive) {
            if (diaryDetail && diaryList) {
                diaryDetail.style.display = 'flex';
                setTimeout(() => {
                    diaryDetail.classList.add('active');
                    diaryList.classList.add('with-detail');
                }, 10);
            }
            return;
        }

        if (diaryDetail) {
            diaryDetail.classList.remove('active');
            setTimeout(() => {
                diaryDetail.style.display = 'none';
            }, 300);
        }
        if (diaryList) {
            diaryList.classList.remove('with-detail');
        }
    }

    // 目前的版面模式：只讀 matchMedia 快取的結果，本身不呼叫 matchMedia
    // （那是 initLayoutModeWatcher 的事）。沒有 mobileMediaQuery（環境不支援
    // 或尚未初始化）一律當作寬螢幕——與現有桌面行為一致的安全預設值。
    function getLayoutMode() {
        if (!mobileMediaQuery) {
            return LAYOUT_MODE.WIDE;
        }
        return mobileMediaQuery.matches ? LAYOUT_MODE.MOBILE : LAYOUT_MODE.WIDE;
    }

    // 監看寬/窄螢幕斷點變化，跨越時重新套用目前狀態的版面（單一面板 ⇄
    // 分割面板）。window.matchMedia 不存在時整段跳過、不拋錯——這是
    // jsdom 預設環境與部分舊瀏覽器的真實狀況（見檔頭 mobileMediaQuery 宣告
    // 處的說明），不存在就等同「這個環境永遠是寬螢幕」，維持今天的行為。
    function initLayoutModeWatcher() {
        if (typeof window.matchMedia !== 'function') {
            return;
        }

        mobileMediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
        if (!mobileMediaQuery) {
            return;
        }

        function handleBreakpointChange() {
            switchToState(currentViewState);
        }

        // addEventListener 是現行標準；addListener 是舊版相容 API
        // （Safari < 14），兩者擇一即可，用 typeof 檢查避免呼叫不存在的方法。
        if (typeof mobileMediaQuery.addEventListener === 'function') {
            mobileMediaQuery.addEventListener('change', handleBreakpointChange);
        } else if (typeof mobileMediaQuery.addListener === 'function') {
            mobileMediaQuery.addListener(handleBreakpointChange);
        }
    }

    // 鍵盤感知輸入框（v2.3 task 2.1）：手機瀏覽器彈出虛擬鍵盤時，
    // window.innerHeight／CSS vh 不會變，但 visualViewport 會縮小（鍵盤蓋住
    // 的區域不算在 visualViewport 內）。監聽它的 resize/scroll，把「目前被
    // 鍵盤佔用的高度」轉成 .chat-input-area 的 padding-bottom，確保輸入框
    // 與送出鈕永遠留在鍵盤上方、看得到也點得到。
    //
    // window.visualViewport 不存在時整段跳過、不拋錯——這是 jsdom 預設
    // 環境、部分舊瀏覽器、以及本專案目前 Electron 版本的真實狀況。
    //
    // 這段邏輯無法在模擬的螢幕尺寸下驗證（emulator 不會真的彈出鍵盤、
    // visualViewport 也不會跟著縮小），只能靠實機測試——細節見
    // task-2.1-report.md。
    function initKeyboardAwareInput() {
        if (!window.visualViewport) {
            return;
        }

        const inputArea = document.querySelector('.chat-input-area');
        if (!inputArea) {
            return;
        }

        function adjustForKeyboard() {
            const vv = window.visualViewport;
            // layoutViewport 高度（window.innerHeight）減去 visualViewport
            // 的高度與其 offsetTop，約等於鍵盤（或其他底部系統 UI）目前
            // 佔用的像素高度；沒有鍵盤時這個差值趨近 0。Math.max 避免極少數
            // 瀏覽器捨入誤差算出負值，變成負的 padding。
            const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
            inputArea.style.paddingBottom = overlap > 0 ? `${overlap}px` : '';
        }

        window.visualViewport.addEventListener('resize', adjustForKeyboard);
        window.visualViewport.addEventListener('scroll', adjustForKeyboard);
    }

    // 切換到指定狀態
    function switchToState(newState) {
        console.log(`切換視圖狀態: ${currentViewState} -> ${newState}`);
        
        // 更新當前狀態
        currentViewState = newState;
        
        // 先移除所有視圖容器的狀態類別
        elements.viewContainers.forEach(container => {
            container.classList.remove('active', 'half', 'left', 'right');
        });
        
        // 獲取視圖容器
        const chatView = document.getElementById('chat-view');
        const diaryView = document.getElementById('diary-view');
        const calendarView = document.getElementById('calendar-view');

        // 獲取日記詳情元素
        const diaryDetail = document.querySelector('.diary-detail');
        const diaryList = document.querySelector('.diary-list');
        
        // 決定這個狀態在目前版面模式（寬/窄螢幕）下，各面板該套哪些
        // class —— 純函式決策（resolvePaneClasses，完整規則說明見該函式
        // 上方註解）+ 這裡負責真的套到 DOM 上，兩者職責分離。
        const layoutMode = getLayoutMode();
        const paneClasses = resolvePaneClasses(newState, layoutMode);

        applyPaneClass(chatView, paneClasses.chat);
        applyPaneClass(diaryView, paneClasses.diary);
        applyPaneClass(calendarView, paneClasses.calendar);
        applyDetailPane(paneClasses.detail, diaryDetail, diaryList);

        // 高亮對應的導覽項目（頭部導覽與底部分頁列共用同一套 .nav-item，
        // 詳見 updateNavHighlight）
        updateNavHighlight(navHighlightForState(newState));

        // 觸發視圖狀態變更事件
        document.dispatchEvent(new CustomEvent('viewStateChanged', { 
            detail: { newState: newState } 
        }));
    }
    
    // 更新導航項目高亮
    // 同時套用到頭部導覽與底部分頁列（v2.3 task 2.1）——兩者都用
    // .nav-item + data-view，對 elements.navItems 的單一迴圈天然涵蓋兩邊，
    // 不必寫兩份。aria-current 是新增的（cheap ARIA）：只在真正的 active
    // 項目上出現，供螢幕閱讀器/瀏覽器辨識目前所在分頁。
    function updateNavHighlight(activeView) {
        if (elements.navItems) {
            elements.navItems.forEach(item => {
                const itemView = item.getAttribute('data-view');
                if (itemView === activeView) {
                    item.classList.add('active');
                    item.setAttribute('aria-current', 'page');
                } else {
                    item.classList.remove('active');
                    item.removeAttribute('aria-current');
                }
            });
        }
    }
    
    // 處理日記詳情顯示
    function showDiaryDetail() {
        console.log(`處理顯示日記詳情，當前狀態: ${currentViewState}`);
        
        // 根據當前狀態決定切換到哪個狀態
        switch (currentViewState) {
            case VIEW_STATE.CHAT_FULL:
                // 全螢幕聊天 -> 日記列表+日記詳情
                switchToState(VIEW_STATE.DIARY_DETAIL_SPLIT);
                break;
                
            case VIEW_STATE.CHAT_DIARY_SPLIT:
                // 聊天+日記列表 -> 日記列表+日記詳情
                switchToState(VIEW_STATE.DIARY_DETAIL_SPLIT);
                break;
                
            case VIEW_STATE.CHAT_DETAIL_SPLIT:
                // 已經在聊天+日記詳情狀態，維持不變
                break;
                
            case VIEW_STATE.DIARY_DETAIL_SPLIT:
                // 已經在日記列表+日記詳情狀態，維持不變
                break;
                
            default:
                // 默認切換到日記列表+日記詳情
                switchToState(VIEW_STATE.DIARY_DETAIL_SPLIT);
                break;
        }
    }
    
    // 處理日記詳情關閉
    function hideDiaryDetail() {
        console.log(`處理隱藏日記詳情，當前狀態: ${currentViewState}`);
        
        // 根據當前狀態決定切換到哪個狀態
        switch (currentViewState) {
            case VIEW_STATE.DIARY_DETAIL_SPLIT:
                // 日記列表+日記詳情 -> 聊天+日記列表
                switchToState(VIEW_STATE.CHAT_DIARY_SPLIT);
                break;
                
            case VIEW_STATE.CHAT_DETAIL_SPLIT:
                // 聊天+日記詳情 -> 聊天+日記列表
                switchToState(VIEW_STATE.CHAT_DIARY_SPLIT);
                break;
                
            default:
                // 對其他狀態不做處理
                break;
        }
    }
    
    // 刷新DOM元素引用
    function refreshDOMElements() {
        elements.navItems = document.querySelectorAll('.nav-item');
        elements.viewContainers = document.querySelectorAll('.view-container');
        elements.chatContainer = document.querySelector('#chat-view');
        elements.diaryContainer = document.querySelector('#diary-view');
        elements.calendarContainer = document.querySelector('#calendar-view');
        elements.spinner = document.querySelector('.loading-spinner');
        elements.errorContainer = document.querySelector('#error-container');
        elements.themeToggleBtn = document.querySelector('#theme-toggle');
        elements.debugBtn = document.querySelector('#debug-btn');
    }
    
    // 向後兼容的視圖切換函數 - 支持舊代碼調用
    function switchView(viewName) {
        console.log(`兼容模式調用switchView: ${viewName}`);
        
        try {
            // 轉換視圖名稱為視圖類型
            const viewType = viewName.toLowerCase();
            
            // 基於當前狀態和目標視圖類型決定下一個狀態
            if (viewType === VIEW_TYPE.CALENDAR) {
                switchToState(VIEW_STATE.CALENDAR_FULL);
            } else if (viewType === VIEW_TYPE.CHAT) {
                // 切換到聊天視圖
                if (currentViewState === VIEW_STATE.DIARY_DETAIL_SPLIT) {
                    // 如果在日記詳情視圖，切換到聊天+日記詳情
                    switchToState(VIEW_STATE.CHAT_DETAIL_SPLIT);
                } else {
                    // 其他情況，直接切換到全螢幕聊天
                    switchToState(VIEW_STATE.CHAT_FULL);
                }
            } else if (viewType === VIEW_TYPE.DIARY) {
                // 切換到日記視圖
                if (currentViewState === VIEW_STATE.CHAT_FULL) {
                    // 從全螢幕聊天切換到聊天+日記分割
                    switchToState(VIEW_STATE.CHAT_DIARY_SPLIT);
                } else if (currentViewState === VIEW_STATE.CHAT_DETAIL_SPLIT) {
                    // 從聊天+日記詳情切換到日記列表+日記詳情
                    switchToState(VIEW_STATE.DIARY_DETAIL_SPLIT);
                }
            }
        } catch (error) {
            console.error('視圖切換錯誤:', error);
        }
    }
    
    // 初始化主題切換功能
    function initializeThemeToggle() {
        const themeToggleBtn = document.querySelector('#theme-toggle');
        if (themeToggleBtn) {
            console.log('找到主題切換按鈕，開始綁定事件');
            
            // 設置初始主題
            const currentTheme = getCurrentTheme();
            console.log('初始主題:', currentTheme);
            
            // 應用主題
            applyTheme(currentTheme);
            
            // 更新按鈕圖標
            updateThemeToggleIcon(currentTheme);
            
            // 移除所有現有的點擊事件
            const newButton = themeToggleBtn.cloneNode(true);
            themeToggleBtn.parentNode.replaceChild(newButton, themeToggleBtn);
            
            // 使用新引用
            const newThemeToggleBtn = document.querySelector('#theme-toggle');
            
            // 防止事件重複觸發的標記
            let isThemeSwitching = false;
            
            // 添加點擊事件處理
            newThemeToggleBtn.addEventListener('click', function(event) {
                // 防止事件冒泡
                event.preventDefault();
                event.stopPropagation();
                
                // 如果正在切換中，則忽略點擊
                if (isThemeSwitching) {
                    console.log('主題切換中，忽略點擊');
                    return;
                }
                
                // 設置標記，防止重複觸發
                isThemeSwitching = true;
                
                // 執行主題切換
                handleThemeToggle();
                
                // 500ms後重置標記
                setTimeout(() => {
                    isThemeSwitching = false;
                }, 500);
            });
            
            console.log('主題切換按鈕事件已重新綁定');
            newThemeToggleBtn.setAttribute('data-initialized', 'true');
        } else {
            console.warn('未找到主題切換按鈕，無法初始化主題切換功能');
        }
    }
    
    // 初始化Debug按鈕
    function initializeDebugButton() {
        const debugBtn = document.querySelector('#debug-btn');
        if (debugBtn) {
            console.log('找到Debug按鈕，開始綁定事件');
            
            // 移除舊事件（如果有）
            debugBtn.removeEventListener('click', handleDebugButtonClick);
            
            // 綁定點擊事件
            debugBtn.addEventListener('click', handleDebugButtonClick);
            console.log('Debug按鈕事件已綁定');
            
            // 測試事件是否綁定成功
            debugBtn.setAttribute('data-initialized', 'true');
        } else {
            console.warn('未找到Debug按鈕，無法初始化Debug功能');
        }
    }
    
    // 處理Debug按鈕點擊
    function handleDebugButtonClick() {
        console.log('Debug按鈕被點擊');
        
        try {
            if (window.require) {
                const electron = window.require('electron');
                console.log('electron對象獲取成功');
                
                // 首先嘗試使用ipcRenderer
                if (electron.ipcRenderer) {
                    console.log('使用ipcRenderer發送打開開發者工具請求');
                    electron.ipcRenderer.send('open-dev-tools');
                    return;
                }
                
                // 在新版Electron中，remote模塊被移除，使用@electron/remote模塊
                try {
                    const remote = window.require('@electron/remote');
                    if (remote) {
                        console.log('使用@electron/remote模塊打開開發者工具');
                        remote.getCurrentWindow().webContents.openDevTools();
                        return;
                    }
                } catch (remoteError) {
                    console.warn('加載@electron/remote模塊失敗:', remoteError);
                }
                
                console.warn('無法找到合適的方法打開開發者工具，嘗試快捷鍵');
                tryKeyboardShortcut();
            } else {
                console.warn('window.require未定義，可能在瀏覽器中運行');
                tryKeyboardShortcut();
            }
        } catch (error) {
            console.error('打開開發者工具時出錯:', error);
            alert(I18N.t('ui.devtoolsHint'));
            tryKeyboardShortcut();
        }
    }
    
    // 嘗試使用鍵盤快捷鍵打開開發者工具
    function tryKeyboardShortcut() {
        try {
            // 模擬按下F12鍵
            const event = new KeyboardEvent('keydown', {
                key: 'F12',
                code: 'F12',
                keyCode: 123,
                which: 123,
                bubbles: true,
                cancelable: true
            });
            document.dispatchEvent(event);
            console.log('已嘗試通過F12快捷鍵打開開發者工具');
        } catch (err) {
            console.error('模擬鍵盤事件失敗:', err);
        }
    }
    
    // 處理主題切換點擊
    function handleThemeToggle() {
        try {
            console.log('執行主題切換');
            
            // 從DOM和LocalStorage獲取當前主題，確保一致性
            const domTheme = document.documentElement.getAttribute('data-theme');
            const storageKey = CONFIG && CONFIG.STORAGE && CONFIG.STORAGE.THEME ? 
                CONFIG.STORAGE.THEME : 'urdiary_theme';
            const storedTheme = localStorage.getItem(storageKey);
            
            // 確保DOM和存儲設置一致
            let currentTheme;
            if (domTheme && (domTheme === 'light' || domTheme === 'dark')) {
                currentTheme = domTheme;
                if (storedTheme !== currentTheme) {
                    localStorage.setItem(storageKey, currentTheme);
                    console.log(`存儲設置已與DOM同步: ${currentTheme}`);
                }
            } else if (storedTheme && (storedTheme === 'light' || storedTheme === 'dark')) {
                currentTheme = storedTheme;
                document.documentElement.setAttribute('data-theme', currentTheme);
                console.log(`DOM已與存儲設置同步: ${currentTheme}`);
            } else {
                // 默認為亮色主題
                currentTheme = 'light';
                document.documentElement.setAttribute('data-theme', currentTheme);
                localStorage.setItem(storageKey, currentTheme);
                console.log(`已設置默認主題: ${currentTheme}`);
            }
            
            console.log('當前主題:', currentTheme);
            
            // 切換主題 - 明確比較字符串值
            let newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            console.log('切換到新主題:', newTheme);
            
            // 更新DOM
            document.documentElement.setAttribute('data-theme', newTheme);
            
            // 更新body類
            document.body.classList.remove('theme-light', 'theme-dark');
            document.body.classList.add(`theme-${newTheme}`);
            
            // 保存到本地存儲
            try {
                localStorage.setItem(storageKey, newTheme);
                console.log('主題已保存到本地存儲');
            } catch (error) {
                console.error('保存主題失敗:', error);
            }
            
            // 更新按鈕圖標
            updateThemeToggleIcon(newTheme);
            
            // 觸發主題變更事件
            document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: newTheme } }));

            // 重新應用CSS變量
            applyThemeCSSVariables(newTheme);
            
            console.log(`主題成功切換為: ${newTheme}`);
        } catch (error) {
            console.error('主題切換出錯:', error);
            if (window.UIManager && UIManager.showToast) {
                UIManager.showToast(I18N.t('errors.themeSwitch', { error: error.message }));
            }
        }
    }
    
    // 應用主題CSS變量
    function applyThemeCSSVariables(theme) {
        const root = document.documentElement;
        
        // 確保主題值有效
        if (theme !== 'light' && theme !== 'dark') {
            console.warn(`無效的主題值: ${theme}，使用默認值 'light'`);
            theme = 'light';
        }
        
        // 應用所有基於主題的CSS變量
        if (theme === 'dark') {
            // 夜間模式變量
            root.style.setProperty('--background-color', '#121212');
            root.style.setProperty('--card-background', '#1e1e1e');
            root.style.setProperty('--text-color', '#e0e0e0');
            root.style.setProperty('--text-secondary', '#a0a0a0');
            root.style.setProperty('--border-color', '#333333');
        } else {
            // 日間模式變量
            root.style.setProperty('--background-color', '#f5f5f5');
            root.style.setProperty('--card-background', '#ffffff');
            root.style.setProperty('--text-color', '#333333');
            root.style.setProperty('--text-secondary', '#666666');
            root.style.setProperty('--border-color', '#e0e0e0');
        }
        
        console.log(`已應用${theme}模式的CSS變量`);
    }
    
    // 獲取當前主題
    function getCurrentTheme() {
        // 從DOM獲取當前激活的主題
        const dataTheme = document.documentElement.getAttribute('data-theme');
        if (dataTheme && (dataTheme === 'light' || dataTheme === 'dark')) {
            console.log('從DOM獲取主題:', dataTheme);
            return dataTheme;
        }
        
        // 從本地存儲獲取
        const savedTheme = localStorage.getItem(CONFIG.STORAGE.THEME);
        if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
            console.log('從本地存儲獲取主題:', savedTheme);
            return savedTheme;
        }
        
        // 檢查系統偏好
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            console.log('使用系統深色偏好');
            return 'dark';
        }
        
        // 默認為亮色主題
        console.log('使用默認亮色主題');
        return 'light';
    }
    
    // 應用主題
    function applyTheme(theme) {
        try {
            if (!theme || (theme !== 'light' && theme !== 'dark')) {
                console.error('無效的主題值:', theme);
                theme = 'light';
            }
            
            console.log('正在應用主題:', theme);
            
            // 設置根元素屬性
            document.documentElement.setAttribute('data-theme', theme);
            
            // 更新body類
            document.body.classList.remove('theme-light', 'theme-dark');
            document.body.classList.add(`theme-${theme}`);
            
            // 應用CSS變量
            applyThemeCSSVariables(theme);
            
            console.log(`主題已設置為: ${theme}`);
        } catch (error) {
            console.error('應用主題時出錯:', error);
        }
    }
    
    // 更新主題切換按鈕圖標
    function updateThemeToggleIcon(theme) {
        try {
            const themeToggleBtn = document.querySelector('#theme-toggle');
            if (!themeToggleBtn) {
                console.warn('找不到主題切換按鈕');
                return;
            }
            
            // 清空按鈕內容
            themeToggleBtn.innerHTML = '';
            
            // 設置新圖標和提示文字
            if (theme === 'dark') {
                // 在深色模式時顯示太陽圖標，表示可以切換到亮色模式
                themeToggleBtn.innerHTML = '<i class="fa fa-sun"></i>';
                themeToggleBtn.title = '切換到亮色模式';
                console.log('已設置深色模式圖標 (太陽)');
            } else {
                // 在亮色模式時顯示月亮圖標，表示可以切換到深色模式
                themeToggleBtn.innerHTML = '<i class="fa fa-moon"></i>';
                themeToggleBtn.title = '切換到深色模式';
                console.log('已設置亮色模式圖標 (月亮)');
            }
        } catch (error) {
            console.error('更新主題圖標時出錯:', error);
        }
    }
    
    // 顯示帶有訊息的加載動畫
    function showLoadingSpinner(message) {
        message = message || I18N.t('ui.loading');
        if (elements.spinner) {
            // 檢查是否有加載訊息元素
            let messageElement = elements.spinner.querySelector('.loading-message');

            // 如果沒有訊息元素，則創建一個
            if (!messageElement) {
                messageElement = document.createElement('div');
                messageElement.className = 'loading-message';
                elements.spinner.appendChild(messageElement);
            }

            // 設置訊息內容
            messageElement.textContent = message;

            // 顯示加載動畫
            elements.spinner.style.display = 'flex';
        }
    }

    // 隱藏加載動畫
    function hideLoadingSpinner() {
        if (elements.spinner) {
            elements.spinner.style.display = 'none';
        }
    }

    // showSpinner/hideSpinner 為 showLoadingSpinner/hideLoadingSpinner 的別名
    // （原本是四個各自獨立實作、行為其實相同的函式，合併後呼叫端零改動）
    const showSpinner = showLoadingSpinner;
    const hideSpinner = hideLoadingSpinner;

    // 顯示提示消息
    function showToast(message, duration = 3000) {
        // 移除現有的提示
        const existingToast = document.querySelector('.toast-message');
        if (existingToast) {
            existingToast.remove();
        }
        
        // 創建新的提示元素
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        
        // 添加到文檔
        document.body.appendChild(toast);
        
        // 顯示提示
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // 設置自動隱藏
        setTimeout(() => {
            toast.classList.remove('show');

            // 動畫結束後移除元素
            toast.addEventListener('transitionend', function() {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            });
        }, duration);
    }

    // 淡出並移除一個 toast 元素（showToast 的自動隱藏、showActionToast 的
    // 兩個按鈕共用同一段收尾邏輯，避免各自重複實作 transitionend 清理）
    function dismissToastElement(toast) {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        });
    }

    // 顯示一則「非阻斷、但需要使用者主動選擇」的提示（PWA 有新版本可用時
    // 使用）。跟 showToast 共用 .toast-message 視覺樣式與淡入/淡出機制，
    // 差別是：不會自動消失、多一個動作按鈕，使用者不點按鈕它就一直留著
    // （不阻斷操作，使用者仍可正常使用其餘畫面，符合「non-blocking」的
    // 要求），直到點動作按鈕或關閉按鈕其中之一。
    function showActionToast(message, actionLabel, onAction) {
        const existingToast = document.querySelector('.toast-message');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = 'toast-message toast-message--action';

        const text = document.createElement('span');
        text.className = 'toast-message-text';
        text.textContent = message;
        toast.appendChild(text);

        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'toast-action-btn';
        actionBtn.textContent = actionLabel;
        actionBtn.addEventListener('click', function() {
            dismissToastElement(toast);
            if (typeof onAction === 'function') {
                onAction();
            }
        });
        toast.appendChild(actionBtn);

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'toast-dismiss-btn';
        dismissBtn.setAttribute('aria-label', I18N.t('pwa.dismiss'));
        dismissBtn.textContent = '×';
        dismissBtn.addEventListener('click', function() {
            dismissToastElement(toast);
        });
        toast.appendChild(dismissBtn);

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        // 刻意沒有自動隱藏的 setTimeout——留到使用者按下其中一個按鈕。
    }

    // 顯示錯誤訊息
    function showError(title, message, detail = null) {
        if (elements.errorContainer) {
            const errorTitle = elements.errorContainer.querySelector('.error-header h3');
            const errorContent = document.getElementById('error-content');
            
            if (errorTitle && errorContent) {
                errorTitle.textContent = title || I18N.t('errors.genericTitle');
                
                // 錯誤訊息可能挾帶 API/伺服器回傳內容，寫入 innerHTML 前必須轉義
                let contentHtml = `<p>${escapeHtml(message || I18N.t('errors.unknownGeneric'))}</p>`;
                if (detail) {
                    contentHtml += `<div class="error-detail"><pre>${escapeHtml(detail)}</pre></div>`;
                }
                
                errorContent.innerHTML = contentHtml;
                elements.errorContainer.style.display = 'block';
            }
        } else {
            console.error('錯誤容器不存在，無法顯示錯誤:', message);
            alert(`${I18N.t('errors.genericTitle')}: ${message}`);
        }
    }

    // 隱藏錯誤訊息
    function hideError() {
        if (elements.errorContainer) {
            elements.errorContainer.style.display = 'none';
        }
    }

    // 提供公共方法
    return {
        init,
        VIEW_STATE,
        VIEW_TYPE,
        getCurrentState: () => currentViewState,
        switchToState,
        switchView,
        handleNavigation,
        showDiaryDetail,
        hideDiaryDetail,
        getCurrentTheme,
        applyTheme,
        toggleTheme: handleThemeToggle,
        showSpinner,
        hideSpinner,
        showLoadingSpinner,
        hideLoadingSpinner,
        showToast,
        showActionToast,
        showError,
        hideError,
        // v2.3 task 2.1：響應式版面
        LAYOUT_MODE,
        getLayoutMode,
        // 純函式，主要為 vitest 單元測試曝光；switchToState 內部也是唯一
        // 呼叫端，行為說明見函式本身上方註解
        resolvePaneClasses
    };
})();

// 明確掛上 window（v2.3 task 2.1 修復）：此檔案先前完全沒有這一行——
// <script> 標籤共享同一份全域作用域，本檔案自己與其他後載入的 <script>
// （main.js 等）都能繼續用裸露的 UIManager 識別字直接呼叫，這行不加也不影響
// 那條路徑。但本檔案 handleThemeToggle 的 catch 區塊明確檢查
// `window.UIManager && UIManager.showToast`（而不是裸露識別字，用
// grep -n "window.UIManager && UIManager.showToast" 這支檔案本身可以找到，
// 行號會隨這次改動而變、故意不寫死）——沒有這行賦值，window.UIManager
// 永遠是 undefined，那個分支永遠不會成立，主題切換失敗時原本設計要跳出的
// 提示 toast 形同死碼。同時本專案其餘核心/服務型
// 模塊（config.js/i18n.js/api_service.js/secure_store.js/settings_module.js）
// 全部都有這一行——補上後 UIManager 與這些模塊的慣例一致。
window.UIManager = UIManager;