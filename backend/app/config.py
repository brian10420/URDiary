import os
import json
from pathlib import Path
from dotenv import load_dotenv
import secrets

# 讀取 .env 文件 - 以本檔案位置解析，與啟動目錄無關 (app/config.py -> backend/.env)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
# 環境設定
ENV = os.getenv("ENV", "development")

# 應用程式版本號：單一事實來源 (v2.3 task 3.1)。main.py 建立 FastAPI(...)
# 時的 version= 參數、/health 與 /system/capabilities 回報的版本都讀這裡，
# 不要在別處另外寫死版本字串——之後升版只需要改這一行。
APP_VERSION = "2.3.0"

# -----------------------
# 本地資料目錄 (SQLite 資料庫 + 自動生成的金鑰)
# -----------------------
# 預設放在專案根目錄 data/ (app/config.py -> backend/ -> 專案根)。
# 使用者備份日記 = 備份這個資料夾。config 是最早被 import 的模組，
# 因此目錄建立放在這裡，後續模組可以直接假設它存在。
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.getenv("URDIARY_DATA_DIR", str(_REPO_ROOT / "data"))).expanduser()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "urdiary.db"


# -----------------------
# 安全密鑰：env 優先，否則讀/生成 data/secrets.json
# -----------------------
# 舊行為是「未設 env 就每次啟動隨機生成」——重啟後所有 JWT 失效，
# 且 HASH_SALT 會混入 bcrypt 雜湊，變動等於讓所有帳號密碼失效。
# 本地部署改為：首次啟動生成一次並持久化 (0600)；env 有值時永遠優先，
# 且 env 的值不寫入磁碟 (避免把使用者的環境秘密複製到檔案裡)。
#
# SECRET_KEY 還有第三個用途 (v2.3 task 1.6)：utils/key_vault 用它導出
# 加密金鑰，把 llm_credentials 裡的 LLM API Key 加密存放。因此**輪換
# SECRET_KEY 會讓所有已儲存的 LLM 金鑰解不開** —— 那不會讓 App 壞掉
# (解不開就當成「沒有這組憑證」往下一層找)，但每個人都要在設定面板重新
# 填一次金鑰、伺服器擁有者也要重跑一次 urdiary_admin.py set-server-key。
# 同理：刪掉 data/secrets.json 等同輪換。
def _load_or_create_secrets() -> dict:
    secrets_file = DATA_DIR / "secrets.json"
    stored = {}
    if secrets_file.exists():
        try:
            stored = json.loads(secrets_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            stored = {}

    resolved, changed = {}, False
    for key, nbytes in (("SECRET_KEY", 32), ("HASH_SALT", 8)):
        value = os.getenv(key) or stored.get(key)
        if not value:
            value = secrets.token_hex(nbytes)
            stored[key] = value
            changed = True
        resolved[key] = value

    if changed:
        secrets_file.write_text(json.dumps(stored, indent=2), encoding="utf-8")
        try:
            secrets_file.chmod(0o600)
        except OSError:
            pass  # Windows 無 POSIX 權限
    return resolved


_secrets = _load_or_create_secrets()
SECRET_KEY = _secrets["SECRET_KEY"]
HASH_SALT = _secrets["HASH_SALT"]

# JWT 設置
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "1440"))  # 默認24小時

# -----------------------
# 令牌有效期 (v2.3 認證強化)
# -----------------------
# 訪問令牌短命 (30 分鐘)：它是無狀態的，撤銷工作階段後仍會活到 exp 為止，
# 這個長度就是「撤銷生效的最壞延遲」上限。刷新令牌長命 (30 天) 但每次使用
# 都會輪替 + 落地 auth_sessions，可即時撤銷 (見 api/routes/user.py)。
ACCESS_TOKEN_MINUTES = int(os.getenv("URDIARY_ACCESS_TOKEN_MINUTES", "30"))
REFRESH_TOKEN_DAYS = int(os.getenv("URDIARY_REFRESH_TOKEN_DAYS", "30"))

# LLM 後備設定：主路徑是前端經 X-LLM-* 標頭提供供應商與金鑰（見 api/deps.get_llm_config），
# XAI_API_KEY 降為「未帶標頭時」的可選 Grok 後備
GROK_API_URL = os.getenv("GROK_API_URL", "https://api.x.ai/v1")
XAI_API_KEY = os.getenv("XAI_API_KEY")
FALLBACK_GROK_MODEL = os.getenv("FALLBACK_GROK_MODEL", "grok-4.3")

