"""輕量 schema 升級機制。

`Base.metadata.create_all()` 只建「不存在的表」，不會為既有表加欄位。
這裡在 startup 時比對 model 與實際表結構，缺欄就 `ALTER TABLE ADD COLUMN`——
冪等、只支援「加欄位」(nullable 或含常量預設)，這對本專案的演進足夠，
也是開源使用者跨版本升級唯一需要的機制 (拉新版 → 重啟 → 自動補欄)。

限制：不處理改型別、改約束、刪欄位；新欄位必須 nullable
(SQLite 的 ADD COLUMN 不支援非常量預設的 NOT NULL 欄位)。
"""
import logging

from sqlalchemy import inspect, text

from database.models import Base

logger = logging.getLogger(__name__)


def ensure_schema(engine):
    """比對 models 與資料庫，為既有表補上缺少的欄位 (冪等)。"""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue  # 新表由 create_all 建立
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(
                    f'ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}'
                ))
                logger.info(f"schema upgrade: {table.name} + {column.name} ({col_type})")
