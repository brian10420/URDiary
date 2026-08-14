# Grok 語音整合（STT＋TTS）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聊天可用麥克風口述（xAI STT 轉寫），AI 回覆可朗讀（xAI TTS），全部經後端代理、語音一律用 xAI 金鑰。

**Architecture:** 新 `POST /voice/stt`（multipart 音檔→文字）與 `POST /voice/tts`（文字→audio/mpeg 串流）由 FastAPI 以 httpx 直呼 `https://api.x.ai/v1/{stt,tts}`；金鑰四層解析（標頭→使用者 grok 憑證→伺服器 grok 憑證→env XAI_API_KEY）。前端新 `voice_module.js`（MediaRecorder 錄音、上傳、TTS 播放與 blob 快取），語音偏好存 localStorage。

**Tech Stack:** FastAPI + httpx（openai SDK 的既有轉依賴）、MediaRecorder API、pytest / vitest。

**Spec:** `docs/superpowers/specs/2026-08-14-grok-voice-integration-design.md`

## Global Constraints

- 測試指令同計畫 ①（pytest 於 backend/、vitest 於 desktop/）
- **音訊只在記憶體處理，不落磁碟**；金鑰不寫入任何 log；上游（xAI）原始錯誤不透傳給前端
- 限制：音檔 ≤25MB（413）、TTS 文字 ≤2000 字（422）；兩路由都要 JWT
- 語音偏好 localStorage 鍵：`urDiary_voice_input_mode`（`confirm`|`fluent`，預設 confirm）、`urDiary_voice_autoread`（`1`|`0`，預設 0）、`urDiary_voice_id`（字串，預設空=供應商預設語音）
- **已知偏差（已於計畫階段查證）**：spec §4 的「日記編輯器麥克風」目前無宿主——前端沒有日記編輯 UI（diary_module.js 為唯讀檢視；後端 PUT /diary/{id} 存在但前端未接）。本計畫麥克風只落聊天輸入（URDiary 實際的日記撰寫流程即對話）；`voice_module.js` API 保持通用，未來日記編輯器出現時直接複用。**執行前向使用者確認此偏差。**
- xAI STT/TTS 為 xAI 自有端點（非 OpenAI 相容）；Task 1 的請求形狀以 docs.x.ai 現行文件為準做最終校對

---

### Task 1: voice_service（httpx 呼叫 xAI STT/TTS）

**Files:**
- Create: `backend/app/services/voice_service.py`
- Modify: `backend/app/requirements.txt`（明列 `httpx`——目前是 openai SDK 的轉依賴，改為直接依賴就要明列）
- Test: `backend/tests/test_voice_service.py`

**Interfaces:**
- Produces:
  - `voice_service.speech_to_text(audio: bytes, filename: str, content_type: str, api_key: str, language: str) -> str`（回轉寫文字；失敗拋 `VoiceServiceError(status_code, public_message_key)`）
  - `voice_service.text_to_speech(text: str, api_key: str, voice_id: str | None) -> bytes`（回 mp3 bytes）
  - `voice_service.VoiceServiceError`：`.status_code`（給路由層決定 HTTP 狀態）與 `.message_key`（utils/messages key）
- Task 3 的路由層依賴這三個名稱

- [ ] **Step 1: 寫失敗測試**（monkeypatch `voice_service._post` 單點，不打網路）

```python
"""voice_service：xAI STT/TTS 呼叫與錯誤映射（httpx 以 _post 單點隔離）。"""
import pytest


def test_stt_returns_text(monkeypatch):
    from services import voice_service

    def fake_post(url, api_key, **kwargs):
        assert url.endswith("/v1/stt")
        assert api_key == "xai-test"
        class R:
            status_code = 200
            def json(self): return {"text": "今天想寫點東西"}
            content = b""
        return R()

    monkeypatch.setattr(voice_service, "_post", fake_post)
    text = voice_service.speech_to_text(
        b"fakeaudio", "a.webm", "audio/webm", api_key="xai-test", language="zh-TW")
    assert text == "今天想寫點東西"


def test_tts_returns_audio_bytes(monkeypatch):
    from services import voice_service

    def fake_post(url, api_key, **kwargs):
        assert url.endswith("/v1/tts")
        class R:
            status_code = 200
            content = b"ID3fake-mp3"
            def json(self): return {}
        return R()

    monkeypatch.setattr(voice_service, "_post", fake_post)
    audio = voice_service.text_to_speech("你好", api_key="xai-test", voice_id=None)
    assert audio.startswith(b"ID3")


def test_upstream_error_mapped_not_leaked(monkeypatch):
    from services import voice_service

    def fake_post(url, api_key, **kwargs):
        class R:
            status_code = 401
            content = b'{"error":"invalid xai key sk-secret-detail"}'
            def json(self): return {"error": "invalid xai key sk-secret-detail"}
        return R()

    monkeypatch.setattr(voice_service, "_post", fake_post)
    with pytest.raises(voice_service.VoiceServiceError) as exc:
        voice_service.speech_to_text(b"x", "a.webm", "audio/webm",
                                     api_key="bad", language="zh-TW")
    assert exc.value.status_code == 502
    assert "sk-secret" not in str(exc.value)  # 上游細節不外洩
    assert exc.value.message_key == "voice_upstream_failed"


def test_timeout_mapped(monkeypatch):
    import httpx
    from services import voice_service

    def fake_post(url, api_key, **kwargs):
        raise httpx.TimeoutException("boom")

    monkeypatch.setattr(voice_service, "_post", fake_post)
    with pytest.raises(voice_service.VoiceServiceError) as exc:
        voice_service.text_to_speech("hi", api_key="k", voice_id=None)
    assert exc.value.status_code == 504
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_voice_service.py -v`
Expected: FAIL — module 不存在。

