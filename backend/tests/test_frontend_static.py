"""鎖定 v2.3 同源前端靜態檔服務：明確的 /js /css /assets 子樹掛載，加上
GET / 、/manifest.webmanifest、/sw.js、/favicon.ico 的明確檔案路由。

刻意不掛 catch-all "/{path:path}"：diary router 沒有 prefix，/generate、
/diaries/*、/diary/*、/analytics/*、/interaction-notes/* 等都掛在根路徑，
catch-all 會蓋掉這些 API 路由。這裡的「no-shadow」測試組直接鎖定這件事：
即使前端服務已啟用 (本測試環境下 desktop/ 存在，SERVE_FRONTEND 預設開)，
每一個代表性的 API 路徑仍然要打進真正的 API，而不是被靜態掛載攔截。
"""
import pytest


# --- GET / 、靜態子樹：實際檔案內容比對 -------------------------------------

def test_root_serves_index_html_with_no_cache(client):
    resp = client.get("/")

    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert resp.headers["cache-control"] == "no-cache"
    assert "URDiary - 您的情緒日記助手" in resp.text


def test_js_subtree_serves_real_file(client):
    import main

    resp = client.get("/js/config.js")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "js" / "config.js").read_bytes()


def test_css_subtree_serves_real_file_and_still_has_security_headers(client):
    """安全標頭中間件要套用到「所有」回應，不只 API JSON (task 1.1 決策)；
    中間件本身的行為在 test_security_headers.py 用 /health 已經鎖定，
    這裡只再確認同一組標頭確實也出現在靜態檔回應上。"""
    import main

    resp = client.get("/css/base.css")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "css" / "base.css").read_bytes()
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert "content-security-policy" in resp.headers


def test_assets_subtree_serves_real_file(client):
    import main

    resp = client.get("/assets/icon.jpg")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "assets" / "icon.jpg").read_bytes()


# --- manifest / sw.js / favicon：v2.3 task 2.2 已建立，改鎖「正確提供真實
# --- 內容」；task 1.1 當時的「乾淨 404」行為則交給下面 test_config.py 旁邊
# --- 沒有變動的 _serve_frontend_file() 本體邏輯，與 test_manifest_served_
# --- normally_once_present_without_forced_cache_control / test_sw_js_served_
# --- with_no_cache_once_present 這兩個既有的 monkeypatch 測試繼續覆蓋 -------

def test_manifest_served_for_real(client):
    import main

    resp = client.get("/manifest.webmanifest")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "manifest.webmanifest").read_bytes()

    body = resp.json()
    assert body["name"] == "URDiary"
    assert body["short_name"] == "URDiary"
    assert body["display"] == "standalone"
    assert body["start_url"] == "/"
    assert body["scope"] == "/"


def test_sw_js_served_for_real_with_no_cache(client):
    import main

    resp = client.get("/sw.js")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "sw.js").read_bytes()
    assert resp.headers["cache-control"] == "no-cache"


def test_favicon_served_for_real(client):
    import main

    resp = client.get("/favicon.ico")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "favicon.ico").read_bytes()
    # favicon.ico 跟 manifest.webmanifest 一樣呼叫 _serve_frontend_file()
    # 時沒有帶 no_cache=True，交給 FileResponse 自己的 ETag 機制。
    assert resp.headers.get("cache-control") is None
    assert "etag" in resp.headers


def test_vendor_assets_subtree_serves_real_file(client):
    """自架字型/圖示 (v2.3 task 2.2) 放在 assets/vendor/ 底下，走既有的
    /assets StaticFiles 掛載——這裡確認巢狀子目錄一樣能被正確提供，不只是
    assets/ 底下的一層檔案 (test_assets_subtree_serves_real_file 已經測過)。"""
    import main

    resp = client.get("/assets/vendor/fonts/fonts.css")

    assert resp.status_code == 200
    assert resp.content == (main.FRONTEND_DIR / "assets" / "vendor" / "fonts" / "fonts.css").read_bytes()


