"""onboarding 三 API (v2.5 Spec B Task 2)。"""
import json

from conftest import LLM_HEADERS

OPS_REPLY = json.dumps({"ops": [{
    "action": "add", "file": "user_profile",
    "section": "稱呼與身分", "text": "- 叫他小明 (2026-08-24)"}]})

# complete 首次完成時依序打兩次 LLM：取名判定（先）→ 收納 pass（後）
NAMING_NULL = json.dumps({"companion_name": None})


def _naming_reply(name):
    return json.dumps({"companion_name": name}, ensure_ascii=False)


def _provider_down(messages, cfg):
    """佇列用的「供應商失敗」。mock_llm.fail() 是一次性旗標——只擋下一次呼叫，
    連呼兩次也不會累加——而 complete 現在要打兩次 LLM，要讓兩次都失敗
    （等同零金鑰）或只讓其中一次失敗，都得靠佇列裡會拋錯的 callable。"""
    from providers.base import LLMError
    raise LLMError("mock_llm: 模擬供應商呼叫失敗")


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
    # 沒有任何答案 → 取名判定與收納都不打 LLM
    assert mock_llm.calls == []
    assert r.json()["memory_review"] is None
    assert r.json()["companion_name"] is None
    # 冪等
    r = client.post("/users/onboarding/complete", headers=headers)
    assert r.status_code == 200 and r.json()["completed"] is True
    assert client.get("/users/onboarding/state", headers=headers).json()["completed"] is True


def test_complete_twice_does_not_re_ingest(client, auth_header, mock_llm):
    """收納成功會戳記素材、取名判定只在首次完成時跑：重按一次 complete
    不再打任何 LLM。"""
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "name", "answer_text": "小明"})
    mock_llm.respond(NAMING_NULL)   # 取名判定
    mock_llm.respond(OPS_REPLY)     # 收納 pass
    first = client.post("/users/onboarding/complete",
                        headers={**headers, **LLM_HEADERS})
    assert first.status_code == 200 and first.json()["completed"] is True
    assert len(mock_llm.calls) == 2
    second = client.post("/users/onboarding/complete",
                         headers={**headers, **LLM_HEADERS})
    assert second.status_code == 200 and second.json()["completed"] is True
    assert len(mock_llm.calls) == 2  # 素材已戳記、取名已判定過：第二次沒有新的 LLM 呼叫
    assert second.json()["memory_review"] is None
    assert second.json()["companion_name"] is None


