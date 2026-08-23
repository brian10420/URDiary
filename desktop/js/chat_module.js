/**
 * 聊天模塊 - 處理聊天相關功能
 */
const ChatModule = (function() {
    // 私有變量
    let chatHistory = [];
    let userAvatar = null;
    let botAvatar = 'assets/icon.jpg';
    let isProcessing = false;
    // 語音輸入（v2.4 spec②）：麥克風鍵是否正在錄音中
    let recording = false;

    // v2.5 Spec A：「AI 行事曆印章」開關（預設開；'0' 才是關）
    const DAY_NOTE_KEY = 'urdiary_day_note_enabled';

    // DOM元素
    let chatContainer, chatMessagesContainer, userInputElement, 
        sendButtonElement, endChatBtnElement, clearChatBtnElement, modelSelectorElement;
    
    // 初始化
    function init() {
        console.log('初始化聊天模塊');
        
        // 獲取DOM元素
        chatContainer = document.querySelector('.chat-container');
        chatMessagesContainer = document.querySelector('.chat-messages');
        userInputElement = document.querySelector('#user-input');
        sendButtonElement = document.querySelector('#send-button');
        endChatBtnElement = document.querySelector('#end-chat-btn');
        clearChatBtnElement = document.querySelector('#clear-chat-btn');
        
        // 檢查必要的DOM元素
        if (!chatContainer) {
            console.error('聊天容器元素不存在');
            return;
        }
        
        if (!chatMessagesContainer) {
            console.log('創建聊天消息容器');
            chatMessagesContainer = document.createElement('div');
            chatMessagesContainer.className = 'chat-messages';
            chatContainer.appendChild(chatMessagesContainer);
        }
        
        // 加載用戶頭像
        loadUserAvatar();
        
        // 確保機器人頭像存在
        ensureBotAvatar();
        
        // 初始化模型選擇器
        initModelSelector();
        
        // 綁定發送按鈕點擊事件
        if (sendButtonElement) {
            sendButtonElement.addEventListener('click', sendMessage);
        } else {
            console.warn('發送按鈕元素不存在');
        }
        
        // 綁定輸入框Enter鍵事件
        if (userInputElement) {
            userInputElement.addEventListener('keypress', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        } else {
            console.warn('用戶輸入元素不存在');
        }

        // 語音輸入鍵（v2.4 spec②）：index.html 預設 display:none，只有瀏覽器
        // 支援錄音（VoiceModule.isSupported()）才顯示並綁定。typeof 防禦寫法
        // 與本檔案其餘可選依賴一致——部分單元測試不載入 voice_module.js，
        // 也不在測試用 DOM 片段放 #mic-button，兩者都要能安靜跳過。
        const micBtn = document.getElementById('mic-button');
        if (micBtn && typeof VoiceModule !== 'undefined' && VoiceModule.isSupported()) {
            micBtn.style.display = '';
            micBtn.addEventListener('click', toggleMic);
        }

        // 綁定結束聊天按鈕事件
        if (endChatBtnElement) {
            endChatBtnElement.addEventListener('click', endChat);
        } else {
            console.warn('結束聊天按鈕元素不存在');
        }
        
        // 綁定清空聊天按鈕事件
        if (clearChatBtnElement) {
            clearChatBtnElement.addEventListener('click', clearChat);
        } else {
            console.warn('清空聊天按鈕元素不存在');
        }
        
        // 清空聊天界面
        if (chatMessagesContainer) {
            chatMessagesContainer.innerHTML = '';
        }
        
        // 載入聊天歷史
        loadChatHistory();

        // 標題顯示陪伴者名字（若已設定；沒設定則維持預設標題）
        applyCompanionTitle();

        console.log('聊天模塊初始化完成');
    }

    // 聊天標題顯示陪伴者名字（Task 8）：SettingsModule 開啟設定面板/儲存
    // 成功後才會有快取值，因此這裡的取值來源永遠是它的模組內快取，不直接
    // 打 API——避免每次進聊天頁都多一次網路請求。找不到 .chat-title 節點
    // 時安靜跳過（防禦性寫法，比照本檔案其餘 DOM 操作）。
    function applyCompanionTitle() {
        const el = document.querySelector('.chat-title');
        if (!el) return;
        const name = (typeof SettingsModule !== 'undefined' && SettingsModule.getCompanionName)
            ? SettingsModule.getCompanionName() : null;
        el.textContent = name || I18N.t('chat.title');
    }
    document.addEventListener('companion-settings-changed', applyCompanionTitle);
    
    // 是否已註冊設定變更監聽（init 會被重複呼叫，避免重複綁定）
    let llmChangeListenerBound = false;

    // 初始化 AI 供應商選擇器（金鑰與模型細節在 ⚙ 設定面板調整）
    function initModelSelector() {
        // 查找聊天行為區域，如果是input-wrapper，查找其父級
        const inputArea = document.querySelector('.chat-input-area') ||
                          document.querySelector('.chat-input-wrapper')?.parentElement;

        if (!inputArea) {
            console.warn('無法找到聊天輸入區域，無法添加供應商選擇器');
            return;
        }

        const providers = (typeof CONFIG !== 'undefined' && CONFIG.PROVIDERS) ? CONFIG.PROVIDERS : {};
        const active = (typeof SettingsModule !== 'undefined' && SettingsModule.getActiveLLM) ?
            SettingsModule.getActiveLLM() : { provider: 'grok', model: '', label: 'Grok (xAI)' };

        // 創建選擇器元素（供應商下拉 + 目前模型顯示）
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'model-selector-container';
        selectorDiv.style.cssText = 'margin: 0 15px 10px; text-align: right; font-size: 12px; color: #666;';
        selectorDiv.innerHTML = `
            <label for="model-selector" style="margin-right: 5px;">AI: </label>
            <select id="model-selector" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd;">
                ${Object.keys(providers).map(id =>
                    `<option value="${id}" ${id === active.provider ? 'selected' : ''}>${id === 'local' ? I18N.t('provider.local') : providers[id].LABEL}</option>`
                ).join('')}
            </select>
            <span id="model-selector-model" style="margin-left: 6px;">${active.model || ''}</span>
        `;

        // 如果有原有選擇器，則替換，否則插入到輸入區域前
        const existingSelector = document.querySelector('.model-selector-container');
        if (existingSelector) {
            existingSelector.replaceWith(selectorDiv);
        } else {
            inputArea.insertBefore(selectorDiv, inputArea.firstChild);
        }

        // 獲取選擇器元素
        modelSelectorElement = document.getElementById('model-selector');

        // 切換供應商 → 交給設定模塊持久化（實際標頭由 fetchAPI 統一附上）
        if (modelSelectorElement) {
            modelSelectorElement.addEventListener('change', function(e) {
                if (typeof SettingsModule !== 'undefined' && SettingsModule.setActiveProvider) {
                    SettingsModule.setActiveProvider(e.target.value);
                }
            });
        }

        // 設定變更（含 ⚙ 面板儲存）→ 同步選單與模型顯示
        if (!llmChangeListenerBound) {
            llmChangeListenerBound = true;
            window.addEventListener('urdiary:llm-settings-changed', function(e) {
                const llm = e.detail || (typeof SettingsModule !== 'undefined' ? SettingsModule.getActiveLLM() : null);
                if (!llm) return;

                const selector = document.getElementById('model-selector');
                if (selector) selector.value = llm.provider;

                const modelSpan = document.getElementById('model-selector-model');
                if (modelSpan) modelSpan.textContent = llm.model || '';

                addSystemMessage(I18N.t('chat.providerSwitched', { label: llm.label, model: llm.model || I18N.t('chat.defaultModel') }));
            });
        }
    }
    
    // 載入用戶頭像
    function loadUserAvatar() {
        try {
            // 檢查CONFIG是否存在
            if (typeof CONFIG === 'undefined') {
                console.warn('CONFIG未定義，使用默認設置');
                userAvatar = 'assets/default-avatar.jpg';
                return;
            }
            
            // 先從localStorage獲取
            const avatarKey = CONFIG.STORAGE.USER_AVATAR || 'urdiary_user_avatar';
            const avatarFromStorage = localStorage.getItem(avatarKey);
            
            if (avatarFromStorage) {
                userAvatar = avatarFromStorage;
                console.log('從存儲中讀取用戶頭像');
            } else {
                // 默認頭像路徑
                userAvatar = CONFIG.USER?.DEFAULT_AVATAR || 'assets/default-avatar.jpg';
                console.log('使用默認用戶頭像');
                
                // 保存到localStorage
                try {
                    localStorage.setItem(avatarKey, userAvatar);
                } catch (storageError) {
                    console.warn('無法保存頭像到本地存儲', storageError);
                }
            }
        } catch (error) {
            console.error('載入用戶頭像時出錯:', error);
            userAvatar = 'assets/default-avatar.jpg';
        }
        
        // 創建一個Image對象測試圖像是否能加載
        const img = new Image();
        img.onload = function() {
            console.log('用戶頭像加載成功');
        };
        img.onerror = function() {
            console.warn('用戶頭像加載失敗，使用默認頭像');
            userAvatar = 'assets/default-avatar.jpg';
            localStorage.setItem(CONFIG.STORAGE.USER_AVATAR, userAvatar);
        };
        img.src = userAvatar;
    }
    
    // 確保機器人頭像存在
    function ensureBotAvatar() {
        // 創建一個Image對象測試圖像是否能加載
        const img = new Image();
        img.onload = function() {
            console.log('機器人頭像加載成功');
        };
        img.onerror = function() {
            console.warn('機器人頭像加載失敗，使用文字替代');
            createDefaultBotAvatar();
        };
        img.src = botAvatar;
    }
    
    // 創建默認機器人頭像
    function createDefaultBotAvatar() {
        // 這裡實際上無法直接檢查和創建文件（瀏覽器限制），
        // 但我們可以更換為預設的圖標字符
        botAvatar = null; // 使用null表示使用文字替代
        
        console.log('使用文字作為機器人頭像');
        
        // 更新已存在的機器人頭像元素
        const botAvatarElements = document.querySelectorAll('.system-message .message-avatar img');
        botAvatarElements.forEach(element => {
            element.style.display = 'none';
            const textElement = document.createElement('span');
            textElement.textContent = 'AI';
            textElement.className = 'avatar-text';
            element.parentNode.appendChild(textElement);
        });
    }
    
    // 靜態歡迎詞（後端無法提供每日問候時的後備）——取值延遲到使用當下，
    // 確保語言切換重載後拿到正確語言
    function WELCOME_MESSAGE_TEXT() {
        return I18N.t('chat.welcome');
    }

    // 載入聊天歷史
    function loadChatHistory() {
        try {
            // 獲取當前用戶ID
            const userId = localStorage.getItem('numericUserId');
            if (!userId) {
                console.warn('無法獲取用戶ID，無法載入聊天歷史');
                return;
            }

            // 使用與用戶ID關聯的存儲鍵
            const storageKey = `${CONFIG.STORAGE.CHAT_HISTORY}_${userId}`;
            const savedHistory = localStorage.getItem(storageKey);
            let renderedToday = false;

            if (savedHistory) {
                const parsedHistory = JSON.parse(savedHistory);

                // 只還原「今日」的聊天記錄（凌晨 5 點換日，與後端一致）
                if (parsedHistory.length > 0 && checkIfChatIsFromToday(parsedHistory)) {
                    console.log('載入今日聊天記錄');
                    chatHistory = parsedHistory;

                    // 渲染聊天歷史
                    chatMessagesContainer.innerHTML = '';

                    chatHistory.forEach(msg => {
                        if (msg.type === 'user') {
                            addUserMessage(msg.content, false);
                        } else {
                            addSystemMessage(msg.content, false);
                        }
                    });

                    scrollToBottom();
                    renderedToday = true;
                }
            }

            if (!renderedToday) {
                chatHistory = [];
                chatMessagesContainer.innerHTML = '';
            }

            // 每日 check-in：今日首次開啟時由 AI 主動問候（依昨日日記與時段）。
            // 後端為準：已問候過/未設金鑰時回 checkin:false，畫面空著才補靜態歡迎詞。
            requestDailyCheckin(renderedToday);
        } catch (error) {
            console.error('載入聊天歷史失敗:', error);
            chatHistory = [];
            // 顯示歡迎消息
            addSystemMessage(WELCOME_MESSAGE_TEXT());
        }
    }

    // 每日問候只發一次（init 可能被重複呼叫，兩個非同步請求賽跑會加出兩句歡迎詞）
    let checkinInFlight = false;

    // 向後端請求每日開場問候
    async function requestDailyCheckin(hasRenderedHistory) {
        if (checkinInFlight) return;
        checkinInFlight = true;
        let thinkingMessageId = null;

        // 靜態歡迎詞保底：僅在對話仍是空的時候補上，避免重複。
        // v2.5 Spec B：靜態訊息順帶適用假思考延遲（同一 util，測試可設 0）。
        function fallbackWelcome() {
            if (!hasRenderedHistory && chatHistory.length === 0) {
                withThinkingDelay(function () {
                    if (chatHistory.length === 0) {
                        addSystemMessage(WELCOME_MESSAGE_TEXT());
                    }
                });
            }
        }

        try {
            if (typeof ApiService === 'undefined' || !ApiService.checkIn ||
                !ApiService.isAuthenticated || !ApiService.isAuthenticated()) {
                fallbackWelcome();
                return;
            }

            thinkingMessageId = addThinkingMessage();
            const result = await ApiService.checkIn();

            const thinkingMessage = document.getElementById(thinkingMessageId);
            if (thinkingMessage) thinkingMessage.remove();
            thinkingMessageId = null;

            if (result && result.checkin && result.message) {
                // AI 的主動問候：進入畫面與本地歷史（後端也已存入正式對話歷史）。
                // checkinHtml() 前綴（端茶吉祥物）只是渲染層的信任 HTML——見
                // appendChatMessage 的 htmlPrefix 說明，result.message 本身仍
                // 原文存入 chatHistory／餵給朗讀鍵，不會混進 SVG；isReply 維持
                // 預設 false，不觸發自動朗讀（R6 裁決不變）。typeof 防禦同
                // addThinkingMessage。
                const checkinPrefix = (typeof MascotModule !== 'undefined') ? MascotModule.checkinHtml() : '';
                addSystemMessage(result.message, true, false, checkinPrefix);
                saveChatHistory();
            } else {
                fallbackWelcome();
            }
        } catch (error) {
            // 問候失敗不打擾使用者（不彈錯誤），保底顯示靜態歡迎詞
            const thinkingMessage = thinkingMessageId ? document.getElementById(thinkingMessageId) : null;
            if (thinkingMessage) thinkingMessage.remove();
            console.warn('每日問候略過:', error);
            fallbackWelcome();
        } finally {
            checkinInFlight = false;
        }
    }

    // 「日記日」字串：凌晨 5 點前算前一天（與後端 time_utils 的換日規則一致）
    function diaryDayString(date) {
        const shifted = new Date(date.getTime() - 5 * 60 * 60 * 1000);
        return `${shifted.getFullYear()}-${shifted.getMonth() + 1}-${shifted.getDate()}`;
    }

    // 檢查聊天記錄是否為今日（依 5 點換日）
    function checkIfChatIsFromToday(history) {
        if (!history || history.length === 0) {
            return false;
        }

        // 獲取最後一條消息的時間戳
        const lastMessage = history[history.length - 1];
        if (!lastMessage || !lastMessage.timestamp) {
            return false;
        }

        return diaryDayString(new Date(lastMessage.timestamp)) === diaryDayString(new Date());
    }
    
    // 發送消息
    //
    // v2.3 task 2.3：輸入框一送出就清空（跟原本行為一致，訊息立刻以氣泡
    // 形式出現在對話串裡，符合一般聊天 App 的即時回饋）。「不遺失使用者的
    // 文字」不是靠留著輸入框裡的草稿，而是靠：(1) 訊息一旦離開輸入框就
    // 立刻寫進 chatHistory 並存檔（下面的 saveChatHistory()，早於送出結果
    // 揭曉），(2) 萬一送出失敗，原始文字存在該則氣泡的 dataset 上，附一顆
    // 「點擊重試」，不必使用者重新輸入（見 attemptSend/markSendFailed）。
    async function sendMessage() {
        // 獲取用戶輸入
        const userInput = userInputElement.value.trim();

        // 如果輸入為空或者正在處理中，則返回
        if (!userInput || isProcessing) {
            return;
        }

        // 清空輸入框
        userInputElement.value = '';

        // 添加用戶消息到聊天窗口，拿到氣泡節點供稍後標記傳送中/失敗狀態
        const bubble = addUserMessage(userInput);

        // 立即持久化：即使接下來的網路請求失敗，這則訊息也已經在
        // localStorage 裡，不會因為使用者在結果揭曉前就關閉分頁/重整而遺失。
        saveChatHistory();

        await attemptSend(userInput, bubble);
    }

    // 語音輸入接線（v2.4 spec②）：VoiceModule 負責錄音/轉寫/偏好，這裡只
    // 負責把轉寫結果接進既有的輸入框/送出流程，不重複實作 VoiceModule 已有
    // 的邏輯（見 binding constraint「聊天接線只讀不重複實作」）。

    function userInputEl() { return document.getElementById('user-input'); }

    // opts.mode/opts.send 供測試直接注入（見 tests/chat_voice.test.js）；
    // 正常執行路徑落回 VoiceModule 目前的偏好與預設送出行為。
    function handleTranscript(text, opts) {
        const mode = (opts && opts.mode) || VoiceModule.getInputMode();
        const send = (opts && opts.send) || ((t) => { userInputEl().value = t; sendMessage(); });
        if (!text) return;
        if (mode === 'fluent') { send(text); return; }
        // confirm 模式：轉寫結果進輸入框，使用者自己按送出（不自動送出）
        const input = userInputEl();
        input.value = text;
        input.focus();
    }

    // 麥克風鍵點擊：開始/停止錄音。錄音中再次點擊才會觸發停止＋轉寫，
    // 期間鍵上加 .recording 供 CSS 顯示脈動效果（見 css/chat.css）。
    async function toggleMic() {
        const btn = document.getElementById('mic-button');
        if (!recording) {
            // 連點防護（比照下面 stop 分支既有的做法）：recording 要等
            // startRecording() 的 await 回來才會變 true，在那之前（例如
            // 麥克風權限彈窗還沒回應的當下）快速連點兩下一樣會走進這個
            // if 分支。同步鎖住按鈕，讓這一層在最源頭就擋掉第二次進入，
            // 不單依賴 VoiceModule 內部的同步鎖（見 voice_module.js
            // startRecording() 的 starting 旗標——兩層防護對應同一個
            // cross-task 的孤兒 MediaStream 問題，各自獨立生效）。
            btn.disabled = true;
            try {
                await VoiceModule.startRecording();
                recording = true;
                btn.classList.add('recording');
            } catch (e) {
                addSystemMessage(I18N.t('voice.micDenied'));
            } finally {
                btn.disabled = false;
            }
        } else {
            recording = false;
            btn.classList.remove('recording');
            // 轉寫請求在路上時鎖住按鈕，避免使用者連點觸發第二次
            // stopRecording()（此時 mediaRecorder 已是 null，會直接 reject）。
            btn.disabled = true;
            try {
                const { text } = await VoiceModule.stopRecording();
                handleTranscript(text, {});
            } catch (e) {
                addSystemMessage((e && e.message) || I18N.t('voice.sttFailed'));
            } finally {
                btn.disabled = false;
            }
        }
    }

    // 慢速模型提示（2026-08 驗收回饋）：grok-4.6 回覆常等超過 30 秒。等待
    // 超過門檻時，若目前模型有已知的較快替代，用系統訊息推薦到設定切換。
    // 一個工作階段最多提示一次（reset() 換帳號時歸零），模型沒有對應建議
    // 就完全不提示，不對其他供應商嘮叨。
    const SLOW_REPLY_HINT_MS = 30000;
    const SLOW_MODEL_SUGGESTIONS = { 'grok-4.6': 'grok-4.3' };
    let slowModelHintShown = false;

    function maybeShowSlowModelHint(elapsedMs) {
        if (slowModelHintShown || elapsedMs < SLOW_REPLY_HINT_MS) {
            return null;
        }
        const active = (typeof SettingsModule !== 'undefined' &&
            typeof SettingsModule.getActiveLLM === 'function') ?
            SettingsModule.getActiveLLM() : null;
        const suggestion = active && active.model ? SLOW_MODEL_SUGGESTIONS[active.model] : null;
        if (!suggestion) {
            return null;
        }
        slowModelHintShown = true;
        const text = I18N.t('chat.slowModelHint', {
            seconds: Math.round(elapsedMs / 1000),
            model: active.model,
            suggestion: suggestion
        });
        // 單元測試不跑 init()，容器不存在時只回傳文字不上畫面
        if (chatMessagesContainer) {
            addSystemMessage(text);
        }
        return text;
    }

    // 實際嘗試發送一則訊息（新訊息與「點擊重試」共用同一份邏輯）。
    // userInput 一律是呼叫端明確傳入的原始文字，不是重新讀取輸入框目前的
    // 內容——重試時使用者可能已經在輸入框打了別的話，不該被這次重試誤送。
    async function attemptSend(userInput, bubbleElement) {
        isProcessing = true;
        userInputElement.disabled = true;

        // 量測等待時間：成功與失敗（逾時 abort 也會走 catch）都要餵給
        // maybeShowSlowModelHint 判斷是否推薦較快的模型
        const sendStartedAt = Date.now();

        clearSendFailure(bubbleElement);
        markPending(bubbleElement);

        // 必須宣告在 try 之外：catch 區塊也要用它移除「思考中」動畫。
        // 若宣告在 try 內，const 的區塊作用域會讓 catch 取用時拋出 ReferenceError，
        // 導致錯誤訊息永遠顯示不出來、思考動畫卡住不消失。
        let thinkingMessageId = null;

        try {
            // 添加思考中消息
            thinkingMessageId = addThinkingMessage();

            // 檢查ApiService是否存在
            if (typeof ApiService === 'undefined') {
                console.error('ApiService未定義，無法發送消息');
                throw new Error('API服務未初始化，請重新加載應用');
            }

            // 檢查sendChatMessage方法是否存在
            if (typeof ApiService.sendChatMessage !== 'function') {
                console.error('ApiService.sendChatMessage方法未定義');
                throw new Error('API服務不完整，缺少sendChatMessage方法');
            }

            // 供應商與模型由 fetchAPI 依設定面板統一附上 (X-LLM-* 標頭)。
            // 注意：sendChatMessage 內部絕不自動重試（POST 是非冪等請求，
            // 見 api_service.js 的說明）——這裡失敗就是真的失敗一次，重試
            // 完全交給下面 catch 區塊掛上的「點擊重試」，由使用者主動觸發。
            const response = await ApiService.sendChatMessage(userInput);

            // 移除思考中消息
            const thinkingMessage = document.getElementById(thinkingMessageId);
            if (thinkingMessage) {
                thinkingMessage.remove();
            }
            thinkingMessageId = null;

            // 添加系統回應 - 修復數據結構不匹配問題
            console.log('API響應數據結構:', response);

            // 檢查響應格式並提取消息內容
            let messageContent;
            if (typeof response === 'string') {
                // 如果響應直接是字符串
                messageContent = response;
            } else if (response && response.message) {
                // 如果響應有message屬性
                messageContent = response.message;
            } else if (response && response.response) {
                // 如果響應有response屬性
                messageContent = response.response;
            } else {
                // 默認錯誤消息
                messageContent = I18N.t('chat.cantUnderstand');
            }

            // 成功了：清掉傳送中標記，以及（如果這是一次重試）殘留的失敗
            // 文字備份——code review 修復：先前只清視覺上的 .pending，
            // dataset.pendingText 會一直留在成功的氣泡上，雖然沒有任何地方
            // 會再讀到它（重試按鈕已經被 clearSendFailure 移除），但終究是
            // 用不到的殘留資料，成功了就一併清掉。
            clearPending(bubbleElement);
            if (bubbleElement && bubbleElement.dataset) {
                delete bubbleElement.dataset.pendingText;
            }
            // isReply=true（R6 裁決）：這是唯一真正的「AI 聊天新回覆」，自動
            // 朗讀只由這一個呼叫點觸發（見 addSystemMessage/appendChatMessage
            // 上方註解）。
            addSystemMessage(messageContent, true, true);

            maybeShowSlowModelHint(Date.now() - sendStartedAt);

            // 保存聊天歷史
            saveChatHistory();
        } catch (error) {
            console.error('處理用戶輸入失敗:', error);

            // 移除思考中消息
            const thinkingMessage = thinkingMessageId ? document.getElementById(thinkingMessageId) : null;
            if (thinkingMessage) {
                thinkingMessage.remove();
            }

            // 在使用者的訊息氣泡上標記「傳送失敗」＋「點擊重試」，不再另外
            // 添加一則系統錯誤訊息（訊息本身如實留在對話串裡，不會消失，
            // 也不需要使用者重新輸入——見 markSendFailed）。
            markSendFailed(bubbleElement, userInput);

            // 等了很久才失敗（例如 180 秒逾時）同樣值得推薦較快的模型
            maybeShowSlowModelHint(Date.now() - sendStartedAt);

            // ApiService 本身未就緒是更嚴重的整合問題，重試也無濟於事——
            // 額外提示使用者刷新頁面（既有的安全網訊息，行為不變）。
            if (error.message && error.message.includes('API服務未初始化')) {
                addSystemMessage(I18N.t('chat.tryRefresh'));
            }
        } finally {
            // 恢復輸入狀態
            isProcessing = false;
            userInputElement.disabled = false;
            userInputElement.focus();
        }
    }

    // 標記一則使用者訊息氣泡「傳送中」（v2.3 task 2.3）：淡化樣式，跟一般
    // 已送達/尚未有結果的訊息區分開來。沒有節點可標記時安靜跳過。
    function markPending(bubbleElement) {
        if (bubbleElement) {
            bubbleElement.classList.add('pending');
        }
    }

    function clearPending(bubbleElement) {
        if (bubbleElement) {
            bubbleElement.classList.remove('pending');
        }
    }

    // 標記一則使用者訊息氣泡「傳送失敗」，並附上「點擊重試」按鈕。
    //
    // 聊天訊息是非冪等的 POST——這裡的重試一定是使用者主動點按鈕觸發，
    // 絕不自動重試（自動重試可能讓後端真的收到兩次同一句話）。原始文字
    // 存在 bubbleElement.dataset.pendingText 上，重試時直接重送，不必
    // 使用者重新輸入，也不會被使用者這段時間在輸入框打的新內容誤蓋過去。
    function markSendFailed(bubbleElement, originalText) {
        clearPending(bubbleElement);

        if (!bubbleElement) {
            // 防禦性後備：理論上不會發生（addUserMessage 一定回傳元素），
            // 沒有氣泡可以掛失敗狀態時，退回舊版的系統訊息，至少不會讓
            // 失敗完全無聲無息、使用者以為訊息送出去了
            addSystemMessage(I18N.t('chat.errorPrefix', { error: originalText || '' }));
            return;
        }

        bubbleElement.classList.add('send-failed');
        bubbleElement.dataset.pendingText = originalText;

        const content = bubbleElement.querySelector('.message-content');
        if (!content) {
            return;
        }

        let failureRow = content.querySelector('.send-failure');
        if (!failureRow) {
            failureRow = document.createElement('div');
            failureRow.className = 'send-failure';
            content.appendChild(failureRow);
        }
        failureRow.innerHTML = '';

        const label = document.createElement('span');
        label.className = 'send-failure-label';
        label.textContent = I18N.t('chat.sendFailed');
        failureRow.appendChild(label);

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'send-retry-btn';
        retryBtn.textContent = I18N.t('chat.retrySend');
        retryBtn.addEventListener('click', function() {
            retrySendFromBubble(bubbleElement);
        });
        failureRow.appendChild(retryBtn);
    }

    // 移除失敗狀態的視覺標記（重試開始時呼叫）。這次重試最後成功與否，
    // 交由 attemptSend 決定要不要再叫一次 markSendFailed，這裡只負責清掉
    // 「上一次失敗」留下的痕跡，避免舊的失敗列跟新一輪的傳送中狀態並存。
    function clearSendFailure(bubbleElement) {
        if (!bubbleElement) return;
        bubbleElement.classList.remove('send-failed');
        const failureRow = bubbleElement.querySelector('.send-failure');
        if (failureRow) {
            failureRow.remove();
        }
    }

    // 使用者點擊失敗氣泡上的「重試」。isProcessing 為 true（例如同時有
    // 另一則訊息正在傳送）時比照 endChat 的既有慣例，提示忙碌並直接返回，
    // 不排隊、不疊加。
    function retrySendFromBubble(bubbleElement) {
        if (isProcessing) {
            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                UIManager.showToast(I18N.t('chat.busy'));
            } else {
                alert(I18N.t('chat.busy'));
            }
            return;
        }

        const text = bubbleElement && bubbleElement.dataset ? bubbleElement.dataset.pendingText : '';
        if (!text) {
            return;
        }

        attemptSend(text, bubbleElement);
    }
    
    // 組出訊息的頭像 HTML：user 一律有圖，system/thinking 依 botAvatar 是否存在決定
    // 是否有圖（沒有就純文字 "AI" 替代）。addUserMessage/addSystemMessage/addThinkingMessage
    // 三處原本各自重複這段樣板，合併到這裡。
    function buildAvatarHtml(kind) {
        if (kind === 'user') {
            return `
                <img src="${userAvatar}" alt="User" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <span class="avatar-text" style="display:none;">U</span>
            `;
        }
        return `
                ${botAvatar ?
                    `<img src="${botAvatar}" alt="AI" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` :
                    ''}
                <span class="avatar-text" ${botAvatar ? 'style="display:none;"' : ''}>AI</span>
            `;
    }

    // TTS 播放鍵的 messageId（v2.4 spec②）：外部沒有指定（options.messageId）
    // 時用遞增計數器現配一個。VoiceModule.speak 拿它當快取鍵，同一頁面工作
    // 階段內每則訊息都要拿到不同的 id，否則會被誤判成「同一則訊息」而共用
    // 到別則訊息已快取的錄音。
    let ttsMessageCounter = 0;

    // 組出一則訊息的完整 HTML（頭像 + 內容氣泡，選擇性附時間戳）
    //
    // v2.4 spec②：kind 為 system 且未關閉時間戳（showTime）的訊息才附朗讀
    // 鍵——唯一主動關閉 showTime 的是 addThinkingMessage 的「思考中」佔位
    // 泡泡，那則訊息沒有實際文字內容可唸，也不會經過下面的 appendChatMessage
    // （不會被綁上 click），刻意排除。
    function buildMessageHtml(kind, bubbleInnerHtml, options = {}) {
        const showTime = options.showTime !== false;
        const isAssistantReply = kind === 'system' && showTime;
        const ttsButtonHtml = isAssistantReply
            ? `<button class="tts-play" data-mid="${options.messageId || ('tts-' + (++ttsMessageCounter))}" title="${I18N.t('voice.playTitle')}"><i class="fa fa-volume-up"></i></button>`
            : '';
        return `
            <div class="message-avatar">${buildAvatarHtml(kind)}</div>
            <div class="message-content">
                <div class="message-bubble">${bubbleInnerHtml}</div>${ttsButtonHtml}
                ${showTime ? `<div class="message-time">${formatTime(new Date())}</div>` : ''}
            </div>
        `;
    }

    // user/system 訊息共用邏輯：建立 DOM 節點、寫入歷史、選擇性捲動；
    // 兩者差異只在頭像種類與 chatHistory 記錄的 type，故合併為同一實作。
    // 回傳建立的 DOM 節點（v2.3 task 2.3 新增）：sendMessage 需要拿到剛
    // 建立的使用者訊息氣泡，之後傳送失敗時才能把「傳送失敗＋重試」的標記
    // 掛在正確的氣泡上，而不是猜測它在 DOM 裡的位置。
    // isReply（v2.4 spec② R6 修復）：是否為「AI 聊天新回覆本身」——唯一為
    // true 的呼叫端是 attemptSend 成功分支的 addSystemMessage(messageContent,
    // true, true)。其餘 addSystemMessage 呼叫（問候語、供應商切換、慢速模型
    // 提示、各種錯誤/失敗通知……）一律留預設 false。控制器裁決 R6：自動朗讀
    // 的範圍是「新回覆」本身，不是任何即時出現的系統訊息——見 spec §4「設定
    // 開『自動朗讀新回覆』則新回覆到達即播」與 §6 的省錢設計（預設手動播放）。
    // 播放鍵不受這個旗標影響：所有 assistant 訊息一律有鍵（buildMessageHtml
    // 的既有邏輯不變），isReply 只決定「要不要自動觸發」。
    // htmlPrefix（v2.4 spec③，選用）：只給「我們自己模組產出的信任 HTML」
    // 用的渲染前綴（目前唯一呼叫端是 check-in 問候的 MascotModule.checkinHtml()
    // 端茶插圖）——只接在 formatMessageContent(content) 轉義＋<br>化後的結果
    // 前面組成 bubble 的顯示 HTML，不進入下面 chatHistory.push 的 content、
    // 也不會被傳給 VoiceModule.speak（見下方 ttsBtn 區塊仍是用原始 content
    // 參數）。使用者/AI 文字本身仍然全程走 formatMessageContent 的 escape，
    // 這個參數不能拿來塞未經信任的內容。
    function appendChatMessage(type, content, scroll, isReply, htmlPrefix, ephemeral) {
        const messageElement = document.createElement('div');
        messageElement.className = type === 'user' ? 'chat-message user-message' : 'chat-message system-message';
        messageElement.innerHTML = buildMessageHtml(type, (htmlPrefix || '') + formatMessageContent(content));

        chatMessagesContainer.appendChild(messageElement);

        // ephemeral（v2.5 Spec B）：onboarding 腳本訊息與答案只進 DOM，不進
        // chatHistory——之後任何 saveChatHistory() 都不會把它們持久化（重載不重演）。
        if (!ephemeral) {
            chatHistory.push({
                type: type,
                content: content,
                timestamp: new Date().toISOString()
            });
        }

        // 朗讀鍵接線（v2.4 spec②）：buildMessageHtml 只為真正的 assistant 訊息
        // 附上 .tts-play（思考中佔位泡泡不經過這裡，見該函式說明），這裡用
        // 呼叫端傳入的 content（原始純文字）餵給 VoiceModule.speak——不重抽
        // DOM 文字，DOM 裡存的是 formatMessageContent() 跳脫＋<br> 轉換後的
        // HTML，不是原文。typeof 防禦：部分既有單元測試載入 chat_module.js
        // 時不載入 voice_module.js（例如 tests/chat_retry.test.js）。
        const ttsBtn = messageElement.querySelector('.tts-play');
        if (ttsBtn && typeof VoiceModule !== 'undefined') {
            const mid = ttsBtn.dataset.mid;
            ttsBtn.addEventListener('click', function () {
                VoiceModule.speak(mid, content).catch(function (error) {
                    console.warn('朗讀失敗:', error);
                });
            });

            // 自動朗讀只套用在「即時出現的 AI 新回覆」：isReply 排除問候語／
            // 通知／錯誤訊息等其餘系統訊息（見上方函式註解、R6 裁決）；scroll
            // 排除 loadChatHistory 還原今日歷史（見該處呼叫 addSystemMessage
            // (msg.content, false)）——否則重新整理頁面會把今天全部的歷史
            // 訊息一次疊在一起唸出來。兩個條件都要成立才觸發。
            if (isReply && scroll && VoiceModule.isAutoRead()) {
                VoiceModule.speak(mid, content).catch(function (error) {
                    console.warn('自動朗讀失敗:', error);
                });
            }
        }

        if (scroll) {
            scrollToBottom();
        }

        return messageElement;
    }

    // 添加用戶消息
    function addUserMessage(content, scroll = true) {
        return appendChatMessage('user', content, scroll);
    }

    // 添加系統消息。isReply 只有 attemptSend 成功分支的「AI 聊天新回覆」呼叫
    // 會傳 true（見該處），其餘呼叫端留預設 false（R6 裁決，詳見 appendChatMessage
    // 上方註解）。
    function addSystemMessage(content, scroll = true, isReply = false, htmlPrefix) {
        return appendChatMessage('system', content, scroll, isReply, htmlPrefix);
    }

    // ephemeral 訊息（v2.5 Spec B）：樣式與一般訊息相同，但不進 chatHistory/持久層
    function addEphemeralSystemMessage(content) {
        return appendChatMessage('system', content, true, false, undefined, true);
    }

    function addEphemeralUserMessage(content) {
        return appendChatMessage('user', content, true, false, undefined, true);
    }

    // 添加"思考中"消息
    // v2.4 spec③：泡泡內文優先用 MascotModule.thinkingBubbleHtml()（搖擺吉祥物
    // ＋三點動畫）。typeof 防禦比照下面 appendChatMessage 對 VoiceModule 的
    // 處理慣例——部分既有單元測試載入 chat_module.js 時不載入 mascot.js
    // （如 tests/chat_retry.test.js／chat_voice.test.js 直接跑 sendMessage()
    // 會經過這裡），落回原本純點點動畫，行為不變。
    function addThinkingMessage() {
        // 創建唯一ID
        const messageId = 'thinking-message-' + Date.now();

        const thinkingInnerHtml = (typeof MascotModule !== 'undefined')
            ? MascotModule.thinkingBubbleHtml()
            : `<div class="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>`;

        // 創建消息元素
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message system-message thinking';
        messageElement.id = messageId;
        messageElement.innerHTML = buildMessageHtml('system', thinkingInnerHtml, { showTime: false });

        // 添加到聊天容器
        chatMessagesContainer.appendChild(messageElement);

        // 滾動到底部
        scrollToBottom();

        return messageId;
    }

    // 腳本/靜態訊息的「假思考」（v2.5 Spec B §4）：搖擺泡泡 → uniform 隨機延遲 →
    // 替換為訊息。只用於腳本與靜態訊息（onboarding 全部訊息、fallbackWelcome）；
    // 真實 LLM 回覆維持既有 addThinkingMessage 流程，不經過這裡。
    let scriptDelayRange = [1000, 3000];

    // 測試鉤子（spec 硬需求）：測試設 (0,0)，正式碼不得縮短預設區間
    function setScriptDelayRange(minMs, maxMs) {
        scriptDelayRange = [minMs, maxMs];
    }

    function withThinkingDelay(showFn) {
        const min = scriptDelayRange[0];
        const max = scriptDelayRange[1];
        const delay = min + Math.random() * (max - min);
        const thinkingId = addThinkingMessage();
        setTimeout(function () {
            const el = document.getElementById(thinkingId);
            if (el) el.remove();
            showFn();
        }, delay);
    }

    // 添加「生成日記中」等待訊息（v2.4 final-fix：spec③ §3 使用位置 3——
    // AI 生成日記等待）。比照 addThinkingMessage 的純 DOM 佔位模式：不進
    // chatHistory、不呼叫 saveChatHistory，showTime:false（沒有實際文字
    // 內容需要朗讀，也跟思考中泡泡一樣排除 .tts-play／不觸發自動朗讀）。
    // 內文用 MascotModule.loadingHtml()——安靜的搖擺動畫本身，chat 區域
    // 規定只能有這一種動畫，不像 thinkingBubbleHtml() 額外疊三點。呼叫端
    // （endChat）已用 typeof MascotModule 防禦，這裡假設 MascotModule 存在。
    // 沿用既有的 I18N「chat.generatingDiary」等待文字（原本顯示在全頁
    // spinner 裡）——不新增字串，i18n 兩語配對不變。
    function addDiaryGeneratingMessage() {
        const messageId = 'diary-generating-message-' + Date.now();

        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message system-message diary-generating';
        messageElement.id = messageId;
        messageElement.innerHTML = buildMessageHtml('system',
            `<div class="mascot-loading">${MascotModule.loadingHtml()}` +
            `<p class="mascot-loading-text">${I18N.t('chat.generatingDiary')}</p></div>`,
            { showTime: false });

        chatMessagesContainer.appendChild(messageElement);
        scrollToBottom();

        return messageId;
    }

    // 結束聊天
    async function endChat() {
        // 必須宣告在 try 之外（比照上面 sendMessage 的 thinkingMessageId）：
        // 下面 finally 也要用它來對稱清除載入動畫，宣告在 try 內的話 finally
        // 取用會拋 ReferenceError。
        let diaryGeneratingMessageId = null;

        try {
            console.log('結束聊天，準備生成日記');

            // 確保不在處理狀態
            if (isProcessing) {
                console.warn('正在處理其他請求，請稍後再試');
                if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                    UIManager.showToast(I18N.t('chat.busy'));
                } else {
                    alert(I18N.t('chat.busy'));
                }
                return;
            }

            // 設置處理狀態
            isProcessing = true;

            // 禁用輸入和按鈕
            userInputElement.disabled = true;
            if (endChatBtnElement) endChatBtnElement.disabled = true;

            // 顯示載入狀態：優先在聊天區域顯示吉祥物搖擺動畫（見
            // addDiaryGeneratingMessage 註解）；MascotModule 未載入時（部分
            // 既有單元測試只載入 chat_module.js，例如 tests/chat_retry.test.js
            // ／chat_voice.test.js）落回原本的全頁 spinner，行為不變——guard
            // 比照 addThinkingMessage／showSaveEgg 既有慣例。
            // diaryGeneratingMessageId 記住走了哪條路，讓下面 finally 對稱
            // 清除，成功／失敗兩條路徑都不會留下殘留元素。
            try {
                if (typeof MascotModule !== 'undefined') {
                    diaryGeneratingMessageId = addDiaryGeneratingMessage();
                } else {
                    UIManager.showLoadingSpinner(I18N.t('chat.generatingDiary'));
                }
            } catch (error) {
                console.warn('無法顯示載入動畫:', error);
            }

            // 調用API服務結束聊天（供應商/模型由 fetchAPI 統一附上）
            const response = await ApiService.endChat(null, isDayNoteEnabled());
            
            // 處理響應
            console.log('結束聊天API響應:', response);
            
            // 清空聊天歷史
            chatHistory = [];
            saveChatHistory();
            
            // 顯示日記已生成消息
            const diaryMessage = response.message || I18N.t('chat.diaryDone');
            addSystemMessage(diaryMessage);

            // v2.5 Spec C：核可制下有待核可記憶 → 溫暖邀請（不寫入聊天持久層）。
            // 控制器裁決 R5：addSystemMessage 的第二參數是「要不要捲動」，不是
            // 「要不要持久化」——上面 chatHistory = []; saveChatHistory(); 已經
            // 早於這整段執行，成功路徑之後不再呼叫 saveChatHistory()，所以
            // 這裡沿用預設參數（捲動到通知是正確的 UX）即可，訊息不會落盤，
            // 與上面的 diaryMessage 本身同構（見該處）。
            // spec §5 裁決（fix wave）：泡泡需要看得見的「去看看」文字提示，
            // 不能只靠純滑鼠游標樣式暗示可點——兩把 i18n 鑰匙用最小拼接組成
            // 訊息文字，不新增 HTML 機關；整顆泡泡仍然可點擊 → MemoryModule.open()。
            const review = response.memory_review;
            if (review && review.pending > 0) {
                const noticeText = `${I18N.t('memory.pendingNotice')} ${I18N.t('memory.goSee')}`;
                const noticeElement = addSystemMessage(noticeText);
                const noticeBubble = noticeElement && noticeElement.querySelector('.message-bubble');
                if (noticeBubble && typeof MemoryModule !== 'undefined') {
                    noticeBubble.style.cursor = 'pointer';
                    noticeBubble.addEventListener('click', () => MemoryModule.open());
                }
                if (typeof MemoryModule !== 'undefined') MemoryModule.refreshBadge();
            }

            // v2.4 spec ③：存日記彩蛋。只綁這個操作事件；negative valence → 安靜略過。
            if (typeof MascotModule !== 'undefined') {
                const valence = (response.diary && typeof response.diary.valence === 'number')
                    ? response.diary.valence : null;
                MascotModule.showSaveEgg(MascotModule.eggKindFor(valence, new Date().getHours()));
            }

            // 檢查配置是否自動切換到日記視圖
            if (CONFIG && CONFIG.APP.AUTO_SWITCH_TO_DIARY_AFTER_END) {
                // 0.5秒後切換到日記頁面並刷新日記列表
                setTimeout(() => {
                    try {
                        // 先刷新日記列表
                        if (typeof DiaryModule !== 'undefined' && typeof DiaryModule.loadDiaries === 'function') {
                            console.log('刷新日記列表');
                            DiaryModule.loadDiaries();
                        } else {
                            console.warn('無法刷新日記列表: DiaryModule 未定義或缺少 loadDiaries 方法');
                        }
                        
                        // 然後點擊日記頁籤
                        const diaryTabElement = document.querySelector('[data-view="diary"]');
                        if (diaryTabElement) {
                            diaryTabElement.click();
                        }
                    } catch (error) {
                        console.warn('自動刷新日記列表失敗:', error);
                    }
                }, 500);
            } else {
                // 即使不自動切換到日記視圖，也刷新日記列表以保持數據最新
                if (typeof DiaryModule !== 'undefined' && typeof DiaryModule.loadDiaries === 'function') {
                    console.log('刷新日記列表');
                    setTimeout(() => {
                        DiaryModule.loadDiaries();
                    }, 500);
                }
            }
        } catch (error) {
            console.error('結束聊天失敗:', error);
            
            // 顯示錯誤信息
            let errorMessage = I18N.t('chat.diaryError', { error: error.message });
            addSystemMessage(errorMessage);
        } finally {
            // 恢復狀態
            isProcessing = false;
            userInputElement.disabled = false;
            if (endChatBtnElement) endChatBtnElement.disabled = false;
            
            // 關閉載入動畫：對稱地依上面顯示時走的是哪條路徑收尾——不論
            // 成功或失敗都會執行到這裡（finally），兩條路徑都不會留下
            // 殘留元素／卡住的全頁 spinner。
            try {
                if (diaryGeneratingMessageId) {
                    const generatingMessage = document.getElementById(diaryGeneratingMessageId);
                    if (generatingMessage) generatingMessage.remove();
                } else {
                    UIManager.hideLoadingSpinner();
                }
            } catch (error) {
                console.warn('無法隱藏載入動畫:', error);
            }
        }
    }

    // 清空聊天
    function clearChat() {
        // 確認對話框
        if (confirm(I18N.t('chat.confirmClear'))) {
            // 清空聊天歷史
            chatHistory = [];

            // 保存空的聊天歷史
            saveChatHistory();

            // 清空聊天界面
            chatMessagesContainer.innerHTML = '';

            // 添加新的歡迎消息
            addSystemMessage(WELCOME_MESSAGE_TEXT());
        }
    }

    // v2.5 Spec A：「AI 行事曆印章」開關（預設開；'0' 才是關）
    function isDayNoteEnabled() { return localStorage.getItem(DAY_NOTE_KEY) !== '0'; }
    function setDayNoteEnabled(on) { localStorage.setItem(DAY_NOTE_KEY, on ? '1' : '0'); }

    // 保存聊天歷史
    function saveChatHistory() {
        try {
            // 獲取當前用戶ID
            const userId = localStorage.getItem('numericUserId');
            if (!userId) {
                console.warn('無法獲取用戶ID，無法保存聊天歷史');
                return;
            }
            
            // 獲取最大聊天歷史記錄數，如果未定義則使用默認值
            const maxHistory = CONFIG && CONFIG.APP && CONFIG.APP.MAX_CHAT_HISTORY ? 
                CONFIG.APP.MAX_CHAT_HISTORY : 100;
            
            // 如果需要，截取歷史記錄以限制數量
            const historyToSave = chatHistory.length > maxHistory ? 
                chatHistory.slice(-maxHistory) : chatHistory;
                
            // 保存到與用戶ID關聯的本地存儲
            const storageKey = `${CONFIG.STORAGE.CHAT_HISTORY}_${userId}`;
                
            localStorage.setItem(storageKey, JSON.stringify(historyToSave));
            console.log(`保存了 ${historyToSave.length} 條聊天記錄到鍵 ${storageKey}`);
        } catch (error) {
            console.error('保存聊天歷史失敗:', error);
            // 嘗試使用簡單方式保存
            try {
                const userId = localStorage.getItem('numericUserId') || 'backup';
                localStorage.setItem(`urdiary_chat_history_backup_${userId}`, JSON.stringify(chatHistory));
                console.log('使用備用方式保存聊天記錄');
            } catch (backupError) {
                console.error('備用保存方式也失敗:', backupError);
            }
        }
    }
    
    // 格式化消息內容 (處理換行等)
    // 內容會寫入 innerHTML，且可能來自 AI 回應 —— 必須先轉義再換成 <br>，
    // 否則模型或伺服器回傳的 HTML 標籤會在 nodeIntegration 環境下執行任意程式碼
    function formatMessageContent(content) {
        // 添加防錯處理，確保content不是undefined或null
        if (!content) return '';

        // 確保content是字符串
        const contentStr = typeof content === 'string' ? content : String(content);
        return escapeHtml(contentStr).replace(/\n/g, '<br>');
    }
    
    // 格式化時間顯示
    function formatTime(date) {
        const locale = (typeof I18N !== 'undefined') ? I18N.dateLocale() : [];
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
    
    // 滾動到底部
    function scrollToBottom() {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
    
    // 重置聊天模塊
    function reset() {
        console.log('重置聊天模塊');
        
        // 清空聊天歷史
        chatHistory = [];
        
        // 清空聊天介面
        if (chatMessagesContainer) {
            chatMessagesContainer.innerHTML = '';
        }
        
        // 重置處理狀態
        isProcessing = false;
        
        // 清空輸入框
        if (userInputElement) {
            userInputElement.value = '';
        }
        
        // 換帳號後新的工作階段可以再提示一次慢速模型建議
        slowModelHintShown = false;

        // 麥克風鍵不在 chatMessagesContainer 底下，上面的 innerHTML 清空不會
        // 動到它——錄音狀態旗標另外歸零，避免殘留的 recording=true 讓下一次
        // 點擊誤判成「正在錄音、要停止」（此時 VoiceModule 內部其實早已沒有
        // 對應的 mediaRecorder）。
        recording = false;
        const micBtn = document.getElementById('mic-button');
        if (micBtn) micBtn.classList.remove('recording');

        console.log('聊天模塊已重置');
    }
    
    // 返回公共API
    return {
        init: init,
        reset: reset,
        sendMessage: sendMessage,
        clearHistory: clearChat,
        endChat: endChat,
        isDayNoteEnabled: isDayNoteEnabled,
        setDayNoteEnabled: setDayNoteEnabled,
        // 純函式，僅為 vitest 單元測試曝光，行為不變
        diaryDayString: diaryDayString,
        applyCompanionTitle: applyCompanionTitle,
        maybeShowSlowModelHint: maybeShowSlowModelHint,
        // v2.5 Spec B：onboarding 腳本訊息基礎設施
        addThinkingMessage: addThinkingMessage,
        addEphemeralSystemMessage: addEphemeralSystemMessage,
        addEphemeralUserMessage: addEphemeralUserMessage,
        withThinkingDelay: withThinkingDelay,
        setScriptDelayRange: setScriptDelayRange,
        _test: { handleTranscript: handleTranscript }
    };
})();