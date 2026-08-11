"""鎖定 utils/messages.py 的 zh/en 訊息對照與格式化後備規則。"""
import utils.messages as messages_module
from utils.messages import msg


def test_known_key_has_both_languages_and_they_differ():
    zh_text = msg("diary_not_found", "zh-TW")
    en_text = msg("diary_not_found", "en")

    assert zh_text == "日記不存在"
    assert en_text == "Diary not found"
    assert zh_text != en_text


def test_every_key_has_both_languages_and_they_differ():
    """雙語對等的機器把關 (global-constraints「Bilingual parity」)。

    只靠 msg() 的 fallback 兜底，漏譯的鍵會安靜地回中文給英文使用者，
    要等有人切到 en 剛好用到那個畫面才會發現。
    """
    missing_en = sorted(k for k, v in messages_module.MESSAGES.items() if not v.get("en"))
    missing_zh = sorted(k for k, v in messages_module.MESSAGES.items() if not v.get("zh-TW"))
    assert missing_en == [], f"缺少 en 翻譯: {missing_en}"
    assert missing_zh == [], f"缺少 zh-TW 翻譯: {missing_zh}"

    identical = sorted(k for k, v in messages_module.MESSAGES.items() if v["en"] == v["zh-TW"])
    assert identical == [], f"en 與 zh-TW 完全相同 (疑似漏譯): {identical}"


def test_unknown_key_returns_the_key_itself():
    assert msg("this_key_does_not_exist") == "this_key_does_not_exist"


def test_missing_language_entry_falls_back_to_zh_tw(monkeypatch):
    """現行 MESSAGES 字典裡每個 key 目前都同時有 zh-TW/en；用 monkeypatch 注入
    一個只有 zh-TW 的假 key，直接驗證 msg() 對「該語言缺項」的後備邏輯
    (entry.get(lang) or entry.get('zh-TW') or key)。"""
    patched = dict(messages_module.MESSAGES)
    patched["__test_only_zh_entry__"] = {"zh-TW": "只有中文版本"}
    monkeypatch.setattr(messages_module, "MESSAGES", patched)

    assert msg("__test_only_zh_entry__", "en") == "只有中文版本"


def test_error_kwargs_formats_into_template():
    result = msg("ai_unavailable", "zh-TW", error="連線逾時")
    assert result == "AI 服務暫時無法使用: 連線逾時"

    result_en = msg("ai_unavailable", "en", error="timeout")
    assert result_en == "The AI service is temporarily unavailable: timeout"


def test_mismatched_kwargs_do_not_raise_and_return_raw_template():
    """模板需要 {error} 但呼叫端傳錯 kwarg 名稱：現行行為是吞掉 KeyError，
    回傳「未格式化」的原始模板字串，而不是拋例外或補空字串。"""
    template = messages_module.MESSAGES["ai_unavailable"]["zh-TW"]
    result = msg("ai_unavailable", "zh-TW", wrong_kwarg_name="x")

    assert result == template
    assert "{error}" in result