- [ ] **Step 3: 實作 `services/voice_service.py`**

```python
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

    請求形狀（multipart file + model/language 欄位）以 docs.x.ai 現行
    文件為最終依據——實作時開 https://docs.x.ai/developers/rest-api-reference
    校對欄位名，需要調整就連同本檔 docstring 一起更新。
    """
    response = _call(
        f"{XAI_VOICE_BASE}/stt", api_key,
        files={"file": (filename, audio, content_type)},
        data={"language": (language or "zh-TW").split("-")[0]},
    )
    text = (response.json() or {}).get("text", "")
    if not text:
        raise VoiceServiceError(502, "voice_empty_transcript")
    return text


def text_to_speech(text: str, api_key: str, voice_id: Optional[str]) -> bytes:
    """文字 → mp3 bytes。voice_id 為 None 時交由 xAI 預設語音。"""
    payload = {"input": text, "format": "mp3"}
    if voice_id:
        payload["voice"] = voice_id
    response = _call(f"{XAI_VOICE_BASE}/tts", api_key, json=payload)
    return response.content
```

`backend/app/requirements.txt` 追加一行 `httpx`（版本不釘，跟隨 openai SDK 的相容範圍）。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_voice_service.py -v`
Expected: PASS（4 項）。

- [ ] **Step 5: 對照官方文件校對請求形狀**——開 `https://docs.x.ai/docs/guides/voice` 與 REST reference，逐欄核對 `/v1/stt`（multipart 欄位名、language 值格式）與 `/v1/tts`（`input`/`voice`/`format` 欄位名）。不一致就改 `speech_to_text`/`text_to_speech` 的 payload 組裝（測試 mock 的是 `_post`，形狀改動不破壞測試；把最終形狀記回 docstring）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/voice_service.py backend/app/requirements.txt backend/tests/test_voice_service.py
git commit -m "feat(backend): voice_service——httpx 呼叫 xAI STT/TTS，錯誤映射不透傳"
```

---

### Task 2: 語音金鑰解析（get_voice_api_key）

**Files:**
- Modify: `backend/app/api/deps.py`（檔尾追加）
- Test: `backend/tests/test_voice_api.py`（新檔；本 task 先放金鑰解析測試）

**Interfaces:**
- Consumes: `llm_credential_service.resolve_stored_config(user_id) -> (Optional[LLMConfig], Optional[str])`（既有）；`config.XAI_API_KEY`
- Produces: FastAPI 依賴 `get_voice_api_key(...) -> str`（永遠回非空 xAI 金鑰，否則拋 BadRequestError `voice_key_missing`）；Task 3 路由依賴它

- [ ] **Step 1: 寫失敗測試**（直接測依賴函式，繞過 FastAPI DI 的部分用 asyncio 執行）

```python
"""voice 金鑰四層解析與 /voice 路由。"""
import asyncio

import pytest

from conftest import _create_and_login, _unique_username


def _resolve(monkeypatch, *, header_key=None, stored=None, env_key=""):
    """呼叫 deps.get_voice_api_key；stored=(provider, key) 模擬 DB 憑證層。"""
    import config as app_config
    from api import deps
    from providers.base import LLMConfig

    monkeypatch.setattr(app_config, "XAI_API_KEY", env_key)

    def fake_resolve(user_id):
        if stored is None:
            return None, None
        provider, key = stored
        return LLMConfig(provider=provider, model="", api_key=key), "user"

    import services.llm_credential_service as creds
    monkeypatch.setattr(creds, "resolve_stored_config", fake_resolve)

    class FakeUser:
        id = 1

    return asyncio.run(
        deps.get_voice_api_key(x_voice_api_key=header_key,
                               current_user=FakeUser(), lang="zh-TW"))


def test_header_key_wins(monkeypatch):
    assert _resolve(monkeypatch, header_key="xai-h",
                    stored=("grok", "xai-db"), env_key="xai-env") == "xai-h"


def test_stored_grok_credential_used(monkeypatch):
    assert _resolve(monkeypatch, stored=("grok", "xai-db")) == "xai-db"


def test_stored_non_grok_credential_skipped(monkeypatch):
    assert _resolve(monkeypatch, stored=("claude", "sk-ant"),
                    env_key="xai-env") == "xai-env"


