#!/usr/bin/env python3
"""
URDiary v1.2.6 修復驗證腳本
測試資料庫連接和title欄位是否正常工作
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

def test_database_connection():
    """測試資料庫連接"""
    try:
        # 設定環境變數
        os.environ['DB_PASS'] = 'Ligtace760123@'
        
        from app.database import engine, SessionLocal
        from app.database import crud
        from app.database.models import User, Diary
        
        print("🔍 測試資料庫連接...")
        
        # 測試連接
        connection = engine.connect()
        print("✅ 資料庫連接成功！")
        
        # 測試表結構
        result = connection.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'diaries' AND column_name = 'title'")
        title_column = result.fetchone()
        
        if title_column:
            print("✅ diaries表的title欄位存在！")
        else:
            print("❌ diaries表的title欄位不存在！")
            return False
            
        connection.close()
        
        # 測試CRUD操作
        print("🔍 測試CRUD操作...")
        db = SessionLocal()
        try:
            # 確保有測試用戶
            test_user = crud.get_user_by_username(db, "test_user")
            if not test_user:
                test_user = crud.create_user(db, "test_user")
                print("✅ 創建測試用戶成功")
            
            # 測試創建日記（包含title）
            test_diary = crud.create_diary(
                db=db,
                user_id=test_user.id,
                title="測試日記標題",
                content="這是一個測試日記內容",
                valence=0.7,
                arousal=0.3
            )
            print("✅ 創建日記成功（包含title）")
            
            # 測試獲取日記
            retrieved_diary = crud.get_diary(db, test_diary.id)
            if retrieved_diary and retrieved_diary.title == "測試日記標題":
                print("✅ 獲取日記成功，title欄位正常")
            else:
                print("❌ 獲取日記失敗或title欄位異常")
                return False
                
            # 清理測試數據
            crud.delete_diary(db, test_diary.id)
            print("✅ 清理測試數據成功")
            
        finally:
            db.close()
            
        return True
        
    except Exception as e:
        print(f"❌ 資料庫測試失敗: {str(e)}")
        return False

def test_api_endpoints():
    """測試API端點"""
    try:
        print("🔍 測試API端點導入...")
        
        from app.api.routes.chat import router as chat_router
        from app.api.routes.diary import router as diary_router
        
        print("✅ API路由導入成功")
        
        # 檢查修復的函數
        from app.services.diary_service import generate_diary_title, save_diary_for_user
        
        # 測試標題生成
        test_content = "今天是美好的一天，我學到了很多新東西。"
        title = generate_diary_title(test_content)
        
        if title and len(title) > 0:
            print(f"✅ 日記標題生成成功: {title}")
        else:
            print("❌ 日記標題生成失敗")
            return False
            
        return True
        
    except Exception as e:
        print(f"❌ API端點測試失敗: {str(e)}")
        return False

def main():
    """主測試函數"""
    print("🚀 開始URDiary v1.2.6修復驗證...")
    print("=" * 50)
    
    # 測試資料庫
    db_success = test_database_connection()
    print()
    
    # 測試API
    api_success = test_api_endpoints()
    print()
    
    # 總結
    print("=" * 50)
    if db_success and api_success:
        print("🎉 所有測試通過！修復成功！")
        print("✅ 資料庫title欄位已正確添加")
        print("✅ API端點已正確修復")
        print("✅ 日記生成功能正常")
        return 0
    else:
        print("❌ 部分測試失敗，請檢查錯誤訊息")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 