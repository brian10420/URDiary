"""統一的 LLM 呼叫入口。

所有服務一律經 chat(messages, cfg) 呼叫模型：
- cfg 來自請求範圍的 X-LLM-* 標頭（deps.get_llm_config），金鑰不落地
- cfg 為 None 時使用 .env 的 XAI_API_KEY 作為 Grok 後備（可選）
- 失敗一律拋 LLMError，絕不把錯誤字串當成模型輸出回傳
"""
from typing import Dict, List, Optional

from providers.base import LLMConfig, LLMError
from providers.factory import build_provider, PROVIDER_DEFAULT_MODELS, stub_llm_allowed
from config import XAI_API_KEY, FALLBACK_GROK_MODEL


def default_config() -> LLMConfig:
    """後備設定：前端未帶 LLM 標頭時，用 .env 的 Grok 金鑰。

    v2.3 task 3.2 例外（Playwright 手機 E2E 專用）：只有在「沒有 XAI_API_KEY
    可用」且 URDIARY_ALLOW_STUB_LLM=1 時，才會落到 env-gated 的 stub 供應商
    （見 providers/factory.py 的 stub_llm_allowed() 與 providers/
    stub_provider.py）。stub 的優先權嚴格低於既有的 .env Grok 後備——旗標
    開著、但真的有 XAI_API_KEY 時，行為與改動前完全相同；旗標關閉時
    （預設值）這個分支必定跳過，直接維持原本的錯誤。

    這是刻意選擇的「作為最後手段的預設值」設計，而不是讓前端顯式送
    X-LLM-Provider: stub 標頭：手機瀏覽器 / PWA 沒有 Electron 的安全儲存
    (SecureStore.isAvailable() 為 false)，api_service.js 在那個環境下整段
    跳過 X-LLM-* 標頭（見該檔案的說明），Playwright E2E 走的正是這條路徑
    ——讓 stub 在「其他都沒有」時自動生效，E2E 不需要另外改前端或碰
    KNOWN_PROVIDERS/憑證儲存。
    """
    if not XAI_API_KEY:
        if stub_llm_allowed():
            return LLMConfig(provider="stub", model="stub-e2e")
        raise LLMError(
            "未提供 LLM 供應商設定。請在前端「設定」面板選擇供應商並填入 API Key"
            "（或於 backend/.env 設定 XAI_API_KEY 作為 Grok 後備）。"
        )
    return LLMConfig(provider="grok", model=FALLBACK_GROK_MODEL, api_key=XAI_API_KEY)


def resolve_config(cfg: Optional[LLMConfig]) -> LLMConfig:
    """補齊請求設定：無設定走後備；未填模型補上該供應商預設模型。"""
    if cfg is None:
        cfg = default_config()

    if not cfg.model:
        default_model = PROVIDER_DEFAULT_MODELS.get((cfg.provider or "").strip().lower())
        if not default_model:
            raise LLMError(f"供應商 {cfg.provider!r} 需要指定模型名稱")
        cfg.model = default_model

    return cfg


def chat(messages: List[Dict[str, str]], cfg: Optional[LLMConfig] = None) -> str:
    """送出 OpenAI 風格 messages，回傳助手文字回應；失敗拋 LLMError。"""
    cfg = resolve_config(cfg)
    provider = build_provider(cfg)
    return provider.chat(messages, cfg.model)
