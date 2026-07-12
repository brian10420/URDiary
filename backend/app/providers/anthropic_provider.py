from typing import List, Dict
import anthropic

from providers.base import LLMProvider, LLMError


class AnthropicProvider(LLMProvider):
    """Claude 官方 SDK（Messages API）。

    OpenAI 風格 messages 的 system 訊息抽出成 system= 參數，
    其餘 user/assistant 傳 messages=。保持精簡（不強設 thinking 等參數），
    避免特定模型 400。
    """

    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key or "MISSING_API_KEY")

    def chat(self, messages: List[Dict[str, str]], model: str) -> str:
        system_parts = [m["content"] for m in messages if m.get("role") == "system"]
        chat_messages = [
            {"role": m["role"], "content": m["content"]}
            for m in messages if m.get("role") in ("user", "assistant")
        ]

        kwargs = {
            "model": model,
            "max_tokens": 4096,
            "messages": chat_messages,
        }
        if system_parts:
            kwargs["system"] = "\n\n".join(system_parts)

        try:
            response = self.client.messages.create(**kwargs)
        except Exception as e:
            raise LLMError(f"呼叫 Claude API 失敗 (model={model}): {e}") from e

        text = "".join(
            block.text for block in response.content
            if getattr(block, "type", "") == "text"
        )
        if not text:
            raise LLMError(f"Claude 回應中沒有文字內容 (model={model})")
        return text