def test_all_layers_missing_raises(monkeypatch):
    from utils.api_exceptions import BadRequestError
    with pytest.raises(BadRequestError):
        _resolve(monkeypatch)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_voice_api.py -v`
Expected: FAIL — `get_voice_api_key` 不存在。

- [ ] **Step 3: `api/deps.py` 檔尾實作**

```python
async def get_voice_api_key(
    x_voice_api_key: Optional[str] = Header(None, description="xAI 金鑰（桌面版由 secure_store 的 grok 金鑰帶上）"),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_language),
) -> str:
    """語音專用金鑰解析——語音永遠打 xAI，與聊天供應商選擇無關。

    四層（比照 get_llm_config 的層次設計，但只認 grok/xAI）：
      1. X-Voice-Api-Key 標頭（Electron 桌面）
      2. 資料庫憑證（使用者 → 伺服器預設），**僅當該列 provider == "grok"**
         ——憑證表一人一列，存的是聊天供應商；選 Claude 聊天的人沒有可用的
         grok 列，直接落到下一層，絕不拿別家金鑰打 xAI。
      3. .env 的 XAI_API_KEY
      4. 都沒有 → 400 voice_key_missing，前端引導到設定頁補 xAI 金鑰。

    與 get_llm_config 同一條鐵律：不宣告 Depends(get_db)，資料庫由
    credential service 短 session 自理。
    """
    header_key = (x_voice_api_key or "").strip()
    if header_key:
        return header_key

    from services.llm_credential_service import resolve_stored_config
    stored_config, _source = resolve_stored_config(current_user.id)
    if stored_config is not None and stored_config.provider == "grok" and stored_config.api_key:
        return stored_config.api_key

    import config as app_config
    if app_config.XAI_API_KEY:
        return app_config.XAI_API_KEY

    raise BadRequestError(error_code=ErrorCode.INVALID_INPUT,
                          detail=msg("voice_key_missing", lang))
```
（`ErrorCode`、`BadRequestError`、`msg` 檔頭已 import。）

- [ ] **Step 4: `utils/messages.py` 加 keys**（Task 3 的路由也會用到，一次加齊）

```python
    "voice_key_missing": {
        "zh-TW": "語音功能需要 xAI (Grok) 的 API Key——請到設定填入，或改用桌面版既有的 Grok 金鑰",
        "en": "Voice features need an xAI (Grok) API key — add one in Settings",
    },
    "voice_upstream_failed": {
        "zh-TW": "語音服務暫時無法使用，請稍後再試",
        "en": "The voice service is temporarily unavailable — please try again later",
    },
    "voice_timeout": {
        "zh-TW": "語音服務回應逾時，請稍後再試",
        "en": "The voice service timed out — please try again later",
    },
    "voice_empty_transcript": {
        "zh-TW": "沒有聽清楚，請再說一次",
        "en": "Couldn't catch that — please try again",
    },
    "voice_audio_too_large": {
        "zh-TW": "音檔太大（上限 25MB／約 10 分鐘）",
        "en": "Audio too large (max 25MB / ~10 minutes)",
    },
    "voice_bad_audio_type": {
        "zh-TW": "不支援的音訊格式",
        "en": "Unsupported audio format",
    },
    "voice_text_too_long": {
        "zh-TW": "朗讀文字過長（上限 2000 字）",
        "en": "Text too long to read aloud (max 2000 characters)",
    },
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_voice_api.py -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/deps.py backend/app/utils/messages.py backend/tests/test_voice_api.py
git commit -m "feat(backend): get_voice_api_key 四層 xAI 金鑰解析＋語音訊息字串"
```

---

### Task 3: /voice/stt 與 /voice/tts 路由

**Files:**
- Create: `backend/app/api/routes/voice.py`
- Modify: 路由匯集處——`grep -n "api_router" backend/app/api/__init__.py backend/app/api/routes/__init__.py` 找到既有 include 清單（main.py:108 只掛 `api_router`），比照 calendar router 的掛法加入
- Test: `backend/tests/test_voice_api.py`（追加路由測試）

**Interfaces:**
- Consumes: `voice_service.speech_to_text/text_to_speech/VoiceServiceError`（Task 1）、`get_voice_api_key`（Task 2）、`get_language`
- Produces: `POST /voice/stt`（multipart `file`；200 → `{"text": "..."}`）；`POST /voice/tts`（JSON `{"text": str, "voice_id": str|null}`；200 → `audio/mpeg` bytes）。前端 Task 5/6 依賴這兩個形狀

- [ ] **Step 1: 追加失敗測試**

```python
LLM_AUDIO = b"\x1aE\xdf\xa3fake-webm-bytes"


def _voice_headers(client):
    headers, _ = _create_and_login(client, _unique_username())
    headers["X-Voice-Api-Key"] = "xai-test"
    return headers


def test_stt_requires_auth(client):
    resp = client.post("/voice/stt", files={"file": ("a.webm", LLM_AUDIO, "audio/webm")})
    assert resp.status_code == 401


def test_stt_roundtrip(client, monkeypatch):
    import services.voice_service as vs
    monkeypatch.setattr(vs, "speech_to_text",
                        lambda audio, filename, content_type, api_key, language: "轉寫結果")
    resp = client.post("/voice/stt", headers=_voice_headers(client),
                       files={"file": ("a.webm", LLM_AUDIO, "audio/webm")})
    assert resp.status_code == 200
    assert resp.json()["text"] == "轉寫結果"


def test_stt_rejects_oversize(client):
    big = b"0" * (25 * 1024 * 1024 + 1)
    resp = client.post("/voice/stt", headers=_voice_headers(client),
                       files={"file": ("a.webm", big, "audio/webm")})
    assert resp.status_code == 413


