/**
 * 聊天模塊 - 處理聊天相關功能
 */
const ChatModule = (function() {
    // 私有變量
    let chatHistory = [];
    let userAvatar = null;
    let botAvatar = 'assets/icon.jpg';
    let isProcessing = false;
    let currentModel = null; // 當前使用的模型
    
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
    
    // 初始化模型選擇器
    function initModelSelector() {
        // 查找聊天行為區域，如果是input-wrapper，查找其父級
        const inputArea = document.querySelector('.chat-input-area') || 
                          document.querySelector('.chat-input-wrapper')?.parentElement;
        
        if (!inputArea) {
            console.warn('無法找到聊天輸入區域，無法添加模型選擇器');
            return;
        }
        
        // 檢查是否已有模型選擇器
        if (document.getElementById('model-selector')) {
            modelSelectorElement = document.getElementById('model-selector');
            console.log('模型選擇器已存在');
            return;
        }
        
        // 創建模型選擇器元素
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'model-selector-container';
        selectorDiv.style.cssText = 'margin: 0 15px 10px; text-align: right; font-size: 12px; color: #666;';
        
        // 獲取可用模型
        const availableModels = CONFIG?.MODELS?.AVAILABLE || ['grok2', 'grok3'];
        const defaultModel = CONFIG?.MODELS?.DEFAULT || 'grok3';
        
        // 設置當前模型
        currentModel = localStorage.getItem('urDiary_current_model') || defaultModel;
        
        // 創建選擇器HTML
        selectorDiv.innerHTML = `
            <label for="model-selector" style="margin-right: 5px;">模型: </label>
            <select id="model-selector" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd;">
                ${availableModels.map(model => {
                    const displayName = CONFIG?.MODELS?.DISPLAY_NAMES?.[model] || model;
                    return `<option value="${model}" ${model === currentModel ? 'selected' : ''}>${displayName}</option>`;
                }).join('')}
            </select>
        `;
        
        // 如果有原有選擇器，則替換，否則插入到輸入區域前
        const existingSelector = document.querySelector('.model-selector-container');
        if (existingSelector) {
            inputArea.replaceChild(selectorDiv, existingSelector);
        } else {
            inputArea.insertBefore(selectorDiv, inputArea.firstChild);
        }
        
        // 獲取選擇器元素
        modelSelectorElement = document.getElementById('model-selector');
        
        // 綁定變更事件
        if (modelSelectorElement) {
            modelSelectorElement.addEventListener('change', function(e) {
                currentModel = e.target.value;
                console.log(`模型已切換為: ${currentModel}`);
                localStorage.setItem('urDiary_current_model', currentModel);
                
                // 添加系統提示消息
                const displayName = CONFIG?.MODELS?.DISPLAY_NAMES?.[currentModel] || currentModel;
                addSystemMessage(`已切換到模型: ${displayName}`);
            });
        }
    }
    
    // 載入用戶頭像
    function loadUserAvatar() {
        try {
            // 檢查CONFIG是否存在
            if (typeof CONFIG === 'undefined') {
                console.warn('CONFIG未定義，使用默認設置');
                userAvatar = 'assets/default-avatar.png';
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
                userAvatar = CONFIG.USER?.DEFAULT_AVATAR || 'assets/default-avatar.png';
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
            userAvatar = 'assets/default-avatar.png';
        }
        
        // 創建一個Image對象測試圖像是否能加載
        const img = new Image();
        img.onload = function() {
            console.log('用戶頭像加載成功');
        };
        img.onerror = function() {
            console.warn('用戶頭像加載失敗，使用默認頭像');
            userAvatar = 'assets/default-avatar.png';
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
        // 檢查assets目錄是否存在
        const assetsDir = 'assets';
        
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
            
            if (savedHistory) {
                const parsedHistory = JSON.parse(savedHistory);
                
                // 檢查是否有聊天記錄
                if (parsedHistory.length > 0) {
                    // 檢查最後一條消息是否為今日
                    const isToday = checkIfChatIsFromToday(parsedHistory);
                    
                    if (isToday) {
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
                    } else {
                        console.log('聊天記錄不是今日的，顯示新的歡迎消息');
                        chatHistory = [];
                        chatMessagesContainer.innerHTML = '';
                        addSystemMessage("您好！我是您的情緒日記助手。今天想聊些什麼呢？");
                    }
                } else {
                    // 沒有聊天記錄，顯示歡迎消息
                    addSystemMessage("您好！我是您的情緒日記助手。今天想聊些什麼呢？");
                }
            } else {
                // 沒有保存的聊天記錄，顯示歡迎消息
                addSystemMessage("您好！我是您的情緒日記助手。今天想聊些什麼呢？");
            }
        } catch (error) {
            console.error('載入聊天歷史失敗:', error);
            chatHistory = [];
            // 顯示歡迎消息
            addSystemMessage("您好！我是您的情緒日記助手。今天想聊些什麼呢？");
        }
    }
    
    // 檢查聊天記錄是否為今日
    function checkIfChatIsFromToday(history) {
        if (!history || history.length === 0) {
            return false;
        }
        
        // 獲取最後一條消息的時間戳
        const lastMessage = history[history.length - 1];
        if (!lastMessage || !lastMessage.timestamp) {
            return false;
        }
        
        // 解析最後一條消息的時間
        const messageDate = new Date(lastMessage.timestamp);
        
        // 獲取今天的日期 (年、月、日)
        const today = new Date();
        const todayDate = today.getDate();
        const todayMonth = today.getMonth();
        const todayYear = today.getFullYear();
        
        // 獲取消息的日期 (年、月、日)
        const messageDay = messageDate.getDate();
        const messageMonth = messageDate.getMonth();
        const messageYear = messageDate.getFullYear();
        
        // 比較日期是否相同
        return (
            messageDay === todayDate &&
            messageMonth === todayMonth &&
            messageYear === todayYear
        );
    }
    
    // 發送消息
    async function sendMessage() {
        // 獲取用戶輸入
        const userInput = userInputElement.value.trim();
        
        // 如果輸入為空或者正在處理中，則返回
        if (!userInput || isProcessing) {
            return;
        }
        
        // 設置處理狀態
        isProcessing = true;
        userInputElement.disabled = true;
        
        // 清空輸入框
        userInputElement.value = '';
        
        // 添加用戶消息到聊天窗口
        addUserMessage(userInput);
        
        // 處理用戶輸入
        processUserInput(userInput);
    }
    
    // 處理用戶輸入
    async function processUserInput(userInput) {
        try {
            // 添加思考中消息
            const thinkingMessageId = addThinkingMessage();
            
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
            
            // 獲取當前選擇的模型
            const selectedModel = currentModel || CONFIG?.MODELS?.DEFAULT || 'grok3';
            console.log(`使用模型 ${selectedModel} 處理用戶輸入`);
            
            // 調用API服務發送消息
            const response = await ApiService.sendChatMessage(userInput, selectedModel);
            
            // 移除思考中消息
            const thinkingMessage = document.getElementById(thinkingMessageId);
            if (thinkingMessage) {
                thinkingMessage.remove();
            }
            
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
                messageContent = '抱歉，我無法理解您的請求。';
            }
            
            // 添加模型信息到消息末尾（如果有）
            const modelUsed = response.model_used || selectedModel;
            if (modelUsed && typeof messageContent === 'string') {
                const modelDisplayName = CONFIG?.MODELS?.DISPLAY_NAMES?.[modelUsed] || modelUsed;
                messageContent = messageContent;
            }
            
            // 添加系統消息
            addSystemMessage(messageContent);
            
            // 如果響應中包含模型信息，但和當前選擇的不同，更新選擇器
            if (response.model_used && response.model_used !== selectedModel && modelSelectorElement) {
                modelSelectorElement.value = response.model_used;
                currentModel = response.model_used;
                localStorage.setItem('urDiary_current_model', currentModel);
            }
            
            // 保存聊天歷史
            saveChatHistory();
        } catch (error) {
            console.error('處理用戶輸入失敗:', error);
            
            // 移除思考中消息
            const thinkingMessage = document.getElementById(thinkingMessageId);
            if (thinkingMessage) {
                thinkingMessage.remove();
            }
            
            // 添加錯誤消息
            addSystemMessage('抱歉，我遇到了一些問題: ' + error.message);
            
            // 如果是API服務未定義的錯誤，顯示更詳細的錯誤信息
            if (error.message.includes('API服務未初始化')) {
                addSystemMessage('請嘗試刷新頁面，或者檢查API服務是否已啟動。如果問題持續，請聯繫技術支持。');
            }
        } finally {
            // 恢復輸入狀態
            isProcessing = false;
            userInputElement.disabled = false;
            userInputElement.focus();
        }
    }
    
    // 添加用戶消息
    function addUserMessage(content, scroll = true) {
        // 創建消息元素
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message user-message';
        
        // 創建頭像和消息內容容器
        const messageHTML = `
            <div class="message-avatar">
                <img src="${userAvatar}" alt="User" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <span class="avatar-text" style="display:none;">U</span>
            </div>
            <div class="message-content">
                <div class="message-bubble">${formatMessageContent(content)}</div>
                <div class="message-time">${formatTime(new Date())}</div>
            </div>
        `;
        
        // 設置消息HTML
        messageElement.innerHTML = messageHTML;
        
        // 添加到聊天容器
        chatMessagesContainer.appendChild(messageElement);
        
        // 添加到聊天歷史
        chatHistory.push({
            type: 'user',
            content: content,
            timestamp: new Date().toISOString()
        });
        
        // 滾動到底部
        if (scroll) {
            scrollToBottom();
        }
    }
    
    // 添加系統消息
    function addSystemMessage(content, scroll = true) {
        // 創建消息元素
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message system-message';
        
        // 創建頭像和消息內容容器
        const messageHTML = `
            <div class="message-avatar">
                ${botAvatar ? 
                    `<img src="${botAvatar}" alt="AI" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : 
                    ''}
                <span class="avatar-text" ${botAvatar ? 'style="display:none;"' : ''}>AI</span>
            </div>
            <div class="message-content">
                <div class="message-bubble">${formatMessageContent(content)}</div>
                <div class="message-time">${formatTime(new Date())}</div>
            </div>
        `;
        
        // 設置消息HTML
        messageElement.innerHTML = messageHTML;
        
        // 添加到聊天容器
        chatMessagesContainer.appendChild(messageElement);
        
        // 添加到聊天歷史
        chatHistory.push({
            type: 'system',
            content: content,
            timestamp: new Date().toISOString()
        });
        
        // 滾動到底部
        if (scroll) {
            scrollToBottom();
        }
    }
    
    // 添加"思考中"消息
    function addThinkingMessage() {
        // 創建唯一ID
        const messageId = 'thinking-message-' + Date.now();
        
        // 創建消息元素
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message system-message thinking';
        messageElement.id = messageId;
        
        // 創建頭像和消息內容容器
        const messageHTML = `
            <div class="message-avatar">
                ${botAvatar ? 
                    `<img src="${botAvatar}" alt="AI" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : 
                    ''}
                <span class="avatar-text" ${botAvatar ? 'style="display:none;"' : ''}>AI</span>
            </div>
            <div class="message-content">
                <div class="message-bubble">
                    <div class="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        `;
        
        // 設置消息HTML
        messageElement.innerHTML = messageHTML;
        
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
                    UIManager.showToast('正在處理中，請稍後再試');
                } else {
                    alert('正在處理中，請稍後再試');
                }
                return;
            }
            
            // 獲取當前選擇的模型
            const selectedModel = currentModel || CONFIG?.MODELS?.DEFAULT || 'grok3';
            console.log(`使用模型 ${selectedModel} 結束聊天並生成日記`);
            
            // 設置處理狀態
            isProcessing = true;
            
            // 禁用輸入和按鈕
            userInputElement.disabled = true;
            if (endChatBtnElement) endChatBtnElement.disabled = true;
            
            // 顯示載入狀態
            try {
                UIManager.showLoadingSpinner('生成日記中...');
            } catch (error) {
                console.warn('無法顯示載入動畫:', error);
            }
            
            // 調用API服務結束聊天
            const response = await ApiService.endChat(selectedModel);
            
            // 處理響應
            console.log('結束聊天API響應:', response);
            
            // 清空聊天歷史
            chatHistory = [];
            saveChatHistory();
            
            // 顯示日記已生成消息
            const diaryMessage = response.message || '日記已生成，您可以在日記頁面查看。';
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
            let errorMessage = '生成日記時出錯: ' + error.message;
            addSystemMessage(errorMessage);
            
            // 如果可能，添加一條更詳細的錯誤消息
            if (typeof ErrorHandler !== 'undefined' && typeof ErrorHandler.getDetailedErrorMessage === 'function') {
                const detailedMessage = ErrorHandler.getDetailedErrorMessage(error, '結束聊天');
                if (detailedMessage) {
                    addSystemMessage(detailedMessage);
                }
            }
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
        if (confirm('確定要清空當前對話嗎？')) {
            // 清空聊天歷史
            chatHistory = [];
            
            // 保存空的聊天歷史
            saveChatHistory();
            
            // 清空聊天界面
            chatMessagesContainer.innerHTML = '';
            
            // 添加新的歡迎消息
            addSystemMessage('您好！我是您的情緒日記助手。今天想聊些什麼呢？');
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
    function formatMessageContent(content) {
        // 添加防錯處理，確保content不是undefined或null
        if (!content) return '';
        
        // 確保content是字符串
        const contentStr = typeof content === 'string' ? content : String(content);
        return contentStr.replace(/\n/g, '<br>');
    }
    
    // 格式化時間顯示
    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // 滾動到底部
    function scrollToBottom() {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
    
    // 添加機器人消息 - 添加定義解決 addBotMessage 未定義問題
    function addBotMessage(message) {
        addSystemMessage(message);
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
        endChat: endChat
    };
})();

// 當DOM加載完成後初始化
document.addEventListener('DOMContentLoaded', function() {
    ChatModule.init();
});