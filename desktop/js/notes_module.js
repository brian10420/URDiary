/**
 * 筆記模塊 - 處理互動筆記相關功能
 */
const NotesModule = (function() {
    // 私有變量
    let notesList = [];
    let currentNote = null;
    
    // DOM元素
    const notesListElement = document.querySelector('.notes-list');
    const noteEditorElement = document.querySelector('.note-editor');
    const noteTitleInput = document.querySelector('#note-title');
    const noteContentInput = document.querySelector('#note-content');
    const saveNoteBtn = document.querySelector('#save-note-btn');
    const newNoteBtn = document.querySelector('#new-note-btn');
    
    // 初始化
    async function init() {
        console.log('初始化筆記模塊');
        
        try {
            // 檢查API服務
            if (typeof ApiService === 'undefined' || !ApiService.getNotes) {
                throw new Error('ApiService 未定義或缺少 getNotes 方法');
            }
            
            // 獲取DOM元素
            const notesView = document.getElementById('notes-view');
            if (!notesView) {
                console.error('找不到筆記視圖容器 (#notes-view)');
                return;
            }
            
            // 檢查DOM元素
            if (!notesListElement) {
                console.warn('找不到筆記列表元素 (.notes-list)，創建一個');
                const listElement = document.createElement('div');
                listElement.className = 'notes-list';
                notesView.appendChild(listElement);
                
                // 更新引用
                window.notesListElement = listElement;
            }
            
            // 檢查編輯器元素
            if (!noteEditorElement) {
                console.warn('找不到筆記編輯器元素 (.note-editor)，創建一個');
                const editorElement = document.createElement('div');
                editorElement.className = 'note-editor';
                editorElement.innerHTML = `
                    <div class="editor-header">
                        <input type="text" id="note-title" placeholder="筆記標題">
                        <button id="save-note-btn" class="btn btn-primary">保存</button>
                        <button id="cancel-note-btn" class="btn btn-secondary">取消</button>
                    </div>
                    <textarea id="note-content" placeholder="輸入筆記內容..."></textarea>
                `;
                notesView.appendChild(editorElement);
                
                // 更新引用
                window.noteEditorElement = editorElement;
                window.noteTitleInput = editorElement.querySelector('#note-title');
                window.noteContentInput = editorElement.querySelector('#note-content');
                window.saveNoteBtn = editorElement.querySelector('#save-note-btn');
                
                // 添加取消按鈕事件
                const cancelNoteBtn = editorElement.querySelector('#cancel-note-btn');
                if (cancelNoteBtn) {
                    cancelNoteBtn.addEventListener('click', hideNoteEditor);
                }
            }
            
            // 檢查新建筆記按鈕
            if (!newNoteBtn) {
                console.warn('找不到新建筆記按鈕 (#new-note-btn)，創建一個');
                const actionsElement = document.createElement('div');
                actionsElement.className = 'notes-actions';
                actionsElement.innerHTML = '<button id="new-note-btn" class="btn btn-primary">新建筆記</button>';
                notesView.insertBefore(actionsElement, notesListElement);
                
                // 更新引用
                window.newNoteBtn = actionsElement.querySelector('#new-note-btn');
            }
            
            // 綁定事件監聽器
            if (saveNoteBtn) {
                saveNoteBtn.addEventListener('click', saveCurrentNote);
            } else {
                console.error('找不到保存筆記按鈕');
            }
            
            if (newNoteBtn) {
                newNoteBtn.addEventListener('click', createNewNote);
            } else {
                console.error('找不到新建筆記按鈕');
            }
            
            // 初始隱藏編輯器
            hideNoteEditor();
            
            // 加載筆記
            await loadNotes();
            
            console.log('筆記模塊初始化完成');
        } catch (error) {
            console.error('初始化筆記模塊失敗:', error);
            if (typeof ErrorHandler !== 'undefined') {
                ErrorHandler.handleError(error, 'ui', { component: 'notes-module', action: 'init' });
            }
            
            // 顯示錯誤信息
            showFallbackError('初始化筆記模塊失敗: ' + error.message);
        }
    }
    
    // 顯示備用錯誤信息
    function showFallbackError(message) {
        console.error(message);
        
        // 嘗試使用UIManager
        if (typeof UIManager !== 'undefined' && UIManager.showToast) {
            UIManager.showToast(message);
        }
        
        // 創建備用錯誤消息
        try {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.innerHTML = `
                <h3>應用程序錯誤</h3>
                <p>${message}</p>
                <button id="dismiss-error" class="btn">關閉</button>
            `;
            
            // 添加到頁面
            const container = document.querySelector('#notes-view') || document.body;
            container.appendChild(errorDiv);
            
            // 添加關閉按鈕事件
            const dismissBtn = errorDiv.querySelector('#dismiss-error');
            if (dismissBtn) {
                dismissBtn.addEventListener('click', function() {
                    errorDiv.remove();
                });
            }
            
            // 自動隱藏
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                }
            }, 8000);
        } catch (err) {
            console.error('無法顯示錯誤訊息:', err);
            alert(message);
        }
    }
    
    // 加載筆記
    async function loadNotes() {
        console.log('開始加載筆記');
        
        try {
            // 檢查DOM元素
            if (!notesListElement) {
                throw new Error('筆記列表元素不存在');
            }
            
            // 顯示加載指示器
            const spinnerActive = typeof UIManager !== 'undefined' && UIManager.showSpinner;
            if (spinnerActive) {
                UIManager.showSpinner();
            } else {
                console.warn('UIManager.showSpinner 不可用');
                // 創建臨時加載指示器
                const spinner = document.createElement('div');
                spinner.className = 'temp-spinner';
                spinner.textContent = '加載中...';
                spinner.style.cssText = 'text-align:center;padding:20px;color:#666;';
                notesListElement.innerHTML = '';
                notesListElement.appendChild(spinner);
            }
            
            // 檢查API服務
            if (typeof ApiService === 'undefined' || !ApiService.getNotes) {
                throw new Error('API服務不可用');
            }
            
            // 從API獲取筆記
            const notes = await ApiService.getNotes().catch(error => {
                console.error('調用 ApiService.getNotes 失敗:', error);
                throw new Error('獲取筆記數據失敗: ' + error.message);
            });
            
            // 驗證結果
            if (!notes) {
                throw new Error('獲取的筆記數據為空');
            }
            
            // 處理並過濾筆記數據
            if (Array.isArray(notes)) {
                // 過濾有效筆記（必須有id, title和content字段）
                notesList = notes.filter(note => 
                    note && 
                    (note.id || note.note_id) && 
                    (note.title || note.title === '') && 
                    (note.content || note.content === '')
                );
            } else if (typeof notes === 'object') {
                // 嘗試將對象轉換為數組，並過濾
                notesList = Object.values(notes).filter(note => 
                    note && 
                    typeof note === 'object' && 
                    (note.id || note.note_id) && 
                    (note.title || note.title === '') && 
                    (note.content || note.content === '')
                );
            } else {
                throw new Error('筆記數據格式不正確: ' + typeof notes);
            }
            
            console.log(`成功加載 ${notesList.length} 條筆記`);
            
            // 渲染筆記列表
            renderNotesList();
        } catch (error) {
            console.error('加載筆記失敗:', error);
            
            // 記錄錯誤
            if (typeof ErrorHandler !== 'undefined') {
                ErrorHandler.handleError(error, 'data', { component: 'notes-module', action: 'load-notes' });
            }
            
            // 顯示錯誤信息
            showFallbackError('加載筆記失敗: ' + error.message);
            
            // 顯示友好的錯誤信息
            if (notesListElement) {
                notesListElement.innerHTML = `
                    <div class="error-message">
                        <h3>加載筆記失敗</h3>
                        <p>${error.message}</p>
                        <button id="retry-load-notes" class="btn btn-primary">重試</button>
                    </div>
                `;
                
                // 綁定重試按鈕
                const retryButton = document.getElementById('retry-load-notes');
                if (retryButton) {
                    retryButton.addEventListener('click', loadNotes);
                }
            }
        } finally {
            // 隱藏加載指示器
            if (typeof UIManager !== 'undefined' && UIManager.hideSpinner) {
                UIManager.hideSpinner();
            } else {
                // 移除臨時加載指示器
                const spinner = notesListElement.querySelector('.temp-spinner');
                if (spinner) {
                    spinner.remove();
                }
            }
        }
    }
    
    // 渲染筆記列表
    function renderNotesList() {
        if (!notesListElement) return;
        
        // 清空筆記列表
        notesListElement.innerHTML = '';
        
        if (notesList.length === 0) {
            // 顯示空筆記提示
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-notes-message';
            emptyMessage.innerHTML = `
                <p>您還沒有互動筆記</p>
                <p>隨著您的對話，系統會自動更新互動筆記</p>
            `;
            notesListElement.appendChild(emptyMessage);
            return;
        }
        
        // 創建筆記卡片
        notesList.forEach(note => {
            const noteCard = createNoteCard(note);
            notesListElement.appendChild(noteCard);
        });
    }
    
    // 創建筆記卡片
    function createNoteCard(note) {
        const date = new Date(note.lastUpdated);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const card = document.createElement('div');
        card.className = 'note-card';
        card.setAttribute('data-id', note.id);
        
        // 創建預覽文本 (限制在100字符內)
        const previewText = note.content.length > 100 
            ? note.content.substring(0, 100) + '...' 
            : note.content;
        
        card.innerHTML = `
            <div class="note-title">${note.title}</div>
            <div class="note-preview">${previewText}</div>
            <div class="note-footer">
                <div class="note-date">${formattedDate}</div>
                <div class="note-actions">
                    <button class="edit-note-btn" title="編輯">編輯</button>
                    <button class="delete-note-btn" title="刪除">刪除</button>
                </div>
            </div>
        `;
        
        // 添加點擊事件
        card.querySelector('.edit-note-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            editNote(note.id);
        });
        
        card.querySelector('.delete-note-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDeleteNote(note.id);
        });
        
        // 點擊卡片也可以編輯
        card.addEventListener('click', () => {
            editNote(note.id);
        });
        
        return card;
    }
    
    // 編輯筆記
    function editNote(noteId) {
        const note = notesList.find(n => n.id === noteId);
        if (!note) {
            UIManager.showToast('未找到筆記');
            return;
        }
        
        currentNote = note;
        
        // 顯示編輯器
        showNoteEditor();
        
        // 填充表單
        if (noteTitleInput) noteTitleInput.value = note.title;
        if (noteContentInput) noteContentInput.value = note.content;
    }
    
    // 創建新筆記
    function createNewNote() {
        currentNote = null;
        
        // 顯示編輯器
        showNoteEditor();
        
        // 清空表單
        if (noteTitleInput) noteTitleInput.value = '';
        if (noteContentInput) noteContentInput.value = '';
    }
    
    // 顯示筆記編輯器
    function showNoteEditor() {
        if (!noteEditorElement) return;
        
        // 隱藏筆記列表，顯示編輯器
        if (notesListElement) notesListElement.style.display = 'none';
        noteEditorElement.style.display = 'block';
    }
    
    // 隱藏筆記編輯器
    function hideNoteEditor() {
        if (!noteEditorElement) return;
        
        // 顯示筆記列表，隱藏編輯器
        if (notesListElement) notesListElement.style.display = 'block';
        noteEditorElement.style.display = 'none';
    }
    
    // 保存當前筆記
    async function saveCurrentNote() {
        if (!noteTitleInput || !noteContentInput) return;
        
        const title = noteTitleInput.value.trim();
        const content = noteContentInput.value.trim();
        
        if (!title) {
            UIManager.showToast('請輸入筆記標題');
            return;
        }
        
        try {
            // 顯示加載指示器
            UIManager.showSpinner();
            
            // 構建筆記對象
            const noteData = {
                title: title,
                content: content
            };
            
            // 如果是編輯現有筆記
            if (currentNote) {
                noteData.id = currentNote.id;
            }
            
            // 保存筆記
            const response = await ApiService.saveNote(noteData);
            
            if (response.success) {
                UIManager.showToast('筆記已保存');
                
                // 重新加載筆記列表
                await loadNotes();
                
                // 隱藏編輯器
                hideNoteEditor();
            } else {
                UIManager.showToast('保存筆記失敗: ' + (response.message || '未知錯誤'));
            }
        } catch (error) {
            console.error('保存筆記失敗:', error);
            UIManager.showToast('保存筆記失敗，請稍後再試');
        } finally {
            // 隱藏加載指示器
            UIManager.hideSpinner();
        }
    }
    
    // 確認刪除筆記
    function confirmDeleteNote(noteId) {
        if (confirm('確定要刪除這個筆記嗎？此操作無法撤銷。')) {
            deleteNote(noteId);
        }
    }
    
    // 刪除筆記
    async function deleteNote(noteId) {
        try {
            // 顯示加載指示器
            UIManager.showSpinner();
            
            // 刪除筆記
            const response = await ApiService.deleteNote(noteId);
            
            if (response.success) {
                UIManager.showToast('筆記已刪除');
                
                // 重新加載筆記列表
                await loadNotes();
            } else {
                UIManager.showToast('刪除筆記失敗: ' + (response.message || '未知錯誤'));
            }
        } catch (error) {
            console.error('刪除筆記失敗:', error);
            UIManager.showToast('刪除筆記失敗，請稍後再試');
        } finally {
            // 隱藏加載指示器
            UIManager.hideSpinner();
        }
    }
    
    // 從聊天更新筆記
    function updateNoteFromChat(topic, content) {
        // 查找是否有相關主題的筆記
        const existingNote = notesList.find(note => 
            note.title.toLowerCase().includes(topic.toLowerCase())
        );
        
        if (existingNote) {
            // 更新現有筆記
            const updatedContent = existingNote.content + '\n\n' + content;
            
            // 保存更新
            ApiService.saveNote({
                id: existingNote.id,
                title: existingNote.title,
                content: updatedContent
            }).then(() => {
                console.log('從聊天更新了筆記:', existingNote.title);
            }).catch(error => {
                console.error('從聊天更新筆記失敗:', error);
            });
        } else {
            // 創建新筆記
            ApiService.saveNote({
                title: '關於' + topic,
                content: content
            }).then(() => {
                console.log('從聊天創建了新筆記:', '關於' + topic);
            }).catch(error => {
                console.error('從聊天創建筆記失敗:', error);
            });
        }
    }
    
    // 返回公共API
    return {
        init: init,
        loadNotes: loadNotes,
        updateNoteFromChat: updateNoteFromChat
    };
})();

// 當DOM加載完成後初始化
document.addEventListener('DOMContentLoaded', function() {
    NotesModule.init();
});