def test_stt_rejects_non_audio_mime(client):
    resp = client.post("/voice/stt", headers=_voice_headers(client),
                       files={"file": ("a.txt", b"hello", "text/plain")})
    assert resp.status_code == 422


def test_tts_roundtrip(client, monkeypatch):
    import services.voice_service as vs
    monkeypatch.setattr(vs, "text_to_speech",
                        lambda text, api_key, voice_id: b"ID3mp3bytes")
    resp = client.post("/voice/tts", headers=_voice_headers(client),
                       json={"text": "你好", "voice_id": None})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/mpeg")
    assert resp.content == b"ID3mp3bytes"


def test_tts_rejects_long_text(client):
    resp = client.post("/voice/tts", headers=_voice_headers(client),
                       json={"text": "字" * 2001})
    assert resp.status_code == 422


def test_upstream_error_becomes_502_with_localized_message(client, monkeypatch):
    import services.voice_service as vs

    def boom(text, api_key, voice_id):
        raise vs.VoiceServiceError(502, "voice_upstream_failed")

    monkeypatch.setattr(vs, "text_to_speech", boom)
    resp = client.post("/voice/tts", headers=_voice_headers(client),
                       json={"text": "你好"})
    assert resp.status_code == 502
    assert "語音服務" in resp.json()["detail"]
