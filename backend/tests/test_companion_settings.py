"""companion 設定：模型欄位、讀取服務、API。"""
from conftest import _create_and_login, _unique_username


def test_get_companion_settings_defaults_empty(client):
    """新帳號五欄皆 NULL → is_empty() 為真。"""
    headers, user_id = _create_and_login(client, _unique_username())
    from services.companion_service import get_companion_settings
    s = get_companion_settings(user_id)
    assert s.name is None and s.nickname is None
    assert s.reply_length is None and s.emoji is None and s.formality is None
    assert s.is_empty()
