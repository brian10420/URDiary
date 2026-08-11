import re

from utils.messages import msg

# 規則 -> (檢查函式, 訊息鍵)。訊息一律走 msg()，避免中文寫死在後端而讓
# 英文使用者在手機上看到中文錯誤 (v2.3 認證強化)。
_RULES = (
    (lambda p: len(p) >= 8, "password_min_length"),
    (lambda p: bool(re.search(r'[A-Z]', p)), "password_need_upper"),
    (lambda p: bool(re.search(r'[a-z]', p)), "password_need_lower"),
    (lambda p: bool(re.search(r'[0-9]', p)), "password_need_digit"),
    (lambda p: bool(re.search(r'[!@#$%^&*(),.?":{}|<>]', p)), "password_need_special"),
)


def is_strong_password(password: str) -> bool:
    """
    檢查密碼強度是否滿足要求:
    1. 至少8個字符
    2. 至少包含一個大寫字母
    3. 至少包含一個小寫字母
    4. 至少包含一個數字
    5. 至少包含一個特殊字符
    """
    return all(check(password) for check, _ in _RULES)


def validate_password_and_get_errors(password: str, lang: str = "zh-TW") -> list:
    """
    驗證密碼並返回不符合要求的錯誤列表 (依 lang 回中/英文)
    """
    return [msg(key, lang) for check, key in _RULES if not check(password)]
