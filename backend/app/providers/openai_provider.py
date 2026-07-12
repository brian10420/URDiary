from typing import List, Dict, Optional
from openai import OpenAI

from providers.base import LLMProvider, LLMError


class OpenAICompatProvider(LLMProvider):
    """OpenAI 相容端點的共用實作。

    同時服務三種供應商：
    - ChatGPT 原生（不帶 base_url）
    - Grok（base_url=https://api.x.ai/v1）
    - 本地自架（base_url=使用者填，例如 Ollama http://localhost:11434/v1）
    """

    def __init__(self, api_key: str, base_url: Optional[str] = None, provider_name: str = "openai"):
        self.provider_name = provider_name
        kwargs = {"api_key": api_key or "MISSING_API_KEY"}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = OpenAI(**kwargs)

    def chat(self, messages: List[Dict[str, str]], model: str) -> str:
        try:
            completion = self.client.chat.completions.create(
                model=model,
                messages=messages,
            )
        except Exception as e:
            raise LLMError(f"呼叫 {self.provider_name} API 失敗 (model={model}): {e}") from e

        if not completion.choices:
            raise LLMError(f"{self.provider_name} 回應中沒有任何候選 (model={model})")

        content = completion.choices[0].message.content
        if content is None:
            raise LLMError(f"{self.provider_name} 回應中沒有文字內容 (model={model})")
        return content
