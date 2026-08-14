"""語音代理路由 (v2.4 spec ②)：POST /voice/stt、POST /voice/tts。

音訊 bytes 只活在請求處理期間的記憶體，不落磁碟；上游錯誤一律經
VoiceServiceError 映射為本地化訊息（原始 body 不轉傳）。

路由刻意寫成同步 `def`（不是 `async def`）：services/voice_service.py 內部
用 httpx 的同步用戶端直呼 xAI，逾時上限到 60 秒——若宣告成 async def
又在其中直接呼叫這些同步函式，會整個卡住 FastAPI 事件迴圈，等於這數十秒
內全站其他使用者的請求都被卡住。FastAPI 對同步 `def` 路由會自動丟進
threadpool 執行，這與 api/routes/chat.py 既有的同步路由風格一致。
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel, Field

from api.deps import get_language, get_voice_api_key
from services import voice_service
from utils.api_exceptions import APIError
from utils.error_codes import ErrorCode
from utils.messages import msg

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_TTS_CHARS = 2000
_ALLOWED_AUDIO_PREFIXES = ("audio/", "video/mp4")  # iOS Safari 錄音容器是 video/mp4


class TTSIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    voice_id: Optional[str] = Field(default=None, max_length=64)


def _voice_http_error(exc: voice_service.VoiceServiceError, lang: str) -> APIError:
    """VoiceServiceError → APIError；error_code 依 status 挑最接近的既有代碼。

    504（xAI 逾時）用 SERVICE_TIMEOUT，其餘上游失敗（502，含轉寫結果為空）
    用 SERVICE_RESPONSE_ERROR——本檔沒有通用的「SERVICE_ERROR」代碼可用，
    這兩個是 utils/error_codes.py 既有代碼裡語意最接近的。
    """
    error_code = (ErrorCode.SERVICE_TIMEOUT if exc.status_code == 504
                  else ErrorCode.SERVICE_RESPONSE_ERROR)
    return APIError(status_code=exc.status_code, error_code=error_code,
                    detail=msg(exc.message_key, lang))


@router.post("/stt", response_model=Dict[str, Any], summary="語音轉文字")
def voice_stt(file: UploadFile = File(...),
             api_key: str = Depends(get_voice_api_key),
             lang: str = Depends(get_language)):
    """接收錄音檔，代呼 xAI STT 後只回傳轉寫文字。"""
    content_type = (file.content_type or "").lower()
    if not content_type.startswith(_ALLOWED_AUDIO_PREFIXES):
        raise APIError(status_code=422, error_code=ErrorCode.INVALID_INPUT,
                       detail=msg("voice_bad_audio_type", lang))

    # 同步讀（非 await file.read()）：路由是同步 def，file.file 是一般
    # SpooledTemporaryFile，讀完立刻只留在這個區域變數裡，函式結束就釋放。
    audio = file.file.read()
    if len(audio) > MAX_AUDIO_BYTES:
        raise APIError(status_code=413, error_code=ErrorCode.INVALID_INPUT,
                       detail=msg("voice_audio_too_large", lang))

    try:
        text = voice_service.speech_to_text(
            audio, file.filename or "audio", content_type,
            api_key=api_key, language=lang)
    except voice_service.VoiceServiceError as exc:
        raise _voice_http_error(exc, lang)
    return {"text": text}


@router.post("/tts", summary="文字轉語音（回 audio/mpeg）")
def voice_tts(payload: TTSIn,
             api_key: str = Depends(get_voice_api_key),
             lang: str = Depends(get_language)):
    """文字轉語音，直接回傳 mp3 bytes（前端當 Blob 播放，不落地）。"""
    try:
        audio = voice_service.text_to_speech(
            payload.text, api_key=api_key, voice_id=payload.voice_id)
    except voice_service.VoiceServiceError as exc:
        raise _voice_http_error(exc, lang)
    return Response(content=audio, media_type="audio/mpeg")
