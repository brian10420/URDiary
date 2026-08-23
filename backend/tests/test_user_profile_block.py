"""注入層三態 fallback 與 builder 接線 (v2.5 Spec C Task 7)。"""
from database import db_session, crud
from services.user_profile import get_memory_context, get_user_profile_block


def test_state_new_files(client, auth_header):
    _h, uid = auth_header
    with db_session() as db:
        crud.upsert_memory_file(db, uid, "user_profile", "## 稱呼與身分\n- 小B (2026-08-23)")
        crud.upsert_memory_file(db, uid, "companion_notes", "## 有效的支持方式\n- 別追問 (2026-08-23)")
    ctx = get_memory_context(uid, "zh-TW")
    assert ctx.has_any
    assert "【你對這位使用者的長期認識（使用者檔案）】" in ctx.profile_block
    assert "小B" in ctx.profile_block and "不要向他複誦" in ctx.profile_block  # 使用說明緊貼
    assert "【你自己的陪伴筆記" in ctx.companion_block and "別追問" in ctx.companion_block
    assert "小B" in ctx.diary_context and "別追問" in ctx.diary_context
    assert get_user_profile_block(uid, "zh-TW") == ctx.profile_block  # Spec B 契約


def test_state_legacy_fallback(client, auth_header):
    _h, uid = auth_header
    from services.interaction_service import create_interaction_note
    with db_session() as db:
        create_interaction_note(db, uid, "## 使用者畫像\n- 舊筆記內容")
    ctx = get_memory_context(uid, "zh-TW")
    assert ctx.has_any and "舊筆記內容" in ctx.profile_block
    assert ctx.companion_block == ""  # 舊筆記只進 profile 塊
    assert "舊筆記內容" in ctx.diary_context


def test_state_empty_placeholder_both_langs(client, auth_header):
    _h, uid = auth_header
    zh = get_memory_context(uid, "zh-TW")
    assert not zh.has_any and "還不熟" in zh.profile_block and zh.companion_block == ""
    assert zh.diary_context == "尚無互動筆記記錄。"
    en = get_memory_context(uid, "en")
    assert "barely know" in en.profile_block


def test_conversation_prompt_injects_blocks(client, auth_header):
    _h, uid = auth_header
    with db_session() as db:
        crud.upsert_memory_file(db, uid, "user_profile", "## 稱呼與身分\n- 小B (2026-08-23)")
    from services.prompt_builder import build_conversation_system
    ctx = get_memory_context(uid, "zh-TW")
    for lang in ("zh-TW", "en"):
        c = get_memory_context(uid, lang)
        system = build_conversation_system(
            lang=lang, user_profile_block=c.profile_block,
            companion_notes_block=c.companion_block,
            relevant_memories="（無）", today_date="2026-08-23")
        assert "小B" in system
        assert "{user_profile_block}" not in system and "{interaction_note}" not in system
        assert "\n\n\n" not in system  # companion 空塊不留三連空行
