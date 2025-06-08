#!/usr/bin/env python3
"""
數據庫遷移腳本：為 diaries 表添加 title 列
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, create_engine
from sqlalchemy.orm import sessionmaker
from urllib.parse import quote_plus
import logging

# 設置日誌
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_add_title_column():
    """添加 title 列到 diaries 表"""
    
    # 直接使用 localhost 連接（容器外運行）
    DB_HOST = "localhost"
    DB_PORT = "5432"
    DB_USER = "myuser"
    DB_PASS = "Ligtace760123@"
    DB_NAME = "mydb"
    
    # 對密碼進行URL編碼
    encoded_pass = quote_plus(DB_PASS)
    DB_URL = f"postgresql://{DB_USER}:{encoded_pass}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    
    # 創建引擎和會話
    engine = create_engine(DB_URL, echo=False)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    db = SessionLocal()
    try:
        # 檢查 title 列是否已存在
        check_column_query = text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'diaries' AND column_name = 'title'
        """)
        
        result = db.execute(check_column_query).fetchone()
        
        if result:
            logger.info("title 列已存在，無需添加")
            return True
            
        # 添加 title 列
        logger.info("開始添加 title 列到 diaries 表")
        add_column_query = text("""
            ALTER TABLE diaries 
            ADD COLUMN title VARCHAR(255)
        """)
        
        db.execute(add_column_query)
        db.commit()
        logger.info("成功添加 title 列")
        
        # 為現有記錄生成標題
        logger.info("開始為現有記錄生成標題")
        update_titles_query = text("""
            UPDATE diaries 
            SET title = CASE 
                WHEN LENGTH(content) > 20 THEN 
                    SUBSTRING(content FROM 1 FOR 20) || '...'
                ELSE 
                    COALESCE(content, '無標題日記')
            END
            WHERE title IS NULL OR title = ''
        """)
        
        result = db.execute(update_titles_query)
        db.commit()
        logger.info(f"成功更新 {result.rowcount} 條記錄的標題")
        
        return True
        
    except Exception as e:
        logger.error(f"遷移失敗: {str(e)}")
        db.rollback()
        return False
    finally:
        db.close()

if __name__ == "__main__":
    success = migrate_add_title_column()
    if success:
        print("遷移成功完成")
        sys.exit(0)
    else:
        print("遷移失敗")
        sys.exit(1) 