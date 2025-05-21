# 使用多模型配置指南

## 概述

URDiary 現在支持多種 Grok 模型，包括 Grok 2 和 Grok 3。這個指南說明如何配置和使用這些模型。

## 配置

在 `.env` 文件中，添加以下配置：

```
# 模型設定
DEFAULT_MODEL=grok3  # 可選值: grok2, grok3
AUTO_USE_LATEST_MODEL=True  # 如果模型不可用，是否自動使用最新的可用模型
```

### 配置選項說明

- `DEFAULT_MODEL`: 設定默認使用的模型，選項：
  - `grok2`: 使用 grok-2-latest 模型
  - `grok3`: 使用 grok-3-latest 模型
  
- `AUTO_USE_LATEST_MODEL`: 設定當指定模型不可用時，是否自動使用最新可用模型
  - `True`: 自動使用最新可用模型
  - `False`: 不自動切換，返回錯誤

## API 使用方法

現在所有的 API 端點都支持指定模型，通過添加 `model` 參數來實現：

### 基本聊天 API

```json
POST /chat/

{
  "user_id": "your_user_id",
  "message": "Your message",
  "model": "grok3"  // 可選，不提供時使用 DEFAULT_MODEL
}
```

### 增強聊天 API

```json
POST /chat/enhanced/

{
  "user_id": "your_user_id",
  "numeric_user_id": 1,
  "message": "Your message",
  "model": "grok3"  // 可選，不提供時使用 DEFAULT_MODEL
}
```

### 結束聊天並生成日記

```json
POST /chat/end/

{
  "user_id": "your_user_id",
  "numeric_user_id": 1,
  "exclude_interaction_notes": false,
  "model": "grok3"  // 可選，不提供時使用 DEFAULT_MODEL
}
```

## 響應格式

所有 API 響應現在都會包含 `model_used` 字段，指示實際使用的模型：

```json
{
  "response": "AI 回應內容",
  "model_used": "grok3"
}
```

## 實用提示

1. Grok 3 模型提供更強的能力，但在某些情況下可能不如 Grok 2 穩定或可預測。
2. 如果您的應用對模型特定行為有依賴，建議指定固定的模型而不是使用默認值。
3. 在生產環境中，建議設置 `AUTO_USE_LATEST_MODEL=True` 以提高系統可用性。

## 代碼示例

### 前端 JavaScript 示例

```javascript
// 指定模型發送消息
async function sendMessageWithModel(message, model) {
  const response = await fetch('/api/chat/enhanced/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_id: currentUserId,
      numeric_user_id: numericUserId, 
      message: message,
      model: model // 指定使用 grok3 或 grok2
    })
  });
  
  const data = await response.json();
  console.log(`使用的模型: ${data.model_used}`);
  return data.response;
}
```

### 後端 Python 示例

```python
from grok_client import send_to_model, MODELS
from config import DEFAULT_MODEL

# 靈活選擇模型
def process_with_best_model(message, preferred_model=None):
    model = preferred_model or DEFAULT_MODEL
    
    # 確保模型有效
    if model not in MODELS:
        model = DEFAULT_MODEL
        
    # 使用選定的模型
    response = send_to_model([
        {"role": "system", "content": "系統提示"},
        {"role": "user", "content": message}
    ], model)
    
    return response
``` 