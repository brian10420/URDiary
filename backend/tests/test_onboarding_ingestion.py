"""review pass 懶收納 (v2.5 Spec B Task 4)：素材注入＋成功戳記＋失敗不戳。"""
import json

from database import db_session, crud

OPS_REPLY = json.dumps({"ops": [{
    "action": "add", "file": "user_profile",
    "section": "稱呼與身分", "text": "- 叫他小明 (2026-08-24)"}]})

# 唯一的 op 指向不存在的檔案＝整批全 failed：走完寫階段但什麼都沒收納
BAD_REPLY = json.dumps({"ops": [{"action": "add", "file": "no_such_file",
                                 "section": "x", "text": "- y"}]})


def _seed(uid, key, text):
    with db_session() as db:
        crud.upsert_onboarding_answer(db, uid, key, text)


def _uningested(uid):
    with db_session() as db:
        return [r.question_key for r in crud.get_uningested_onboarding_answers(db, uid)]


def _run(uid, mock_llm, reply=None, fail=False):
    from providers.base import LLMConfig
    from services.memory_review import run_review_pass
    if fail:
        mock_llm.fail()
    elif reply is not None:
        mock_llm.respond(reply)
    return run_review_pass(uid, LLMConfig(provider="claude", api_key="sk-test"),
                           lang="zh-TW", source="onboarding")


def test_material_block_in_prompt(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    _seed(uid, "favorite_food", "牛肉湯")
    _run(uid, mock_llm, reply=OPS_REPLY)
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "【初次見面他告訴你的（收納素材）】" in prompt
    assert "稱呼：小明" in prompt and "喜歡的食物：牛肉湯" in prompt


def test_no_material_no_block(client, auth_header, mock_llm):
    _h, uid = auth_header
    _run(uid, mock_llm, reply=json.dumps({"ops": []}))
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "收納素材" not in prompt


def test_applied_pass_stamps(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=OPS_REPLY)
    assert result.applied == 1 and result.error is None
    assert _uningested(uid) == []
    # 收納後 raw 區塊自然消失（Task 3 的渲染只認未收納列）
    from services.user_profile import get_memory_context
    assert "初次見面" not in get_memory_context(uid, "zh-TW").profile_block


def test_empty_ops_does_not_stamp(client, auth_header, mock_llm):
    """模型說「沒什麼好記」＝收納失敗：素材下輪重現（天然重試）。"""
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=json.dumps({"ops": []}))
    assert result.applied == 0
    assert _uningested(uid) == ["name"]


def test_parse_failure_does_not_stamp(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply="這不是 JSON")
    assert result.error == "parse_failed"
    assert _uningested(uid) == ["name"]


def test_all_ops_failed_does_not_stamp(client, auth_header, mock_llm):
    """所有 ops 無效＝什麼都沒收納：不戳記（釘住 result.applied 護欄本身）。

    這條走完整個寫階段（不像空 ops／解析失敗那樣早退），因此唯一擋住戳記的
    就是 `if onboarding_ids and result.applied:` 的 result.applied 那一半。
    """
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=BAD_REPLY)
    assert result.applied == 0 and result.failed == 1
    assert _uningested(uid) == ["name"]


def test_over_budget_does_not_stamp(client, auth_header, mock_llm):
    """整批超標遭拒＝檔案沒動：不戳記，素材下輪重現（天然重試）。"""
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    big = json.dumps({"ops": [{"action": "add", "file": "user_profile",
                               "section": "稱呼與身分", "text": "- " + "長" * 900}]})
    mock_llm.respond(big)
    mock_llm.respond(big)  # 初次 ＋ 超標 retry 各吃一次
    result = _run(uid, mock_llm)
    assert result.error == "over_budget"
    assert _uningested(uid) == ["name"]


def test_approval_mode_pending_stamps(client, auth_header, mock_llm):
    """核可制：ops 進 pending 也算收納成功（素材不重複產 pending）。"""
    _h, uid = auth_header
    with db_session() as db:
        user = crud.get_user(db, uid)
        user.memory_write_mode = "approval"
        db.commit()
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=OPS_REPLY)
    assert result.pending == 1 and result.applied == 0
    assert _uningested(uid) == []


def test_approval_mode_all_ops_failed_does_not_stamp(client, auth_header, mock_llm):
    """核可制的同一條護欄：沒有任何 op 進 pending＝沒收納，不戳記。"""
    _h, uid = auth_header
    with db_session() as db:
        user = crud.get_user(db, uid)
        user.memory_write_mode = "approval"
        db.commit()
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=BAD_REPLY)
    assert result.pending == 0 and result.failed == 1
    assert _uningested(uid) == ["name"]


def test_ledger_source_is_onboarding(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    _run(uid, mock_llm, reply=OPS_REPLY)
    with db_session() as db:
        ops = crud.get_memory_ops(db, uid, limit=10, offset=0)
    assert ops and ops[0].source == "onboarding"


def test_diary_pass_also_carries_material(client, auth_header, mock_llm):
    """零金鑰走完 onboarding 的人：首篇日記後的一般 review pass 自然補收。"""
    from providers.base import LLMConfig
    from services.memory_review import run_review_pass
    _h, uid = auth_header
    _seed(uid, "hobbies", "打羽球")
    mock_llm.respond(OPS_REPLY)
    result = run_review_pass(uid, LLMConfig(provider="claude", api_key="sk-test"),
                             lang="zh-TW", source="review_pass",
                             diary_content="今天打了羽球", valence=0.7)
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "收納素材" in prompt and "打羽球" in prompt
    assert result.applied == 1
    assert _uningested(uid) == []


def test_material_with_braces_does_not_break_prompt(client, auth_header, mock_llm):
    """安全：素材是 memory_review_prompt.format() 的「值」——答案含花括號時
    _build_prompt 不炸 KeyError、原文完整入 prompt。"""
    _h, uid = auth_header
    _seed(uid, "self_view", "喜歡用 {} 寫程式")
    result = _run(uid, mock_llm, reply=json.dumps({"ops": []}))
    assert result.error is None
    assert "喜歡用 {} 寫程式" in mock_llm.calls[0]["messages"][1]["content"]
