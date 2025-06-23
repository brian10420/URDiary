# URDiary 測試策略指南

## 測試架構概述

### 測試金字塔
```
    E2E Tests (端到端測試)
         ↑
   Integration Tests (整合測試)
         ↑
    Unit Tests (單元測試)
```

## 1. 單元測試 (Unit Tests)

### 後端單元測試
**目標**：測試個別函數和類別的邏輯正確性

**涵蓋範圍**：
- `services/` 目錄下的所有業務邏輯函數
- `utils/` 目錄下的工具函數
- `database/crud.py` 的CRUD操作
- `middleware/` 的錯誤處理邏輯

**測試工具**：
- `pytest` - 主要測試框架
- `pytest-asyncio` - 異步測試支援
- `unittest.mock` - Mock外部依賴

**範例測試結構**：
```python
# tests/test_services/test_diary_service.py
import pytest
from unittest.mock import patch, MagicMock
from services.diary_service import generate_diary_from_chat, check_sensitive_content

class TestDiaryService:
    def test_check_sensitive_content_positive(self):
        """測試敏感內容檢測 - 正面案例"""
        assert check_sensitive_content("我想要自殺") == True
        assert check_sensitive_content("I want to suicide") == True
    
    def test_check_sensitive_content_negative(self):
        """測試敏感內容檢測 - 負面案例"""
        assert check_sensitive_content("今天天氣很好") == False
        assert check_sensitive_content("I'm feeling great") == False
    
    @patch('services.diary_service.get_chat_history')
    @patch('services.diary_service.client.chat.completions.create')
    def test_generate_diary_from_chat(self, mock_grok, mock_history):
        """測試日記生成功能"""
        # 設置Mock
        mock_history.return_value = [
            {"role": "user", "content": "今天心情不錯"},
            {"role": "assistant", "content": "很高興聽到你心情好"}
        ]
        mock_grok.return_value.choices[0].message.content = "今天是美好的一天..."
        
        # 執行測試
        content, emotions = generate_diary_from_chat("test_user")
        
        # 驗證結果
        assert isinstance(content, str)
        assert len(content) > 0
        assert "valence" in emotions
        assert "arousal" in emotions
```

### 前端單元測試
**目標**：測試JavaScript模組和函數

**涵蓋範圍**：
- `js/` 目錄下的各模組函数
- API調用邏輯
- 數據處理函数
- UI操作函数

**測試工具**：
- `Jest` - JavaScript測試框架
- `jsdom` - DOM操作測試

## 2. 整合測試 (Integration Tests)

### API端點測試
**目標**：測試API端點的完整流程

**測試工具**：
- `pytest`
- `httpx` - 異步HTTP客戶端
- `TestClient` from FastAPI

**範例測試**：
```python
# tests/test_api_integration.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

class TestChatAPI:
    def test_basic_chat_endpoint(self):
        """測試基本聊天API"""
        response = client.post("/chat/", json={
            "user_id": "test_user",
            "message": "Hello, how are you?"
        })
        assert response.status_code == 200
        data = response.json()
        assert "response" in data
        assert "model_used" in data
    
    def test_sensitive_content_handling(self):
        """測試敏感內容處理"""
        response = client.post("/chat/", json={
            "user_id": "test_user",
            "message": "我想要自殺"
        })
        assert response.status_code == 200
        data = response.json()
        assert "生命線協談專線" in data["response"]
    
    def test_enhanced_chat_flow(self):
        """測試增強聊天完整流程"""
        # 1. 先進行基本聊天建立歷史
        client.post("/chat/", json={
            "user_id": "test_user",
            "message": "我今天很開心"
        })
        
        # 2. 使用增強聊天
        response = client.post("/chat/enhanced/", json={
            "user_id": "test_user",
            "numeric_user_id": 1,
            "message": "你還記得我剛才說什麼嗎？"
        })
        assert response.status_code == 200
        
        # 3. 結束對話並生成日記
        response = client.post("/chat/end/", json={
            "user_id": "test_user",
            "numeric_user_id": 1
        })
        assert response.status_code == 200
        assert "diary" in response.json()
```