def test_manifest_served_normally_once_present_without_forced_cache_control(client, monkeypatch, tmp_path):
    """manifest.webmanifest 沒有像 index.html/sw.js 那樣明確的 no-cache
    需求，應該單純交給 FileResponse 自己的 ETag/Last-Modified 機制。這裡
    順便鎖定 _serve_frontend_file() 的「headers=None」分支——js/css/assets
    都是 StaticFiles 在處理，不會走到這個 helper 的成功路徑，只有這裡會。

    用 monkeypatch 把 main.FRONTEND_DIR 換成 pytest 的 tmp_path，不寫進
    真正的 desktop/ (git 追蹤的原始碼目錄，conftest.py 的資料目錄隔離只管
    data/，desktop/ 需要測試自己注意)：明確檔案路由 (_serve_frontend_file)
    每次請求都重新讀 main.FRONTEND_DIR 這個模組全域變數，不像 /js /css
    /assets 的 StaticFiles 掛載在啟動時就把目錄路徑固定下來，所以這樣替換
    是安全的，不會影響那三個子樹掛載。
    """
    import main

    monkeypatch.setattr(main, "FRONTEND_DIR", tmp_path)
    (tmp_path / "manifest.webmanifest").write_text('{"name": "test-only placeholder"}', encoding="utf-8")

    resp = client.get("/manifest.webmanifest")

    assert resp.status_code == 200
    assert resp.headers.get("cache-control") is None
    assert "etag" in resp.headers


def test_sw_js_served_with_no_cache_once_present(client, monkeypatch, tmp_path):
    """sw.js 的 scope 必須涵蓋整個 app，瀏覽器每次都要重新驗證才能讓 PWA
    更新不卡在舊版 SW。no-cache 邏輯與 index.html 共用同一段程式，這裡用
    monkeypatch 把 main.FRONTEND_DIR 換成 pytest 的 tmp_path 驗證 route
    真的接上了 no-cache，不寫進真正的 desktop/ (見上一個測試的說明)。
    """
    import main

    monkeypatch.setattr(main, "FRONTEND_DIR", tmp_path)
    (tmp_path / "sw.js").write_text("// test-only placeholder\n", encoding="utf-8")

    resp = client.get("/sw.js")

    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-cache"


# --- desktop/ 底下不該曝露到網路的檔案/目錄 ---------------------------------

def test_desktop_node_modules_not_reachable(client):
    resp = client.get("/node_modules/anything.js")
    assert resp.status_code == 404


def test_desktop_package_json_not_reachable(client):
    resp = client.get("/package.json")
    assert resp.status_code == 404


def test_desktop_main_js_not_reachable(client):
    """main.js 是 Electron 主行程進入點，不能被當成靜態檔曝露到網路。"""
    resp = client.get("/main.js")
    assert resp.status_code == 404


def test_desktop_tests_dir_not_reachable(client):
    resp = client.get("/tests/config.test.js")
    assert resp.status_code == 404


# --- no-shadow：前端服務啟用時，代表性的 API 路徑仍必須打進真正的 API -------

def test_health_route_not_shadowed(client):
    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["status"] == "ok"


def test_docs_route_not_shadowed(client):
    resp = client.get("/docs")

    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "swagger" in resp.text.lower()


def test_openapi_json_route_not_shadowed(client):
    resp = client.get("/openapi.json")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["info"]["title"] == "AI Diary API"


def test_diary_route_not_shadowed(client):
    """/diaries/{user_id} 屬於沒有 prefix 的 diary router。未帶 Authorization
    會在 get_current_user 之前就被 401，剛好證明真的打進 API 而不是回靜態頁
    (靜態頁會是 200 text/html)。"""
    resp = client.get("/diaries/1")

    assert resp.status_code == 401
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["code"] == "HTTP_401"


def test_users_route_not_shadowed(client):
    resp = client.get("/users/1")

    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401"


