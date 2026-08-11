from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Optional


class LLMError(RuntimeError):
    """LLM 供應商呼叫失敗。

    重要：絕不可把錯誤訊息當成模型輸出回傳。呼叫端會把「模型輸出」直接寫進
    diaries.content 與 interaction_notes.content，而互動筆記又會被注入到之後
    每一次對話的 system prompt。若把 "Error: ..." 當成正常輸出，等於把 API
    錯誤永久寫進使用者的日記並污染所有後續對話 —— 必須拋例外，讓路由回 5xx。
    """


@dataclass
class LLMConfig:
    """單一請求範圍的 LLM 設定。

    api_key 有三種來源 (v2.3 task 1.6 之後；解析順序見 api/deps.get_llm_config)：

    1. 前端 X-LLM-* 標頭 —— Electron 桌面版從系統金鑰鏈 (safeStorage) 解密後
       隨請求送來，只存在於請求生命週期，不寫入資料庫。
    2. 這台伺服器上該使用者存的憑證 (llm_credentials)。
    3. 伺服器預設憑證 (同一張表，user_id IS NULL) 或 .env 的 XAI_API_KEY。

    後兩者在資料庫裡是 Fernet 密文 (utils/key_vault，加密金鑰由 SECRET_KEY
    導出)，不是明文。無論來源為何，解密後的金鑰都只活在這個 LLMConfig 物件
    裡，**不記入日誌**，也只會送往 provider 欄位指定的那家供應商。
    """
    provider: str                 # claude | openai | grok | gemini | local
    model: str = ""               # 空字串時由 llm.chat 補上該供應商的預設模型
    api_key: str = ""
    base_url: Optional[str] = None  # local / 自訂端點使用


class LLMProvider(ABC):
    """統一介面：收 OpenAI 風格 messages，回傳助手的文字回應。"""

    @abstractmethod
    def chat(self, messages: List[Dict[str, str]], model: str) -> str:
        """失敗時拋 LLMError，絕不回傳錯誤字串。"""
