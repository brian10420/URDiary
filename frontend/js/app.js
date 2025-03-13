// 配置
const API_URL = 'http://localhost:8000';
const USER_ID = 'frontend_user';
const NUMERIC_USER_ID = 1; // 確保這與數據庫中的ID匹配

// 頁面元素
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const endChatBtn = document.getElementById('end-chat-btn');
const navLinks = document.querySelectorAll('.navigation a');
const chatView = document.getElementById('chat-view');
const diaryView = document.getElementById('diary-view');
const notesView = document.getElementById('notes-view');
const diaryList = document.getElementById('diary-list');
const diaryContent = document.getElementById('diary-content');
const diaryContentDate = document.getElementById('diary-content-date');
const diaryContentText = document.getElementById('diary-content-text');
const diaryValence = document.getElementById('diary-valence');
const diaryArousal = document.getElementById('diary-arousal');
const backToListBtn = document.getElementById('back-to-list-btn');
const notesContent = document.getElementById('notes-content');
const spinners = {
    chat: document.getElementById('chat-spinner'),
    diary: document.getElementById('diary-spinner'),
    notes: document.getElementById('notes-spinner')
};

// 設置用戶信息
document.getElementById('username').textContent = '測試用戶';
document.getElementById('user-id').textContent = `ID: #${NUMERIC_USER_ID}`;

// 導航功能
navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        
        // 更新活動鏈接樣式
        navLinks.forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        
        // 顯示對應的視圖
        const viewName = this.getAttribute('data-view');
        chatView.style.display = viewName === 'chat' ? 'flex' : 'none';
        diaryView.style.display = viewName === 'diary' ? 'block' : 'none';
        notesView.style.display = viewName === 'notes' ? 'block' : 'none';
        
        // 如果切換到日記或筆記視圖，則加載數據
        if (viewName === 'diary') {
            loadDiaries();
        } else if (viewName === 'notes') {
            loadInteractionNotes();
        }
    });
});

// 發送消息功能
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;
    
    // 添加用戶消息到聊天框
    addMessage(message, 'user');
    messageInput.value = '';
    
    // 顯示加載指示器
    showSpinner('chat');
    
    // 發送到API
    fetch(`${API_URL}/chat/enhanced/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: USER_ID,
            numeric_user_id: NUMERIC_USER_ID,
            message: message
        })
    })
    .then(response => response.json())
    .then(data => {
        // 添加助手回覆到聊天框
        addMessage(data.response, 'assistant');
        hideSpinner('chat');
    })
    .catch(error => {
        console.error('發送消息時出錯:', error);
        addMessage('抱歉，發送消息時出錯。請稍後再試。', 'assistant');
        hideSpinner('chat');
    });
}

// 結束對話功能
endChatBtn.addEventListener('click', endChat);

function endChat() {
    // 確認對話結束
    if (!confirm('確定要結束當前對話並生成日記嗎？')) {
        return;
    }
    
    // 顯示加載指示器
    showSpinner('chat');
    
    // 呼叫結束對話API
    fetch(`${API_URL}/chat/end/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: USER_ID,
            numeric_user_id: NUMERIC_USER_ID
        })
    })
    .then(response => response.json())
    .then(data => {
        // 顯示成功消息
        alert('對話已結束，日記已生成！');
        
        // 清空聊天記錄
        chatMessages.innerHTML = `
            <div class="message assistant-message">
                你好！我是你的心理陪伴助手。今天你想聊些什麼呢？
                <div class="message-time">現在</div>
            </div>
        `;
        
        hideSpinner('chat');
        
        // 切換到日記視圖
        document.querySelector('[data-view="diary"]').click();
    })
    .catch(error => {
        console.error('結束對話時出錯:', error);
        alert('結束對話時出錯，請稍後再試。');
        hideSpinner('chat');
    });
}

// 加載日記列表
function loadDiaries() {
    showSpinner('diary');
    diaryList.style.display = 'block';
    diaryContent.style.display = 'none';
    
    fetch(`${API_URL}/diaries/${NUMERIC_USER_ID}`)
        .then(response => response.json())
        .then(data => {
            if (data.diaries && data.diaries.length > 0) {
                diaryList.innerHTML = '';
                data.diaries.forEach(diary => {
                    const date = new Date(diary.diary_date);
                    const dateStr = date.toLocaleDateString();
                    const excerpt = diary.content.substring(0, 100) + '...';
                    
                    const diaryItem = document.createElement('div');
                    diaryItem.className = 'diary-item';
                    diaryItem.innerHTML = `
                        <div class="diary-date">${dateStr}</div>
                        <div class="diary-excerpt">${excerpt}</div>
                    `;
                    
                    diaryItem.addEventListener('click', () => {
                        showDiaryContent(diary);
                    });
                    
                    diaryList.appendChild(diaryItem);
                });
            } else {
                diaryList.innerHTML = '<p>暫無日記</p>';
            }
            hideSpinner('diary');
        })
        .catch(error => {
            console.error('加載日記時出錯:', error);
            diaryList.innerHTML = '<p>加載日記時出錯</p>';
            hideSpinner('diary');
        });
}

// 顯示日記內容
function showDiaryContent(diary) {
    diaryList.style.display = 'none';
    diaryContent.style.display = 'block';
    
    const date = new Date(diary.diary_date);
    diaryContentDate.textContent = date.toLocaleDateString();
    diaryContentText.textContent = diary.content;
    diaryValence.textContent = diary.valence?.toFixed(2) || '未知';
    diaryArousal.textContent = diary.arousal?.toFixed(2) || '未知';
}

// 返回日記列表
backToListBtn.addEventListener('click', () => {
    diaryList.style.display = 'block';
    diaryContent.style.display = 'none';
});

// 加載互動筆記
function loadInteractionNotes() {
    showSpinner('notes');
    
    fetch(`${API_URL}/interaction-notes/${NUMERIC_USER_ID}`)
        .then(response => {
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('尚未有互動筆記');
                }
                throw new Error('加載互動筆記時出錯');
            }
            return response.json();
        })
        .then(data => {
            // 渲染 Markdown 內容 (簡易版)
            const content = data.content
                .replace(/## (.*)/g, '<h2>$1</h2>')
                .replace(/### (.*)/g, '<h3>$1</h3>')
                .replace(/\n- (.*)/g, '<li>$1</li>')
                .replace(/\n/g, '<br>');
            
            notesContent.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <b>版本:</b> ${data.version} | <b>更新時間:</b> ${new Date(data.updated_at).toLocaleString()}
                </div>
                ${content}
            `;
            hideSpinner('notes');
        })
        .catch(error => {
            console.error('加載互動筆記時出錯:', error);
            notesContent.innerHTML = `<p>${error.message}</p>`;
            hideSpinner('notes');
        });
}

// 輔助函數
function addMessage(content, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    messageDiv.innerHTML = `
        ${content}
        <div class="message-time">${formatTime(new Date())}</div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function formatTime(date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function showSpinner(view) {
    if (spinners[view]) {
        spinners[view].style.display = 'block';
    }
}

function hideSpinner(view) {
    if (spinners[view]) {
        spinners[view].style.display = 'none';
    }
}