"""run_review_pass 管線 (v2.5 Spec C Task 4)。全部經 mock_llm，不打網路。"""
import json

from database import db_session, crud


def _ops_json(ops):
    return json.dumps({"ops": ops}, ensure_ascii=False)


def _run(user_id, mock_llm, reply, **kwargs):
    from services.memory_review import run_review_pass
    from providers.base import LLMConfig
    if reply is not None:
        mock_llm.respond(reply)
    cfg = LLMConfig(provider="claude", model="m", api_key="k", base_url=None)
    return run_review_pass(user_id, cfg, lang="zh-TW",
                           chat_history=[{"role": "user", "content": "今天去吃牛肉湯"}],
                           diary_content="今天帶朋友去吃牛肉湯，很放鬆。",
                           diary_id=None, valence=0.8, **kwargs)


def test_auto_mode_applies_and_records(client, auth_header, mock_llm):
    _h, uid = auth_header
    result = _run(uid, mock_llm, _ops_json([
        {"action": "add", "file": "user_profile", "section": "重要事件時間線",
         "text": "- [2026-08-23] 吃牛肉湯很放鬆"},
        {"action": "add", "file": "companion_notes", "section": "觀察與提醒",
         "text": "- 吃的話題讓他放鬆 (2026-08-23)"},
    ]))
    assert result.error is None and result.applied == 2 and result.pending == 0 and result.failed == 0
    with db_session() as db:
        files = crud.get_memory_files(db, uid)
        assert "吃牛肉湯很放鬆" in files["user_profile"].content
        assert "吃的話題讓他放鬆" in files["companion_notes"].content
        ops = crud.get_memory_ops(db, uid)
        assert len(ops) == 2 and all(o.status == "applied" and o.batch_id == result.batch_id for o in ops)


def test_empty_ops_writes_nothing(client, auth_header, mock_llm):
    _h, uid = auth_header
    result = _run(uid, mock_llm, _ops_json([]))
    assert result.applied == result.failed == result.pending == 0 and result.error is None
    with db_session() as db:
        assert crud.get_memory_files(db, uid) == {}
        assert crud.get_memory_ops(db, uid) == []


def test_parse_failure_is_safe(client, auth_header, mock_llm):
    _h, uid = auth_header
    result = _run(uid, mock_llm, "我覺得今天不錯（完全不是 JSON）")
    assert result.error == "parse_failed" and result.applied == 0
    with db_session() as db:
        assert crud.get_memory_files(db, uid) == {}


def test_target_miss_marks_failed_others_apply(client, auth_header, mock_llm):
    _h, uid = auth_header
    result = _run(uid, mock_llm, _ops_json([
        {"action": "remove", "file": "user_profile", "target": "檔案裡沒有這句"},
        {"action": "add", "file": "user_profile", "section": "情緒模式", "text": "- 放鬆 (2026-08-23)"},
        {"action": "add", "file": "user_profile", "section": "不存在的節", "text": "x"},
        {"action": "add", "file": "第三個檔", "section": "情緒模式", "text": "x"},
    ]))
    assert result.applied == 1 and result.failed == 3
    with db_session() as db:
        ops = crud.get_memory_ops(db, uid)
        errors = {o.error for o in ops if o.status == "failed"}
        assert "target_not_found" in errors and "bad_section" in errors and "bad_file" in errors


def test_over_budget_retry_then_reject(client, auth_header, mock_llm):
    _h, uid = auth_header
    big = "字" * 900
    over_ops = _ops_json([{"action": "add", "file": "user_profile",
                           "section": "情緒模式", "text": big}])
    # 第一次超標 → 重試提示要帶回饋；第二次仍超標 → 整批拒絕、檔案不動
    mock_llm.respond(over_ops)
    result = _run(uid, mock_llm, over_ops)
    assert result.error == "over_budget" and result.applied == 0 and result.failed == 1
    retry_prompt = mock_llm.calls[1]["messages"][1]["content"]
    assert "超標" in retry_prompt  # over_budget_feedback 已填入
    with db_session() as db:
        assert crud.get_memory_files(db, uid) == {}
        ops = crud.get_memory_ops(db, uid)
        assert len(ops) == 1 and ops[0].status == "failed" and ops[0].error == "over_budget"


