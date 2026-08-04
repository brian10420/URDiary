"""鎖定 /chat/* API 的現行行為 (api/routes/chat.py)。

危機處理雙保險：ACUTE 敏感詞 (如「想死」) 機械附上求助資源；CONTEXTUAL 敏感詞
(如「想消失」) 只在 system prompt 附加 crisis_mode 內容，不強制附資源。
"""
from services.diary_service import get_support_message
from services.prompt_loader import load_prompt


def test_basic_chat_returns_200(client, auth_header, mock_llm, llm_headers):
    headers, _ = auth_header
    mock_llm.respond("我在這裡陪你聊聊。")

    resp = client.post(
        "/chat/", json={"message": "今天天氣真好"}, headers={**headers, **llm_headers}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["response"] == "我在這裡陪你聊聊。"
    assert "model_used" in body


def test_enhanced_chat_returns_200_with_response_and_model(client, auth_header, mock_llm, llm_headers):
    headers, _ = auth_header
    mock_llm.respond("這是增強版對話的回覆。")

    resp = client.post(
        "/chat/enhanced/", json={"message": "跟我聊聊今天"}, headers={**headers, **llm_headers}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["response"] == "這是增強版對話的回覆。"
    assert "model_used" in body


def test_enhanced_chat_history_persists_across_turns(client, auth_header, mock_llm, llm_headers):
    headers, _ = auth_header
    combined = {**headers, **llm_headers}

    mock_llm.respond("第一輪的回覆內容。")
    resp1 = client.post("/chat/enhanced/", json={"message": "第一輪訊息"}, headers=combined)
    assert resp1.status_code == 200

    mock_llm.respond("第二輪的回覆內容。")
    resp2 = client.post("/chat/enhanced/", json={"message": "第二輪訊息"}, headers=combined)
    assert resp2.status_code == 200

    # 第二輪送給 llm.chat 的 messages 裡應該看得到第一輪的對話 (歷史持續)
    second_call_messages = mock_llm.calls[-1]["messages"]
    assert {"role": "user", "content": "第一輪訊息"} in second_call_messages
    assert {"role": "assistant", "content": "第一輪的回覆內容。"} in second_call_messages
    assert {"role": "user", "content": "第二輪訊息"} in second_call_messages


def test_acute_sensitive_word_appends_support_message(client, auth_header, mock_llm, llm_headers):
    """「想死」屬於 SENSITIVE_WORDS_ACUTE (級別 2)：回覆尾端強制附求助資源文字。"""
    headers, _ = auth_header
    mock_llm.respond("我聽到你了，你並不孤單。")

    resp = client.post(
        "/chat/enhanced/", json={"message": "我覺得好累，我想死"},
        headers={**headers, **llm_headers},
    )

    assert resp.status_code == 200
    expected_support = get_support_message("zh-TW")
    assert resp.json()["response"] == f"我聽到你了，你並不孤單。\n\n{expected_support}"


def test_contextual_sensitive_word_adds_crisis_prompt_without_support_message(
    client, auth_header, mock_llm, llm_headers
):
    """「想消失」屬於 SENSITIVE_WORDS_CONTEXTUAL (級別 1)：不強制附資源，
    但 system prompt 應該含 crisis_mode 附錄內容，交給模型自行判斷。"""
    headers, _ = auth_header
    mock_llm.respond("聽起來你最近很辛苦。")

    resp = client.post(
        "/chat/enhanced/", json={"message": "有時候真的很想消失"},
        headers={**headers, **llm_headers},
    )

    assert resp.status_code == 200
    assert resp.json()["response"] == "聽起來你最近很辛苦。"  # 不附求助資源

    crisis_text = load_prompt("crisis_mode.txt", "zh-TW")
    system_prompt = mock_llm.calls[-1]["messages"][0]["content"]
    assert crisis_text in system_prompt


def test_enhanced_chat_system_prompt_contains_upcoming_calendar_event(
    client, auth_header, mock_llm, llm_headers
):
    """明天的行事曆事件要進得了 enhanced 對話的 system prompt（未來 7 天視窗）。"""
    from datetime import timedelta
    from database import crud, SessionLocal
    from utils.time_utils import get_local_now

    headers, user_id = auth_header
    tomorrow = get_local_now().date() + timedelta(days=1)

    db = SessionLocal()
    try:
        crud.create_calendar_event(
            db, user_id, "資格考口試", tomorrow,
            category="study", event_time="09:30",
        )
    finally:
        db.close()

    mock_llm.respond("好啊，那就聊聊今天吧。")
    resp = client.post(
        "/chat/enhanced/", json={"message": "在嗎"}, headers={**headers, **llm_headers}
    )

    assert resp.status_code == 200
    system_prompt = mock_llm.calls[-1]["messages"][0]["content"]
    assert "資格考口試" in system_prompt


def test_mock_llm_failure_returns_503_and_does_not_write_history(
    client, auth_header, mock_llm, llm_headers
):
    from memory_manager import get_chat_history

    headers, user_id = auth_header
    combined = {**headers, **llm_headers}

    mock_llm.respond("成功的一輪回覆。")
    ok_resp = client.post("/chat/enhanced/", json={"message": "第一輪"}, headers=combined)
    assert ok_resp.status_code == 200
    history_after_success = get_chat_history(user_id)

    mock_llm.fail()
    fail_resp = client.post("/chat/enhanced/", json={"message": "會失敗的這輪"}, headers=combined)

    assert fail_resp.status_code == 503
    assert fail_resp.json()["code"] == "E3001"  # ErrorCode.CHAT_SERVICE_UNAVAILABLE

    history_after_failure = get_chat_history(user_id)
    assert history_after_failure == history_after_success  # 失敗這輪沒有寫入歷史


def test_clear_chat_history_empties_history(client, auth_header, mock_llm, llm_headers):
    from memory_manager import get_chat_history

    headers, user_id = auth_header
    mock_llm.respond("會被清除的一輪對話。")
    resp = client.post(
        "/chat/enhanced/", json={"message": "測試訊息"}, headers={**headers, **llm_headers}
    )
    assert resp.status_code == 200
    assert get_chat_history(user_id) != []

    clear_resp = client.delete("/chat/clear/", headers=headers)
    assert clear_resp.status_code == 200

    assert get_chat_history(user_id) == []
