from providers.base import LLMConfig, LLMProvider, LLMError
from providers.openai_provider import OpenAICompatProvider
from providers.anthropic_provider import AnthropicProvider
from providers.gemini_provider import GeminiProvider

GROK_BASE_URL = "https://api.x.ai/v1"

# 各供應商的預設模型（模型欄位在前端可自訂，這裡只是未填時的預設值）
PROVIDER_DEFAULT_MODELS = {
    "grok": "grok-4.3",
    "openai": "gpt-5.5",
    "claude": "claude-opus-4-8",
    "gemini": "gemini-3-flash",
    # local 不設預設：模型名稱取決於使用者自架的服務
}


def build_provider(cfg: LLMConfig) -> LLMProvider:
    """依請求範圍的 LLMConfig 建構供應商實例（金鑰只在此注入，不落地）。"""
    provider = (cfg.provider or "").strip().lower()

    if provider == "claude":
        return AnthropicProvider(api_key=cfg.api_key)

    if provider == "gemini":
        return GeminiProvider(api_key=cfg.api_key)

    if provider == "openai":
        return OpenAICompatProvider(
            api_key=cfg.api_key, base_url=cfg.base_url, provider_name="openai")

    if provider == "grok":
        return OpenAICompatProvider(
            api_key=cfg.api_key,
            base_url=cfg.base_url or GROK_BASE_URL,
            provider_name="grok")

    if provider == "local":
        if not cfg.base_url:
            raise LLMError("本地供應商需要 Base URL（例如 http://localhost:11434/v1）")
        # 本地端點（Ollama/LM Studio）通常不驗金鑰，但 SDK 要求非空
        return OpenAICompatProvider(
            api_key=cfg.api_key or "not-needed",
            base_url=cfg.base_url,
            provider_name="local")

    raise LLMError(f"不支援的 LLM 供應商: {cfg.provider!r}（可用: claude / openai / grok / gemini / local）")
