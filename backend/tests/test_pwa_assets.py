"""v2.3 task 2.2 (PWA)：產出的靜態資產本身是否正確——manifest 是合法 JSON
且帶齊必要欄位、icon 是合法 PNG 且尺寸正確、favicon.ico 有合法的 ICO 檔頭、
sw.js 的更新流程沒有在 install 時就 skipWaiting。

這裡直接讀 desktop/ 底下的真實檔案，不透過 HTTP／TestClient：關注點是
「產出的檔案內容本身對不對」，跟 test_frontend_static.py 鎖的「HTTP 路由/
標頭」是不同層次，兩者刻意分開。
"""
import json
import re
import struct

import pytest

import config

FRONTEND_DIR = config.FRONTEND_DIR


def _png_dimensions(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path} 不是合法的 PNG (magic bytes 不符)"
    # PNG 規格保證 IHDR 是檔案裡的第一個 chunk：8 bytes 簽章之後接
    # 4 bytes 長度 + 4 bytes 'IHDR' + 4 bytes width + 4 bytes height
    # (big-endian)。
    assert data[12:16] == b"IHDR"
    width, height = struct.unpack(">II", data[16:24])
    return width, height


# --- icons -------------------------------------------------------------------

@pytest.mark.parametrize(
    "filename,expected_size",
    [
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("icon-maskable-512.png", 512),
        ("apple-touch-icon-180.png", 180),
    ],
)
def test_icon_png_is_valid_and_correct_size(filename, expected_size):
    path = FRONTEND_DIR / "assets" / "icons" / filename
    assert path.is_file(), f"缺少 {path}"

    width, height = _png_dimensions(path)
    assert (width, height) == (expected_size, expected_size)


def test_maskable_icon_has_light_theme_background_at_its_border():
    """maskable icon 的安全區留白必須是純色背景 (css/base.css 的
    --bg-light: #f5f5f0)，不能是透明——Android 遮罩會直接顯示這圈顏色，
    透明在部分launcher上會被畫成黑色或系統預設色。"""
    path = FRONTEND_DIR / "assets" / "icons" / "icon-maskable-512.png"
    data = path.read_bytes()
    assert data[12:16] == b"IHDR"
    # bit depth (offset 24) / color type (offset 25)：color type 2 = RGB
    # (無 alpha 通道)，代表整張圖沒有透明的可能，安全區必然是實心背景。
    color_type = data[25]
    assert color_type == 2, f"maskable icon 應為不含 alpha 的 RGB PNG，實際 color type={color_type}"


def test_favicon_ico_has_valid_ico_header():
    path = FRONTEND_DIR / "favicon.ico"
    assert path.is_file()

    data = path.read_bytes()
    # ICO 檔頭 (ICONDIR)：2 bytes reserved(=0) + 2 bytes type(=1，代表 icon)
    # + 2 bytes 圖示張數 (little-endian)
    assert data[0:2] == b"\x00\x00"
    assert data[2:4] == b"\x01\x00"
    count = struct.unpack("<H", data[4:6])[0]
    assert count >= 1


# --- manifest.webmanifest -----------------------------------------------------

def test_manifest_is_valid_json_with_required_keys():
    path = FRONTEND_DIR / "manifest.webmanifest"
    manifest = json.loads(path.read_text(encoding="utf-8"))

    assert manifest["name"] == "URDiary"
    assert manifest["short_name"] == "URDiary"
    assert manifest["display"] == "standalone"
    assert manifest["start_url"] == "/"
    assert manifest["scope"] == "/"
    assert manifest["theme_color"].startswith("#")
    assert manifest["background_color"].startswith("#")
    assert manifest["description"]


