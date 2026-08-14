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


# --- /voice/stt、/voice/tts 路由 ---------------------------------------------

LLM_AUDIO = b"\x1aE\xdf\xa3fake-webm-bytes"


def _voice_headers(client):
    headers, _ = _create_and_login(client, _unique_username())
    headers["X-Voice-Api-Key"] = "xai-test"
    return headers


def test_stt_requires_auth(client):
    resp = client.post("/voice/stt", files={"file": ("a.webm", LLM_AUDIO, "audio/webm")})
    assert resp.status_code == 401


def test_stt_cors_preflight_allows_voice_api_key_header(client):
    """v2.4 fix wave item 4：跨來源 (cross-origin) PWA 對 /voice/stt 送出
    preflight 時，Access-Control-Request-Headers 帶 X-Voice-Api-Key 必須
    被 CORSMiddleware 放行——這是 fail-closed 的行為，沒放行不是「這個
    標頭被忽略」，是瀏覽器直接擋下 preflight、正式請求根本送不出去。"""
    resp = client.options(
        "/voice/stt",
        headers={
            "Origin": "http://localhost:3000",  # config.py default_origins 之一
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Voice-Api-Key",
        },
    )
    assert resp.status_code == 200
    assert "X-Voice-Api-Key" in resp.headers.get("access-control-allow-headers", "")


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


# --- 安全回歸測試 (v2.4 fix wave item 1)：multipart part 標頭注入 -------------
#
# 舊版檢查是 content_type.startswith(("audio/", "video/mp4"))（前綴比對）。
# services/voice_service.py 會把驗證通過的值原樣當成 httpx 呼叫 xAI 時該
# part 的 Content-Type 轉傳；httpx 的 multipart 編碼器不會跳脫這個值，
# Starlette 的 multipart 解析器又能接受值裡帶裸 LF，所以只要前綴符合
# "audio/"，帶換行的惡意字串一樣會通過舊版檢查、被原封不動送進對 xAI 的
# 外送請求標頭裡。改成 api/routes/voice.py 的精確白名單 (_ALLOWED_AUDIO_TYPES)
# 後，這兩個情境都必須驗證：真實瀏覽器常見的 `;codecs=...` 參數不能被
# 誤擋（否則整個語音輸入功能會壞掉），惡意換行字串則必須被擋。

def test_stt_accepts_codecs_param_and_strips_to_base_before_forwarding(client, monkeypatch):
    """回歸防護（重要——真實瀏覽器會送這個）：Chrome/Firefox 的
    MediaRecorder 產生的 content_type 通常帶 `;codecs=opus` 這類參數，例如
    "audio/webm;codecs=opus"。精確白名單比對前必須先剝除這個參數，且轉傳
    給 voice_service 的必須是剝除後的乾淨基底型別 "audio/webm"——不是原始
    帶參數的字串，也不是任何其他值。"""
    import services.voice_service as vs
    captured = {}

    def fake_stt(audio, filename, content_type, api_key, language):
        captured["content_type"] = content_type
        return "轉寫結果"

    monkeypatch.setattr(vs, "speech_to_text", fake_stt)
    resp = client.post("/voice/stt", headers=_voice_headers(client),
                       files={"file": ("a.webm", LLM_AUDIO, "audio/webm;codecs=opus")})

    assert resp.status_code == 200
    assert resp.json()["text"] == "轉寫結果"
    assert captured["content_type"] == "audio/webm"


def test_stt_rejects_content_type_with_embedded_newline(client, monkeypatch):
    """注入測試：content_type 帶裸 LF 是 multipart part 標頭注入的攻擊
    向量。這裡直接用 TestClient 底層的 httpx 用戶端端到端送出（沒有另外
    繞過或手動組 multipart body）——已用獨立探測腳本確認 httpx 0.28 的
    multipart 編碼器不會跳脫這個值、Starlette 的解析器會把它完整原樣交給
    file.content_type，所以這個測試真的在驗證「值本身帶換行」這個情境，
    不是理論假設。精確白名單比對必須擋下它 (422)，且完全不能呼叫到
    speech_to_text——注入的字串絕不能有機會被轉傳到對 xAI 的外送請求。"""
    import services.voice_service as vs
    called = []
    monkeypatch.setattr(vs, "speech_to_text",
                        lambda *a, **k: called.append(1) or "不該被呼叫")

    injected_content_type = "audio/webm\nX-Injected: 1"
    resp = client.post("/voice/stt", headers=_voice_headers(client),
                       files={"file": ("a.webm", LLM_AUDIO, injected_content_type)})

    assert resp.status_code == 422
    assert called == []


def test_allowlist_rejects_newline_value_via_direct_unit_check():
    """對驗證邏輯本身做直接單元檢查（不經 HTTP/multipart 傳輸層）：確保
    這個不變量不會因為未來 httpx/TestClient 對 multipart 標頭多做了一層
    跳脫處理，而讓上面的端到端注入測試悄悄變得測不到真正的攻擊情境。
    任何帶換行字元的字串，正規化後都不可能是 _ALLOWED_AUDIO_TYPES 集合
    裡的精確成員。"""
    from api.routes.voice import _ALLOWED_AUDIO_TYPES

    malicious = "audio/webm\nX-Injected: 1"
    base = malicious.split(";")[0].strip().lower()

    assert "\n" in base  # 確認測的就是「值本身帶換行」這個情境
    assert base not in _ALLOWED_AUDIO_TYPES


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
