"""end-of-chat 管線接線與回應形變 (v2.5 Spec C Task 6)。"""
import json

from database import db_session, crud

DIARY_REPLY = ('今天吃了牛肉湯，很滿足。\n'
               '{"title": "牛肉湯", "summary": "滿足的一天", "valence": 0.8, "arousal": 0.4}')
REVIEW_REPLY = json.dumps({"ops": [{"action": "add", "file": "user_profile",
                                    "section": "重要事件時間線",
                                    "text": "- [2026-08-23] 吃牛肉湯"}]}, ensure_ascii=False)


def _chat_once(client, headers, llm_headers, mock_llm):
    mock_llm.respond("好啊，聽起來不錯！")
    r = client.post("/chat/", json={"message": "今天吃了牛肉湯"},
                    headers={**headers, **llm_headers})
    assert r.status_code == 200


def test_chat_end_returns_memory_review(client, auth_header, llm_headers, mock_llm):
    headers, uid = auth_header
    _chat_once(client, headers, llm_headers, mock_llm)
    mock_llm.respond(DIARY_REPLY)
    mock_llm.respond(REVIEW_REPLY)
    resp = client.post("/chat/end/", json={}, headers={**headers, **llm_headers})
    assert resp.status_code == 200
    body = resp.json()
    assert "interaction_note" not in body and "interaction_note_error" not in body
    assert body["memory_review"]["applied"] == 1 and body["memory_review_error"] is None
    assert body["diary"]["title"] == "牛肉湯"
    with db_session() as db:
        files = crud.get_memory_files(db, uid)
        assert "吃牛肉湯" in files["user_profile"].content
        # review pass 的 ops 綁定來源日記
        op = crud.get_memory_ops(db, uid)[0]
        assert op.source_diary_id == body["diary"]["diary_id"]


def _boom(messages, cfg):
    """`mock_llm.fail()` 是覆寫下一次呼叫的旗標，不看佇列位置——會搶在已佇列
    的 DIARY_REPLY 前面觸發，讓日記生成本身失敗，而非本測試要驗的 review
    pass 失敗。改用可呼叫物件佇列在 DIARY_REPLY 之後，維持 FIFO 順序。"""
    from providers.base import LLMError
    raise LLMError("mock_llm: 模擬供應商呼叫失敗（review pass）")


def test_chat_end_review_failure_is_partial_success(client, auth_header, llm_headers, mock_llm):
    headers, uid = auth_header
    _chat_once(client, headers, llm_headers, mock_llm)
    mock_llm.respond(DIARY_REPLY)
    mock_llm.respond(_boom)  # review pass 的 LLM 呼叫失敗
    resp = client.post("/chat/end/", json={}, headers={**headers, **llm_headers})
    assert resp.status_code == 200  # 日記已存，部分成功
    body = resp.json()
    assert body["memory_review"] is None and body["memory_review_error"]
    assert body["diary"]["title"] == "牛肉湯"


def test_interaction_note_update_endpoint_reshaped(client, auth_header, llm_headers, mock_llm):
    headers, uid = auth_header
    _chat_once(client, headers, llm_headers, mock_llm)
    mock_llm.respond(DIARY_REPLY)
    mock_llm.respond(REVIEW_REPLY)
    resp = client.post("/interaction-notes/update", json={},
                       headers={**headers, **llm_headers})
    assert resp.status_code == 200
    body = resp.json()
    assert "memory_review" in body and "interaction_note" not in body


def test_interaction_notes_table_no_longer_written(client, auth_header, llm_headers, mock_llm):
    headers, uid = auth_header
    _chat_once(client, headers, llm_headers, mock_llm)
    mock_llm.respond(DIARY_REPLY)
    mock_llm.respond(REVIEW_REPLY)
    client.post("/chat/end/", json={}, headers={**headers, **llm_headers})
    from services.interaction_service import get_latest_interaction_note
    with db_session() as db:
        assert get_latest_interaction_note(db, uid) is None  # 停寫


def test_review_pass_receives_chat_history(client, auth_header, llm_headers, mock_llm):
    headers, uid = auth_header
    _chat_once(client, headers, llm_headers, mock_llm)
    mock_llm.respond(DIARY_REPLY)
    mock_llm.respond(REVIEW_REPLY)
    client.post("/chat/end/", json={}, headers={**headers, **llm_headers})
    review_prompt = mock_llm.calls[-1]["messages"][1]["content"]
    assert "今天吃了牛肉湯" in review_prompt  # 對話素材有進 review
