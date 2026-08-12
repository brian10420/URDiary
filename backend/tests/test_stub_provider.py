"""env-gated stub LLM 供應商鎖定測試（v2.3 task 3.2：Playwright 手機 E2E 用）。

**安全鐵律**：stub 只有在環境變數 URDIARY_ALLOW_STUB_LLM=1 時才可達。沒有這個
旗標（正式環境、以及本測試套件其餘所有測試——conftest.py 從不設定它），
provider="stub" 必須被當成「打錯字的供應商名稱」一視同仁拒絕：

    - 不出現在 providers.factory.KNOWN_PROVIDERS（那份清單只服務「可被持久化
      成使用者/伺服器憑證」的供應商，見 services/llm_credential_service.py 的
      is_known_provider；stub 不需要金鑰、永遠不該被存進 llm_credentials 表）
    - build_provider(LLMConfig(provider="stub")) 拋出的 LLMError 訊息與任何
      未知供應商完全一致（不多印一個字透露 stub 存在）
    - 就算前端／攻擊者直接送 X-LLM-Provider: stub 標頭（get_llm_config 的
      標頭分支本來就不檢查 KNOWN_PROVIDERS——真正的守門只在 build_provider），
      /chat/ 端點一樣是既有的 503（走到 LLMError 才會知道，不是被標頭層擋下，
      這裡直接證明兩層都測到）

旗標開啟（monkeypatch os.environ，逐案切換，讀法與 config.REQUIRE_INVITE /
config.RATE_LIMIT_ENABLED 同一套模式）時，stub 才會回傳固定內容，讓 Playwright
E2E 可以在不需要真實 API Key 的情況下確定性地跑完整條對話→日記管線。
"""
import pytest

from providers.base import LLMConfig, LLMError
from providers.factory import KNOWN_PROVIDERS, build_provider
import providers.stub_provider as stub_provider_module
import llm as llm_module
from services.prompt_loader import get_role


# --- KNOWN_PROVIDERS：靜態清單，不受旗標影響 ------------------------------------

def test_stub_never_in_known_providers():
    """KNOWN_PROVIDERS 是「可持久化憑證」的供應商清單（PUT /users/me/llm 的
    驗證、user.py 的錯誤訊息都讀這裡）。stub 不需要金鑰，永遠不該出現在這裡
    ——這個斷言不受任何旗標影響，旗標開著也一樣。"""
    assert "stub" not in KNOWN_PROVIDERS


# --- build_provider：旗標關閉（預設）時完全打不到 --------------------------------

def test_stub_rejected_like_unknown_provider_when_flag_unset(monkeypatch):
    monkeypatch.delenv("URDIARY_ALLOW_STUB_LLM", raising=False)

    with pytest.raises(LLMError, match=r"不支援的 LLM 供應商: 'stub'"):
        build_provider(LLMConfig(provider="stub", model="m", api_key="k"))


def test_stub_rejected_when_flag_explicitly_zero(monkeypatch):
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "0")

    with pytest.raises(LLMError, match=r"不支援的 LLM 供應商: 'stub'"):
        build_provider(LLMConfig(provider="stub", model="m", api_key="k"))


def test_stub_error_message_identical_to_genuinely_unknown_provider(monkeypatch):
    """不只是「同一種例外類型」，訊息文字本身必須一致——不能讓 stub 走一條
    措辭不同的分支（那本身就是一種洩漏：代表 'stub' 這個名字有特殊意義）。"""
    monkeypatch.delenv("URDIARY_ALLOW_STUB_LLM", raising=False)

    with pytest.raises(LLMError) as stub_exc:
        build_provider(LLMConfig(provider="stub", model="m", api_key="k"))
    with pytest.raises(LLMError) as bogus_exc:
        build_provider(LLMConfig(provider="totally-bogus-xyz", model="m", api_key="k"))

    expected_stub_msg = str(bogus_exc.value).replace("totally-bogus-xyz", "stub")
    assert str(stub_exc.value) == expected_stub_msg


# --- build_provider：旗標開啟時可用且決定性 -------------------------------------

def test_stub_selectable_and_returns_canned_chat_reply_when_flag_enabled(monkeypatch):
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "1")

    provider = build_provider(LLMConfig(provider="stub", model="stub-e2e", api_key=""))
    assert isinstance(provider, stub_provider_module.StubProvider)

    reply = provider.chat(
        [
            {"role": "system", "content": get_role("companion", "zh-TW")},
            {"role": "user", "content": "今天過得怎麼樣？"},
        ],
        model="stub-e2e",
    )
    assert reply == stub_provider_module.STUB_CHAT_REPLY

    # 兩次呼叫、任何輸入，回覆都相同——Playwright 斷言要能鎖定固定文字。
    reply_again = provider.chat([{"role": "user", "content": "完全不同的輸入"}], model="stub-e2e")
    assert reply_again == stub_provider_module.STUB_CHAT_REPLY


