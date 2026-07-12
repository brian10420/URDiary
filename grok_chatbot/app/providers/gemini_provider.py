from typing import List, Dict

from providers.base import LLMProvider, LLMError


class GeminiProvider(LLMProvider):
    """Gemini 官方 google-genai SDK。

    OpenAI 風格 messages 轉為 Gemini 的 contents（user/model 角色）
    + system_instruction。
    """

    def __init__(self, api_key: str):
        self.api_key = api_key

    def chat(self, messages: List[Dict[str, str]], model: str) -> str:
        # 延遲載入：沒用到 Gemini 的部署不需要裝 google-genai 也能啟動
        try:
            from google import genai
            from google.genai import types as genai_types
        except ImportError as e:
            raise LLMError(f"google-genai 套件未安裝，無法使用 Gemini: {e}") from e

        system_parts = [m["content"] for m in messages if m.get("role") == "system"]

        contents = []
        for m in messages:
            role = m.get("role")
            if role == "user":
                contents.append(genai_types.Content(
                    role="user", parts=[genai_types.Part.from_text(text=m["content"])]))
            elif role == "assistant":
                contents.append(genai_types.Content(
                    role="model", parts=[genai_types.Part.from_text(text=m["content"])]))

        config = None
        if system_parts:
            config = genai_types.GenerateContentConfig(
                system_instruction="\n\n".join(system_parts))

        try:
            client = genai.Client(api_key=self.api_key or "MISSING_API_KEY")
            response = client.models.generate_content(
                model=model, contents=contents, config=config)
        except Exception as e:
            raise LLMError(f"呼叫 Gemini API 失敗 (model={model}): {e}") from e

        text = getattr(response, "text", None)
        if not text:
            raise LLMError(f"Gemini 回應中沒有文字內容 (model={model})")
        return text