```

- [ ] **Step 2: 跑測試確認失敗**（404）

- [ ] **Step 3: 實作 `api/routes/voice.py`**

```python
"""語音代理路由 (v2.4 spec ②)：POST /voice/stt、POST /voice/tts。

音訊 bytes 只活在請求處理期間的記憶體，不落磁碟；上游錯誤一律經
VoiceServiceError 映射為本地化訊息（原始 body 不轉傳）。
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Response, UploadFile, File
from pydantic import BaseModel, Field

from api.deps import get_language, get_voice_api_key
from services import voice_service
from utils.api_exceptions import ApiError  # 若專案例外基底名不同，比照 utils/api_exceptions.py 現況
from utils.error_codes import ErrorCode
from utils.messages import msg

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_TTS_CHARS = 2000
_ALLOWED_AUDIO_PREFIXES = ("audio/", "video/mp4")  # iOS Safari 錄音容器是 video/mp4


class TTSIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    voice_id: Optional[str] = Field(default=None, max_length=64)


def _voice_http_error(exc: voice_service.VoiceServiceError, lang: str):
    return ApiError(status_code=exc.status_code, error_code=ErrorCode.SERVICE_ERROR,
                    detail=msg(exc.message_key, lang))


@router.post("/stt", response_model=Dict[str, Any], summary="語音轉文字")
async def voice_stt(file: UploadFile = File(...),
                    api_key: str = Depends(get_voice_api_key),
                    lang: str = Depends(get_language)):
    content_type = (file.content_type or "").lower()
    if not content_type.startswith(_ALLOWED_AUDIO_PREFIXES):
        raise ApiError(status_code=422, error_code=ErrorCode.INVALID_INPUT,
                       detail=msg("voice_bad_audio_type", lang))
    audio = await file.read()
    if len(audio) > MAX_AUDIO_BYTES:
        raise ApiError(status_code=413, error_code=ErrorCode.INVALID_INPUT,
                       detail=msg("voice_audio_too_large", lang))
    try:
        text = voice_service.speech_to_text(
            audio, file.filename or "audio", content_type,
            api_key=api_key, language=lang)
    except voice_service.VoiceServiceError as exc:
        raise _voice_http_error(exc, lang)
    return {"text": text}


@router.post("/tts", summary="文字轉語音（回 audio/mpeg）")
async def voice_tts(payload: TTSIn,
                    api_key: str = Depends(get_voice_api_key),
                    lang: str = Depends(get_language)):
    try:
        audio = voice_service.text_to_speech(
            payload.text, api_key=api_key, voice_id=payload.voice_id)
    except voice_service.VoiceServiceError as exc:
        raise _voice_http_error(exc, lang)
    return Response(content=audio, media_type="audio/mpeg")
```

**現場對齊（實作時必查，不得跳過）**：本專案例外類別與 error code 名稱以 `backend/app/utils/api_exceptions.py`／`utils/error_codes.py` 現況為準——若沒有通用 `ApiError(status_code=…)`，就比照該檔既有類別（如 BadRequestError）新增一個可帶任意 status 的子類，413/502/504 用它；`exception_handlers.py` 是唯一例外→JSON 出口，確認新例外走同一條路。路由掛載比照 calendar router 在同一個彙整檔加 `include_router`。

- [ ] **Step 4: 跑測試確認通過＋全套件回歸**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_voice_api.py -v && ../.venv/bin/python -m pytest -q`
Expected: 全 PASS。

- [ ] **Step 5: smoke_test.sh 加兩項**（無金鑰路徑；比照該腳本既有 curl 斷言寫法）：未登入 `POST /voice/stt` → 401；登入後無任何金鑰層 `POST /voice/tts` → 400。

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/voice.py backend/app/api backend/tests/test_voice_api.py backend/tests/smoke_test.sh
git commit -m "feat(backend): /voice/stt 與 /voice/tts 代理路由（JWT、限流上限、錯誤本地化）"
```

---

### Task 4: 前端 voice_module.js

**Files:**
- Create: `desktop/js/voice_module.js`
- Modify: `desktop/index.html`（`<script src="js/voice_module.js">` 加在 api_service.js 之後、chat_module.js 之前）
- Test: `desktop/tests/voice_module.test.js`

**Interfaces:**
- Consumes: `ApiService.fetchAPI`／`CONFIG.getApiBaseUrl()`（既有）；`POST /voice/stt`、`POST /voice/tts`（Task 3 形狀）
- Produces: `VoiceModule`（IIFE，`const VoiceModule = (function(){...})();`）：
  - `isSupported() -> bool`（MediaRecorder 與 getUserMedia 可用性）
  - `startRecording() -> Promise<void>`、`stopRecording() -> Promise<{text: string}>`（stop 內上傳 STT 並回轉寫）
  - `speak(messageId: string, text: string) -> Promise<void>`（TTS 播放；同 id 用 blob 快取不重打）
  - `stopSpeaking() -> void`
  - `getInputMode() -> 'confirm'|'fluent'`、`setInputMode(mode)`、`isAutoRead() -> bool`、`setAutoRead(on)`、`getVoiceId()/setVoiceId(id)`（localStorage 封裝）
  - `_test: { pickMimeType, cacheSize }`

- [ ] **Step 1: 寫失敗測試**

```javascript
/** VoiceModule：mime 選擇、偏好存取、TTS blob 快取。 */
const { loadScript } = require('./helpers/load.js');

describe('VoiceModule', () => {
    beforeEach(() => {
        localStorage.clear();
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/voice_module.js');
    });

    test('偏好預設值：confirm 模式、自動朗讀關', () => {
        expect(VoiceModule.getInputMode()).toBe('confirm');
        expect(VoiceModule.isAutoRead()).toBe(false);
    });

    test('偏好寫入 localStorage 指定鍵', () => {
        VoiceModule.setInputMode('fluent');
        VoiceModule.setAutoRead(true);
        VoiceModule.setVoiceId('ara');
        expect(localStorage.getItem('urDiary_voice_input_mode')).toBe('fluent');
        expect(localStorage.getItem('urDiary_voice_autoread')).toBe('1');
        expect(localStorage.getItem('urDiary_voice_id')).toBe('ara');
    });

    test('pickMimeType 依支援度回退（webm → mp4）', () => {
        const canWebm = { isTypeSupported: (t) => t.startsWith('audio/webm') };
        const onlyMp4 = { isTypeSupported: (t) => t === 'audio/mp4' };
        expect(VoiceModule._test.pickMimeType(canWebm)).toBe('audio/webm');
        expect(VoiceModule._test.pickMimeType(onlyMp4)).toBe('audio/mp4');
        expect(VoiceModule._test.pickMimeType({ isTypeSupported: () => false })).toBe('');
    });

    test('speak 以 messageId 快取 blob（同 id 第二次不再 fetch）', async () => {
        let fetches = 0;
        global.ApiService = { fetchRaw: async () => { fetches += 1;
            return new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }); } };
        global.Audio = class { play() { return Promise.resolve(); } pause() {} };
        global.URL.createObjectURL = () => 'blob:x';
        await VoiceModule.speak('m1', '你好');
        await VoiceModule.speak('m1', '你好');
        expect(fetches).toBe(1);
        expect(VoiceModule._test.cacheSize()).toBe(1);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/voice_module.test.js`
Expected: FAIL

- [ ] **Step 3: 實作 `js/voice_module.js`**

```javascript
/**
 * VoiceModule (v2.4 spec ②)：錄音 → /voice/stt 轉寫；/voice/tts 朗讀。
 *
 * - MediaRecorder mime 依環境回退：Chrome/Electron audio/webm，iOS Safari
 *   只支援 audio/mp4（PWA 重點路徑）。
 * - TTS 以 messageId 快取 blob：同一則重播不重新計費。
 * - 偏好存 localStorage（比照語言/語意記憶開關慣例，零後端 schema）：
 *   urDiary_voice_input_mode / urDiary_voice_autoread / urDiary_voice_id
 * - 音訊 blob 只活在記憶體，不進 localStorage、不落任何儲存。
 */
const VoiceModule = (function () {
    const KEY_MODE = 'urDiary_voice_input_mode';
    const KEY_AUTOREAD = 'urDiary_voice_autoread';
    const KEY_VOICE = 'urDiary_voice_id';

    let mediaRecorder = null;
    let chunks = [];
    let currentAudio = null;
    const ttsCache = new Map(); // messageId -> objectURL

    function isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
            && typeof MediaRecorder !== 'undefined');
    }

    function pickMimeType(recorderClass) {
        const RC = recorderClass || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
        if (!RC || !RC.isTypeSupported) return '';
        if (RC.isTypeSupported('audio/webm')) return 'audio/webm';
        if (RC.isTypeSupported('audio/mp4')) return 'audio/mp4';   // iOS Safari
        return ''; // 交給瀏覽器預設
    }

    async function startRecording() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mimeType = pickMimeType();
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType })
                                 : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mediaRecorder.start();
    }

    function stopRecording() {
        return new Promise((resolve, reject) => {
            if (!mediaRecorder) { reject(new Error('not-recording')); return; }
            const recorder = mediaRecorder;
            mediaRecorder = null;
            recorder.onstop = async () => {
                recorder.stream.getTracks().forEach((t) => t.stop());
                try {
                    const type = recorder.mimeType || 'audio/webm';
                    const blob = new Blob(chunks, { type });
                    const ext = type.includes('mp4') ? 'm4a' : 'webm';
                    const form = new FormData();
                    form.append('file', blob, `voice.${ext}`);
                    const data = await ApiService.fetchAPI('/voice/stt',
                        { method: 'POST', body: form });
                    resolve({ text: data.text || '' });
                } catch (err) { reject(err); }
            };
            recorder.stop();
        });
    }

    async function speak(messageId, text) {
        stopSpeaking();
        let url = ttsCache.get(messageId);
        if (!url) {
            const blob = await ApiService.fetchRaw('/voice/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice_id: getVoiceId() || null }),
            });
            url = URL.createObjectURL(blob);
            ttsCache.set(messageId, url);
        }
        currentAudio = new Audio(url);
        await currentAudio.play();
    }

    function stopSpeaking() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }

    function getInputMode() { return localStorage.getItem(KEY_MODE) === 'fluent' ? 'fluent' : 'confirm'; }
    function setInputMode(mode) { localStorage.setItem(KEY_MODE, mode === 'fluent' ? 'fluent' : 'confirm'); }
    function isAutoRead() { return localStorage.getItem(KEY_AUTOREAD) === '1'; }
    function setAutoRead(on) { localStorage.setItem(KEY_AUTOREAD, on ? '1' : '0'); }
    function getVoiceId() { return localStorage.getItem(KEY_VOICE) || ''; }
    function setVoiceId(id) { localStorage.setItem(KEY_VOICE, id || ''); }

    return {
        isSupported, startRecording, stopRecording,
        speak, stopSpeaking,
        getInputMode, setInputMode, isAutoRead, setAutoRead, getVoiceId, setVoiceId,
        _test: { pickMimeType, cacheSize: () => ttsCache.size },
    };
})();

if (typeof window !== 'undefined') { window.VoiceModule = VoiceModule; }
```

**現場對齊**：`ApiService.fetchRaw`（回 Blob 的變體）若不存在，就在 `api_service.js` 比照 `fetchAPI` 加一個回 `response.blob()` 的 `fetchRaw(endpoint, options)`（共用同一套 token/base-url/401 邏輯）；FormData 上傳時**不得**手動設 Content-Type（瀏覽器需自帶 boundary），確認 fetchAPI 不會強制蓋 JSON Content-Type——會的話在 options 加旗標跳過。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/voice_module.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add desktop/js/voice_module.js desktop/index.html desktop/tests/voice_module.test.js
git commit -m "feat(desktop): VoiceModule——錄音上傳 STT、TTS 播放與快取、偏好封裝"
```

---

### Task 5: 聊天 UI 接線（麥克風鍵＋播放鍵＋自動朗讀＋金鑰標頭）

**Files:**
- Modify: `desktop/index.html:331-338`（chat-input-wrapper 加麥克風鍵）
- Modify: `desktop/js/chat_module.js`（錄音流程、TTS 鍵、自動朗讀）
- Modify: `desktop/js/api_service.js`（voice 端點帶 `X-Voice-Api-Key`）
- Modify: `desktop/js/i18n.js`、`desktop/css/chat.css`、`desktop/css/mobile.css`
- Test: `desktop/tests/chat_voice.test.js`

**Interfaces:**
- Consumes: `VoiceModule`（Task 4 全部 API）；`SecureStore.getKey('grok')`（既有）
- Produces: 無新對外介面（純 UI 接線）

- [ ] **Step 1: 寫失敗測試**（測可單元化的兩段：模式分流與自動朗讀判斷）

```javascript
/** 聊天語音接線：confirm/fluent 分流、自動朗讀觸發。 */
const { loadScript } = require('./helpers/load.js');

describe('chat voice wiring', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<textarea id="user-input"></textarea>';
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/voice_module.js');
        loadScript('js/chat_module.js');   // 若 chat_module 需其他全域 stub，比照 tests/chat_helpers.test.js 現有 beforeEach 補齊
    });

    test('confirm 模式：轉寫填入輸入框不送出', () => {
        const sent = [];
        ChatModule._test.handleTranscript('今天有點累', {
            mode: 'confirm', send: (t) => sent.push(t) });
        expect(document.getElementById('user-input').value).toBe('今天有點累');
        expect(sent).toEqual([]);
    });

    test('fluent 模式：直接送出', () => {
        const sent = [];
        ChatModule._test.handleTranscript('今天有點累', {
            mode: 'fluent', send: (t) => sent.push(t) });
        expect(sent).toEqual(['今天有點累']);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: UI 與實作**

index.html 的 chat-input-wrapper（textarea 之前）加：
```html
                            <button id="mic-button" class="icon-btn" title="語音輸入" data-i18n-title="voice.micTitle" style="display:none;">
                                <i class="fa fa-microphone"></i>
                            </button>
```
chat_module.js：

```javascript
    let recording = false;

    function handleTranscript(text, opts) {
        const mode = (opts && opts.mode) || VoiceModule.getInputMode();
        const send = (opts && opts.send) || ((t) => { userInputEl().value = t; sendMessage(); });
        if (!text) return;
        if (mode === 'fluent') { send(text); return; }
        const input = userInputEl();
        input.value = text;   // confirm 模式：進輸入框，使用者按送出
        input.focus();
    }

    function userInputEl() { return document.getElementById('user-input'); }

    async function toggleMic() {
        const btn = document.getElementById('mic-button');
        if (!recording) {
            try { await VoiceModule.startRecording(); }
            catch (e) { addSystemMessage(I18N.t('voice.micDenied')); return; }
            recording = true;
            btn.classList.add('recording');
        } else {
            recording = false;
            btn.classList.remove('recording');
            btn.disabled = true;
            try {
                const { text } = await VoiceModule.stopRecording();
                handleTranscript(text, {});
            } catch (e) {
                addSystemMessage((e && e.message) || I18N.t('voice.sttFailed'));
            } finally { btn.disabled = false; }
        }
    }
```
接線於 `init()`：`if (VoiceModule.isSupported()) { micBtn.style.display=''; micBtn.addEventListener('click', toggleMic); }`。

TTS：`buildMessageHtml`（chat_module.js:620）為 assistant 訊息加播放鍵（`options.messageId` 沒有就用遞增計數器），bubble HTML 後附 `<button class="tts-play" data-mid="…" title="…"><i class="fa fa-volume-up"></i></button>`；`appendChatMessage` 綁 click → `VoiceModule.speak(mid, 純文字內容)`（用既有訊息原文變數，不重抽 DOM 文字）。自動朗讀：assistant 訊息 append 後 `if (VoiceModule.isAutoRead()) VoiceModule.speak(mid, content)`。模組 return 加 `_test: { handleTranscript }`。

api_service.js：在 X-LLM-\* 區塊（:508）之後，比照同款模式加：

```javascript
            // 語音端點永遠用 xAI 金鑰（v2.4 spec ②）；僅桌面（有 secure store）帶標頭，
            // PWA 走後端 DB 憑證/env 後備。
            if (hasSecureStore && endpoint.startsWith('/voice/')) {
                const grokKey = SecureStore.getKey('grok');
                if (grokKey) fetchOptions.headers['X-Voice-Api-Key'] = grokKey;
            }
```

css/chat.css：`#mic-button.recording i { color: #e34948; animation: mic-pulse 1s infinite; } @keyframes mic-pulse { 50% { opacity: .4; } }`；`.tts-play` 比照既有 icon-btn 尺寸；mobile.css 確認輸入列三鍵在 768px 下不換行（`.chat-input-wrapper { gap: 6px; }` 視現況）。

i18n 兩語：`'voice.micTitle': '語音輸入' / 'Voice input'`、`'voice.micDenied': '無法取得麥克風權限——請到瀏覽器/系統設定允許' / 'Microphone permission denied — allow it in browser/system settings'`、`'voice.sttFailed': '轉寫失敗，請再試一次' / 'Transcription failed — please try again'`、`'voice.playTitle': '朗讀這則回覆' / 'Read this reply aloud'`。

- [ ] **Step 4: 跑測試確認通過＋vitest 全綠**

Run: `cd /home/e604/Brian/URDiary/desktop && npm test`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add desktop/index.html desktop/js/chat_module.js desktop/js/api_service.js desktop/js/i18n.js desktop/css/chat.css desktop/css/mobile.css desktop/tests/chat_voice.test.js
git commit -m "feat(desktop): 聊天麥克風（confirm/fluent 雙模式）＋回覆朗讀鍵與自動朗讀"
```

---

### Task 6: 設定頁「語音」卡片

**Files:**
- Modify: `desktop/index.html`（settings-dialog，陪伴者卡片之後）
- Modify: `desktop/js/settings_module.js`
- Modify: `desktop/js/i18n.js`
- Test: `desktop/tests/voice_settings.test.js`

**Interfaces:**
- Consumes: `VoiceModule` 偏好 API（Task 4）

- [ ] **Step 1: 寫失敗測試**

```javascript
const { loadScript } = require('./helpers/load.js');

describe('voice settings card', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = `
            <select id="voice-input-mode"><option value="confirm">c</option><option value="fluent">f</option></select>
            <input type="checkbox" id="voice-autoread">
            <input id="voice-id">`;
        global.CONFIG = { getApiBaseUrl: () => 'http://x' };
        loadScript('js/voice_module.js');
        loadScript('js/settings_module.js');
    });

    test('load 回填三欄、save 寫回 VoiceModule', () => {
        VoiceModule.setInputMode('fluent'); VoiceModule.setAutoRead(true);
        SettingsModule._test.loadVoicePrefs();
        expect(document.getElementById('voice-input-mode').value).toBe('fluent');
        expect(document.getElementById('voice-autoread').checked).toBe(true);
        document.getElementById('voice-input-mode').value = 'confirm';
        document.getElementById('voice-autoread').checked = false;
        document.getElementById('voice-id').value = 'ara';
        SettingsModule._test.saveVoicePrefs();
        expect(VoiceModule.getInputMode()).toBe('confirm');
        expect(VoiceModule.isAutoRead()).toBe(false);
        expect(VoiceModule.getVoiceId()).toBe('ara');
    });
});
```

- [ ] **Step 2: 確認失敗 → Step 3: 實作**——index.html 卡片：

```html
                    <hr style="margin: 14px 0;">
                    <h4 data-i18n="voice.sectionTitle">語音</h4>
                    <div class="form-group">
                        <label for="voice-input-mode" data-i18n="voice.inputMode">語音輸入模式</label>
                        <select id="voice-input-mode" class="form-control">
                            <option value="confirm" data-i18n="voice.modeConfirm">確認後送出（轉寫先進輸入框）</option>
                            <option value="fluent" data-i18n="voice.modeFluent">流暢直送（轉寫完直接送出）</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" id="voice-autoread" style="width:auto;">
                            <span data-i18n="voice.autoread">自動朗讀新回覆</span>
                        </label>
                    </div>
                    <div class="form-group">
                        <label for="voice-id" data-i18n="voice.voiceId">朗讀語音（進階，留空＝預設）</label>
                        <input type="text" id="voice-id" class="form-control" maxlength="64" placeholder="">
                        <small style="display:block;margin-top:4px;color:#888;" data-i18n="voice.keyNote">語音功能使用 xAI (Grok) 金鑰——桌面版用已存的 Grok 金鑰；手機版需在伺服器端存 Grok 憑證。</small>
                    </div>
```
settings_module.js：`loadVoicePrefs()`（openDialog 時呼叫）與 `saveVoicePrefs()`（settings-save handler 尾端呼叫），實作即測試所示三欄 get/set；`_test` 匯出兩函式。i18n 兩語：`voice.sectionTitle`＝語音/Voice、`voice.inputMode`＝語音輸入模式/Voice input mode、`voice.modeConfirm`＝確認後送出（轉寫先進輸入框）/Review before send、`voice.modeFluent`＝流暢直送（轉寫完直接送出）/Send immediately、`voice.autoread`＝自動朗讀新回覆/Auto-read new replies、`voice.voiceId`＝朗讀語音（進階，留空＝預設）/Voice (advanced, empty = default)、`voice.keyNote`＝上文/"Voice features use your xAI (Grok) key — desktop uses the stored Grok key; on mobile store a Grok credential server-side."

- [ ] **Step 4: `npm test` 全綠 → Step 5: Commit**

```bash
git add desktop/index.html desktop/js/settings_module.js desktop/js/i18n.js desktop/tests/voice_settings.test.js
git commit -m "feat(desktop): 設定頁語音卡片（輸入模式/自動朗讀/語音選擇）"
```

---

### Task 7: 安全驗證與實機驗收

**Files:**
- 驗證為主；發現問題就地修

- [ ] **Step 1: 金鑰不落 log 驗證**

```bash
grep -rn "api_key" backend/app/services/voice_service.py backend/app/api/routes/voice.py | grep -i "log\|print"
```
Expected: 空輸出。

- [ ] **Step 2: 音訊不落地驗證**

```bash
grep -rn "open(\|write(\|tempfile\|NamedTemporary" backend/app/services/voice_service.py backend/app/api/routes/voice.py
```
Expected: 空輸出。

- [ ] **Step 3: 全套件回歸**——backend pytest -q ＋ desktop npm test ＋ `bash backend/tests/smoke_test.sh`（需先起 server）全綠。
- [ ] **Step 4: 跑 `/security-review`**（Claude Code 技能）掃本分支變更，修完所有 confirmed 項。
- [ ] **Step 5: 實機驗收清單（交使用者，用真 xAI 金鑰）**
  - 桌面 Electron：錄音→轉寫進輸入框（confirm）；切 fluent 直送；播放鍵出聲；自動朗讀開關生效；同一則重播不重新請求（DevTools Network 確認）
  - 手機 PWA（HTTPS）：iOS Safari 錄音（mp4 路徑）與 Android Chrome 各一輪；無 grok 憑證時出現引導訊息
  - 拒絕麥克風權限 → 出現雙語提示不崩潰
- [ ] **Step 6: Commit（如有修正）**

```bash
git add -A && git commit -m "fix(voice): 安全驗證與實機修正波"
```

---

## Self-Review 紀錄

- Spec 覆蓋：§3 路由/金鑰/防護（Task 1-3）、§4 前端 UX（Task 4-6；日記編輯器偏差已在 Global Constraints 註明並要求執行前確認）、§5 測試（各 task＋Task 7）、§6 費用（無程式）、§7 檔案清單全數對應。
- 型別一致：`VoiceServiceError(status_code, message_key)` 貫穿 Task 1/3；`/voice/stt → {text}`、`/voice/tts → audio/mpeg` 貫穿 Task 3/4/5；localStorage 三鍵名貫穿 Task 4/6 與 Global Constraints。
- 現場變異點（不影響介面）：例外基底類名（utils/api_exceptions.py 為準）、router 彙整檔位置、`ApiService.fetchRaw` 是否需新增、xAI 端點欄位名最終以官方文件校對（Task 1 Step 5）。