def test_chat_route_not_shadowed(client):
    resp = client.post("/chat/", json={"message": "hi"})

    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401"


def test_calendar_route_not_shadowed(client):
    resp = client.get("/calendar/events", params={"start": "2026-01-01", "end": "2026-01-02"})

    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401"


# --- no-shadow（task 3.3 稽核缺口）：task-1.1-brief.md 列舉、上面卻還沒有
# --- 任何測試明確命中的其餘根路徑 ---------------------------------------------
#
# task-1.1-brief.md 的完整清單是：/generate、/enhanced-generate、/diaries/*、
# /diary/*、/analytics/*、/interaction-notes/*，加上 /health、
# /system/capabilities、/docs、/redoc、/openapi.json、/users/*、/chat/*、
# /calendar/*。上面已經各自有命名測試涵蓋 /health /docs /openapi.json
# /diaries/1 /users/1 /chat/ /calendar/events；這裡資料驅動補齊剩下的部分。
# /diary/{id}（單數）容易被忽略——它與 /diaries/{user_id}（複數）是完全
# 不同的路由函式 (diary.py 的 get_diary vs get_user_diaries)，「複數測過了」
# 不代表「單數也測過」。
#
# 這幾個路徑在 test_diary_api.py／test_rate_limit.py 裡另外也有帶認證的
# 200 功能測試，但那些驗的是「CRUD 邏輯對不對」；這裡驗的是完全不同的性質
# ——「有沒有被靜態掛載攔截」，用未帶認證、以 401 JSON 為判準，與本檔案其餘
# no-shadow 測試同一套邏輯，因此不算重複。用真的插入一個 rogue catch-all
# StaticFiles 掛載到 "/" 驗證過這組斷言的靈敏度：插入後這五個路徑全部變成
# 404/405（不再是 401 JSON），/system/capabilities 與 /redoc 也雙雙變成
# 404——證明這裡的斷言在 shadow 真的發生時會確實變紅 (task-3.3-report.md
# 的「安全關鍵測試的證明」一節有完整記錄)。
_REMAINING_PROTECTED_ROOT_PATHS = [
    ("POST", "/generate", {}),
    ("POST", "/enhanced-generate", {}),
    ("GET", "/diary/1", None),
    ("GET", "/analytics/emotion/1", None),
    ("GET", "/interaction-notes/1", None),
]


@pytest.mark.parametrize("method,path,body", _REMAINING_PROTECTED_ROOT_PATHS)
def test_remaining_protected_root_paths_not_shadowed(client, method, path, body):
    """未帶認證時，這些路徑都必須打進真正的 API 回 401 JSON (走 FastAPI
    OAuth2PasswordBearer 自己的 auto_error，回應 code 固定是 "HTTP_401")，
    不是靜態掛載攔截後的 200 text/html 或 StaticFiles 自己的 404。"""
    resp = client.request(method, path, json=body)

    assert resp.status_code == 401, f"{method} {path}: {resp.status_code} {resp.text}"
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["code"] == "HTTP_401"


def test_system_capabilities_route_not_shadowed(client):
    """免認證的公開端點：仍要回真正的能力旗標 JSON，不是 index.html 外殼
    (若被 catch-all 遮蔽，帶查詢工具的瀏覽器仍會拿到 200，但內容完全不對，
    單看狀態碼看不出來——必須直接檢查回應內容/形狀)。"""
    resp = client.get("/system/capabilities")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert "require_invite" in body
    assert "app_version" in body


def test_redoc_route_not_shadowed(client):
    """/redoc 是 FastAPI 內建文件頁 (公開、未自架)：內容要是真正的 ReDoc
    頁面，不是被靜態掛載攔截後回傳的 index.html 外殼——兩者都是 200
    text/html，只看狀態碼分辨不出來，必須直接比對內容關鍵字。"""
    resp = client.get("/redoc")

    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "redoc" in resp.text.lower()
    assert "URDiary - 您的情緒日記助手" not in resp.text
