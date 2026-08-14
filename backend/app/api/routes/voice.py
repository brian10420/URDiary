"""語音代理路由 (v2.4 spec ②)：POST /voice/stt、POST /voice/tts。

應用層絕不主動寫入音訊到任何儲存（沒有 open/write/tempfile 之類的呼叫）；
上游錯誤一律經 VoiceServiceError 映射為本地化訊息（原始 body 不轉傳）。

「不落磁碟」的實際保證範圍：Starlette 的 multipart 解析器對 >1MB 的上傳
部分（本路由接受到 25MB）會先經過一個匿名、已 unlink 的 OS 暫存檔——沒有
路徑可尋、請求結束就釋放。這裡保證的是「不持久化、不留下可被發現的檔案」，
不是字面上的「全程純 RAM」；這個範圍已滿足日記隱私的實際訴求，因此刻意
不去改寫 multipart 解析層，也不換掉 UploadFile。

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

# 錄音上傳 MIME 白名單：精確比對（集合成員資格），不是前綴/子字串比對。
# 涵蓋主流瀏覽器 MediaRecorder 常見輸出 (Chrome/Firefox audio/webm)、
# 桌面/行動 Safari (audio/mp4、iOS 錄音容器 video/mp4)，以及其餘常見音訊
# 格式。voice_stt() 比對前只取 ';' 前的基底型別 (見下方 base 正規化)，
# 因此這個集合裡不放任何帶參數的字串（如 "audio/webm;codecs=opus"）。
#
# 安全考量 (v2.4 spec② fix wave item 1 — multipart part 標頭注入)：
# services/voice_service.py 會把驗證通過的值原樣當成 httpx 呼叫 xAI 時
# 該 part 的 Content-Type 轉傳；httpx 對這個值不跳脫、Starlette 的
# multipart 解析器又能接受值裡帶裸 LF，所以 file.content_type 有可能是
# 攻擊者精心構造、帶換行的字串 (例如 "audio/webm\nX-Injected: 1")。舊版
# `.startswith(("audio/", "video/mp4"))` 前綴檢查一樣會放行這種字串
# （它確實以 "audio/" 開頭），被原封不動送進對 xAI 的請求標頭裡——等於
# 已認證使用者能在伺服器簽發、代表伺服器/使用者憑證的外送請求裡夾帶額外
# MIME 標頭列。改成「集合裡的每個值都是不含任何空白/控制字元的靜態字串
# 常量，且必須完全相等」後，任何帶換行或參數的字串都無法通過，徹底堵死
# 這條注入路徑。
_ALLOWED_AUDIO_TYPES = frozenset({
    "audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg",
    "audio/wav", "audio/x-wav", "audio/aac", "video/mp4",
})


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
    # 只取 ';' 前的基底型別、去除首尾空白後小寫——MediaRecorder 常附加
    # `;codecs=opus` 之類的參數，必須先剝掉才能跟白名單精確比對；這一步
    # 產生的 base 也是後面唯一會轉傳給 voice_service 的值，file.content_type
    # 這個原始（可能被使用者端惡意置換的）字串到此為止，不再往下游傳遞。
    base = (file.content_type or "").split(";")[0].strip().lower()
    if base not in _ALLOWED_AUDIO_TYPES:
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
            audio, file.filename or "audio", base,
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
