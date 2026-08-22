from utils.messages import msg

# 規則 -> (檢查函式, 訊息鍵)。訊息一律走 msg()，避免中文寫死在後端而讓
# 英文使用者在手機上看到中文錯誤 (v2.3 認證強化)。
# v2.5 放寬（使用者要求「密碼僅要求數字即可，簡單就好」）：唯一規則＝長度
# 至少 8 字元——純數字（如 12345678）即可通過；本專案是全本地單機資料，
# 密碼複雜度交給使用者自行決定。
_RULES = (
    (lambda p: len(p) >= 8, "password_min_length"),
)


def is_strong_password(password: str) -> bool:
    """檢查密碼是否滿足要求：至少 8 個字符（純數字可）。"""
    return all(check(password) for check, _ in _RULES)


def validate_password_and_get_errors(password: str, lang: str = "zh-TW") -> list:
    """
    驗證密碼並返回不符合要求的錯誤列表 (依 lang 回中/英文)
    """
    return [msg(key, lang) for check, key in _RULES if not check(password)]
