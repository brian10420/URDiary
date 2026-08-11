/**
 * 聊天模塊 - 處理聊天相關功能
 */
const ChatModule = (function() {
    // 私有變量
    let chatHistory = [];
    let userAvatar = null;
    let botAvatar = 'assets/icon.jpg';
    let isProcessing = false;

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
        
        console.log('聊天模塊初始化完成');
    }
    
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

        // 靜態歡迎詞保底：僅在對話仍是空的時候補上，避免重複
        function fallbackWelcome() {
            if (!hasRenderedHistory && chatHistory.length === 0) {
                addSystemMessage(WELCOME_MESSAGE_TEXT());
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
                // AI 的主動問候：進入畫面與本地歷史（後端也已存入正式對話歷史）
                addSystemMessage(result.message);
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

    // 實際嘗試發送一則訊息（新訊息與「點擊重試」共用同一份邏輯）。
    // userInput 一律是呼叫端明確傳入的原始文字，不是重新讀取輸入框目前的
    // 內容——重試時使用者可能已經在輸入框打了別的話，不該被這次重試誤送。
    async function attemptSend(userInput, bubbleElement) {
        isProcessing = true;
        userInputElement.disabled = true;

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

            // 成功了：清掉傳送中標記，添加系統消息
            clearPending(bubbleElement);
            addSystemMessage(messageContent);

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

    // 組出一則訊息的完整 HTML（頭像 + 內容氣泡，選擇性附時間戳）
    function buildMessageHtml(kind, bubbleInnerHtml, options = {}) {
        const showTime = options.showTime !== false;
        return `
            <div class="message-avatar">${buildAvatarHtml(kind)}</div>
            <div class="message-content">
                <div class="message-bubble">${bubbleInnerHtml}</div>
                ${showTime ? `<div class="message-time">${formatTime(new Date())}</div>` : ''}
            </div>
        `;
    }

    // user/system 訊息共用邏輯：建立 DOM 節點、寫入歷史、選擇性捲動；
    // 兩者差異只在頭像種類與 chatHistory 記錄的 type，故合併為同一實作。
    // 回傳建立的 DOM 節點（v2.3 task 2.3 新增）：sendMessage 需要拿到剛
    // 建立的使用者訊息氣泡，之後傳送失敗時才能把「傳送失敗＋重試」的標記
    // 掛在正確的氣泡上，而不是猜測它在 DOM 裡的位置。
    function appendChatMessage(type, content, scroll) {
        const messageElement = document.createElement('div');
        messageElement.className = type === 'user' ? 'chat-message user-message' : 'chat-message system-message';
        messageElement.innerHTML = buildMessageHtml(type, formatMessageContent(content));

        chatMessagesContainer.appendChild(messageElement);

        chatHistory.push({
            type: type,
            content: content,
            timestamp: new Date().toISOString()
        });

        if (scroll) {
            scrollToBottom();
        }

        return messageElement;
    }

    // 添加用戶消息
    function addUserMessage(content, scroll = true) {
        return appendChatMessage('user', content, scroll);
    }

    // 添加系統消息
    function addSystemMessage(content, scroll = true) {
        return appendChatMessage('system', content, scroll);
    }

    // 添加"思考中"消息
    function addThinkingMessage() {
        // 創建唯一ID
        const messageId = 'thinking-message-' + Date.now();

        // 創建消息元素
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message system-message thinking';
        messageElement.id = messageId;
        messageElement.innerHTML = buildMessageHtml('system', `
                    <div class="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                `, { showTime: false });

        // 添加到聊天容器
        chatMessagesContainer.appendChild(messageElement);

        // 滾動到底部
        scrollToBottom();

        return messageId;
    }

    // 結束聊天
    async function endChat() {
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
            
            // 顯示載入狀態
            try {
                UIManager.showLoadingSpinner(I18N.t('chat.generatingDiary'));
            } catch (error) {
                console.warn('無法顯示載入動畫:', error);
            }
            
            // 調用API服務結束聊天（供應商/模型由 fetchAPI 統一附上）
            const response = await ApiService.endChat();
            
            // 處理響應
            console.log('結束聊天API響應:', response);
            
            // 清空聊天歷史
            chatHistory = [];
            saveChatHistory();
            
            // 顯示日記已生成消息
            const diaryMessage = response.message || I18N.t('chat.diaryDone');
            addSystemMessage(diaryMessage);
            
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
            
            // 關閉載入動畫
            try {
                UIManager.hideLoadingSpinner();
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
        
        console.log('聊天模塊已重置');
    }
    
    // 返回公共API
    return {
        init: init,
        reset: reset,
        sendMessage: sendMessage,
        clearHistory: clearChat,
        endChat: endChat,
        // 純函式，僅為 vitest 單元測試曝光，行為不變
        diaryDayString: diaryDayString
    };
})();