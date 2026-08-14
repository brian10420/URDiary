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
