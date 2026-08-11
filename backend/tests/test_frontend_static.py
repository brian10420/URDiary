"""鎖定 v2.3 同源前端靜態檔服務：明確的 /js /css /assets 子樹掛載，加上
GET / 、/manifest.webmanifest、/sw.js、/favicon.ico 的明確檔案路由。

刻意不掛 catch-all "/{path:path}"：diary router 沒有 prefix，/generate、
/diaries/*、/diary/*、/analytics/*、/interaction-notes/* 等都掛在根路徑，
catch-all 會蓋掉這些 API 路由。這裡的「no-shadow」測試組直接鎖定這件事：
即使前端服務已啟用 (本測試環境下 desktop/ 存在，SERVE_FRONTEND 預設開)，
每一個代表性的 API 路徑仍然要打進真正的 API，而不是被靜態掛載攔截。
"""


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


# --- manifest / sw.js / favicon：尚未由後續任務建立，須乾淨 404 而非 500 ----

def test_manifest_returns_clean_404_when_missing(client):
    import main

    assert not (main.FRONTEND_DIR / "manifest.webmanifest").exists(), \
        "manifest.webmanifest 應由後續任務建立；此測試假設現在還不存在"

    resp = client.get("/manifest.webmanifest")

    assert resp.status_code == 404
    assert resp.json()["code"] == "HTTP_404"


def test_sw_js_returns_clean_404_when_missing(client):
    import main

    assert not (main.FRONTEND_DIR / "sw.js").exists(), \
        "sw.js 應由後續任務建立；此測試假設現在還不存在"

    resp = client.get("/sw.js")

    assert resp.status_code == 404
    assert resp.json()["code"] == "HTTP_404"


def test_favicon_returns_clean_404_when_missing(client):
    import main

    assert not (main.FRONTEND_DIR / "favicon.ico").exists(), \
        "favicon.ico 應由後續任務建立；此測試假設現在還不存在"

    resp = client.get("/favicon.ico")

    assert resp.status_code == 404
    assert resp.json()["code"] == "HTTP_404"


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
