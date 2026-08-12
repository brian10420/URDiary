import os

from providers.base import LLMConfig, LLMProvider, LLMError
from providers.openai_provider import OpenAICompatProvider
from providers.anthropic_provider import AnthropicProvider
from providers.gemini_provider import GeminiProvider
from providers.stub_provider import StubProvider

GROK_BASE_URL = "https://api.x.ai/v1"

# build_provider 認得的供應商全集。存憑證的端點/CLI 要在寫進資料庫「之前」
# 就擋掉打錯的供應商名稱 (不然要等到真的呼叫模型才炸)，因此把這份清單從
# build_provider 的 if 串裡抽出來共用——新增供應商時兩處要一起改，放在
# 同一個檔案裡就看得到彼此。
# 注意 local 不在 PROVIDER_DEFAULT_MODELS 內 (它沒有預設模型)，所以不能
# 拿那個 dict 的鍵當成「合法供應商清單」。
KNOWN_PROVIDERS = ("claude", "openai", "grok", "gemini", "local")

# 各供應商的預設模型（模型欄位在前端可自訂，這裡只是未填時的預設值）
PROVIDER_DEFAULT_MODELS = {
    "grok": "grok-4.3",
    "openai": "gpt-5.5",
    "claude": "claude-opus-4-8",
    "gemini": "gemini-3-flash",
    # local 不設預設：模型名稱取決於使用者自架的服務
}


def stub_llm_allowed() -> bool:
    """URDIARY_ALLOW_STUB_LLM 旗標是否開啟（v2.3 task 3.2：Playwright 手機
    E2E 專用的 canned-response 供應商，見 providers/stub_provider.py）。

    呼叫當下讀 os.environ，刻意不在 import 當下綁定——與 config.py 的
    REQUIRE_INVITE / RATE_LIMIT_ENABLED 同一套模式（見該檔案兩個旗標上方的
    說明），build_provider() 才能在每次請求時反映當下的環境變數，測試也才
    能用 monkeypatch.setenv/delenv 逐案切換，不必重啟行程或重新 import。

    刻意不放進 config.py 的模組屬性：這個旗標只有 build_provider() 這一處
    會用到，混進一般設定模組會讓「正式環境會不會不小心開著」這件事變得更
    難稽核——判斷邏輯留在唯一用得到它的檔案，稽核時只需要看這裡。
    """
    return os.environ.get("URDIARY_ALLOW_STUB_LLM") == "1"


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

    if provider == "stub" and stub_llm_allowed():
        # 只服務 Playwright E2E（見 stub_llm_allowed() 與 providers/
        # stub_provider.py 檔頭的說明）。旗標關閉時 (預設值；正式環境與
        # 本測試套件其餘所有測試都是這個狀態) 這個分支必定跳過，provider
        # == "stub" 會直接落到下面「不支援的供應商」——跟任何打錯字的
        # 供應商名稱一視同仁，錯誤訊息完全相同，不多透露 stub 的存在。
        return StubProvider()

    raise LLMError(f"不支援的 LLM 供應商: {cfg.provider!r}（可用: claude / openai / grok / gemini / local）")
