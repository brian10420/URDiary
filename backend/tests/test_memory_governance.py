"""治理操作：核可/拒絕/撤銷/直接編輯/總覽 (v2.5 Spec C Task 5)。"""
from database import db_session, crud
from services import memory_files as mf
from services import memory_review as mr


def _seed_pending(uid, *, action="add", section="情緒模式", target=None,
                  text="- p (2026-08-23)", file_key="user_profile"):
    with db_session() as db:
        rows = crud.create_memory_ops(db, [{
            "user_id": uid, "file_key": file_key, "batch_id": "batch-t5",
            "action": action, "section": section, "target_text": target,
            "new_text": text, "status": "pending", "source": "review_pass"}])
        return rows[0].id


def _seed_applied_add(uid, text="- a (2026-08-23)", section="情緒模式"):
    with db_session() as db:
        content = mf.apply_op("user_profile", "", "add", section=section, text=text).content
        crud.upsert_memory_file(db, uid, "user_profile", content)
        rows = crud.create_memory_ops(db, [{
            "user_id": uid, "file_key": "user_profile", "batch_id": "batch-t5a",
            "action": "add", "section": section, "target_text": None,
            "new_text": text, "status": "applied", "source": "review_pass"}])
        return rows[0].id


def test_approve_applies_to_current_file(client, auth_header):
    _h, uid = auth_header
    op_id = _seed_pending(uid)
    r = mr.approve_op(uid, op_id)
    assert r["ok"] and r["status"] == "applied"
    with db_session() as db:
        assert "- p (2026-08-23)" in crud.get_memory_files(db, uid)["user_profile"].content
        assert crud.get_memory_op(db, uid, op_id).decided_at is not None


def test_approve_stale_when_target_gone(client, auth_header):
    _h, uid = auth_header
    op_id = _seed_pending(uid, action="remove", section=None, target="不存在的原文", text=None)
    r = mr.approve_op(uid, op_id)
    assert not r["ok"] and r["status"] == "stale"
    with db_session() as db:
        assert crud.get_memory_op(db, uid, op_id).status == "stale"


def test_approve_refuses_over_budget(client, auth_header):
    _h, uid = auth_header
    with db_session() as db:
        crud.upsert_memory_file(db, uid, "user_profile", "x" * 795)
    op_id = _seed_pending(uid, text="- 這句一定會爆掉上限 (2026-08-23)")
    r = mr.approve_op(uid, op_id)
    assert not r["ok"] and r["error"] == "over_budget"
    with db_session() as db:
        assert crud.get_memory_op(db, uid, op_id).status == "pending"  # 保持待決


def test_reject_and_not_pending_guard(client, auth_header):
    _h, uid = auth_header
    op_id = _seed_pending(uid)
    assert mr.reject_op(uid, op_id)["status"] == "rejected"
    again = mr.approve_op(uid, op_id)
    assert not again["ok"] and again["error"] == "not_pending"
    assert not mr.approve_op(uid, 99999)["ok"]  # not_found


def test_undo_add_remove_replace(client, auth_header):
    _h, uid = auth_header
    # undo add
    op_id = _seed_applied_add(uid, text="- 要撤銷的 (2026-08-23)")
    r = mr.undo_op(uid, op_id)
    assert r["ok"] and r["status"] == "undone"
    with db_session() as db:
        assert "要撤銷的" not in crud.get_memory_files(db, uid)["user_profile"].content
    # undo replace（target ↔ new_text 反向）
    with db_session() as db:
        content = mf.apply_op("user_profile", "", "add", section="情緒模式", text="- 新句 (2026-08-23)").content
        crud.upsert_memory_file(db, uid, "user_profile", content)
        rep = crud.create_memory_ops(db, [{
            "user_id": uid, "file_key": "user_profile", "batch_id": "b", "action": "replace",
            "section": None, "target_text": "舊句", "new_text": "新句", "status": "applied",
            "source": "review_pass"}])[0].id
    assert mr.undo_op(uid, rep)["ok"]
    with db_session() as db:
        assert "舊句" in crud.get_memory_files(db, uid)["user_profile"].content
    # undo remove（把 target 補回原節）
    with db_session() as db:
        rem = crud.create_memory_ops(db, [{
            "user_id": uid, "file_key": "user_profile", "batch_id": "b", "action": "remove",
            "section": "情緒模式", "target_text": "- 被刪的 (2026-08-01)", "new_text": None,
            "status": "applied", "source": "review_pass"}])[0].id
    assert mr.undo_op(uid, rem)["ok"]
    with db_session() as db:
        content = crud.get_memory_files(db, uid)["user_profile"].content
        assert "被刪的" in content and mf.find_section_of(content, "被刪的") == "情緒模式"


def test_undo_conflict_when_content_changed(client, auth_header):
    _h, uid = auth_header
    op_id = _seed_applied_add(uid, text="- 已被手改掉 (2026-08-23)")
    with db_session() as db:
        crud.upsert_memory_file(db, uid, "user_profile", "## 稱呼與身分\n- 全部重寫了")
    r = mr.undo_op(uid, op_id)
    assert not r["ok"] and r["error"] == "target_not_found"
    with db_session() as db:
        assert crud.get_memory_op(db, uid, op_id).status == "applied"  # 狀態不變


def test_batch_approve_and_reject(client, auth_header):
    _h, uid = auth_header
    _seed_pending(uid, text="- b1 (2026-08-23)")
    _seed_pending(uid, action="remove", section=None, target="沒這句", text=None)
    r = mr.approve_batch(uid, "batch-t5")
    assert r["applied"] == 1 and r["stale"] == 1
    op3 = _seed_pending(uid, text="- b3 (2026-08-23)")
    assert mr.reject_batch(uid, "batch-t5")["rejected"] == 1
    with db_session() as db:
        assert crud.get_memory_op(db, uid, op3).status == "rejected"


def test_save_user_edit_caps_ledger_and_stale(client, auth_header):
    _h, uid = auth_header
    pend = _seed_pending(uid, action="replace", section=None, target="待改的原文", text="改後")
    keep = _seed_pending(uid, text="- 純新增不受影響 (2026-08-23)")
    over = mr.save_user_edit(uid, "user_profile", "x" * 801)
    assert not over["ok"] and over["error"] == "over_limit"
    bad = mr.save_user_edit(uid, "no_such_file", "x")
    assert not bad["ok"] and bad["error"] == "bad_file"
    ok = mr.save_user_edit(uid, "user_profile", "## 稱呼與身分\n- 我自己寫的")
    assert ok["ok"] and ok["stale_count"] == 1
    with db_session() as db:
        assert crud.get_memory_op(db, uid, pend).status == "stale"
        assert crud.get_memory_op(db, uid, keep).status == "pending"  # add 無 target 不受影響
        ops = crud.get_memory_ops(db, uid)
        assert ops[0].action == "user_edit" and ops[0].status == "applied" and ops[0].source == "user_edit"


def test_overview_and_write_mode(client, auth_header):
    _h, uid = auth_header
    ov = mr.get_memory_overview(uid)
    assert ov["write_mode"] == "auto" and ov["pending_count"] == 0
    assert set(ov["files"].keys()) == {"user_profile", "companion_notes"}
    assert ov["files"]["user_profile"]["limit"] == 800
    assert ov["files"]["user_profile"]["content"] == ""  # 懶建立前回空字串
    assert mr.set_write_mode(uid, "approval")["ok"]
    assert not mr.set_write_mode(uid, "chaos")["ok"]
    _seed_pending(uid)
    ov2 = mr.get_memory_overview(uid)
    assert ov2["write_mode"] == "approval" and ov2["pending_count"] == 1
