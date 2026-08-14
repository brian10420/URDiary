"""鎖定 /chat/checkin/ 每日主動問候 API 的現行行為 (daily_checkin，5am 換日基準)。"""


def test_first_checkin_of_day_persists_and_second_call_same_day_returns_false(
    client, auth_header, mock_llm, llm_headers
):
    from database import crud, SessionLocal
    from memory_manager import get_chat_history

    headers, user_id = auth_header
    combined = {**headers, **llm_headers}
    mock_llm.respond("早安，新的一天，今天想聊點什麼呢？")

    resp = client.post("/chat/checkin/", headers=combined)

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "checkin": True,
        "message": "早安，新的一天，今天想聊點什麼呢？",
        "model_used": body["model_used"],
    }

    # DB：last_checkin_date 已寫入
    db = SessionLocal()
    try:
        user = crud.get_user(db, user_id)
        assert user.last_checkin_date is not None
    finally:
        db.close()

    # 問候已進入正式聊天歷史
    history = get_chat_history(user_id)
    assert {"role": "assistant", "content": "早安，新的一天，今天想聊點什麼呢？"} in history

    # 緊接著第二次呼叫 (同一天內)：已問候過，不再重複
    second_resp = client.post("/chat/checkin/", headers=combined)
    assert second_resp.status_code == 200
    assert second_resp.json() == {"checkin": False}


def test_checkin_prompt_contains_todays_calendar_event(
    client, auth_header, mock_llm, llm_headers
):
    """今天有行事曆事件時，check-in 提示詞要看得到那件事（問候才能自然帶一句）。

    行事曆用真實本地牆上日期 (get_local_now)，不是日記的 5am 換日日。
    """
    from database import crud, SessionLocal
    from utils.time_utils import get_local_now

    headers, user_id = auth_header

    db = SessionLocal()
    try:
        crud.create_calendar_event(
            db, user_id, "牙醫檢查", get_local_now().date(),
            category="health", event_time="14:00",
        )
    finally:
        db.close()

    mock_llm.respond("早安，今天也慢慢來就好。")
    resp = client.post("/chat/checkin/", headers={**headers, **llm_headers})

    assert resp.status_code == 200
    assert resp.json()["checkin"] is True

    prompt_text = "\n".join(m["content"] for m in mock_llm.calls[-1]["messages"])
    assert "牙醫檢查" in prompt_text


def test_checkin_prompt_contains_companion_name(
    client, auth_header, mock_llm, llm_headers
):
    """陪伴者客製化名字要進得了 check-in 開場提示詞（與行事曆注入同一組測試手法）。"""
    headers, _ = auth_header
    client.put("/users/me/companion", headers=headers, json={"companion_name": "小澄"})

    mock_llm.respond("早安，今天也慢慢來就好。")
    resp = client.post("/chat/checkin/", headers={**headers, **llm_headers})

    assert resp.status_code == 200
    assert resp.json()["checkin"] is True

    prompt_text = "\n".join(m["content"] for m in mock_llm.calls[-1]["messages"])
    assert "小澄" in prompt_text


def test_checkin_llm_failure_returns_checkin_false_not_5xx(
    client, other_auth_header, mock_llm, llm_headers
):
    """LLM 失敗時 daily_checkin 讓 LLMError 往上拋，路由層轉成 {"checkin": false}
    (200)，而不是 5xx —— 首開體驗不該被錯誤彈窗打斷。"""
    headers, _ = other_auth_header
    mock_llm.fail()

    resp = client.post("/chat/checkin/", headers={**headers, **llm_headers})

    assert resp.status_code == 200
    assert resp.json() == {"checkin": False}
