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


def test_get_companion_settings_unknown_user_returns_empty(client):
    """查無使用者 (user_id=-1) → 回傳 EMPTY_COMPANION，不拋錯。"""
    from services.companion_service import get_companion_settings, EMPTY_COMPANION
    s = get_companion_settings(-1)
    assert s is EMPTY_COMPANION
    assert s.is_empty()


def test_companion_put_and_get_roundtrip(client):
    headers, _ = _create_and_login(client, _unique_username())
    resp = client.put("/users/me/companion", headers=headers, json={
        "companion_name": "小澄", "user_nickname": "阿哲",
        "style_reply_length": "chatty", "style_emoji": "low",
        "style_formality": "casual"})
    assert resp.status_code == 200
    got = client.get("/users/me/companion", headers=headers).json()
    assert got["companion_name"] == "小澄" and got["user_nickname"] == "阿哲"
    assert got["style_reply_length"] == "chatty"


def test_companion_put_partial_and_clear(client):
    headers, _ = _create_and_login(client, _unique_username())
    client.put("/users/me/companion", headers=headers, json={"companion_name": "小澄"})
    client.put("/users/me/companion", headers=headers, json={"user_nickname": "阿哲"})
    got = client.get("/users/me/companion", headers=headers).json()
    assert got["companion_name"] == "小澄"  # 未出現的欄位維持原值
    client.put("/users/me/companion", headers=headers, json={"companion_name": ""})
    got = client.get("/users/me/companion", headers=headers).json()
    assert got["companion_name"] is None  # 空字串＝清空
    # R1：列舉型 (style_*) 欄位比照文字欄位，空字串一樣要能清空該欄
    client.put("/users/me/companion", headers=headers, json={"style_emoji": "low"})
    got = client.get("/users/me/companion", headers=headers).json()
    assert got["style_emoji"] == "low"
    client.put("/users/me/companion", headers=headers, json={"style_emoji": ""})
    got = client.get("/users/me/companion", headers=headers).json()
    assert got["style_emoji"] is None


def test_companion_put_validation(client):
    headers, _ = _create_and_login(client, _unique_username())
    assert client.put("/users/me/companion", headers=headers,
                      json={"companion_name": "超" * 21}).status_code == 422
    assert client.put("/users/me/companion", headers=headers,
                      json={"style_emoji": "tons"}).status_code == 422
    assert client.put("/users/me/companion", headers=headers,
                      json={"companion_name": "小\n澄"}).status_code == 422  # 控制字元/換行拒收
    assert client.put("/users/me/companion", json={}).status_code == 401  # 未登入


def test_companion_settings_snapshot_after_put(client):
    headers, user_id = _create_and_login(client, _unique_username())
    client.put("/users/me/companion", headers=headers, json={"companion_name": "小澄"})
    from services.companion_service import get_companion_settings
    assert get_companion_settings(user_id).name == "小澄"


def test_chat_system_prompt_contains_companion(client, mock_llm, llm_headers):
    """路由層級：/chat/enhanced/ 真的把使用者設定的陪伴者名字帶進 system prompt。"""
    headers, _ = _create_and_login(client, _unique_username())
    client.put("/users/me/companion", headers=headers, json={"companion_name": "小澄"})
    mock_llm.respond("好的！")

    resp = client.post(
        "/chat/enhanced/", json={"message": "嗨"}, headers={**headers, **llm_headers}
    )

    assert resp.status_code == 200
    system_prompt = mock_llm.calls[-1]["messages"][0]["content"]
    assert "小澄" in system_prompt
