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

    api_key 來自前端 X-LLM-* 標頭（本機 safeStorage 解密後隨請求送來），
    只存在於請求生命週期，不寫入資料庫、不落地、不記入日誌。
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
