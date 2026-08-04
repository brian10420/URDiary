import os
import json
from pathlib import Path
from dotenv import load_dotenv
import secrets

# 讀取 .env 文件 - 以本檔案位置解析，與啟動目錄無關 (app/config.py -> backend/.env)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
# 環境設定
ENV = os.getenv("ENV", "development")

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

# 必要的配置檢查
# XAI_API_KEY 不再是必要條件：金鑰主要由前端提供（X-LLM-* 標頭），.env 只是後備
if ENV == "production" and not XAI_API_KEY:
    print("⚠️  未設定 XAI_API_KEY：前端未帶 LLM 標頭的請求將無後備供應商可用")
