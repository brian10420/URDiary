import re

def is_strong_password(password: str) -> bool:
    """
    檢查密碼強度是否滿足要求:
    1. 至少8個字符
    2. 至少包含一個大寫字母
    3. 至少包含一個小寫字母
    4. 至少包含一個數字
    5. 至少包含一個特殊字符
    """
    if len(password) < 8:
        return False
    
    # 檢查是否包含大寫字母
    if not re.search(r'[A-Z]', password):
        return False
    
    # 檢查是否包含小寫字母
    if not re.search(r'[a-z]', password):
        return False
    
    # 檢查是否包含數字
    if not re.search(r'[0-9]', password):
        return False
    
    # 檢查是否包含特殊字符
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False
    
    return True

def validate_password_and_get_errors(password: str) -> list:
    """
    驗證密碼並返回不符合要求的錯誤列表
    """
    errors = []
    
    if len(password) < 8:
        errors.append("密碼長度至少需要8個字符")
        
    if not re.search(r'[A-Z]', password):
        errors.append("密碼需要包含至少一個大寫字母")
        
    if not re.search(r'[a-z]', password):
        errors.append("密碼需要包含至少一個小寫字母")
        
    if not re.search(r'[0-9]', password):
        errors.append("密碼需要包含至少一個數字")
        
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        errors.append("密碼需要包含至少一個特殊字符")
        
    return errors 