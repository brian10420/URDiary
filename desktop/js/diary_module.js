/**
 * 日記模塊 - 處理日記相關功能
 */
const DiaryModule = (function() {
    // 私有變量
    let diaries = [];
    let selectedDiaryId = null;
    let isEditing = false;
    let originalTitle = '';
    let originalContent = '';
    
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
            // 檢查是否有必要的子元素，如果沒有則創建基本結構
            if (!diaryDetailElement.querySelector('.detail-title')) {
                console.log('創建日記詳情所需的基本子元素');
                diaryDetailElement.innerHTML = `
                    <div class="title-container">
                        <h3 class="detail-title" contenteditable="false" placeholder="點擊編輯標題..."></h3>
                        <span class="edit-hint">點擊標題或內容進行編輯</span>
                    </div>
                    <div class="detail-content" contenteditable="false" placeholder="點擊編輯內容..."></div>
                    <div class="detail-footer">
                        <div class="detail-meta">
                            <span class="detail-date"></span>
                            <span class="detail-mood"></span>
                        </div>
                    </div>
                `;
            }
            
            // 確保編輯按鈕存在
            ensureEditButtonsExist();
            
            // 重新綁定事件
            bindDetailEvents();
        }
        
        // 載入日記列表
        loadDiaries();
        
        // 綁定事件
        bindDetailEvents();
        
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
            const response = await ApiService.getDiaries();
            console.log('API響應:', response);
            
            // 處理響應數據
            let diariesArray = [];
            
            if (response && Array.isArray(response)) {
                // 如果響應直接是數組
                diariesArray = response;
                console.log('響應是數組格式，直接使用');
            } else if (response && response.diaries && Array.isArray(response.diaries)) {
                // 如果響應包含diaries屬性
                diariesArray = response.diaries;
                console.log('從響應的diaries屬性獲取數據');
            } else if (response && response.success && response.diaries && Array.isArray(response.diaries)) {
                // 如果是模擬數據格式
                diariesArray = response.diaries;
                console.log('從模擬數據格式獲取日記列表');
            } else if (response && typeof response === 'object') {
                // 嘗試從其他可能的格式中提取數據
                console.warn('響應格式不標準，嘗試提取數據:', response);
                
                // 檢查是否有其他可能的數據字段
                const possibleArrays = Object.values(response).filter(value => Array.isArray(value));
                if (possibleArrays.length > 0) {
                    diariesArray = possibleArrays[0];
                    console.log('從響應中找到數組數據');
                } else {
                    console.warn('無法從響應中提取日記數據，使用空數組');
                    diariesArray = [];
                }
            } else {
                console.warn('響應格式無效，使用空數組');
                diariesArray = [];
            }
            
            // 轉換數據格式，確保每個日記項目都有必要的字段
            diaries = diariesArray.map(diary => {
                // 處理ID字段
                const id = diary.diary_id || diary.id || generateId();
                
                // 處理標題字段 - 確保不是null或undefined
                let title = diary.title;
                if (!title || title === null || title === undefined || title.trim() === '') {
                    // 如果沒有標題，根據內容或日期生成一個
                    const dateStr = diary.diary_date || diary.date;
                    if (dateStr) {
                        try {
                            const date = new Date(dateStr);
                            title = `日記 - ${date.toLocaleDateString('zh-CN')}`;
                        } catch (e) {
                            title = '無標題日記';
                        }
                    } else {
                        title = '無標題日記';
                    }
                }
                
                // 處理內容字段
                let content = diary.content || '';
                if (content === null || content === undefined) {
                    content = '';
                }
                
                // 處理日期字段
                let date = diary.diary_date || diary.date || new Date().toISOString();
                if (typeof date === 'string') {
                    // 確保日期格式正確
                    try {
                        date = new Date(date).toISOString();
                    } catch (e) {
                        console.warn('日期格式錯誤，使用當前時間:', date);
                        date = new Date().toISOString();
                    }
                }
                
                // 處理情緒值
                const valence = parseFloat(diary.valence) || 0.5;
                const arousal = parseFloat(diary.arousal) || 0.5;
                
                return {
                    id: id,
                    title: title,
                    content: content,
                    date: date,
                    mood: getMoodFromValence(valence),
                    valence: valence,
                    arousal: arousal
                };
            });
            
            console.log(`成功處理${diaries.length}條日記數據`);
            
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
                
                const diaryCard = document.createElement('div');
                diaryCard.className = 'diary-card';
                diaryCard.setAttribute('data-id', diary.id);
                
                // 格式化日期
                const dateObj = new Date(diary.date);
                const formattedDate = dateObj.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                // 獲取摘要
                const excerpt = getExcerpt(diary.content);
                const moodColor = getMoodColor(diary.mood);
                const moodName = getMoodName(diary.mood);
                
                diaryCard.innerHTML = `
                    <div class="diary-card-header">
                        <h3 class="diary-title">${diary.title}</h3>
                        <div class="diary-actions">
                            <button class="btn-icon edit-diary-btn" title="編輯日記" data-id="${diary.id}">
                                <i class="fa fa-edit"></i>
                            </button>
                            <button class="btn-icon view-diary-btn" title="查看詳情" data-id="${diary.id}">
                                <i class="fa fa-eye"></i>
                            </button>
                        </div>
                    </div>
                    <div class="diary-excerpt">${excerpt}</div>
                    <div class="diary-meta">
                        <span class="diary-date">${formattedDate}</span>
                        <span class="diary-mood" style="color: ${moodColor}">${moodName}</span>
                    </div>
                `;
                
                // 添加點擊事件 - 查看詳情
                const viewBtn = diaryCard.querySelector('.view-diary-btn');
                if (viewBtn) {
                    viewBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showDiaryDetails(diary.id);
                    });
                }
                
                // 添加編輯按鈕事件
                const editBtn = diaryCard.querySelector('.edit-diary-btn');
                if (editBtn) {
                    console.log(`為日記 ${diary.id} 綁定編輯按鈕事件`);
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        console.log(`點擊編輯按鈕: 日記ID=${diary.id}`);
                        showDiaryDetails(diary.id);
                        // 延遲一點時間確保詳情頁面已加載，然後自動進入編輯模式
                        setTimeout(() => {
                            enableEditMode();  // 這裡應該調用 enableEditMode() 而不是聚焦
                        }, 100);
                    });
                } else {
                    console.warn(`日記卡片 ${diary.id} 找不到編輯按鈕`);
                }
                
                // 整個卡片點擊事件
                diaryCard.addEventListener('click', () => {
                    showDiaryDetails(diary.id);
                });
                
                diaryListElement.appendChild(diaryCard);
                console.log(`添加日記卡片: ID=${diary.id}, 標題=${diary.title}`);
            } catch (error) {
                console.error(`創建日記卡片時出錯 (ID: ${diary.id}):`, error);
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
            
            // 重置編輯狀態
            isEditing = false;
            originalTitle = '';
            originalContent = '';
            
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
            
            if (titleElement) {
                titleElement.textContent = diary.title || '無標題日記';
                // 確保元素不在編輯模式
                titleElement.setAttribute('contenteditable', 'false');
                titleElement.classList.remove('editing');
                // 保存到編輯狀態變量
                originalTitle = diary.title || '';
            }
            if (contentElement) {
                contentElement.innerHTML = formatContent(diary.content || '無內容');
                // 確保元素不在編輯模式
                contentElement.setAttribute('contenteditable', 'false');
                contentElement.classList.remove('editing');
                // 保存到編輯狀態變量
                originalContent = formatContent(diary.content || '無內容');
            }
            if (dateElement) dateElement.textContent = formattedDate;
            if (moodElement) moodElement.textContent = getMoodName(diary.mood);
            
            // 隱藏編輯按鈕
            hideEditButtons();
            
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
    
    function enableEditMode() {
        console.log('進入編輯模式');
        
        if (!diaryDetailElement) {
            console.error('日記詳情元素不存在');
            return;
        }
        
        // 確保按鈕存在
        ensureEditButtonsExist();
        
        const titleElement = diaryDetailElement.querySelector('.detail-title');
        const contentElement = diaryDetailElement.querySelector('.detail-content');
        
        if (!titleElement || !contentElement) {
            console.error('找不到標題或內容元素');
            return;
        }
        
        // 保存原始內容
        originalTitle = titleElement.textContent;
        originalContent = contentElement.innerHTML;
        
        // 設置為可編輯
        titleElement.setAttribute('contenteditable', 'true');
        contentElement.setAttribute('contenteditable', 'true');
        
        // 添加編輯樣式
        titleElement.classList.add('editing');
        contentElement.classList.add('editing');
        
        // 顯示編輯按鈕
        showEditButtons();
        
        // 設置編輯狀態
        isEditing = true;
        
        // 聚焦到標題
        titleElement.focus();
        
        // 選中全部文字（可選）
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
    // 隱藏詳情視圖
    function hideDetails() {
        // 通知UI管理器隱藏日記詳情
        UIManager.hideDiaryDetail();
        
        selectedDiaryId = null;
    }
    
    // 綁定詳情頁面事件
    function bindDetailEvents() {
        if (!diaryDetailElement) return;
        
        // 確保按鈕存在
        ensureEditButtonsExist();
        
        const titleElement = diaryDetailElement.querySelector('.detail-title');
        const contentElement = diaryDetailElement.querySelector('.detail-content');
        const saveBtnElement = document.getElementById('save-diary-btn');
        const cancelBtnElement = document.getElementById('cancel-edit-btn');
        
        // 綁定標題和內容的編輯事件
        if (titleElement) {
            // 移除舊事件監聽器，避免重複綁定
            titleElement.removeEventListener('focus', onEditStart);
            titleElement.removeEventListener('input', onContentChange);
            titleElement.removeEventListener('blur', onTitleBlur);
            
            // 重新綁定事件
            titleElement.addEventListener('focus', onEditStart);
            titleElement.addEventListener('input', onContentChange);
            titleElement.addEventListener('blur', onTitleBlur);
        }
        
        if (contentElement) {
            // 移除舊事件監聽器，避免重複綁定
            contentElement.removeEventListener('focus', onEditStart);
            contentElement.removeEventListener('input', onContentChange);
            contentElement.removeEventListener('blur', onContentBlur);
            
            // 重新綁定事件
            contentElement.addEventListener('focus', onEditStart);
            contentElement.addEventListener('input', onContentChange);
            contentElement.addEventListener('blur', onContentBlur);
        }
        
        // 綁定保存和取消按鈕（這些在 ensureEditButtonsExist 中已經綁定過了）
        if (saveBtnElement) {
            console.log('保存按鈕已找到並可用');
        } else {
            console.warn('保存按鈕在綁定事件時未找到');
        }
        
        if (cancelBtnElement) {
            console.log('取消按鈕已找到並可用');
        } else {
            console.warn('取消按鈕在綁定事件時未找到');
        }
    }

    // 開始編輯事件處理
    function onEditStart() {
        if (!isEditing) {
            console.log('開始編輯模式');
            isEditing = true;
            
            // 保存原始內容
            const titleElement = diaryDetailElement.querySelector('.detail-title');
            const contentElement = diaryDetailElement.querySelector('.detail-content');
            
            if (titleElement && contentElement) {
                originalTitle = titleElement.textContent || '';
                originalContent = contentElement.innerHTML || '';
                
                // 添加編輯樣式
                titleElement.classList.add('editing');
                contentElement.classList.add('editing');
                
                // 顯示編輯按鈕
                showEditButtons();
            }
        }
    }

    // 內容變化事件處理
    function onContentChange() {
        if (isEditing) {
            // 檢查內容是否有變化
            const titleElement = diaryDetailElement.querySelector('.detail-title');
            const contentElement = diaryDetailElement.querySelector('.detail-content');
            
            if (titleElement && contentElement) {
                const currentTitle = titleElement.textContent || '';
                const currentContent = contentElement.innerHTML || '';
                
                // 如果內容有變化，確保按鈕顯示
                if (currentTitle !== originalTitle || currentContent !== originalContent) {
                    showEditButtons();
                }
            }
        }
    }

    // 標題失去焦點
    function onTitleBlur() {
        // 可以在這裡添加標題格式化邏輯
    }

    // 內容失去焦點
    function onContentBlur() {
        // 可以在這裡添加內容格式化邏輯
    }

    // 顯示編輯按鈕
    function showEditButtons() {
        console.log('顯示編輯按鈕');
        
        if (!diaryDetailElement) {
            console.error('日記詳情元素不存在');
            return;
        }
        
        // 首先確保必要的 DOM 結構存在
        ensureEditButtonsExist();
        
        const saveDiaryBtn = diaryDetailElement.querySelector('#save-diary-btn');
        const cancelEditBtn = diaryDetailElement.querySelector('#cancel-edit-btn');
        const editHint = diaryDetailElement.querySelector('.edit-hint');
        
        console.log('按鈕元素檢查:', {
            saveDiaryBtn: !!saveDiaryBtn,
            cancelEditBtn: !!cancelEditBtn,
            editHint: !!editHint
        });
        
        if (saveDiaryBtn) {
            saveDiaryBtn.style.display = 'inline-block';
            console.log('保存按鈕已顯示');
        } else {
            console.error('找不到保存按鈕元素');
        }
        
        if (cancelEditBtn) {
            cancelEditBtn.style.display = 'inline-block';
            console.log('取消按鈕已顯示');
        } else {
            console.error('找不到取消按鈕元素');
        }
        
        if (editHint) {
            editHint.style.display = 'none';
        }
    }

    // 確保編輯按鈕存在
    function ensureEditButtonsExist() {
        if (!diaryDetailElement) {
            console.error('日記詳情元素不存在，無法創建編輯按鈕');
            return;
        }
        
        // 檢查是否已有按鈕
        let detailHeader = diaryDetailElement.querySelector('.detail-header');
        let detailActions = diaryDetailElement.querySelector('.detail-actions');
        
        // 如果沒有 header，創建它
        if (!detailHeader) {
            console.log('創建缺失的 detail-header');
            detailHeader = document.createElement('div');
            detailHeader.className = 'detail-header';
            
            // 將其插入到詳情元素的開頭
            diaryDetailElement.insertBefore(detailHeader, diaryDetailElement.firstChild);
        }
        
        // 如果沒有 actions 容器，創建它
        if (!detailActions) {
            console.log('創建缺失的 detail-actions');
            detailActions = document.createElement('div');
            detailActions.className = 'detail-actions';
            detailHeader.appendChild(detailActions);
        }
        
        // 檢查並創建保存按鈕
        let saveDiaryBtn = document.getElementById('save-diary-btn');
        if (!saveDiaryBtn) {
            console.log('創建缺失的保存按鈕');
            saveDiaryBtn = document.createElement('button');
            saveDiaryBtn.id = 'save-diary-btn';
            saveDiaryBtn.className = 'btn btn-sm btn-primary';
            saveDiaryBtn.style.display = 'none';
            saveDiaryBtn.textContent = '保存更改';
            detailActions.appendChild(saveDiaryBtn);
            
            // 綁定事件
            saveDiaryBtn.addEventListener('click', saveDiaryChanges);
        }
        
        // 檢查並創建取消按鈕
        let cancelEditBtn = document.getElementById('cancel-edit-btn');
        if (!cancelEditBtn) {
            console.log('創建缺失的取消按鈕');
            cancelEditBtn = document.createElement('button');
            cancelEditBtn.id = 'cancel-edit-btn';
            cancelEditBtn.className = 'btn btn-sm btn-secondary';
            cancelEditBtn.style.display = 'none';
            cancelEditBtn.textContent = '取消編輯';
            detailActions.appendChild(cancelEditBtn);
            
            // 綁定事件
            cancelEditBtn.addEventListener('click', cancelEdit);
        }
        
        // 檢查並創建返回按鈕（如果不存在）
        let backToListBtn = document.getElementById('back-to-list-btn');
        if (!backToListBtn) {
            console.log('創建缺失的返回按鈕');
            backToListBtn = document.createElement('button');
            backToListBtn.id = 'back-to-list-btn';
            backToListBtn.className = 'btn btn-sm';
            backToListBtn.textContent = '返回列表';
            detailActions.appendChild(backToListBtn);
            
            // 綁定事件
            backToListBtn.addEventListener('click', hideDetails);
        }
        
        console.log('編輯按鈕檢查和創建完成');
    }

    // 隱藏編輯按鈕
    function hideEditButtons() {
        console.log('隱藏編輯按鈕');
        
        if (!diaryDetailElement) {
            console.error('日記詳情元素不存在');
            return;
        }
        
        const saveDiaryBtn = diaryDetailElement.querySelector('#save-diary-btn');
        const cancelEditBtn = diaryDetailElement.querySelector('#cancel-edit-btn');
        const editHint = diaryDetailElement.querySelector('.edit-hint');
        
        if (saveDiaryBtn) {
            saveDiaryBtn.style.display = 'none';
        }
        
        if (cancelEditBtn) {
            cancelEditBtn.style.display = 'none';
        }
        
        if (editHint) {
            editHint.style.display = 'inline';
        }
    }

    // 保存日記變更
    async function saveDiaryChanges() {
        if (!selectedDiaryId) {
            UIManager.showError('錯誤', '沒有選中的日記');
            return;
        }

        const titleElement = diaryDetailElement.querySelector('.detail-title');
        const contentElement = diaryDetailElement.querySelector('.detail-content');
        
        if (!titleElement || !contentElement) {
            UIManager.showError('錯誤', '無法獲取編輯內容');
            return;
        }

        const newTitle = titleElement.textContent.trim();
        const newContent = contentElement.innerHTML.trim();

        // 檢查是否有更改
        if (newTitle === originalTitle && newContent === originalContent) {
            console.log('內容無變化，退出編輯模式');
            cancelEdit();
            return;
        }

        try {
            // 顯示載入狀態
            UIManager.showSpinner();
            const loadingMessage = document.querySelector('.loading-message');
            if (loadingMessage) {
                loadingMessage.textContent = '保存中...';
            }

            // 調用API更新日記
            const response = await ApiService.updateDiary(selectedDiaryId, {
                title: newTitle || null,
                content: newContent
            });

            console.log('日記更新響應:', response);

            // 檢查是否為模擬響應
            const isMockResponse = response && response._mock === true;
            const errorType = response && response._error;
            
            if (response && (response.diary || response.message || response.success)) {
                // 更新本地數據
                const diaryIndex = diaries.findIndex(d => String(d.id) === String(selectedDiaryId));
                if (diaryIndex !== -1) {
                    diaries[diaryIndex].title = newTitle;
                    diaries[diaryIndex].content = newContent;
                    console.log('本地數據已更新');
                }

                // 隱藏載入動畫
                UIManager.hideSpinner();

                // 提供狀態反饋
                let statusMessage = '';
                if (isMockResponse) {
                    if (errorType === 'api' && response._status === '404') {
                        statusMessage = '⚠️ 伺服器暫時不可用，日記已本地保存。請稍後重試以同步到伺服器。';
                    } else {
                        statusMessage = '⚠️ 使用離線模式保存日記。';
                    }
                    UIManager.showToast(statusMessage, 'warning');
                }

                // 詢問是否更新互動筆記
                const shouldUpdateInteraction = await showUpdateInteractionDialog(newTitle, newContent, isMockResponse);
                
                if (shouldUpdateInteraction) {
                    try {
                        UIManager.showSpinner();
                        if (loadingMessage) {
                            loadingMessage.textContent = '更新互動筆記...';
                        }
                        
                        // 確保傳遞最新的內容
                        console.log('準備更新互動筆記，使用最新內容:', {
                            diaryId: selectedDiaryId,
                            title: newTitle,
                            content: newContent,
                            contentLength: newContent.length
                        });
                        
                        // 調用API更新互動筆記 - 傳遞最新的完整內容
                        const interactionResponse = await ApiService.updateInteractionNotes(selectedDiaryId, newContent);
                        
                        UIManager.hideSpinner();
                        
                        // 檢查互動筆記更新是否為模擬響應
                        const isInteractionMock = interactionResponse && interactionResponse._mock === true;
                        
                        if (isInteractionMock) {
                            if (isMockResponse) {
                                UIManager.showToast('⚠️ 日記和互動筆記已本地保存，但無法同步到伺服器', 'warning');
                            } else {
                                UIManager.showToast('⚠️ 日記已保存到伺服器，但互動筆記更新失敗', 'warning');
                            }
                        } else {
                            if (isMockResponse) {
                                UIManager.showToast('⚠️ 日記本地保存，互動筆記已更新', 'warning');
                            } else {
                                UIManager.showToast('✅ 日記和互動筆記已成功更新', 'success');
                            }
                        }
                    } catch (error) {
                        console.warn('更新互動筆記失敗:', error);
                        UIManager.hideSpinner();
                        UIManager.showToast('⚠️ 日記已保存，但互動筆記更新失敗', 'warning');
                    }
                } else {
                    if (isMockResponse) {
                        UIManager.showToast('⚠️ 日記已本地保存', 'warning');
                    } else {
                        UIManager.showToast('✅ 日記已保存', 'success');
                    }
                }

                // 重新渲染日記列表
                renderDiaryList();
                
                // 重新顯示該日記的詳情（使用最新數據）
                showDiaryDetails(selectedDiaryId);

                // 退出編輯模式
                exitEditMode();

            } else {
                throw new Error('API響應格式錯誤或無有效數據');
            }

        } catch (error) {
            console.error('保存日記失敗:', error);
            UIManager.hideSpinner();
            
            // 改進錯誤訊息
            let errorMessage = '保存日記時出錯';
            if (error.message.includes('404')) {
                errorMessage = '伺服器端點不存在 (404)，請檢查後端是否正常運行';
            } else if (error.message.includes('500')) {
                errorMessage = '伺服器內部錯誤，請稍後重試';
            } else if (error.message.includes('網絡')) {
                errorMessage = '網絡連接失敗，請檢查網絡狀態';
            }
            
            UIManager.showError('保存失敗', errorMessage + ': ' + error.message);
        }
    }

    // 退出編輯模式
    function exitEditMode() {
        const titleElement = diaryDetailElement.querySelector('.detail-title');
        const contentElement = diaryDetailElement.querySelector('.detail-content');
        
        if (titleElement) {
            titleElement.setAttribute('contenteditable', 'false');
            titleElement.classList.remove('editing');
        }
        
        if (contentElement) {
            contentElement.setAttribute('contenteditable', 'false');
            contentElement.classList.remove('editing');
        }
        
        isEditing = false;
        hideEditButtons();
        
        // 清除原始內容記錄
        originalTitle = '';
        originalContent = '';
    }

    // 取消編輯
    function cancelEdit() {
        const titleElement = diaryDetailElement.querySelector('.detail-title');
        const contentElement = diaryDetailElement.querySelector('.detail-content');
        
        if (titleElement) {
            titleElement.textContent = originalTitle;
        }
        
        if (contentElement) {
            contentElement.innerHTML = originalContent;
        }
        
        exitEditMode();
    }

    // 顯示更新互動筆記對話框
    function showUpdateInteractionDialog(title, content, isMockResponse = false) {
        return new Promise((resolve) => {
            // 創建對話框
            const dialog = document.createElement('div');
            dialog.className = 'modal';
            dialog.style.display = 'flex';
            
            // 根據是否為模擬響應調整提示內容
            let statusInfo = '';
            let statusClass = '';
            
            if (isMockResponse) {
                statusInfo = `
                    <div class="status-info warning">
                        <i class="fa fa-exclamation-triangle"></i>
                        <span>⚠️ 當前為離線模式，互動筆記將無法同步到伺服器</span>
                    </div>
                `;
                statusClass = 'mock-mode';
            } else {
                statusInfo = `
                    <div class="status-info success">
                        <i class="fa fa-check-circle"></i>
                        <span>✅ 日記已成功保存到伺服器</span>
                    </div>
                `;
                statusClass = 'online-mode';
            }
            
            dialog.innerHTML = `
                <div class="modal-content ${statusClass}">
                    <div class="modal-header">
                        <h3>更新互動筆記</h3>
                    </div>
                    <div class="modal-body">
                        ${statusInfo}
                        <p>您已修改了日記「${title || '無標題日記'}」的內容。</p>
                        <p>是否要根據修改後的內容更新互動筆記？</p>
                        <div class="content-preview">
                            <h4>修改後的內容摘要：</h4>
                            <div class="content-excerpt">${getExcerpt(content, 150)}</div>
                        </div>
                        <div class="info-box">
                            <i class="fa fa-info-circle"></i>
                            <span>互動筆記會根據您的所有日記內容進行長期的個人資訊追蹤和更新。</span>
                        </div>
                        ${isMockResponse ? `
                        <div class="warning-box">
                            <i class="fa fa-exclamation-triangle"></i>
                            <span>注意：由於伺服器不可用，互動筆記更新將僅在本地保存，無法同步到伺服器。</span>
                        </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button id="confirm-update" class="btn btn-primary">
                            ${isMockResponse ? '是，本地更新互動筆記' : '是，更新互動筆記'}
                        </button>
                        <button id="skip-update" class="btn btn-secondary">否，僅保存日記</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            // 绑定事件
            dialog.querySelector('#confirm-update').addEventListener('click', () => {
                document.body.removeChild(dialog);
                resolve(true);
            });

            dialog.querySelector('#skip-update').addEventListener('click', () => {
                document.body.removeChild(dialog);
                resolve(false);
            });

            // 點擊背景關閉（默認為否）
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    document.body.removeChild(dialog);
                    resolve(false);
                }
            });
        });
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
    
    // 從情緒值獲取情緒標籤
    function getMoodFromValence(valence) {
        if (typeof valence !== 'number') {
            return 'neutral';
        }
        
        if (valence >= 0.7) return 'happy';
        if (valence >= 0.4) return 'calm';
        if (valence >= 0) return 'neutral';
        if (valence >= -0.4) return 'sad';
        return 'angry';
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
    
    // 返回公共API
    return {
        init: init,
        reset: reset,
        loadDiaries: loadDiaries,
        showDiaryDetails: showDiaryDetails
    };
})();

// 初始化模塊
document.addEventListener('DOMContentLoaded', function() {
    DiaryModule.init();
});