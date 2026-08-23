"""onboarding 三 API (v2.5 Spec B Task 2)。"""
import json

from conftest import LLM_HEADERS

OPS_REPLY = json.dumps({"ops": [{
    "action": "add", "file": "user_profile",
    "section": "稱呼與身分", "text": "- 叫他小明 (2026-08-24)"}]})


def test_state_initial(client, auth_header):
    headers, _uid = auth_header
    r = client.get("/users/onboarding/state", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"completed": False, "answered_keys": []}


def test_answer_upsert_and_state(client, auth_header):
    headers, _uid = auth_header
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "name", "answer_text": "小明"})
    assert r.status_code == 200 and r.json()["saved"] is True
    # 空字串＝跳過，合法且進 answered_keys
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "location", "answer_text": ""})
    assert r.status_code == 200
    # 重答覆蓋不長列
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "name", "answer_text": "阿明"})
    assert r.status_code == 200
    state = client.get("/users/onboarding/state", headers=headers).json()
    assert state["completed"] is False
    assert sorted(state["answered_keys"]) == ["location", "name"]


def test_answer_validation_422(client, auth_header):
    headers, _uid = auth_header
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "not_a_key", "answer_text": "x"})
    assert r.status_code == 422
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "name", "answer_text": "很" * 501})
    assert r.status_code == 422


def test_all_endpoints_require_auth(client):
    """安全：三端點全掛認證，無 token 一律 401。"""
    assert client.get("/users/onboarding/state").status_code == 401
    assert client.post("/users/onboarding/answer",
                       json={"question_key": "name", "answer_text": "x"}).status_code == 401
    assert client.post("/users/onboarding/complete").status_code == 401


def test_state_isolated_between_users(client, auth_header, other_auth_header, mock_llm):
    """安全（IDOR）：答案綁 JWT 身分——A 的作答與完成狀態絕不外洩到 B。"""
    headers_a, _uid_a = auth_header
    headers_b, _uid_b = other_auth_header
    client.post("/users/onboarding/answer", headers=headers_a,
                json={"question_key": "name", "answer_text": "A的名字"})
    assert client.get("/users/onboarding/state", headers=headers_b).json()["answered_keys"] == []
    assert client.get("/users/onboarding/state", headers=headers_a).json()["answered_keys"] == ["name"]
    # B 完成 onboarding 不影響 A（mock_llm 掛著保險：若誤觸 LLM 也不打網路）
    client.post("/users/onboarding/complete", headers=headers_b)
    assert client.get("/users/onboarding/state", headers=headers_a).json()["completed"] is False


def test_complete_idempotent_and_state(client, auth_header, mock_llm):
    headers, _uid = auth_header
    r = client.post("/users/onboarding/complete", headers=headers)
    assert r.status_code == 200 and r.json()["completed"] is True
    # 沒有任何待收納答案 → 不打 LLM
    assert mock_llm.calls == []
    assert r.json()["memory_review"] is None
    # 冪等
    r = client.post("/users/onboarding/complete", headers=headers)
    assert r.status_code == 200 and r.json()["completed"] is True
    assert client.get("/users/onboarding/state", headers=headers).json()["completed"] is True


def test_complete_triggers_ingestion_pass(client, auth_header, mock_llm):
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "name", "answer_text": "小明"})
    mock_llm.respond(OPS_REPLY)
    r = client.post("/users/onboarding/complete",
                    headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200 and r.json()["completed"] is True
    assert len(mock_llm.calls) == 1
    review = r.json()["memory_review"]
    assert review is not None and review["applied"] == 1 and review["error"] is None


def test_complete_survives_llm_failure(client, auth_header, mock_llm):
    """零金鑰/供應商失敗：收納 best-effort 跳過，complete 照樣成功。"""
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "hobbies", "answer_text": "打羽球"})
    mock_llm.fail()
    r = client.post("/users/onboarding/complete",
                    headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert r.json()["completed"] is True and r.json()["memory_review"] is None
    assert client.get("/users/onboarding/state", headers=headers).json()["completed"] is True