def test_stub_returns_diary_body_for_diary_writer_role(monkeypatch):
    """依 system 角色句判斷這次呼叫是不是日記生成（services/diary_service.py
    的 generate_enhanced_diary 固定用 get_role("diary_writer", lang) 當
    system 訊息）。中英文角色句都要能對到，不能只認 zh-TW。"""
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "1")
    provider = build_provider(LLMConfig(provider="stub", model="stub-e2e"))

    for lang in ("zh-TW", "en"):
        messages = [
            {"role": "system", "content": get_role("diary_writer", lang)},
            {"role": "user", "content": "今天的對話紀錄……"},
        ]
        reply = provider.chat(messages, model="stub-e2e")
        assert reply == stub_provider_module.STUB_DIARY_BODY


def test_stub_returns_interaction_note_for_note_taker_role(monkeypatch):
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "1")
    provider = build_provider(LLMConfig(provider="stub", model="stub-e2e"))

    for lang in ("zh-TW", "en"):
        messages = [
            {"role": "system", "content": get_role("note_taker", lang)},
            {"role": "user", "content": "更新互動筆記……"},
        ]
        reply = provider.chat(messages, model="stub-e2e")
        assert reply == stub_provider_module.STUB_INTERACTION_NOTE


def test_stub_defaults_to_chat_reply_when_no_system_message():
    """沒有 system 訊息（理論上不會發生，但防禦性地確認不拋例外）時，
    退回一般對話回覆，不是拋錯。"""
    provider = stub_provider_module.StubProvider()
    reply = provider.chat([{"role": "user", "content": "hi"}], model="stub-e2e")
    assert reply == stub_provider_module.STUB_CHAT_REPLY


# --- llm.default_config()：stub 只是「其他後備都沒有」時的最後手段 ----------------

def test_default_config_falls_back_to_stub_when_flag_enabled_and_no_env_key(monkeypatch):
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "1")
    monkeypatch.setattr(llm_module, "XAI_API_KEY", None)

    cfg = llm_module.default_config()
    assert cfg.provider == "stub"

    resolved = llm_module.resolve_config(None)
    assert resolved.provider == "stub"
    assert resolved.model  # resolve_config 不需要再幫它補模型，本來就非空


def test_default_config_still_errors_when_flag_unset_and_no_env_key(monkeypatch):
    monkeypatch.delenv("URDIARY_ALLOW_STUB_LLM", raising=False)
    monkeypatch.setattr(llm_module, "XAI_API_KEY", None)

    with pytest.raises(LLMError):
        llm_module.default_config()


def test_default_config_prefers_xai_key_over_stub_even_when_flag_enabled(monkeypatch):
    """stub 的優先權嚴格低於既有的 .env Grok 後備——旗標開著、但真的有
    XAI_API_KEY 時，行為必須與改動前完全相同（stub 絕不搶原本就會生效的
    後備）。"""
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "1")
    monkeypatch.setattr(llm_module, "XAI_API_KEY", "sk-real-fallback-key")

    cfg = llm_module.default_config()
    assert cfg.provider == "grok"


# --- API 層：/chat/ 端點驗證「兩層都測到」----------------------------------------
# 這裡刻意不用 conftest 的 mock_llm fixture（它會整個攔截 llm.chat，繞過我們
# 真正想驗證的 build_provider 閘門）——要驗證的正是「沒有 mock 時，真正的
# StubProvider 會不會被擋下/放行」。

def test_chat_endpoint_rejects_stub_header_when_flag_unset(client, auth_header, monkeypatch):
    monkeypatch.delenv("URDIARY_ALLOW_STUB_LLM", raising=False)
    headers, _ = auth_header

    resp = client.post(
        "/chat/",
        json={"message": "hi"},
        headers={**headers, "X-LLM-Provider": "stub", "X-LLM-Model": "stub-e2e",
                 "X-LLM-Api-Key": "whatever"},
    )
    assert resp.status_code == 503


def test_chat_endpoint_accepts_stub_header_when_flag_enabled(client, auth_header, monkeypatch):
    monkeypatch.setenv("URDIARY_ALLOW_STUB_LLM", "1")
    headers, _ = auth_header

    resp = client.post(
        "/chat/",
        json={"message": "hi"},
        headers={**headers, "X-LLM-Provider": "stub", "X-LLM-Model": "stub-e2e",
                 "X-LLM-Api-Key": "whatever"},
    )
    assert resp.status_code == 200
    assert resp.json()["response"] == stub_provider_module.STUB_CHAT_REPLY
