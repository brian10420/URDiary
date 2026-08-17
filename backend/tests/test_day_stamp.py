"""鎖定 services/day_stamp.py 與日記管線的印章寫入 (v2.5 Spec A)。"""
from database import crud, db_session, models
from services import day_stamp
from services.diary_draft import parse_diary_output
from services.prompt_loader import get_role


def _seed_chat_history(user_id, messages):
    """比照 test_diary_api.py 的同名慣例：直接寫入對話歷史，繞過真的 LLM
    呼叫與 /chat/ 端點的 X-LLM-* 標頭需求，只為了讓 run_end_of_chat_pipeline
    看到非空的 chat_history。"""
    from memory_manager import append_chat_messages
    append_chat_messages(user_id, messages)


def test_parse_diary_output_extracts_stamp_and_note():
    text = '日記正文。\n{"title": "t", "summary": "s", "valence": 0.8, "arousal": 0.4, "stamp": "cake", "note": "幫媽媽慶生的一天"}'
    draft = parse_diary_output(text)
    assert draft.stamp == "cake"
    assert draft.note == "幫媽媽慶生的一天"
    assert "stamp" not in draft.content


def test_parse_diary_output_without_stamp_fields_is_none():
    text = '正文。\n{"title": "t", "summary": "s", "valence": 0.5, "arousal": 0.5}'
    draft = parse_diary_output(text)
    assert draft.stamp is None
    assert draft.note is None


def test_finalize_low_valence_forces_encourage_set():
    stamp, note = day_stamp.finalize("cake", "打起精神", 0.3)
    assert stamp == day_stamp.FALLBACK_ENCOURAGE          # 非鼓勵組被替換
    stamp2, _ = day_stamp.finalize("rainbow", "會好起來的", 0.3)
    assert stamp2 == "rainbow"                             # 鼓勵組原樣通過


def test_finalize_unknown_or_missing_stamp_returns_none():
    assert day_stamp.finalize("nonsense", "x", 0.8)[0] is None
    assert day_stamp.finalize(None, "x", 0.8)[0] is None


def test_finalize_boundary_045_is_not_negative():
    stamp, _ = day_stamp.finalize("cake", "x", 0.45)
    assert stamp == "cake"


def test_finalize_cleans_note():
    _, note = day_stamp.finalize("cake", "  第一行\n第二行  ", 0.8)
    assert "\n" not in note and note.startswith("第一行")
    _, long_note = day_stamp.finalize("cake", "很" * 200, 0.8)
    assert len(long_note) <= day_stamp.NOTE_MAX


def test_pipeline_writes_day_note(client, auth_header, mock_llm, llm_headers):
    """/chat/end 成功後 day_notes 有落地 (mock_llm 的日記輸出含 stamp/note tail)。

    conftest 的 mock_llm 預設回覆 (`default_reply`) 不含 JSON tail，這裡比照
    test_diary_api.py::test_enhanced_generate_success_parses_diary_and_creates_note
    的「依 system role 內容決定回覆」寫法，腳本化 diary_writer 角色的回覆；
    chat 造數據則比照同檔的 `_seed_chat_history`，直接寫歷史、不經真的
    /chat/ 端點 (避免另外要求 LLM 供應商標頭)。"""
    headers, user_id = auth_header
    _seed_chat_history(user_id, [
        {"role": "user", "content": "今天幫媽媽慶生"},
        {"role": "assistant", "content": "聽起來是溫馨的一天。"},
    ])

    diary_writer_role = get_role("diary_writer", "zh-TW")
    diary_reply = (
        '今天幫媽媽慶生，很開心。\n'
        '{"title": "幫媽媽慶生", "summary": "今天陪媽媽過生日", '
        '"valence": 0.8, "arousal": 0.4, "stamp": "cake", "note": "幫媽媽慶生的一天"}'
    )
    harmless_default = mock_llm.default_reply  # 先存一份，避免下面覆寫後自我參照

    def scripted(messages, cfg):
        return diary_reply if messages[0]["content"] == diary_writer_role else harmless_default

    mock_llm.default_reply = scripted

    resp = client.post("/chat/end/", json={"exclude_interaction_notes": True,
                                           "enable_day_note": True},
                       headers={**headers, **llm_headers})
    assert resp.status_code == 200
    with db_session() as db:
        rows = db.query(models.DayNote).filter_by(user_id=user_id).all()
        assert len(rows) == 1
        assert rows[0].stamp == "cake"
        assert rows[0].phrase == "幫媽媽慶生的一天"


def test_pipeline_flag_off_writes_nothing(client, auth_header, mock_llm, llm_headers):
    """enable_day_note=False 時就算模型回了合法印章也不寫入——旗標優先於模型輸出。"""
    headers, user_id = auth_header
    _seed_chat_history(user_id, [
        {"role": "user", "content": "隨便聊聊"},
        {"role": "assistant", "content": "好啊，想聊什麼呢？"},
    ])

    diary_writer_role = get_role("diary_writer", "zh-TW")
    diary_reply = (
        '今天很平常。\n'
        '{"title": "平常的一天", "summary": "沒什麼特別的事", '
        '"valence": 0.6, "arousal": 0.3, "stamp": "sun", "note": "平凡也很好"}'
    )
    harmless_default = mock_llm.default_reply

    def scripted(messages, cfg):
        return diary_reply if messages[0]["content"] == diary_writer_role else harmless_default

    mock_llm.default_reply = scripted

    resp = client.post("/chat/end/", json={"exclude_interaction_notes": True,
                                           "enable_day_note": False},
                       headers={**headers, **llm_headers})
    assert resp.status_code == 200
    with db_session() as db:
        rows = db.query(models.DayNote).filter_by(user_id=user_id).all()
        assert rows == []
