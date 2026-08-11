"""鎖定 utils/key_vault.py —— LLM 憑證的靜態加密 (v2.3 task 1.6)。

三件事必須成立：
1. 加密／解密可以來回 (round-trip)，且密文不含明文片段。
2. SECRET_KEY 輪換後舊密文解不開時，**降級成「沒有這組憑證」**
   (回 None + 一行 warning)，不是拋例外、不是 500、不是每次請求都炸。
3. 遮罩只露最後 4 碼，任何情況下都不會把明文完整吐出來。
"""
import logging

import pytest

import config
import utils.key_vault as key_vault
from utils.key_vault import decrypt_secret, encrypt_secret, mask_secret


PLAINTEXT = "sk-test-abcdefghijklmnop-9876"


@pytest.fixture(autouse=True)
def _clear_derived_key_cache():
    """key_vault 會快取「由目前 SECRET_KEY 導出的 Fernet」；測試會 monkeypatch
    config.SECRET_KEY 模擬輪換，前後都清一次快取避免互相污染。"""
    key_vault.reset_cache()
    yield
    key_vault.reset_cache()


# --- round-trip --------------------------------------------------------------

def test_encrypt_then_decrypt_returns_the_original_plaintext():
    token = encrypt_secret(PLAINTEXT)
    assert decrypt_secret(token) == PLAINTEXT


def test_ciphertext_never_contains_the_plaintext():
    token = encrypt_secret(PLAINTEXT)
    assert PLAINTEXT not in token
    # 連尾段都不該直接出現 (Fernet 是 AES-CBC + HMAC，這裡只是把「沒有意外
    # 存成明文」這件事釘死)
    assert PLAINTEXT[-8:] not in token


def test_same_plaintext_encrypts_to_different_ciphertexts():
    """Fernet 每次用新的 IV：同一把金鑰加密同一段明文，兩次密文不同
    (否則資料庫裡可以直接比對出「這兩個人用同一把 API Key」)。"""
    assert encrypt_secret(PLAINTEXT) != encrypt_secret(PLAINTEXT)


def test_empty_string_round_trips():
    """local 供應商可以沒有金鑰；空字串要能存也能取回，不可變成 None。"""
    assert decrypt_secret(encrypt_secret("")) == ""


# --- SECRET_KEY 輪換 → 降級而非炸掉 --------------------------------------------

def test_decrypt_after_secret_key_rotation_returns_none(monkeypatch, caplog):
    token = encrypt_secret(PLAINTEXT)

    key_vault.reset_cache()
    monkeypatch.setattr(config, "SECRET_KEY", "a-completely-different-secret-key")

    with caplog.at_level(logging.WARNING):
        assert decrypt_secret(token) is None

    assert caplog.records, "解密失敗時應留下一行 warning"
    assert not any(PLAINTEXT in record.getMessage() for record in caplog.records)


def test_decrypt_garbage_returns_none_instead_of_raising():
    for garbage in ("", "not-a-fernet-token", "!!!!", "gAAAAA"):
        assert decrypt_secret(garbage) is None


def test_secret_key_is_read_at_call_time_not_import_time(monkeypatch):
    """金鑰導出必須在呼叫當下讀 config.SECRET_KEY (模組屬性)，不能在 import
    當下綁死值——否則測試無從模擬輪換，正式環境也讀不到後改的設定。"""
    monkeypatch.setattr(config, "SECRET_KEY", "secret-number-one")
    key_vault.reset_cache()
    token_one = encrypt_secret(PLAINTEXT)

    monkeypatch.setattr(config, "SECRET_KEY", "secret-number-two")
    key_vault.reset_cache()
    token_two = encrypt_secret(PLAINTEXT)

    assert decrypt_secret(token_two) == PLAINTEXT
    assert decrypt_secret(token_one) is None  # 換過金鑰，舊密文解不開


# --- 遮罩 ---------------------------------------------------------------------

def test_mask_reveals_only_the_last_four_characters():
    masked = mask_secret(PLAINTEXT)
    assert masked.endswith(PLAINTEXT[-4:])
    assert PLAINTEXT[:-4] not in masked
    assert len(masked) <= 12  # 不隨金鑰長度變長 (長度本身也是資訊)


def test_mask_of_short_or_empty_secret_reveals_nothing():
    assert mask_secret("") == ""
    assert "abc" not in mask_secret("abc")
    assert mask_secret("abcd") == "****"  # 剛好 4 碼也不露
