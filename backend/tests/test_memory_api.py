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


# --- v2.6：區段標題依介面語言 (X-Language) --------------------------------------

EN = {"X-Language": "en"}


def test_en_user_chat_end_writes_en_headers(client, auth_header, llm_headers, mock_llm):
    """全新 en 使用者：對話結束的 review pass 建出的記憶檔是英文節標題。"""
    import json
    headers, uid = auth_header
    hdrs = {**headers, **llm_headers, **EN}
    mock_llm.respond("Sounds lovely!")
    assert client.post("/chat/", json={"message": "Had pho with Annie"}, headers=hdrs).status_code == 200
    mock_llm.respond('Had pho with Annie, felt calm.\n'
                     '{"title": "Pho day", "summary": "calm", "valence": 0.8, "arousal": 0.4}')
    mock_llm.respond(json.dumps({"ops": [
        {"action": "add", "file": "user_profile", "section": "Key events timeline",
         "text": "- [2026-09-30] Pho with Annie"},
        {"action": "add", "file": "companion_notes", "section": "Support that works",
         "text": "- Food talk relaxes her (2026-09-30)"}]}))
    resp = client.post("/chat/end/", json={}, headers=hdrs)
    assert resp.status_code == 200 and resp.json()["memory_review"]["applied"] == 2
    files = client.get("/users/me/memory", headers={**headers, **EN}).json()["files"]
    assert files["user_profile"]["content"].startswith("## Name & identity\n\n## Four life domains\n")
    assert "## Key events timeline\n- [2026-09-30] Pho with Annie\n" in files["user_profile"]["content"]
    assert files["companion_notes"]["content"].startswith(
        "## Support that works\n- Food talk relaxes her (2026-09-30)\n")
    op = client.get("/users/me/memory/ops", headers={**headers, **EN}).json()["ops"][-1]
    assert op["section"] == "Key events timeline" and op["section_key"] == "timeline"


def test_ops_listing_localizes_section(client, auth_header):
    headers, uid = auth_header
    with db_session() as db:
        crud.create_memory_ops(db, [
            {"user_id": uid, "file_key": "user_profile", "batch_id": "loc", "action": "add",
             "section": "情緒模式", "new_text": "- legacy", "status": "applied", "source": "review_pass"},
            {"user_id": uid, "file_key": "user_profile", "batch_id": "loc", "action": "add",
             "section": "timeline", "new_text": "- keyed", "status": "applied", "source": "review_pass"},
            {"user_id": uid, "file_key": "user_profile", "batch_id": "loc", "action": "add",
             "section": "壞節", "new_text": "- bad", "status": "failed", "source": "review_pass",
             "error": "bad_section"},
            {"user_id": uid, "file_key": "user_profile", "batch_id": "loc", "action": "user_edit",
             "section": None, "new_text": "## x", "status": "applied", "source": "user_edit"},
        ])

    def listing(extra):
        ops = client.get("/users/me/memory/ops", headers={**headers, **extra}).json()["ops"]
        return {o["new_text"]: (o["section"], o["section_key"]) for o in ops}

    en = listing(EN)
    assert en["- legacy"] == ("Emotional patterns", "emotion_patterns")
    assert en["- keyed"] == ("Key events timeline", "timeline")
    assert en["- bad"] == ("壞節", None)          # 認不得的節：原樣回傳
    assert en["## x"] == (None, None)
    zh = listing({})                                 # 無標頭＝zh-TW：與 v2.5 輸出相同
    assert zh["- legacy"] == ("情緒模式", "emotion_patterns")
    assert zh["- keyed"] == ("重要事件時間線", "timeline")


def test_en_approve_and_batch_approve_create_en_file(client, auth_header):
    headers, uid = auth_header
    op_id = _seed_pending(uid, "- single (2026-09-30)")
    r = client.post(f"/users/me/memory/ops/{op_id}/approve", headers={**headers, **EN})
    assert r.status_code == 200 and r.json()["status"] == "applied"
    content = client.get("/users/me/memory", headers=headers).json()["files"]["user_profile"]["content"]
    assert content.startswith("## Name & identity\n") and "## Emotional patterns\n- single (2026-09-30)\n" in content
    # zh 介面核可同批另一筆 → 整份檔換回 zh 標頭 (寫入者語言勝出)
    _seed_pending(uid, "- batch (2026-09-30)")
    r = client.post("/users/me/memory/batches/api-b1/approve", headers=headers)
    assert r.status_code == 200 and r.json()["applied"] == 1
    content = client.get("/users/me/memory", headers=headers).json()["files"]["user_profile"]["content"]
    assert content.startswith("## 稱呼與身分\n") and "Emotional patterns" not in content
    assert "- single (2026-09-30)\n- batch (2026-09-30)\n" in content
    # en 批次核可也帶語言
    _seed_pending(uid, "- batch2 (2026-09-30)")
    client.post("/users/me/memory/batches/api-b1/approve", headers={**headers, **EN})
    content = client.get("/users/me/memory", headers=headers).json()["files"]["user_profile"]["content"]
    assert content.startswith("## Name & identity\n")


def test_en_undo_keeps_en_headers(client, auth_header):
    headers, uid = auth_header
    op_id = _seed_pending(uid, "- to undo (2026-09-30)")
    client.post(f"/users/me/memory/ops/{op_id}/approve", headers={**headers, **EN})
    r = client.post(f"/users/me/memory/ops/{op_id}/undo", headers={**headers, **EN})
    assert r.status_code == 200 and r.json()["status"] == "undone"
    content = client.get("/users/me/memory", headers=headers).json()["files"]["user_profile"]["content"]
    assert "to undo" not in content and content.startswith("## Name & identity\n")
