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
