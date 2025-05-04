/**
 * 日記模塊 - 處理日記相關功能
 */
const DiaryModule = (function() {
    // 私有變量
    let diaries = [];
    let selectedDiaryId = null;
    
    // DOM元素 - 初始化為null，將在init函數中獲取
    let diaryListElement = null;
    let diaryDetailElement = null;
    
    // 初始化
    function init() {
        console.log('初始化日記模塊');
        
        // 重新獲取DOM元素
        diaryListElement = document.querySelector('.diary-list');
        diaryDetailElement = document.querySelector('.diary-detail');
        
        if (!diaryListElement) {
            console.error('初始化時找不到日記列表元素');
            // 嘗試創建元素
            const diaryContainer = document.querySelector('.diary-container');
            if (diaryContainer) {
                console.log('嘗試創建日記列表元素');
                diaryListElement = document.createElement('div');
                diaryListElement.className = 'diary-list';
                diaryContainer.appendChild(diaryListElement);
            }
        }
        
        // 確保日記詳情元素存在並包含必要的子元素
        if (!diaryDetailElement) {
            console.error('初始化時找不到日記詳情元素');
            const diaryContainer = document.querySelector('.diary-container');
            if (diaryContainer) {
                console.log('嘗試創建日記詳情元素');
                diaryDetailElement = document.createElement('div');
                diaryDetailElement.className = 'diary-detail';
                diaryDetailElement.style.display = 'none';
                diaryContainer.appendChild(diaryDetailElement);
            }
        }
        
        // 確保日記詳情元素有所需的子元素
        if (diaryDetailElement) {
            // 檢查是否有必要的子元素
            if (!diaryDetailElement.querySelector('.detail-title')) {
                console.log('創建日記詳情所需的子元素');
                diaryDetailElement.innerHTML = `
                    <div class="detail-header">
                        <h3 class="detail-title"></h3>
                        <div class="detail-actions">
                            <button id="back-to-list-btn" class="btn btn-sm">返回列表</button>
                        </div>
                    </div>
                    <div class="detail-content"></div>
                    <div class="detail-footer">
                        <div class="detail-meta">
                            <span class="detail-date"></span>
                            <span class="detail-mood"></span>
                        </div>
                    </div>
                `;
                
                // 重新綁定返回按鈕事件
                const backToListBtn = diaryDetailElement.querySelector('#back-to-list-btn');
                if (backToListBtn) {
                    backToListBtn.addEventListener('click', function() {
                        hideDetails();
                    });
                }
            }
        }
        
        // 載入日記列表
        loadDiaries();
        
        // 綁定返回按鈕事件
        const backToListBtn = document.getElementById('back-to-list-btn');
        if (backToListBtn) {
            backToListBtn.addEventListener('click', function() {
                hideDetails();
            });
        }
    }
    
    // 載入日記列表
    async function loadDiaries() {
        console.log('開始載入日記列表');
        try {
            // 检查UIManager是否存在
            if (typeof UIManager === 'undefined') {
                console.error('UIManager未定義，無法顯示載入動畫');
                throw new Error('UIManager未定義');
            }
            
            UIManager.showSpinner();
            console.log('顯示載入動畫');
            
            // 確保DOM元素已準備好
            if (!diaryListElement) {
                console.error('日記列表DOM元素不存在，嘗試重新獲取');
                diaryListElement = document.querySelector('.diary-list');
                
                if (!diaryListElement) {
                    throw new Error('無法找到日記列表DOM元素，載入中止');
                }
            }
            
            // 檢查ApiService是否存在
            if (typeof ApiService === 'undefined') {
                console.error('ApiService未定義，無法請求日記數據');
                throw new Error('ApiService未定義，請確保API服務已正確初始化');
            }
            
            // 檢查ApiService.getDiaries方法是否存在
            if (typeof ApiService.getDiaries !== 'function') {
                console.error('ApiService.getDiaries方法未定義');
                throw new Error('API服務未完全初始化，getDiaries方法不可用');
            }
            
            // 從API獲取日記列表
            console.log('向API請求日記數據');
            diaries = await ApiService.getDiaries();
            console.log(`成功獲取${diaries.length}條日記`);
            
            // 檢查數據
            if (!diaries || !Array.isArray(diaries)) {
                console.error('獲取的日記數據無效:', diaries);
                // 使用空數組作為後備
                diaries = [];
                console.log('使用空數組作為後備');
            }
            
            // 渲染日記列表
            console.log('開始渲染日記列表');
            renderDiaryList();
            
            console.log('日記載入完成');
        } catch (error) {
            console.error('載入日記列表失敗:', error);
            if (typeof UIManager !== 'undefined' && UIManager.showError) {
                UIManager.showError('載入失敗', '載入日記資料時出錯: ' + error.message);
            } else {
                alert('載入日記失敗: ' + error.message);
            }
            // 确保至少显示空状态
            diaries = [];
            showEmptyState();
        } finally {
            if (typeof UIManager !== 'undefined' && UIManager.hideSpinner) {
                UIManager.hideSpinner();
                console.log('隱藏載入動畫');
            }
        }
    }
    
    // 渲染日記列表
    function renderDiaryList() {
        console.log('開始渲染日記列表');
        
        // 重新獲取日記列表元素
        if (!diaryListElement) {
            console.warn('日記列表元素不存在，嘗試重新獲取');
            diaryListElement = document.querySelector('.diary-list');
            
            if (!diaryListElement) {
                console.error('無法找到日記列表元素，無法渲染');
                return;
            }
            console.log('成功重新獲取日記列表元素');
        }
        
        // 清空列表
        diaryListElement.innerHTML = '';
        console.log('已清空日記列表DOM');
        
        // 檢查是否有日記數據
        if (!diaries || diaries.length === 0) {
            console.log('無日記數據，顯示空狀態');
            showEmptyState();
            return;
        }
        
        console.log(`開始創建${diaries.length}個日記卡片`);
        
        // 創建日記卡片
        diaries.forEach(diary => {
            try {
                // 確保日記有ID
                if (!diary.id) {
                    diary.id = generateId();
                    console.warn(`日記缺少ID，已生成新ID: ${diary.id}`);
                }
                
                // 解析日期
                const date = new Date(diary.date);
                const formattedDate = formatDate(date);
                
                // 獲取情緒顯示名稱
                const moodName = getMoodName(diary.mood);
                
                // 創建列表項
                const listItem = document.createElement('div');
                listItem.className = 'diary-card';
                listItem.setAttribute('data-id', diary.id);
                
                // 設置HTML內容
                listItem.innerHTML = `
                    <div class="card-header">
                        <div class="card-date">${formattedDate}</div>
                        <div class="mood-tag" style="background-color: ${getMoodColor(diary.mood)}">
                            ${moodName}
                        </div>
                    </div>
                    <h3 class="card-title">${diary.title || '無標題日記'}</h3>
                    <div class="card-excerpt">${getExcerpt(diary.content, 80)}</div>
                `;
                
                // 添加點擊事件 - 使用外部函數封裝以避免閉包問題
                const diaryId = diary.id; // 創建局部變量保存ID
                listItem.addEventListener('click', function() {
                    console.log(`日記卡片被點擊: ID=${diaryId}`);
                    showDiaryDetails(diaryId);
                });
                
                // 添加到列表
                diaryListElement.appendChild(listItem);
                console.log(`添加日記卡片: ID=${diary.id}, 標題=${diary.title}`);
            } catch (error) {
                console.error(`創建日記卡片出錯: ${error.message}`);
                if (diary && diary.id) {
                    console.error(`問題日記ID: ${diary.id}`);
                }
            }
        });
        
        console.log('日記列表渲染完成');
        
        // 確保日記詳情元素存在
        if (!diaryDetailElement) {
            diaryDetailElement = document.querySelector('.diary-detail');
            console.log('重新獲取日記詳情元素:', !!diaryDetailElement);
        }
    }
    
    // 顯示日記詳情
    function showDiaryDetails(diaryId) {
        try {
            console.log(`顯示日記詳情: ID=${diaryId}`);
            
            // 輸出當前diaries數組的狀態
            console.log(`當前日記數量: ${diaries.length}`);
            console.log(`所有日記IDs: ${diaries.map(d => d.id).join(', ')}`);
            
            // 查找指定ID的日記
            let diary = diaries.find(d => String(d.id) === String(diaryId));
            
            if (!diary) {
                console.error(`找不到ID為${diaryId}的日記`);
                UIManager.showError('找不到日記', '無法找到指定的日記記錄');
                return;
            }
            
            // 輸出找到的日記數據
            console.log('找到日記:', JSON.stringify(diary));
            
            // 記錄選中的日記ID
            selectedDiaryId = diaryId;
            
            // 通知UI管理器顯示日記詳情視圖
            UIManager.showDiaryDetail();
            
            // 確保詳情元素存在
            if (!diaryDetailElement) {
                console.error('日記詳情元素不存在');
                // 嘗試再次獲取元素
                diaryDetailElement = document.querySelector('.diary-detail');
                if (!diaryDetailElement) {
                    console.error('無法找到日記詳情元素，無法顯示詳情');
                    return;
                }
                console.log('已重新獲取日記詳情元素');
            }
            
            // 格式化日期
            const dateObj = new Date(diary.date);
            const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            // 更新詳情內容
            const titleElement = diaryDetailElement.querySelector('.detail-title');
            const contentElement = diaryDetailElement.querySelector('.detail-content');
            const dateElement = diaryDetailElement.querySelector('.detail-date');
            const moodElement = diaryDetailElement.querySelector('.detail-mood');
            
            // 檢查DOM元素
            console.log('詳情區域元素檢查:', {
                titleElement: !!titleElement,
                contentElement: !!contentElement,
                dateElement: !!dateElement,
                moodElement: !!moodElement
            });
            
            if (titleElement) titleElement.textContent = diary.title || '無標題日記';
            if (contentElement) contentElement.innerHTML = formatContent(diary.content || '無內容');
            if (dateElement) dateElement.textContent = formattedDate;
            if (moodElement) moodElement.textContent = getMoodName(diary.mood);
            
            // 高亮選中的日記卡片
            const cards = document.querySelectorAll('.diary-card');
            console.log(`找到日記卡片數量: ${cards.length}`);
            cards.forEach(card => {
                const cardId = card.getAttribute('data-id');
                console.log(`卡片ID: ${cardId}, 當前選中ID: ${diaryId}, 匹配: ${cardId === diaryId}`);
                if (String(cardId) === String(diaryId)) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            });
            
            console.log('日記詳情顯示成功');
        } catch (error) {
            console.error('顯示日記詳情時出錯:', error);
            console.error('錯誤堆棧:', error.stack);
            UIManager.showError('顯示詳情失敗', '顯示日記詳情時出錯: ' + error.message);
        }
    }
    
    // 隱藏詳情視圖
    function hideDetails() {
        // 通知UI管理器隱藏日記詳情
        UIManager.hideDiaryDetail();
        
        selectedDiaryId = null;
    }
    
    // 格式化日期
    function formatDate(date) {
        if (!(date instanceof Date) || isNaN(date)) {
            return '未知日期';
        }
        
        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric'
        });
    }
    
    // 獲取摘要
    function getExcerpt(text, length = 100) {
        if (!text) return '';
        return text.length > length ? text.substring(0, length) + '...' : text;
    }
    
    // 獲取情緒顏色
    function getMoodColor(mood) {
        const moodColors = {
            'happy': '#FFD700',
            'excited': '#FF6347',
            'calm': '#7FFFD4',
            'sad': '#6495ED',
            'angry': '#DC143C',
            'anxious': '#9932CC'
        };
        
        return moodColors[mood] || '#CCCCCC';
    }
    
    // 獲取情緒顯示名稱
    function getMoodName(mood) {
        const moodNames = {
            'happy': '喜悅',
            'excited': '興奮',
            'calm': '平靜',
            'neutral': '中性',
            'sad': '悲傷',
            'angry': '憤怒',
            'anxious': '焦慮'
        };
        
        return moodNames[mood] || '未知情緒';
    }
    
    // 格式化內容，處理換行和特殊標記
    function formatContent(content) {
        if (!content) return '<p>無內容</p>';
        
        // 處理換行符
        let formatted = content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
        
        // 確保有開始和結束標籤
        if (!formatted.startsWith('<p>')) {
            formatted = '<p>' + formatted;
        }
        if (!formatted.endsWith('</p>')) {
            formatted = formatted + '</p>';
        }
        
        return formatted;
    }
    
    // 顯示空狀態
    function showEmptyState() {
        console.log('顯示空狀態');
        
        if (!diaryListElement) {
            console.error('日記列表元素不存在，無法顯示空狀態');
            return;
        }
        
        diaryListElement.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📝</div>
                <h3>尚無日記</h3>
                <p>開始與AI助手對話，生成您的第一篇日記吧！</p>
                <button class="btn primary-btn" id="start-chat-btn">開始對話</button>
            </div>
        `;
        
        // 綁定開始對話按鈕
        const startChatBtn = document.getElementById('start-chat-btn');
        if (startChatBtn) {
            startChatBtn.addEventListener('click', function() {
                console.log('點擊"開始對話"按鈕');
                // 使用handleNavigation切換到聊天視圖
                UIManager.handleNavigation('chat');
            });
        }
    }
    
    // 幫助函數：生成隨機ID
    function generateId() {
        return 'diary_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    }
    
    // 重置日記模塊
    function reset() {
        console.log('重置日記模塊');
        
        // 清空日記數據
        diaries = [];
        selectedDiaryId = null;
        
        // 清空日記列表元素
        if (diaryListElement) {
            diaryListElement.innerHTML = '';
        }
        
        // 隱藏日記詳情元素，但不清空其內容
        if (diaryDetailElement) {
            diaryDetailElement.style.display = 'none';
        }
        
        console.log('日記模塊已重置');
    }
    
    // 公共接口
    return {
        init,
        reset,
        loadDiaries,
        showDiaryDetails,
        hideDetails
    };
})();

// 初始化模塊
document.addEventListener('DOMContentLoaded', function() {
    DiaryModule.init();
});