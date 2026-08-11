"""鎖定 config.py 新增的前端靜態檔設定 (SERVE_FRONTEND / FRONTEND_DIR)。

v2.3：後端同源提供 desktop/ 的靜態檔，讓手機能透過 HTTPS tunnel 用同一個
origin 存取 App + API (main.py 的 StaticFiles 掛載與明確檔案路由讀這兩個值)。
"""
from pathlib import Path

import config

_REPO_ROOT = Path(__file__).resolve().parents[2]


def test_frontend_dir_defaults_to_repo_root_desktop_anchored_by_file_location():
    """路徑必須錨定在 config.py 檔案位置，不能依賴啟動目錄
    (uvicorn 實際上是以 backend/ 為 CWD 執行的)。"""
    assert config.FRONTEND_DIR == _REPO_ROOT / "desktop"


def test_serve_frontend_defaults_on_since_desktop_dir_exists_in_this_repo():
    assert config.SERVE_FRONTEND is True


def test_env_flag_returns_default_when_var_unset(monkeypatch):
    monkeypatch.delenv("URDIARY_TEST_ONLY_FLAG", raising=False)
    assert config._env_flag("URDIARY_TEST_ONLY_FLAG", default=True) is True
    assert config._env_flag("URDIARY_TEST_ONLY_FLAG", default=False) is False


def test_env_flag_recognizes_falsy_strings(monkeypatch):
    for falsy in ("0", "false", "False", "no", "NO", "off", ""):
        monkeypatch.setenv("URDIARY_TEST_ONLY_FLAG", falsy)
        assert config._env_flag("URDIARY_TEST_ONLY_FLAG", default=True) is False


def test_env_flag_recognizes_truthy_strings(monkeypatch):
    for truthy in ("1", "true", "True", "yes", "on", "anything-else"):
        monkeypatch.setenv("URDIARY_TEST_ONLY_FLAG", truthy)
        assert config._env_flag("URDIARY_TEST_ONLY_FLAG", default=False) is True
