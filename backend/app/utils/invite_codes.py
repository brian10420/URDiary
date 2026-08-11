"""邀請碼的雜湊工具 (v2.3 task 1.4)。

共用給 `api/routes/user.py` (驗證時) 與 `scripts/urdiary_admin.py` (產生時)，
兩邊的雜湊邏輯必須完全一致，否則 CLI 產生的碼永遠驗不過 —— 因此獨立成
單一函式，不在兩處各自重寫一份 hashlib 呼叫。

明文碼由 CLI 以 `secrets.token_urlsafe(16)` 產生 (約 128 bits 熵)，純隨機、
每組碼只用一次雜湊比對，因此不需要 salt/pepper —— 不同於密碼雜湊
(`utils/security.py` 的 bcrypt + HASH_SALT，那是為了應付「使用者密碼熵低、
可能重複使用於別處」的情境)。邀請碼的熵已經足夠高，直接 sha256 就是
等值安全、且便宜到能被 CLI/路由頻繁查詢的做法。
"""
import hashlib


def hash_invite_code(plaintext: str) -> str:
    """回傳邀請碼明文的 sha256 hex digest —— 資料庫 code_hash 欄位唯一會存的形式。"""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
