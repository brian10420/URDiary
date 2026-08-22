"""鎖定 utils/password_validator.py 的密碼規則。

v2.5 放寬（使用者要求「密碼僅要求數字即可，簡單就好」）：唯一規則＝長度
至少 8 字元，純數字、純字母都可以；大小寫/數字/特殊字符不再強制。
"""
import pytest

from utils.password_validator import is_strong_password, validate_password_and_get_errors

# 應被拒：只剩長度一種可能
TOO_SHORT_PASSWORDS = [
    "1234567",   # 7 碼純數字
    "Pass!",     # 5 碼
    "",          # 空字串
]

# 應通過：長度到了就好（純數字是本次放寬的核心案例）
ACCEPTED_PASSWORDS = [
    "12345678",        # 純數字 8 碼（使用者要的最簡情境）
    "abcdefgh",        # 純小寫字母
    "Password1!",      # 舊強密碼仍然通過
    "StrongP@ssw0rd",
    "C0mpl3x!P@ss",
]


@pytest.mark.parametrize("password", TOO_SHORT_PASSWORDS)
def test_short_passwords_rejected(password):
    assert is_strong_password(password) is False, f"'{password}' 長度不足應被拒"


@pytest.mark.parametrize("password", ACCEPTED_PASSWORDS)
def test_length_only_passwords_accepted(password):
    assert is_strong_password(password) is True, f"'{password}' 長度足夠應通過"


def test_short_password_gets_only_length_error():
    errors = validate_password_and_get_errors("1234567")
    assert errors == ["密碼長度至少需要8個字符"]


def test_short_password_english_error():
    errors = validate_password_and_get_errors("1234567", lang="en")
    assert errors == ["Password must be at least 8 characters"]


@pytest.mark.parametrize("password", ACCEPTED_PASSWORDS)
def test_accepted_passwords_have_no_errors(password):
    assert validate_password_and_get_errors(password) == []
