"""
安全密鑰和密碼生成工具

使用方法：python -m utils.generate_secrets
"""
import os
import secrets
import string
import base64
import hashlib
from password_validator import is_strong_password

def generate_secure_password(length=16):
    """生成一個安全的隨機密碼，包含大小寫字母、數字和特殊字符"""
    # 確保至少包含每種類型的字符
    uppercase = string.ascii_uppercase
    lowercase = string.ascii_lowercase
    digits = string.digits
    special = "!@#$%^&*()_-+=<>?"
    all_chars = uppercase + lowercase + digits + special
    
    # 確保每種類型至少有一個字符
    password = [
        secrets.choice(uppercase),
        secrets.choice(lowercase),
        secrets.choice(digits),
        secrets.choice(special)
    ]
    
    # 填充剩餘長度
    for _ in range(length - 4):
        password.append(secrets.choice(all_chars))
    
    # 打亂順序
    secrets.SystemRandom().shuffle(password)
    password = ''.join(password)
    
    # 確認密碼符合強度要求
    assert is_strong_password(password), "生成的密碼不符合強度要求"
    
    return password

def generate_api_key(length=32):
    """生成API密鑰 (hex格式)"""
    return secrets.token_hex(length)

def generate_secret_key(length=32):
    """生成安全的密鑰 (hex格式)"""
    return secrets.token_hex(length)

def generate_hash_salt(length=8):
    """生成用於密碼雜湊的鹽值 (hex格式)"""
    return secrets.token_hex(length)

def generate_all_secrets():
    """生成所有需要的密鑰和密碼"""
    db_pass = generate_secure_password()
    redis_pass = generate_secure_password()
    api_key = generate_api_key()
    secret_key = generate_secret_key()
    hash_salt = generate_hash_salt()
    
    print("========== 生成的安全密鑰 ==========")
    print(f"數據庫密碼: {db_pass}")
    print(f"Redis密碼: {redis_pass}")
    print(f"API密鑰: {api_key}")
    print(f"密鑰: {secret_key}")
    print(f"雜湊鹽值: {hash_salt}")
    
    return {
        "DB_PASS": db_pass,
        "REDIS_PASSWORD": redis_pass,
        "API_KEY": api_key,
        "SECRET_KEY": secret_key,
        "HASH_SALT": hash_salt
    }

def update_env_file(secrets_dict, env_file=".env"):
    """更新.env文件中的密鑰"""
    try:
        # 讀取當前.env文件
        if os.path.exists(env_file):
            with open(env_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        else:
            lines = []
        
        # 尋找並替換密鑰行
        new_lines = []
        updated_keys = set()
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#"):
                new_lines.append(line)
                continue
                
            key, _, _ = line.partition('=')
            key = key.strip()
            
            if key in secrets_dict:
                new_lines.append(f"{key}={secrets_dict[key]}")
                updated_keys.add(key)
            else:
                new_lines.append(line)
        
        # 添加缺少的密鑰
        for key, value in secrets_dict.items():
            if key not in updated_keys:
                new_lines.append(f"{key}={value}")
        
        # 寫回文件
        with open(env_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(new_lines) + '\n')
            
        print(f"\n✅ 已更新 {env_file} 文件中的密鑰")
    except Exception as e:
        print(f"❌ 更新 {env_file} 文件失敗: {str(e)}")

def main():
    print("歡迎使用安全密鑰生成工具！")
    print("此工具將生成安全的密碼和密鑰供您的應用使用。\n")
    
    choice = input("您要: \n1. 只顯示生成的密鑰 \n2. 更新 .env 文件 \n請選擇 (1/2): ")
    
    secrets_dict = generate_all_secrets()
    
    if choice == "2":
        confirm = input("\n警告: 這將覆蓋現有的密鑰。確定要繼續嗎? (y/n): ")
        if confirm.lower() == 'y':
            update_env_file(secrets_dict)
        else:
            print("已取消更新操作")
    
    print("\n注意: 請妥善保存這些密鑰，並且不要將它們提交到版本控制系統中！")

if __name__ == "__main__":
    main() 