def test_complete_triggers_ingestion_pass(client, auth_header, mock_llm):
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "name", "answer_text": "小明"})
    mock_llm.respond(NAMING_NULL)   # 取名判定（先）
    mock_llm.respond(OPS_REPLY)     # 收納 pass（後）
    r = client.post("/users/onboarding/complete",
                    headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200 and r.json()["completed"] is True
    assert len(mock_llm.calls) == 2
    assert "companion_name" in mock_llm.calls[0]["messages"][1]["content"]
    assert "收納素材" in mock_llm.calls[1]["messages"][1]["content"]
    review = r.json()["memory_review"]
    assert review is not None and review["applied"] == 1 and review["error"] is None
    assert r.json()["companion_name"] is None   # 判定回 null＝名字沒改


def test_complete_survives_llm_failure(client, auth_header, mock_llm):
    """零金鑰/供應商失敗：取名判定與收納都 best-effort 跳過，complete 照樣成功。"""
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "hobbies", "answer_text": "打羽球"})
    mock_llm.respond(_provider_down)   # 取名判定
    mock_llm.respond(_provider_down)   # 收納 pass
    r = client.post("/users/onboarding/complete",
                    headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert len(mock_llm.calls) == 2    # 取名失敗不擋收納：兩次都有打、兩次都失敗
    assert r.json()["completed"] is True and r.json()["memory_review"] is None
    assert r.json()["companion_name"] is None
    assert client.get("/users/onboarding/state", headers=headers).json()["completed"] is True


# --- 取名判定 (v2.5 Spec B 驗收回饋①) ---------------------------------------------

def _answer(client, headers, key, text):
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": key, "answer_text": text})
    assert r.status_code == 200


def _companion_name(client, headers):
    return client.get("/users/me/companion", headers=headers).json()["companion_name"]


def test_complete_resolves_companion_name(client, auth_header, mock_llm):
    """腳本照字面收下整句「我想叫你小樹洞」→ complete 時由 LLM 判定真正的名字。"""
    headers, _uid = auth_header
    client.put("/users/me/companion", headers=headers,
               json={"companion_name": "我想叫你小樹洞"})
    _answer(client, headers, "companion_naming", "我想叫你小樹洞")
    _answer(client, headers, "name", "小明")
    mock_llm.respond(_naming_reply("小樹洞"))
    mock_llm.respond(OPS_REPLY)
    r = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert r.json()["companion_name"] == "小樹洞"
    assert r.json()["companion_name_note"] is None        # 判定出名字＝沒有「沒取名」註記
    assert r.json()["memory_review"]["applied"] == 1      # 收納照跑、既有欄位不變
    assert _companion_name(client, headers) == "小樹洞"


def test_complete_returns_default_name_and_note(client, auth_header, mock_llm):
    """取名題答「不用了」被腳本照字面收下：判定回 declined → 回應帶預設名字與 note
    （前端據此改說 nameDefaulted，而不是「你想叫我⋯⋯對吧」）。"""
    from services.companion_naming import DEFAULT_COMPANION_NAME
    headers, _uid = auth_header
    client.put("/users/me/companion", headers=headers, json={"companion_name": "不用了"})
    _answer(client, headers, "companion_naming", "不用了")
    mock_llm.respond(json.dumps({"companion_name": None, "no_name": "declined"}))
    r = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert r.json()["companion_name"] == DEFAULT_COMPANION_NAME["zh-TW"]
    assert r.json()["companion_name_note"] == "declined"
    assert _companion_name(client, headers) == DEFAULT_COMPANION_NAME["zh-TW"]


def test_complete_skipped_naming_gets_default_without_llm(client, auth_header, mock_llm):
    """按「跳過這題」又沒有別的素材：零 LLM 呼叫，回應照樣帶預設名字與 later。"""
    from services.companion_naming import DEFAULT_COMPANION_NAME
    headers, _uid = auth_header
    _answer(client, headers, "companion_naming", "")
    r = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert mock_llm.calls == []
    assert r.json()["companion_name"] == DEFAULT_COMPANION_NAME["zh-TW"]
    assert r.json()["companion_name_note"] == "later"
    assert r.json()["memory_review"] is None


def test_complete_naming_failure_still_ingests(client, auth_header, mock_llm):
    headers, _uid = auth_header
    client.put("/users/me/companion", headers=headers,
               json={"companion_name": "我想叫你小樹洞"})
    _answer(client, headers, "companion_naming", "我想叫你小樹洞")
    _answer(client, headers, "name", "小明")
    mock_llm.respond(_provider_down)   # 取名判定失敗
    mock_llm.respond(OPS_REPLY)        # 收納照跑
    r = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert len(mock_llm.calls) == 2
    assert r.json()["companion_name"] is None
    assert r.json()["memory_review"]["applied"] == 1
    assert _companion_name(client, headers) == "我想叫你小樹洞"   # 名字維持腳本版


def test_second_complete_does_not_re_resolve_name(client, auth_header, mock_llm):
    """取名判定只在「這次呼叫真的設下完成戳記」時跑：重按 complete 零額外呼叫，
    也不會把使用者之後在設定頁改的名字蓋回去。"""
    headers, _uid = auth_header
    _answer(client, headers, "companion_naming", "我想叫你小樹洞")
    mock_llm.respond(_naming_reply("小樹洞"))
    first = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert first.json()["companion_name"] == "小樹洞"
    assert len(mock_llm.calls) == 1
    client.put("/users/me/companion", headers=headers, json={"companion_name": "阿樹"})
    mock_llm.respond(_naming_reply("小樹洞"))   # 若誤判第二次，名字會被蓋回小樹洞
    second = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert second.status_code == 200 and second.json()["companion_name"] is None
    assert len(mock_llm.calls) == 1
    assert _companion_name(client, headers) == "阿樹"


def test_naming_only_answer_resolves_without_ingestion(client, auth_header, mock_llm):
    """只答取名、其餘跳過：取名判定照跑；收納沒有素材（取名題依設計不收納）→ 不跑。"""
    headers, _uid = auth_header
    _answer(client, headers, "companion_naming", "我想叫你小樹洞")
    _answer(client, headers, "name", "")
    _answer(client, headers, "location", "")
    mock_llm.respond(_naming_reply("小樹洞"))
    r = client.post("/users/onboarding/complete", headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert len(mock_llm.calls) == 1
    assert "companion_name" in mock_llm.calls[0]["messages"][1]["content"]
    assert r.json()["companion_name"] == "小樹洞"
    assert r.json()["memory_review"] is None
