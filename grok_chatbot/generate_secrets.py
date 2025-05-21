# generate_secrets.py
# 用於生成安全的密鑰和密碼的工具

import secrets
import random
import string
import os
import re
from dotenv import load_dotenv

def generate_api_key(length=32):
    """生成API密鑰"""
    return secrets.token_hex(length // 2)

def generate_secret_key(length=64):
    """生成安全密鑰"""
    return secrets.token_hex(length // 2)

def generate_strong_password(length=20):
    """生成強密碼，包含大小寫字母、數字和特殊字符"""
    char_set = string.ascii_lowercase + string.ascii_uppercase + string.digits + "!@#$%^&*()_+-="
    # 確保密碼包含各種字符類型
    password = [
        random.choice(string.ascii_lowercase),
        random.choice(string.ascii_uppercase),
        random.choice(string.digits),
        random.choice("!@#$%^&*()_+-=")
    ]
    # 填充剩餘長度
    password.extend(random.choice(char_set) for _ in range(length - 4))
    # 打亂密碼
    random.shuffle(password)
    return ''.join(password)

def update_env_file(env_file='.env'):
    """更新.env文件中的密鑰和密碼"""
    # 加載當前.env文件
    load_dotenv(env_file)
    
    try:
        with open(env_file, 'r', encoding='utf-8') as file:
            env_content = file.read()
    except FileNotFoundError:
        env_content = ""
        print(f"創建新的{env_file}文件。")
    
    # 生成新的密鑰和密碼
    new_keys = {
        'API_KEY': generate_api_key(),
        'SECRET_KEY': generate_secret_key(),
        'HASH_SALT': secrets.token_hex(8),
        'DB_PASS': generate_strong_password(),
        'REDIS_PASSWORD': generate_strong_password()
    }
    
    # 更新.env內容
    for key, value in new_keys.items():
        # 檢查鍵是否存在，並替換其值
        pattern = re.compile(f"^{key}=.*$", re.MULTILINE)
        replacement = f"{key}={value}"
        
        if pattern.search(env_content):
            env_content = pattern.sub(replacement, env_content)
        else:
            env_content += f"\n{replacement}"
    
    # 寫回文件
    with open(env_file, 'w', encoding='utf-8') as file:
        file.write(env_content)
    
    print(f"{env_file}文件已更新，新密鑰和密碼已生成。")
    print("注意：請保護好這些敏感信息！")
    
    # 打印新密碼供管理員記錄
    print("\n===== 新生成的密碼 (請妥善保存) =====")
    print(f"DB_PASS: {new_keys['DB_PASS']}")
    print(f"REDIS_PASSWORD: {new_keys['REDIS_PASSWORD']}")
    print("=====================================")

if __name__ == "__main__":
    update_env_file()
    print("密鑰生成完成！")