"""
測試密碼強度檢查工具

使用方法：python -m utils.test_password_strength
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from password_validator import is_strong_password, validate_password_and_get_errors

def test_password(password):
    print(f"\n測試密碼: '{password}'")
    is_strong = is_strong_password(password)
    print(f"密碼強度足夠: {is_strong}")
    
    if not is_strong:
        errors = validate_password_and_get_errors(password)
        print("不符合的要求:")
        for error in errors:
            print(f"- {error}")
    
    return is_strong

def run_tests():
    print("========== 密碼強度測試 ==========")
    
    # 測試弱密碼
    weak_passwords = [
        "password",           # 無大寫、數字、特殊字符
        "Password",           # 無數字、特殊字符
        "Password1",          # 無特殊字符
        "Pass!",              # 長度不足
    ]
    
    # 測試強密碼
    strong_passwords = [
        "Password1!",         # 符合所有要求
        "StrongP@ssw0rd",     # 符合所有要求
        "C0mpl3x!P@ss",       # 符合所有要求
    ]
    
    failed = 0
    
    print("\n--- 測試弱密碼 (應該全部失敗) ---")
    for pwd in weak_passwords:
        if test_password(pwd):
            print(f"❌ 測試失敗: '{pwd}' 被錯誤地標記為強密碼")
            failed += 1
    
    print("\n--- 測試強密碼 (應該全部通過) ---")
    for pwd in strong_passwords:
        if not test_password(pwd):
            print(f"❌ 測試失敗: '{pwd}' 被錯誤地標記為弱密碼")
            failed += 1
    
    print("\n========== 測試結果 ==========")
    if failed == 0:
        print("✅ 所有測試通過!")
    else:
        print(f"❌ {failed} 個測試失敗!")
    
    # 測試當前.env設置的密碼
    print("\n========== 測試當前環境變量密碼 ==========")
    try:
        from dotenv import load_dotenv
        load_dotenv()
        db_pass = os.getenv("DB_PASS")
        if db_pass:
            print(f"數據庫密碼: '{db_pass[0]}{'*' * (len(db_pass)-2)}{db_pass[-1] if len(db_pass) > 1 else ''}'")
            test_password(db_pass)
        else:
            print("未設置DB_PASS環境變量")
    except Exception as e:
        print(f"讀取環境變量時出錯: {e}")

if __name__ == "__main__":
    run_tests() 