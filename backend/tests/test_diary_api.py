"""鎖定 /diaries、/diary/* 相關 API 的現行行為 (api/routes/diary.py)。

造測試資料一律用 database.crud.create_diary (在函式內 import，晚於 client
fixture)，避免走 LLM 生成流程；LLM 相關端點才透過 mock_llm 腳本化。
"""
from datetime import datetime
from uuid import UUID


def _seed_diary(user_id, content, title, summary, valence=0.5, arousal=0.5):
    from database import crud, SessionLocal
    db = SessionLocal()
    try:
        diary = crud.create_diary(
            db, user_id=user_id, content=content, title=title,
            summary=summary, valence=valence, arousal=arousal,
        )
        return diary.id
    finally:
        db.close()


def _backdate_diary(diary_id, dt):
    from database import crud, SessionLocal
    db = SessionLocal()
    try:
        crud.update_diary(db, diary_id, diary_date=dt)
    finally:
        db.close()


def _seed_chat_history(user_id, messages):
    from memory_manager import append_chat_messages
    append_chat_messages(user_id, messages)


# --- GET /diaries/{user_id} ------------------------------------------------------

def test_get_own_diaries_list_ordered_desc_by_date(client, auth_header):
    headers, user_id = auth_header
    older_id = _seed_diary(user_id, "第一篇日記內容", "標題一", "摘要一")
    _backdate_diary(older_id, datetime(2020, 1, 1))
    newer_id = _seed_diary(user_id, "第二篇日記內容", "標題二", "摘要二")

    resp = client.get(f"/diaries/{user_id}", headers=headers)

    assert resp.status_code == 200
    diaries = resp.json()["diaries"]
    ids = [d["diary_id"] for d in diaries]
    assert ids.index(newer_id) < ids.index(older_id)


def test_get_other_user_diaries_returns_403(client, auth_header, other_auth_header):
    headers, _ = auth_header
    _, other_user_id = other_auth_header

    resp = client.get(f"/diaries/{other_user_id}", headers=headers)

    assert resp.status_code == 403
    assert resp.json()["code"] == "E1005"  # ErrorCode.FORBIDDEN


# --- GET /diary/{diary_id} --------------------------------------------------------

