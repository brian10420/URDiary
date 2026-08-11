"""鎖定 utils/password_validator.py 的密碼強度規則。

弱/強密碼案例清單搬自已刪除的 utils/test_password_strength.py (原本是會炸
pytest 收集的 print 腳本)；錯誤訊息斷言以現行程式碼實際回傳的字串為準。
"""
import pytest

from utils.password_validator import is_strong_password, validate_password_and_get_errors

# 搬自舊腳本的弱密碼案例 (應該全部被拒)
WEAK_PASSWORDS = [
    "password",   # 無大寫、數字、特殊字符 (長度剛好 8，不觸發長度錯誤)
    "Password",   # 無數字、特殊字符
    "Password1",  # 無特殊字符
    "Pass!",      # 長度不足 (且缺數字)
]

# 搬自舊腳本的強密碼案例 (應該全部通過)
STRONG_PASSWORDS = [
    "Password1!",
    "StrongP@ssw0rd",
    "C0mpl3x!P@ss",
]


@pytest.mark.parametrize("password", WEAK_PASSWORDS)
def test_weak_passwords_rejected(password):
    assert is_strong_password(password) is False, f"'{password}' 不應被判定為強密碼"


@pytest.mark.parametrize("password", STRONG_PASSWORDS)
def test_strong_passwords_accepted(password):
    assert is_strong_password(password) is True, f"'{password}' 應被判定為強密碼"


def test_weak_password_missing_upper_digit_special_errors():
    errors = validate_password_and_get_errors("password")
    assert "密碼需要包含至少一個大寫字母" in errors
    assert "密碼需要包含至少一個數字" in errors
    assert "密碼需要包含至少一個特殊字符" in errors
    # 長度剛好 8，不應該有長度錯誤
    assert "密碼長度至少需要8個字符" not in errors
    assert len(errors) == 3


def test_weak_password_missing_digit_special_errors():
    errors = validate_password_and_get_errors("Password")
    assert errors == ["密碼需要包含至少一個數字", "密碼需要包含至少一個特殊字符"]


def test_weak_password_missing_special_only():
    errors = validate_password_and_get_errors("Password1")
    assert errors == ["密碼需要包含至少一個特殊字符"]


def test_weak_password_too_short_and_missing_digit():
    errors = validate_password_and_get_errors("Pass!")
    assert errors == ["密碼長度至少需要8個字符", "密碼需要包含至少一個數字"]


@pytest.mark.parametrize("password", STRONG_PASSWORDS)
def test_strong_passwords_have_no_errors(password):
    assert validate_password_and_get_errors(password) == []