def test_manifest_icons_cover_192_512_and_maskable_and_point_at_real_files():
    path = FRONTEND_DIR / "manifest.webmanifest"
    manifest = json.loads(path.read_text(encoding="utf-8"))

    icons = manifest["icons"]
    sizes_and_purpose = {(icon["sizes"], icon["purpose"]) for icon in icons}
    assert ("192x192", "any") in sizes_and_purpose
    assert ("512x512", "any") in sizes_and_purpose
    assert ("512x512", "maskable") in sizes_and_purpose

    for icon in icons:
        # 全部都是 /assets/... 絕對路徑；轉成相對於 FRONTEND_DIR 的路徑
        # 確認實際檔案真的存在，manifest 沒有指向一個不存在的檔案。
        icon_path = FRONTEND_DIR / icon["src"].lstrip("/")
        assert icon_path.is_file(), f"manifest 參照的 icon 不存在: {icon['src']}"


# --- sw.js：靜態檢查更新流程與路由委派的關鍵字，不執行 JS --------------------

def test_sw_js_does_not_call_skip_waiting_inside_install():
    """update 流程的核心保證：新版本不能在使用者不知情下悄悄生效。
    skipWaiting() 只能出現在 message handler (收到頁面的 SKIP_WAITING
    訊息才呼叫)，install 事件本身絕對不能呼叫它。"""
    source = (FRONTEND_DIR / "sw.js").read_text(encoding="utf-8")
    assert "skipWaiting" in source, "sw.js 應該要有 skipWaiting 呼叫（在 message handler 裡）"

    install_start = source.index("addEventListener('install'")
    next_listener = source.index("addEventListener(", install_start + 1)
    install_block = source[install_start:next_listener]

    assert "skipWaiting" not in install_block, \
        "install 事件內不能呼叫 skipWaiting()，否則更新會悄悄生效"


def test_sw_js_delegates_routing_to_shared_sw_logic_module():
    """sw.js 的 API-vs-殼層 路由判斷委派給 js/sw_logic.js（跟頁面的更新提示
    邏輯共用同一份規則，見 desktop/tests/sw_logic.test.js 的單元測試）——
    這裡鎖住這個委派關係，避免有人在 sw.js 裡另外長出第二份、可能漂移的
    路徑清單。"""
    source = (FRONTEND_DIR / "sw.js").read_text(encoding="utf-8")
    assert "importScripts" in source
    assert "sw_logic.js" in source
    assert "SWLogic.classifyRequestPath" in source


def _sw_js_shell_assets():
    source = (FRONTEND_DIR / "sw.js").read_text(encoding="utf-8")
    start = source.index("const SHELL_ASSETS = [")
    end = source.index("];", start)
    return re.findall(r"'([^']+)'", source[start:end])


def test_every_precached_shell_asset_is_actually_reachable(client):
    """回歸測試 (code review 修復，見 task-2.2-report.md 的 fix log)：
    sw.js 的 install handler 呼叫 cache.addAll(SHELL_ASSETS)，這個 API
    是 all-or-nothing——清單裡任何一個路徑回應非 200 (例如打字誤植了一個
    後端根本沒有註冊的路由)，整個 install 就會失敗，service worker 從此
    卡在「安裝從未成功過」，且不會有任何顯眼的錯誤（只有瀏覽器 devtools
    的 Application 分頁看得到，一般開發流程不會注意到）。

    這正是 '/index.html' 曾經誤植進 SHELL_ASSETS 時，應該被抓到、卻沒有
    測試覆蓋的洞：main.py 只註冊了 '/' 這個路由，'/index.html' 實際上
    404。這裡對清單裡的每一個路徑真的透過 TestClient 發一次請求，鎖住
    「這份清單裡的每一項都必須是後端真的能 200 回應的路徑」。
    """
    shell_assets = _sw_js_shell_assets()
    assert len(shell_assets) > 10, "解析到的 SHELL_ASSETS 數量異常少，正規表達式可能沒抓對"

    failures = []
    for path in shell_assets:
        resp = client.get(path)
        if resp.status_code != 200:
            failures.append(f"{path} -> HTTP {resp.status_code}")

    assert not failures, (
        "sw.js 的 SHELL_ASSETS 有無法連通的路徑，會讓整個 service worker "
        "install 失敗:\n" + "\n".join(failures)
    )