def test_get_own_single_diary_returns_200(client, auth_header):
    headers, user_id = auth_header
    diary_id = _seed_diary(user_id, "內容ABC", "標題ABC", "摘要ABC")

    resp = client.get(f"/diary/{diary_id}", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["diary_id"] == diary_id
    assert body["title"] == "標題ABC"
    assert body["content"] == "內容ABC"


def test_get_other_users_diary_returns_404_not_403(client, auth_header, other_auth_header):
    """不是自己的日記一律回 404，不洩漏該日記是否存在 (與 /diaries/ 列表的 403 不同)。

    同時鎖定錯誤回應的契約形狀 (middleware/exception_handlers.py 為唯一
    exception->JSON 主人)：body 必須帶 code，且 request_id 是
    middleware/error_handler.py 產生、寫進 request.state 後再被
    exception_handlers 讀出的合法 UUID，不是 "unknown" 後備值。
    """
    headers, _ = auth_header
    other_headers, other_user_id = other_auth_header
    other_diary_id = _seed_diary(other_user_id, "別人的內容", "別人的標題", "別人的摘要")

    resp = client.get(f"/diary/{other_diary_id}", headers=headers)

    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "E4000"  # ErrorCode.DIARY_NOT_FOUND
    assert body["error"] == "http_error"
    assert UUID(body["request_id"])  # 合法 UUID，證明 error_handler 有成功注入


# --- PUT /diary/{diary_id} --------------------------------------------------------

def test_put_own_diary_title_succeeds(client, auth_header):
    headers, user_id = auth_header
    diary_id = _seed_diary(user_id, "原內容", "原標題", "原摘要")

    resp = client.put(f"/diary/{diary_id}", json={"title": "新標題"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["diary"]["title"] == "新標題"


def test_put_empty_body_returns_400(client, auth_header):
    headers, user_id = auth_header
    diary_id = _seed_diary(user_id, "原內容", "原標題", "原摘要")

    resp = client.put(f"/diary/{diary_id}", json={}, headers=headers)

    assert resp.status_code == 400
    assert resp.json()["code"] == "E1001"  # ErrorCode.INVALID_INPUT


def test_put_other_users_diary_returns_404(client, auth_header, other_auth_header):
    headers, _ = auth_header
    _, other_user_id = other_auth_header
    other_diary_id = _seed_diary(other_user_id, "別人的內容", "別人的標題", "別人的摘要")

    resp = client.put(f"/diary/{other_diary_id}", json={"title": "偷改標題"}, headers=headers)

    assert resp.status_code == 404
    assert resp.json()["code"] == "E4000"


# --- DELETE /diary/{diary_id} -----------------------------------------------------

def test_delete_other_users_diary_returns_404(client, auth_header, other_auth_header):
    headers, _ = auth_header
    _, other_user_id = other_auth_header
    other_diary_id = _seed_diary(other_user_id, "別人的內容", "別人的標題", "別人的摘要")

    resp = client.delete(f"/diary/{other_diary_id}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["code"] == "E4000"


def test_delete_own_diary_then_get_returns_404(client, auth_header):
    headers, user_id = auth_header
    diary_id = _seed_diary(user_id, "要被刪除的內容", "要被刪除的標題", "摘要")

    del_resp = client.delete(f"/diary/{diary_id}", headers=headers)
    assert del_resp.status_code == 200

    get_resp = client.get(f"/diary/{diary_id}", headers=headers)
    assert get_resp.status_code == 404


# --- POST /enhanced-generate -------------------------------------------------

def test_enhanced_generate_success_parses_diary_and_creates_note(
    client, auth_header, mock_llm, llm_headers
):
    headers, user_id = auth_header
    _seed_chat_history(user_id, [
        {"role": "user", "content": "今天過得普通，就是上班下班。"},
        {"role": "assistant", "content": "聽起來平淡的一天，有什麼想多聊聊的嗎？"},
    ])

    # 現行流程在一次 /enhanced-generate 裡實際會打 3 次 llm.chat：
    # 日記生成 -> (筆記更新內部先做一次情緒分析) -> 筆記生成。用「依 system
    # role 內容決定回覆」取代「依呼叫順序腳本化」，才不會被中間那次情緒分析
    # 呼叫打亂順序 (也對之後可能的呼叫順序調整更有韌性)。
    from services.prompt_loader import get_role
    diary_writer_role = get_role("diary_writer", "zh-TW")
    note_taker_role = get_role("note_taker", "zh-TW")

    diary_reply = (
        '今天雖然平淡，但和自己相處的感覺不錯。\n'
        '{"title": "平淡卻踏實的一天", "summary": "上班下班，和自己相處", '
        '"valence": 0.65, "arousal": 0.35}'
    )
    note_reply = "使用者今天過得平淡但心情穩定，持續上下班的日常步調。"
    harmless_default = mock_llm.default_reply  # 先存一份，避免下面覆寫後自我參照

    def scripted(messages, cfg):
        system_content = messages[0]["content"]
        if system_content == diary_writer_role:
            return diary_reply
        if system_content == note_taker_role:
            return note_reply
        return harmless_default  # 情緒分析等其他呼叫：回無害預設值即可

    mock_llm.default_reply = scripted

    resp = client.post(
        "/enhanced-generate", json={}, headers={**headers, **llm_headers}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["diary"]["title"] == "平淡卻踏實的一天"
    assert body["diary"]["summary"] == "上班下班，和自己相處"
    assert body["diary"]["valence"] == 0.65
    assert body["diary"]["arousal"] == 0.35
    assert "valence" not in body["diary"]["content"]
    assert body["interaction_note"] is not None
    assert body["interaction_note"]["content"] == note_reply
    assert body["interaction_note_error"] is None

    # DB 驗證：日記確實入庫，且欄位與回應一致
    from database import crud, SessionLocal
    db = SessionLocal()
    try:
        stored = crud.get_diary(db, body["diary"]["diary_id"])
        assert stored is not None
        assert stored.user_id == user_id
        assert stored.title == "平淡卻踏實的一天"
    finally:
        db.close()


def test_enhanced_generate_llm_failure_returns_503(client, auth_header, mock_llm, llm_headers):
    headers, user_id = auth_header
    _seed_chat_history(user_id, [
        {"role": "user", "content": "測試訊息"},
        {"role": "assistant", "content": "測試回覆"},
    ])
    mock_llm.fail()

    resp = client.post(
        "/enhanced-generate", json={}, headers={**headers, **llm_headers}
    )

    assert resp.status_code == 503
    assert resp.json()["code"] == "E3001"  # ErrorCode.CHAT_SERVICE_UNAVAILABLE，現行為 E3001 類
