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


def test_stt_non_json_200_mapped_not_leaked(monkeypatch):
    """xAI 回 200 但 body 不是合法 JSON（或整個是空 body）：response.json()
    會丟 ValueError（json.JSONDecodeError 是其子類別），不該讓這個例外原樣
    往外逃成未映射的 500——一律映射成既有的 voice_upstream_failed。"""
    from services import voice_service

    def fake_post(url, api_key, **kwargs):
        class R:
            status_code = 200
            content = b"not json"
            def json(self): raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return R()

    monkeypatch.setattr(voice_service, "_post", fake_post)
    with pytest.raises(voice_service.VoiceServiceError) as exc:
        voice_service.speech_to_text(b"x", "a.webm", "audio/webm",
                                     api_key="k", language="zh-TW")
    assert exc.value.status_code == 502
    assert exc.value.message_key == "voice_upstream_failed"
