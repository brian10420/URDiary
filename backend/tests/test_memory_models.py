"""記憶資料層：models + crud (v2.5 Spec C Task 1)。"""
from datetime import datetime


def _db():
    from database import SessionLocal
    return SessionLocal()


def test_memory_file_upsert_and_unique(client, auth_header):
    from database import crud
    _headers, user_id = auth_header
    db = _db()
    try:
        assert crud.get_memory_file(db, user_id, "user_profile") is None
        row = crud.upsert_memory_file(db, user_id, "user_profile", "## 稱呼與身分\n- 小B (2026-08-23)")
        assert row.id and row.content.startswith("## 稱呼與身分")
        # upsert 覆蓋同一列，不長第二列
        row2 = crud.upsert_memory_file(db, user_id, "user_profile", "新內容")
        assert row2.id == row.id and row2.content == "新內容"
        files = crud.get_memory_files(db, user_id)
        assert set(files.keys()) == {"user_profile"}
    finally:
        db.close()


def test_memory_ops_create_list_count(client, auth_header):
    from database import crud
    _headers, user_id = auth_header
    db = _db()
    try:
        ops = crud.create_memory_ops(db, [
            {"user_id": user_id, "file_key": "user_profile", "batch_id": "b1",
             "action": "add", "section": "情緒模式", "new_text": "- x (2026-08-23)",
             "status": "applied", "source": "review_pass", "source_diary_id": None},
            {"user_id": user_id, "file_key": "companion_notes", "batch_id": "b1",
             "action": "remove", "target_text": "舊句", "status": "pending",
             "source": "review_pass"},
        ])
        assert len(ops) == 2 and all(o.id for o in ops)
        assert crud.count_pending_ops(db, user_id) == 1
        listed = crud.get_memory_ops(db, user_id, limit=10, offset=0)
        assert len(listed) == 2 and listed[0].id > listed[1].id  # 新在前
        assert [o.id for o in crud.get_ops_by_batch(db, user_id, "b1")] == sorted(o.id for o in ops)
        pend = crud.get_pending_ops(db, user_id)
        assert len(pend) == 1 and pend[0].action == "remove"
        one = crud.get_memory_op(db, user_id, pend[0].id)
        assert one is not None
        assert crud.get_memory_op(db, user_id + 999, pend[0].id) is None  # 跨用戶隔離
    finally:
        db.close()


def test_users_memory_write_mode_column(client, auth_header):
    from database import crud
    _headers, user_id = auth_header
    db = _db()
    try:
        user = crud.get_user(db, user_id)
        assert user.memory_write_mode is None  # 預設 NULL = auto
        user.memory_write_mode = "approval"
        db.commit()
        assert crud.get_user(db, user_id).memory_write_mode == "approval"
    finally:
        db.close()
