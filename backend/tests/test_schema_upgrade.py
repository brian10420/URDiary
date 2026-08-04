"""鎖定 database/schema_upgrade.py 的輕量欄位升級機制 (冪等的 ALTER TABLE ADD COLUMN)。

用一個獨立的臨時 sqlite 檔案 (tmp_path)，手刻缺少 last_checkin_date 欄位的
舊版 users 表，驗證 ensure_schema() 會補上缺欄，且重跑不會出錯。
"""
from sqlalchemy import create_engine, inspect, text

from database.schema_upgrade import ensure_schema


def _make_legacy_engine(tmp_path):
    """建一個只有「舊版」users 表 (缺 last_checkin_date) 的獨立 sqlite 檔案。"""
    db_path = tmp_path / "schema_upgrade_test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password_hash VARCHAR(255),
                created_at DATETIME
            )
            """
        ))
    return engine


def test_ensure_schema_adds_missing_column(tmp_path):
    engine = _make_legacy_engine(tmp_path)
    inspector = inspect(engine)
    before_columns = {col["name"] for col in inspector.get_columns("users")}
    assert "last_checkin_date" not in before_columns

    ensure_schema(engine)

    inspector = inspect(engine)
    after_columns = {col["name"] for col in inspector.get_columns("users")}
    assert "last_checkin_date" in after_columns
    # 原有欄位維持不動
    assert {"id", "username", "password_hash", "created_at"} <= after_columns


def test_ensure_schema_is_idempotent(tmp_path):
    engine = _make_legacy_engine(tmp_path)

    ensure_schema(engine)  # 第一次：補上缺欄
    ensure_schema(engine)  # 第二次：欄位已存在，不應該重複 ADD COLUMN 而炸掉

    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("users")]
    # 欄位沒有被重複加入 (仍然只出現一次)
    assert columns.count("last_checkin_date") == 1


def test_ensure_schema_skips_tables_that_do_not_exist_yet(tmp_path):
    """users 表以外，其餘 model 定義的表 (diaries/diary_embeddings/...) 在這個
    臨時資料庫裡並不存在；ensure_schema 應該直接跳過它們，不嘗試建表或報錯。"""
    engine = _make_legacy_engine(tmp_path)

    ensure_schema(engine)  # 不應拋出例外

    inspector = inspect(engine)
    assert inspector.has_table("users")
    assert not inspector.has_table("diaries")
