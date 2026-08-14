"""xAI 語音 API 代理層 (v2.4 spec ②)。

STT/TTS 是 xAI 自有 REST 端點 (非 OpenAI 相容)，用 httpx 直呼，不走
providers/ 的 chat SDK。鐵律：
- 音訊 bytes 只存在於函式參數/回傳值，絕不落磁碟
- api_key 絕不進 log、絕不出現在例外訊息
- 上游錯誤一律映射為 VoiceServiceError(message_key)，原文只留 status code
"""
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

XAI_VOICE_BASE = "https://api.x.ai/v1"
_TIMEOUT_SECONDS = 60.0  # STT 可能上傳數 MB 音檔


class VoiceServiceError(Exception):
    """語音代理失敗；status_code 給路由、message_key 查 utils/messages。"""

    def __init__(self, status_code: int, message_key: str):
        self.status_code = status_code
        self.message_key = message_key
        super().__init__(message_key)


def _post(url: str, api_key: str, *, files=None, data=None, json=None):
    """httpx.post 單點（測試在此 monkeypatch）。金鑰只進標頭，不進日誌。"""
    return httpx.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        files=files, data=data, json=json,
        timeout=_TIMEOUT_SECONDS,
    )


def _call(url: str, api_key: str, **kwargs):
    try:
        response = _post(url, api_key, **kwargs)
    except httpx.TimeoutException:
        raise VoiceServiceError(504, "voice_timeout")
    except httpx.HTTPError:
        raise VoiceServiceError(502, "voice_upstream_failed")
    if response.status_code != 200:
        # 只記狀態碼；上游 body 可能含金鑰相關細節，不記也不轉傳
        logger.warning("xAI voice upstream returned %s for %s",
                       response.status_code, url.rsplit("/", 1)[-1])
        raise VoiceServiceError(502, "voice_upstream_failed")
    return response


def speech_to_text(audio: bytes, filename: str, content_type: str,
                   api_key: str, language: str) -> str:
    """音檔 → 轉寫文字。language 提示沿用 X-Language (zh-TW → zh)。

    請求形狀已對照官方文件校對 (2026-08-15，見本檔案 Step 5 verification
    記錄於 task-1-report.md)：
    - multipart 音檔欄位固定叫 `file` (非 `audio`)
    - `language` 是裸語言碼 (BCP-47 但不帶地區碼，如 "zh"/"en")，非
      "zh-TW" 這種完整代碼——所以下面用 split("-")[0] 去掉地區碼
    - STT 沒有 `model` 欄位可填，端點固定使用單一模型
    - 回應 JSON 的轉寫文字固定在 `text` 鍵下
    """
    response = _call(
        f"{XAI_VOICE_BASE}/stt", api_key,
        files={"file": (filename, audio, content_type)},
        data={"language": (language or "zh-TW").split("-")[0]},
    )
    try:
        # xAI 回 200 不保證 body 是合法 JSON（也可能整個是空 body）；
        # response.json() 在那種情況下會丟 ValueError
        # (json.JSONDecodeError 是它的子類別)，不接住的話會原樣逃成
        # 未映射的 500，而不是這一層該給的 VoiceServiceError。上游 body
        # 不記、不轉傳，理由同 _call() 對非 200 狀態的處理。
        body = response.json() or {}
    except ValueError:
        raise VoiceServiceError(502, "voice_upstream_failed")
    text = body.get("text", "")
    if not text:
        raise VoiceServiceError(502, "voice_empty_transcript")
    return text


def text_to_speech(text: str, api_key: str, voice_id: Optional[str]) -> bytes:
    """文字 → mp3 bytes。voice_id 為 None 時交由 xAI 預設語音 (eve)。

    請求形狀已對照官方文件校對 (2026-08-15，見本檔案 Step 5 verification
    記錄於 task-1-report.md)：
    - 輸入文字欄位叫 `text` (非 brief 草稿的 `input`)
    - 語音選擇欄位叫 `voice_id` (非 `voice`)；未指定時整個欄位不送，
      xAI 端預設就是 "eve"
    - 輸出格式不是扁平的 `format` 字串，而是巢狀物件
      `output_format: {"codec": "mp3"}` (sample_rate/bit_rate 有預設值
      24kHz/128kbps，不必手動指定)
    - `language` 是必填欄位；本函式簽章沒有語言參數 (呼叫端目前不知道
      使用者語言)，固定送文件列出的合法值 "auto" 交由 xAI 自動偵測
    """
    payload = {
        "text": text,
        "language": "auto",
        "output_format": {"codec": "mp3"},
    }
    if voice_id:
        payload["voice_id"] = voice_id
    response = _call(f"{XAI_VOICE_BASE}/tts", api_key, json=payload)
    return response.content