def test_over_budget_retry_success(client, auth_header, mock_llm):
    _h, uid = auth_header
    mock_llm.respond(_ops_json([{"action": "add", "file": "user_profile",
                                 "section": "情緒模式", "text": "字" * 900}]))
    result = _run(uid, mock_llm, _ops_json([{"action": "add", "file": "user_profile",
                                             "section": "情緒模式", "text": "- 精簡版 (2026-08-23)"}]))
    # 佇列順序：第一則超標 → 觸發重試 → 第二則成功
    assert result.error is None and result.applied == 1
    with db_session() as db:
        assert "精簡版" in crud.get_memory_files(db, uid)["user_profile"].content


def test_approval_mode_pends_without_writing(client, auth_header, mock_llm):
    _h, uid = auth_header
    with db_session() as db:
        crud.get_user(db, uid).memory_write_mode = "approval"
        db.commit()
    result = _run(uid, mock_llm, _ops_json([
        {"action": "add", "file": "user_profile", "section": "情緒模式", "text": "- p (2026-08-23)"},
        {"action": "add", "file": "user_profile", "section": "壞節", "text": "x"},
    ]))
    assert result.pending == 1 and result.failed == 1 and result.applied == 0
    with db_session() as db:
        assert crud.get_memory_files(db, uid) == {}  # 檔案不動
        assert crud.count_pending_ops(db, uid) == 1


def test_migration_seed_includes_legacy_note(client, auth_header, mock_llm):
    _h, uid = auth_header
    from services.interaction_service import create_interaction_note
    with db_session() as db:
        create_interaction_note(db, uid, "## 使用者畫像\n- 舊系統的筆記內容")
    _run(uid, mock_llm, _ops_json([]))
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "舊系統的筆記內容" in prompt and "分流" in prompt
    # 檔案已有內容後不再附舊筆記
    mock_llm.respond(_ops_json([]))
    with db_session() as db:
        crud.upsert_memory_file(db, uid, "user_profile", "## 稱呼與身分\n- 有內容了")
    _run(uid, mock_llm, None)
    assert "舊系統的筆記內容" not in mock_llm.calls[-1]["messages"][1]["content"]


def test_materials_include_day_notes_and_mood(client, auth_header, mock_llm):
    _h, uid = auth_header
    from utils.time_utils import get_diary_date
    with db_session() as db:
        crud.upsert_day_note(db, uid, get_diary_date(), "food", "牛肉湯的快樂")
    from services.memory_review import run_review_pass
    from providers.base import LLMConfig
    mock_llm.respond(_ops_json([]))
    run_review_pass(uid, LLMConfig(provider="claude", model="m", api_key="k", base_url=None),
                    lang="zh-TW", chat_history=None, diary_content="低落的一天", valence=0.2)
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "牛肉湯的快樂" in prompt and "溫柔" in prompt  # day_notes 軌跡＋低落語氣提示


def test_ingest_diary_entrypoint(client, auth_header, mock_llm):
    _h, uid = auth_header
    with db_session() as db:
        diary = crud.create_diary(db, uid, "手寫的一篇日記", valence=0.6, title="手寫", summary="手寫摘要")
        diary_id = diary.id
    from services.memory_review import ingest_diary
    from providers.base import LLMConfig
    mock_llm.respond(_ops_json([{"action": "add", "file": "user_profile",
                                 "section": "情緒模式", "text": "- i (2026-08-23)"}]))
    result = ingest_diary(uid, diary_id, LLMConfig(provider="claude", model="m", api_key="k", base_url=None))
    assert result.applied == 1
    assert "手寫的一篇日記" in mock_llm.calls[0]["messages"][1]["content"]
    with db_session() as db:
        op = crud.get_memory_ops(db, uid)[0]
        assert op.source == "diary_ingest" and op.source_diary_id == diary_id
