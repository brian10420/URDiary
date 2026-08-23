"""onboarding 資料層：models + crud (v2.5 Spec B Task 1)。"""


def _db():
    from database import SessionLocal
    return SessionLocal()


def test_onboarding_answer_upsert_and_unique(client, auth_header):
    from database import crud
    _h, uid = auth_header
    db = _db()
    try:
        assert crud.get_onboarding_answers(db, uid) == []
        row = crud.upsert_onboarding_answer(db, uid, "favorite_food", "牛肉湯")
        assert row.id and row.answer_text == "牛肉湯" and row.answered_at is not None
        assert row.ingested_at is None
        # 重答覆蓋同一列，不長第二列；answered_at 更新
        first_at = row.answered_at
        row2 = crud.upsert_onboarding_answer(db, uid, "favorite_food", "咖哩飯")
        assert row2.id == row.id and row2.answer_text == "咖哩飯"
        assert row2.answered_at >= first_at
        assert len(crud.get_onboarding_answers(db, uid)) == 1
    finally:
        db.close()


def test_upsert_resets_ingested_at(client, auth_header):
    from database import crud
    _h, uid = auth_header
    db = _db()
    try:
        row = crud.upsert_onboarding_answer(db, uid, "hobbies", "打羽球")
        crud.mark_onboarding_answers_ingested(db, uid, [row.id])
        assert crud.get_uningested_onboarding_answers(db, uid) == []
        # 重答＝新素材，重新等待收納
        crud.upsert_onboarding_answer(db, uid, "hobbies", "打羽球和爬山")
        pending = crud.get_uningested_onboarding_answers(db, uid)
        assert [r.question_key for r in pending] == ["hobbies"]
    finally:
        db.close()


def test_uningested_filters(client, auth_header):
    from database import crud
    _h, uid = auth_header
    db = _db()
    try:
        crud.upsert_onboarding_answer(db, uid, "name", "小明")
        crud.upsert_onboarding_answer(db, uid, "location", "")            # 跳過
        crud.upsert_onboarding_answer(db, uid, "companion_naming", "小澄")  # 陪伴者名字
        keys = {r.question_key for r in crud.get_uningested_onboarding_answers(db, uid)}
        assert keys == {"name"}
        # answered_keys 語意（state API 用）：三筆都在
        assert len(crud.get_onboarding_answers(db, uid)) == 3
    finally:
        db.close()


def test_mark_ingested_scoped_to_user(client, auth_header, other_auth_header):
    from database import crud
    _h, uid = auth_header
    _h2, other_uid = other_auth_header
    db = _db()
    try:
        row = crud.upsert_onboarding_answer(db, uid, "strengths", "有毅力")
        # 別人的 user_id 戳不到我的列
        assert crud.mark_onboarding_answers_ingested(db, other_uid, [row.id]) == 0
        assert len(crud.get_uningested_onboarding_answers(db, uid)) == 1
        assert crud.mark_onboarding_answers_ingested(db, uid, [row.id]) == 1
        assert crud.get_uningested_onboarding_answers(db, uid) == []
        assert crud.mark_onboarding_answers_ingested(db, uid, []) == 0  # 空清單 no-op
    finally:
        db.close()


def test_users_onboarding_completed_at_column(client, auth_header):
    from database import crud
    _h, uid = auth_header
    from datetime import datetime
    db = _db()
    try:
        user = crud.get_user(db, uid)
        assert user.onboarding_completed_at is None  # 預設 NULL＝未完成
        user.onboarding_completed_at = datetime.utcnow()
        db.commit()
        assert crud.get_user(db, uid).onboarding_completed_at is not None
    finally:
        db.close()


def test_question_keys_whitelist_constant(client):
    from database.models import ONBOARDING_QUESTION_KEYS
    assert ONBOARDING_QUESTION_KEYS == (
        "companion_naming", "name", "location", "favorite_food",
        "important_people", "hobbies", "strengths", "self_view")
