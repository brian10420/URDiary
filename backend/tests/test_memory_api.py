"""/users/me/memory 端點組 (v2.5 Spec C Task 8)。"""
from database import db_session, crud


def _seed_pending(uid, text="- p (2026-08-23)"):
    with db_session() as db:
        return crud.create_memory_ops(db, [{
            "user_id": uid, "file_key": "user_profile", "batch_id": "api-b1",
            "action": "add", "section": "情緒模式", "target_text": None,
            "new_text": text, "status": "pending", "source": "review_pass"}])[0].id


def test_requires_auth(client):
    assert client.get("/users/me/memory").status_code == 401


def test_overview_shape(client, auth_header):
    headers, uid = auth_header
    r = client.get("/users/me/memory", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["write_mode"] == "auto" and body["pending_count"] == 0
    assert body["files"]["user_profile"]["limit"] == 800
    assert body["files"]["companion_notes"]["limit"] == 600


def test_put_file_and_validation(client, auth_header):
    headers, uid = auth_header
    ok = client.put("/users/me/memory/files/user_profile",
                    json={"content": "## 稱呼與身分\n- 自己寫的"}, headers=headers)
    assert ok.status_code == 200 and ok.json()["ok"]
    got = client.get("/users/me/memory", headers=headers).json()
    assert "自己寫的" in got["files"]["user_profile"]["content"]
    too_long = client.put("/users/me/memory/files/user_profile",
                          json={"content": "x" * 801}, headers=headers)
    assert too_long.status_code == 422
    bad_key = client.put("/users/me/memory/files/no_such",
                         json={"content": "x"}, headers=headers)
    assert bad_key.status_code == 404


def test_settings_toggle(client, auth_header):
    headers, uid = auth_header
    ok = client.put("/users/me/memory/settings", json={"write_mode": "approval"}, headers=headers)
    assert ok.status_code == 200
    assert client.get("/users/me/memory", headers=headers).json()["write_mode"] == "approval"
    bad = client.put("/users/me/memory/settings", json={"write_mode": "chaos"}, headers=headers)
    assert bad.status_code == 422


def test_ops_listing_with_diary_title(client, auth_header):
    headers, uid = auth_header
    with db_session() as db:
        diary = crud.create_diary(db, uid, "內容", title="牛肉湯之日", summary="s")
        crud.create_memory_ops(db, [{
            "user_id": uid, "file_key": "user_profile", "batch_id": "api-b2",
            "action": "add", "section": "情緒模式", "new_text": "- x",
            "status": "applied", "source": "review_pass", "source_diary_id": diary.id}])
    r = client.get("/users/me/memory/ops", headers=headers)
    assert r.status_code == 200
    op = r.json()["ops"][0]
    assert op["source_diary_title"] == "牛肉湯之日" and op["status"] == "applied"


def test_op_actions(client, auth_header):
    headers, uid = auth_header
    op_id = _seed_pending(uid)
    r = client.post(f"/users/me/memory/ops/{op_id}/approve", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "applied"
    again = client.post(f"/users/me/memory/ops/{op_id}/approve", headers=headers)
    assert again.status_code == 409  # not_pending
    undo = client.post(f"/users/me/memory/ops/{op_id}/undo", headers=headers)
    assert undo.status_code == 200 and undo.json()["status"] == "undone"
    assert client.post("/users/me/memory/ops/99999/reject", headers=headers).status_code == 404


def test_batch_actions(client, auth_header):
    headers, uid = auth_header
    _seed_pending(uid, "- b1 (2026-08-23)")
    _seed_pending(uid, "- b2 (2026-08-23)")
    r = client.post("/users/me/memory/batches/api-b1/approve", headers=headers)
    assert r.status_code == 200 and r.json()["applied"] == 2


def test_cross_user_isolation(client, auth_header, other_auth_header):
    headers, uid = auth_header
    other_headers, _other = other_auth_header
    op_id = _seed_pending(uid)
    assert client.post(f"/users/me/memory/ops/{op_id}/approve",
                       headers=other_headers).status_code == 404