# -----------------------
# 時區與換日 (日記的「今天」以此為準；utils/time_utils.py 讀取)
# -----------------------
# 注意：中途變更時區不會換算既有 diary_date，建議安裝時一次決定。
TIMEZONE = os.getenv("URDIARY_TIMEZONE", "Asia/Taipei")
DIARY_DAY_BOUNDARY_HOUR = int(os.getenv("URDIARY_DAY_BOUNDARY_HOUR", "5"))

# CORS設置 - 默認允許本地前端訪問
default_origins = ["http://localhost:3000", "http://localhost:8080"]
CORS_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if not CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS = default_origins

# -----------------------
# 前端靜態檔案 (v2.3：後端同源提供 desktop/ 的靜態檔，讓手機能透過 HTTPS
# tunnel 用同一個 origin 存取 App + API；main.py 的 StaticFiles 掛載與
# 明確檔案路由讀這兩個值)
# -----------------------
# 路徑錨定在本檔案位置 (app/config.py -> backend/ -> 專案根 / desktop)，
# 不能依賴啟動目錄——uvicorn 是以 backend/ 為 CWD 執行的。
FRONTEND_DIR = Path(os.getenv("URDIARY_FRONTEND_DIR", str(_REPO_ROOT / "desktop"))).expanduser()


def _env_flag(name: str, default: bool) -> bool:
    """解析布林環境變數；未設定時回退到 default。"""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("", "0", "false", "no", "off")


# 未顯式設定 URDIARY_SERVE_FRONTEND 時：desktop/ 存在就自動開啟，本機開發
# 不必額外設定；沒有 desktop/ 的部署 (例如只跑 API 的容器) 則預設不掛載，
# 避免啟動時因 StaticFiles 目錄不存在而炸掉 (StaticFiles 建構時的 check_dir)。
SERVE_FRONTEND = _env_flag("URDIARY_SERVE_FRONTEND", default=FRONTEND_DIR.is_dir())

# -----------------------
# 邀請碼註冊閘門 (v2.3 task 1.4：對外開放前的安全閘門)
# -----------------------
# 預設關閉：Electron 本機首次啟動流程 (免邀請碼) 必須維持現狀不變。
# 打算把 tunnel 開放給外部存取時，部署設定明確開啟 (URDIARY_REQUIRE_INVITE=1)。
# api/routes/user.py 讀取這個旗標時必須用 `import config` 取模組屬性、
# 在請求當下讀 (`config.REQUIRE_INVITE`)，不能 `from config import REQUIRE_INVITE`
# 把值綁死在 import 當下 —— 否則測試沒辦法用 monkeypatch 逐案切換。
REQUIRE_INVITE = _env_flag("URDIARY_REQUIRE_INVITE", default=False)

# -----------------------
# 速率限制 (v2.3 task 1.5：對外開放前的安全閘門後半)
# -----------------------
# 預設開啟：這是曝險面最大的一道閘 (含 LLM 花費端點)，「忘記另外開」不該是
# 安全的預設狀態。測試套件在 conftest 環境區塊關閉 (見 backend/tests/
# conftest.py)，要測「限制生效」行為的測試自行對 config 模組屬性
# monkeypatch —— 與 REQUIRE_INVITE 同一套模式：middleware/dependency
# 必須用 `import config; config.RATE_LIMIT_ENABLED` 在請求當下讀，
# 不能 `from config import RATE_LIMIT_ENABLED` 把值綁死在 import 當下。
RATE_LIMIT_ENABLED = _env_flag("URDIARY_RATE_LIMIT_ENABLED", default=True)

# 信任代理標頭 (CF-Connecting-IP / X-Forwarded-For) 取得真實用戶端 IP。
# 預設關閉：這兩個都是請求者能自己塞值的一般 HTTP 標頭，沒有受信任的反向
# 代理/tunnel 把關時，攻擊者可以讓每個請求自報不同 IP，直接繞過限流。
# 只有明確架在受信任代理後面才開啟 (URDIARY_TRUSTED_PROXY=1)——例如
# Tailscale serve/funnel 會替請求補上 X-Forwarded-For，此時
# request.client.host 只會是 tunnel 的本機連線，每個使用者都會共用同一個
# IP，限流形同虛設，必須改讀轉發標頭 (見 middleware/rate_limit.py)。
TRUSTED_PROXY = _env_flag("URDIARY_TRUSTED_PROXY", default=False)

# 必要的配置檢查
# XAI_API_KEY 不再是必要條件：金鑰主要由前端提供（X-LLM-* 標頭），.env 只是後備
if ENV == "production" and not XAI_API_KEY:
    print("⚠️  未設定 XAI_API_KEY：前端未帶 LLM 標頭的請求將無後備供應商可用")