### 資料庫整合測試
**目標**：測試資料庫操作的正確性

**測試策略**：
- 使用測試專用資料庫
- 每個測試後清理資料
- 測試資料庫遷移腳本

## 3. 端到端測試 (E2E Tests)

### 前後端整合測試
**目標**：測試完整的用戶流程

**測試工具**：
- `Playwright` 或 `Selenium` - 瀏覽器自動化
- `Electron Testing` - Electron應用測試

**測試場景**：
```python
# tests/test_e2e.py
def test_complete_diary_creation_flow():
    """測試完整日記創建流程"""
    # 1. 啟動應用
    # 2. 用戶登入
    # 3. 開始聊天對話
    # 4. 進行多輪對話
    # 5. 結束對話
    # 6. 檢查日記是否正確生成
    # 7. 檢查互動筆記是否更新
```

## 4. 性能測試

### 負載測試
**目標**：測試系統在高負載下的表現

**測試工具**：
- `locust` - Python負載測試工具

**測試場景**：
- 併發用戶聊天
- 批量日記生成
- 資料庫查詢性能

## 5. 測試資料管理

### 測試資料庫
```sql
-- tests/test_data/sample_users.sql
INSERT INTO users (id, username) VALUES 
(1, 'test_user_1'),
(2, 'test_user_2');

INSERT INTO diaries (user_id, title, content, valence, arousal) VALUES
(1, '測試日記', '這是一篇測試日記', 0.7, 0.5);
```

### Mock資料
```python
# tests/fixtures/mock_data.py
SAMPLE_CHAT_HISTORY = [
    {"role": "user", "content": "今天天氣很好"},
    {"role": "assistant", "content": "是的，好天氣讓人心情愉快"}
]

SAMPLE_GROK_RESPONSE = {
    "choices": [{
        "message": {
            "content": "今天是美好的一天，陽光明媚..."
        }
    }]
}
```

## 6. 持續整合 (CI/CD)

### GitHub Actions配置
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: 3.10
    - name: Install dependencies
      run: |
        pip install -r requirements.txt
        pip install pytest pytest-asyncio httpx
    - name: Run tests
      run: pytest tests/ -v --cov=app
```

## 7. 測試執行指令

### 執行所有測試
```bash
# 後端測試
cd grok_chatbot
pytest tests/ -v

# 前端測試
cd desktop
npm test
```

### 執行特定類型測試
```bash
# 只執行單元測試
pytest tests/test_services/ -v

# 只執行整合測試
pytest tests/test_api_integration.py -v

# 執行覆蓋率測試
pytest tests/ --cov=app --cov-report=html
```

## 8. 測試最佳實踐

### 命名規範
- 測試檔案：`test_*.py`
- 測試函數：`test_*`
- 測試類別：`Test*`

### 測試結構
- **Arrange**: 準備測試資料
- **Act**: 執行被測試的功能
- **Assert**: 驗證結果

### Mock策略
- Mock外部API調用（Grok API）
- Mock資料庫操作（在單元測試中）
- Mock Redis操作
- 不要Mock被測試的核心邏輯

### 測試覆蓋率目標
- 單元測試覆蓋率：≥80%
- 關鍵業務邏輯覆蓋率：≥95%
- API端點覆蓋率：≥90%

## 9. 錯誤場景測試

### 常見錯誤場景
- 網路連接失敗
- API回應超時
- 資料庫連接中斷
- 無效的用戶輸入
- 記憶體不足
- Redis服務不可用

### 測試範例
```python
def test_grok_api_timeout():
    """測試Grok API超時處理"""
    with patch('services.diary_service.client') as mock_client:
        mock_client.chat.completions.create.side_effect = TimeoutError()
        
        content, emotions = generate_diary_from_chat("test_user")
        
        # 驗證錯誤處理
        assert "技術問題" in content
        assert emotions["valence"] == 0.5  # 預設值
```

這個測試策略將幫助確保URDiary專案的程式碼品質和穩定性，並支援長期的專案發展。 