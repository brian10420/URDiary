"""LLM 憑證的靜態加密 (v2.3 task 1.6)。

`llm_credentials.api_key_enc` 存的是這裡產生的 Fernet 密文，不是明文。
加密金鑰由 `config.SECRET_KEY` 經 HKDF-SHA256 導出（固定 salt + 固定
info 字串）——不直接拿 SECRET_KEY 當 Fernet key，是為了讓「簽 JWT 的
金鑰」與「加密 API Key 的金鑰」在密碼學上互相獨立：同一把秘密被兩個
不同用途共用時，其中一邊的弱點（例如某天換掉 JWT 演算法）會直接波及
另一邊。固定 salt 在這裡是可接受的：HKDF 的 salt 只在「同一把 IKM 要
導出多把彼此獨立的金鑰」時才需要隨機，而本專案的用途只有一個，且
SECRET_KEY 本身就是 32 bytes 的高熵隨機值（不是使用者選的密碼，沒有
字典攻擊的問題）。

**輪換 SECRET_KEY 會讓所有已儲存的 LLM 金鑰解不開**（config.py 的
SECRET_KEY 說明處也標註了同一件事）。這種情況不可以變成 500 或啟動時
的當機迴圈：`decrypt_secret()` 回 None，呼叫端一律當成「沒有這組憑證」
往下一個來源找（見 services/llm_credential_service.py 的解析順序），
使用者只要在設定面板重新填一次金鑰即可。

**任何日誌都不得出現明文金鑰**：這個模組只在解密失敗時記一行不含金鑰
內容的 warning；要顯示給人看時一律經 `mask_secret()`（只露最後 4 碼）。
"""
import base64
import logging
from typing import Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

import config

logger = logging.getLogger(__name__)

# HKDF 的 info/salt：固定值即可（見模組說明）。改動這兩個常數等同輪換
# 金鑰——既有密文會全部解不開，不要為了「看起來更好看」而改。
_HKDF_INFO = b"urdiary-llm-credentials"
_HKDF_SALT = b"urdiary-key-vault-v1"

# 遮罩時保留的尾碼長度；金鑰長度 <= 這個值時一個字元都不露
_MASK_VISIBLE = 4
_MASK_PREFIX = "****"

# (產生這把 Fernet 的 SECRET_KEY, Fernet 實例)。快取只為省下重複的 HKDF
# 導出，鍵是 SECRET_KEY 本身，所以 monkeypatch 換掉 SECRET_KEY 之後
# 會自動重新導出（測試另外呼叫 reset_cache() 讓意圖更明確）。
_cached: Tuple[Optional[str], Optional[Fernet]] = (None, None)


def reset_cache() -> None:
    """丟棄已導出的金鑰快取（測試模擬 SECRET_KEY 輪換時使用）。"""
    global _cached
    _cached = (None, None)


def _fernet() -> Fernet:
    """由目前的 `config.SECRET_KEY` 導出 Fernet 實例。

    刻意用 `import config` + 呼叫當下讀模組屬性（與 config.REQUIRE_INVITE /
    RATE_LIMIT_ENABLED 同一個讀法），不要 `from config import SECRET_KEY`
    把值綁死在本模組 import 當下——否則測試無法模擬輪換。
    """
    global _cached
    secret = config.SECRET_KEY
    cached_secret, cached_fernet = _cached
    if cached_fernet is not None and cached_secret == secret:
        return cached_fernet

    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,                 # Fernet 要求 32 bytes（16 簽章 + 16 加密）
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    ).derive(secret.encode("utf-8"))

    fernet = Fernet(base64.urlsafe_b64encode(derived))
    _cached = (secret, fernet)
    return fernet


def encrypt_secret(plaintext: str) -> str:
    """加密一段機密字串，回傳可直接存進 TEXT 欄位的 ASCII 密文。

    空字串是合法輸入（local 供應商通常不需要金鑰），會被如實加密，
    解密後仍回空字串——與「沒有這一列」是不同的兩件事。
    """
    return _fernet().encrypt((plaintext or "").encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> Optional[str]:
    """解密；**失敗回 None，絕不拋例外**。

    失敗最可能的原因是 SECRET_KEY 被輪換過（或 data/secrets.json 被刪掉
    後重新生成）。呼叫端必須把 None 當成「這組憑證不存在」往下一個來源
    找，讓 App 在使用者重新填金鑰之前仍然可用。
    """
    try:
        return _fernet().decrypt((token or "").encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        # 不記錄 token 本身，也不記錄任何金鑰內容
        logger.warning(
            "LLM 憑證解密失敗（SECRET_KEY 可能已輪換），此憑證視為不存在；"
            "請在設定面板重新填入 API Key"
        )
        return None


def mask_secret(plaintext: Optional[str]) -> str:
    """給人看的遮罩字串：只露最後 4 碼，其餘固定 4 個星號。

    前綴固定長度（不隨金鑰長度變化）——金鑰有多長本身也是資訊。
    空字串回空字串（表示「這組憑證沒有金鑰」，例如本地端點）。
    """
    if not plaintext:
        return ""
    if len(plaintext) <= _MASK_VISIBLE:
        return _MASK_PREFIX
    return f"{_MASK_PREFIX}{plaintext[-_MASK_VISIBLE:]}"
