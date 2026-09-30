#!/usr/bin/env python3
"""URDiary 介紹影片的示範資料種子 (v2.6 1e.1)。

把虛構示範人物「語晴」(zh-TW) 與「Maya」(en) 的三週資料——日記、AI 印章＋小語、
行事曆、記憶檔＋帳本、初次見面答案——以 in-process 方式寫進一個**隔離的**後端
資料目錄。不走 HTTP API 的原因：API 無法回填過去日期的日記與印章，也寫不出
「來自日記《…》」的歷史帳本批次（promo/video/STORYBOARD.md §3.4 第 12 點、附錄 A-4）。
寫入一律用後端自己的 models／crud／memory_files／day_stamp，驗證用 API 的
Pydantic schema，所以資料形狀和 App 真的產生的一樣。

用法（一律用 repo 的 .venv，工作目錄隨意）：
    # 1) 種子：目標目錄只能用環境變數 URDIARY_DATA_DIR 指定
    URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-demo-XXXXXX) .venv/bin/python promo/demo/seed_demo.py
    #    --reset          目錄裡已有帳號時先清空（demo 後端 8124 必須先停）
    #    --d0 YYYY-MM-DD  指定錄影日 D0（預設＝App 的「今天」，05:00 換日、Asia/Taipei）
    #    --d0-zh / --d0-en  兩位人物分開錄時各自的 D0
    #    --checkin-done   把「今天的每日問候」標成已發生（用 stub 錄影時防止問候出現）
    #    --semantic       另外生成語意檢索向量（選配；fastembed 首次會下載模型）
    # 2) 重拍工具（對已種好的目錄操作；demo 後端可以開著）
    .venv/bin/python promo/demo/seed_demo.py --user yuqing --set-checkin yesterday --clear-chat
    .venv/bin/python promo/demo/seed_demo.py --reset-hello
    # 3) 只做目錄安全檢查（run_demo_backend.sh 用；不 import 任何後端模組）
    .venv/bin/python promo/demo/seed_demo.py --check-dir --require-seeded

安全規則（任何寫入之前、任何後端模組被 import 之前就檢查——backend 的 config.py
一被 import 就會 mkdir 資料目錄並寫 secrets.json，檢查晚了等於沒檢查）：
  - URDIARY_DATA_DIR 必須有設；解析 symlink 之後不可在 repo 的 data/ 裡、不可在 repo
    裡、也不可是 repo 的上層目錄；
  - 預設只接受 os.tmpdir()／/tmp 或 /mnt/Data_SSD/urdiary-media/ 底下的子目錄，
    其他位置要明確加 --allow-dir（會印警告）；
  - 目標資料庫已經有帳號就拒絕，除非 --reset；--reset 時 127.0.0.1:8124 不可有人在聽；
  - 秘密隔離：SECRET_KEY／HASH_SALT 設成空字串，擋住 backend/.env 的值
    （python-dotenv 不覆寫已存在的變數），改用這個目錄自己的 secrets.json——示範帳號的
    密碼雜湊與 JWT 拿到真實後端一律無效；
  - 帳號 id 從 101 起（絕不使用 id 1）；種子從不呼叫任何 LLM，也不碰 xAI 金鑰。
"""
import argparse
import hashlib
import json
import os
import re
import socket
import sqlite3
import sys
import tempfile
import uuid
from datetime import date, datetime, time as dtime, timedelta
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
APP_DIR = REPO_ROOT / "backend" / "app"
REPO_DATA_DIR = REPO_ROOT / "data"
MASCOT_JS = REPO_ROOT / "desktop" / "js" / "mascot.js"
PERSONA_FILES = {"zh": HERE / "personas" / "zh.json", "en": HERE / "personas" / "en.json"}
MEDIA_ROOT = Path("/mnt/Data_SSD/urdiary-media")
MANIFEST_NAME = "demo_manifest.json"
DB_NAME = "urdiary.db"
DEMO_HOST, DEMO_PORT = "127.0.0.1", 8124
ROLES_FULL = ("main", "copy")          # 完整資料的帳號；hello＝全新帳號（S2/U02 取名鏡頭）

# 分鏡 §3.3 的資料契約（改人物 JSON 時由 validate_persona 把關）
DIARY_WINDOW = (-21, -1)
DIARY_COUNT = (14, 16)
BAND_BRIGHT = (0.55, 0.85)             # 9–10 篇
BAND_NEUTRAL = (0.45, 0.55)            # 2–3 篇（含 0.45、不含 0.55）
HEAVY_BELOW = 0.45                      # 3 篇
SAFE_FLOOR = 0.25                       # 最沉重的一天也不低於此（「悲傷」而非「憤怒」標籤）
PROFILE_CHARS = (400, 560)
COMPANION_CHARS = (150, 300)
REQUIRED_STAMP_GROUPS = (("cake",), ("camera", "plane"), ("book", "gradcap"),
                         ("coffee",), ("music",), ("paw",))


def log(msg=""):
    print(msg, flush=True)


def refuse(msg, code=2):
    print(f"[seed_demo] REFUSED: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# 安全檢查（純標準函式庫，絕不 import 後端模組）
# ---------------------------------------------------------------------------

def _within(child: Path, parent: Path) -> bool:
    return child == parent or parent in child.parents


def allowed_roots():
    roots = []
    for raw in (tempfile.gettempdir(), "/tmp", str(MEDIA_ROOT)):
        resolved = Path(raw).resolve()
        if resolved not in roots:
            roots.append(resolved)
    return roots


def resolve_data_dir(raw, allow_dir: bool) -> Path:
    """回傳解析後的目標目錄；任何一條不過就 refuse（exit 2）。"""
    if not raw or not raw.strip():
        refuse("URDIARY_DATA_DIR is not set. Point it at a throwaway directory, e.g. "
               "URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-demo-XXXXXX)")
    target = Path(raw.strip()).expanduser().resolve()
    repo = REPO_ROOT.resolve()
    repo_data = REPO_DATA_DIR.resolve()
    if _within(target, repo_data):
        refuse(f"{target} is the repo's real data/ directory (or inside it). Never seed demo data there.")
    if _within(target, repo):
        refuse(f"{target} is inside the repository ({repo}). Demo data must live outside the repo.")
    if _within(repo, target):
        refuse(f"{target} contains the repository. Use a dedicated demo directory.")
    roots = allowed_roots()
    if not any(target != root and _within(target, root) for root in roots):
        if not allow_dir:
            refuse(f"{target} is not a subdirectory of {', '.join(str(r) for r in roots)}. "
                   "Use a mkdtemp directory, or pass --allow-dir if you really mean it.")
        print(f"[seed_demo] WARNING: --allow-dir given; using {target}, which is outside the "
              "default demo locations. Make sure it is not real user data.", file=sys.stderr, flush=True)
    if target.exists() and not target.is_dir():
        refuse(f"{target} exists and is not a directory.")
    return target


def port_in_use(port=DEMO_PORT, host=DEMO_HOST) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def existing_usernames(target: Path) -> set:
    """目標資料庫裡現有的帳號名稱（唯讀開檔；沒有資料庫或沒有 users 表＝空集合）。"""
    db = target / DB_NAME
    if not db.exists():
        return set()
    con = None
    try:
        con = sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True)
        return {row[0] for row in con.execute("SELECT username FROM users")}
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return set()  # 還沒有 users 表 (空資料庫)
        refuse(f"cannot read {db} (read-only open failed: {exc})")
    except sqlite3.Error as exc:
        refuse(f"cannot read {db}: {exc}")
    finally:
        if con is not None:
            con.close()


def load_manifest(target: Path):
    path = target / MANIFEST_NAME
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def stub_checkin_warning(target: Path, manifest: dict):
    """stub 模式的地雷：完整帳號今天還沒問候過的話，一打開聊天頁就會把
    「[urdiary-e2e-stub]」問候寫進對話歷史（之後還會被寫進 U06 的日記）。
    只讀資料庫、不 import 後端；時區與換日規則取自 manifest。"""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo(manifest["timezone"]))
    except Exception:
        return
    today = (now - timedelta(hours=int(manifest["day_boundary_hour"]))).date()
    names = {}
    for info in manifest["personas"].values():
        for role in ROLES_FULL:
            acct = info["accounts"][role]
            names[acct["id"]] = acct["username"]
    con = None
    try:
        con = sqlite3.connect(f"{(target / DB_NAME).as_uri()}?mode=ro", uri=True)
        rows = con.execute("SELECT id, last_checkin_date FROM users WHERE id IN (%s)"
                           % ",".join("?" * len(names)), list(names)).fetchall()
    except sqlite3.Error as exc:
        refuse(f"cannot read {target / DB_NAME} to check the stub check-in state: {exc}")
    finally:
        if con is not None:
            con.close()
    pending = [names[uid] for uid, value in rows if not value or value[:10] < today.isoformat()]
    if pending:
        print(f"[seed_demo] WARNING (stub mode): opening the app as {', '.join(sorted(pending))} today would "
              "store a STUB check-in greeting in their chat history (it would show up in U03 and in the "
              "U06 diary). Before logging in, run:\n"
              f"  URDIARY_DATA_DIR={target} .venv/bin/python promo/demo/seed_demo.py "
              f"--user {','.join(sorted(pending))} --set-checkin today", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# 後端 import（只在安全檢查通過之後）
# ---------------------------------------------------------------------------

def import_backend(target: Path):
    os.environ["URDIARY_DATA_DIR"] = str(target)
    # 秘密隔離（見檔頭）：空字串擋住 backend/.env，config.py 改讀/產生本目錄的 secrets.json
    os.environ["SECRET_KEY"] = ""
    os.environ["HASH_SALT"] = ""
    os.environ["XAI_API_KEY"] = ""          # 種子從不呼叫 LLM
    os.environ["ENV"] = "development"
    os.environ["URDIARY_RATE_LIMIT_ENABLED"] = "0"
    os.environ["URDIARY_REQUIRE_INVITE"] = "0"
    if str(APP_DIR) not in sys.path:
        sys.path.insert(0, str(APP_DIR))

    import config
    if Path(config.DB_PATH).resolve() != (target / DB_NAME).resolve():
        refuse(f"backend resolved DB_PATH={config.DB_PATH}, expected {target / DB_NAME}")
    try:  # 雙保險：確定沒有吃到 backend/.env 的 SECRET_KEY（只比對、絕不印出）
        from dotenv import dotenv_values
        env_values = dotenv_values(APP_DIR.parent / ".env")
        if env_values.get("SECRET_KEY") and env_values.get("SECRET_KEY") == config.SECRET_KEY:
            refuse("backend picked up SECRET_KEY from backend/.env; demo secrets would not be isolated")
    except ImportError:
        pass

    import pytz
    import memory_manager
    from database import engine, db_session, crud, models
    from database.schema_upgrade import ensure_schema
    from services import day_stamp, diary_fts, memory_files, memory_retrieval
    from services.diary_service import check_sensitive_content
    from api.schemas import CalendarEventCreate, CompanionSettingsIn, OnboardingAnswerIn
    from utils import time_utils
    from utils.security import get_password_hash
    return SimpleNamespace(
        config=config, pytz=pytz, memory_manager=memory_manager, engine=engine,
        db_session=db_session, crud=crud, models=models, ensure_schema=ensure_schema,
        day_stamp=day_stamp, diary_fts=diary_fts, memory_files=memory_files,
        memory_retrieval=memory_retrieval, check_sensitive_content=check_sensitive_content,
        CalendarEventCreate=CalendarEventCreate, CompanionSettingsIn=CompanionSettingsIn,
        OnboardingAnswerIn=OnboardingAnswerIn, time_utils=time_utils,
        get_password_hash=get_password_hash)


# ---------------------------------------------------------------------------
# 時間：App 的兩套時間基準
# ---------------------------------------------------------------------------

def parse_hhmm(value: str) -> dtime:
    hh, mm = value.split(":")
    return dtime(int(hh), int(mm))


def shift(d0: date, day: int) -> date:
    return d0 + timedelta(days=day)


class Clock:
    """把「第幾天＋牆上時間」換成 App 各欄位用的時間值。

    - diaries.diary_date、users.last_checkin_date：台北牆上時間的 naive datetime，
      而且採 05:00 換日（凌晨 1:20 寫的日記歸前一天，存成「前一天 01:20」——
      與 utils.time_utils.get_diary_datetime() 一模一樣的語意）；
    - 其餘 created_at／answered_at／decided_at…：UTC naive（datetime.utcnow 語意）。
    """

    def __init__(self, b):
        self.tz = b.time_utils.LOCAL_TZ
        self.utc_tz = b.pytz.utc
        self.boundary = b.time_utils.DIARY_DAY_BOUNDARY_HOUR

    def real_local(self, day: date, hhmm: str) -> datetime:
        t = parse_hhmm(hhmm)
        calendar_day = day + timedelta(days=1) if t.hour < self.boundary else day
        return datetime.combine(calendar_day, t)

    def utc(self, local_naive: datetime) -> datetime:
        return self.tz.localize(local_naive).astimezone(self.utc_tz).replace(tzinfo=None)

    def diary_datetime(self, day: date, hhmm: str) -> datetime:
        return datetime.combine(day, parse_hhmm(hhmm))


# ---------------------------------------------------------------------------
# 人物資料：載入、渲染、記憶帳本建構、驗證
# ---------------------------------------------------------------------------

def load_personas():
    personas = {}
    for key, path in PERSONA_FILES.items():
        try:
            personas[key] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            refuse(f"cannot read persona file {path}: {exc}", code=3)
    return personas


def persona_sha(key: str) -> str:
    return hashlib.sha256(PERSONA_FILES[key].read_bytes()).hexdigest()


def render_body(persona: dict, spec: dict) -> str:
    """日記正文＝App 日記提示詞的四段結構（標題單獨一行、純文字）。verify_demo.py 有同一份。"""
    h = persona["diary_headings"]
    b = spec["body"]
    parts = [(h[0], b["today"]), (h[1], b["feelings"]), (h[2], b["reflections"]), (h[3], b["tomorrow"])]
    return "\n\n".join(f"{title}\n{text.strip()}" for title, text in parts)


_DAY_TOKEN = re.compile(r"\{day:(-?\d+)\}")


def fill_dates(text, batch_day: date, d0: date):
    if text is None:
        return None
    text = _DAY_TOKEN.sub(lambda m: shift(d0, int(m.group(1))).isoformat(), text)
    return text.replace("{date}", batch_day.isoformat())


def build_memory(persona: dict, d0: date, clock: Clock, b):
    """照時間順序逐筆套用帳本批次（用 App 自己的 memory_files.apply_op）。

    回傳 (contents, op_rows, touched, errors)；op_rows 的 diary_day 在寫入時才換成 diary id。
    """
    mf = b.memory_files
    contents = {key: "" for key in mf.FILE_KEYS}
    touched, rows, errors = {}, [], []
    diaries_by_day = {d["day"]: d for d in persona["diaries"]}
    for index, batch in enumerate(persona["memory"]["batches"]):
        source = batch.get("source")
        if source == "user_edit":
            day = shift(d0, batch["day"])
            when = clock.utc(clock.real_local(day, batch["time"]))
            file_key, find, repl = batch["file"], batch["find"], batch["replace"]
            if file_key not in contents:
                errors.append(f"memory batch #{index}: unknown file {file_key!r}")
                continue
            if contents[file_key].count(find) != 1:
                errors.append(f"memory batch #{index} (user_edit): {find!r} must appear exactly once in {file_key}")
                continue
            contents[file_key] = contents[file_key].replace(find, repl, 1)
            touched[file_key] = when
            rows.append(dict(batch_key=index, file_key=file_key, action="user_edit", section=None,
                             target_text=None, new_text=contents[file_key], source="user_edit",
                             diary_day=None, created_at=when))
            continue
        if source == "onboarding":
            day = shift(d0, batch["day"])
            when = clock.utc(clock.real_local(day, batch["time"]) + timedelta(seconds=20))
            diary_day = None
        elif source == "review_pass":
            diary_day = batch.get("diary_day")
            spec = diaries_by_day.get(diary_day)
            if spec is None:
                errors.append(f"memory batch #{index}: diary_day {diary_day} has no diary")
                continue
            day = shift(d0, diary_day)
            when = clock.utc(clock.real_local(day, spec["time"]) + timedelta(seconds=15))
        else:
            errors.append(f"memory batch #{index}: unknown source {source!r}")
            continue
        for op in batch.get("ops", []):
            file_key, action = op.get("file"), op.get("action")
            if file_key not in contents:
                errors.append(f"memory batch #{index}: unknown file {file_key!r}")
                continue
            text = fill_dates(op.get("text"), day, d0)
            target = fill_dates(op.get("target"), day, d0)
            # lang＝人物的介面語言：節標頭跟 App 的 review pass 一樣用該語言寫
            result = mf.apply_op(file_key, contents[file_key], action,
                                 section=op.get("section"), target=target, text=text,
                                 lang=persona["lang"])
            if not result.ok:
                errors.append(f"memory batch #{index}: {action} on {file_key} failed ({result.error})")
                continue
            section = op.get("section")
            if action == "remove" and not section:
                section = mf.find_section_of(contents[file_key], target or "")
            section = mf.canonical_section(file_key, section)  # 帳本存 key，同 App
            contents[file_key] = result.content
            touched[file_key] = when
            rows.append(dict(batch_key=index, file_key=file_key, action=action, section=section,
                             target_text=target.strip() if isinstance(target, str) else None,
                             new_text=text.strip() if isinstance(text, str) else None,
                             source=source, diary_day=diary_day, created_at=when))
    for key in mf.FILE_KEYS:
        if mf.over_limit(key, contents[key]):
            errors.append(f"memory file {key} is over the app limit ({len(contents[key])} chars)")
    return contents, rows, touched, errors


def expand_event(ev: dict, d0: date, start: date, end: date):
    """行事曆事件在 [start, end] 內的發生日（獨立於後端的簡單展開，驗證用）。"""
    first = shift(d0, ev["day"])
    recurrence = ev.get("recurrence", "none")
    out = []
    if "end_day" in ev:
        last = shift(d0, ev["end_day"])
        cur = max(first, start)
        while cur <= min(last, end):
            out.append(cur)
            cur += timedelta(days=1)
    elif recurrence == "none":
        if start <= first <= end:
            out.append(first)
    elif recurrence in ("daily", "weekly"):
        step = 1 if recurrence == "daily" else 7
        cur = first
        while cur <= end:
            if cur >= start:
                out.append(cur)
            cur += timedelta(days=step)
    elif recurrence == "yearly":
        for year in range(start.year, end.year + 1):
            try:
                cand = date(year, first.month, first.day)
            except ValueError:
                continue
            if cand >= first and start <= cand <= end:
                out.append(cand)
    elif recurrence == "monthly":
        year, month = first.year, first.month
        while date(year, month, 1) <= end:
            try:
                cand = date(year, month, first.day)
                if cand >= first and start <= cand <= end:
                    out.append(cand)
            except ValueError:
                pass
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def mascot_stamp_ids():
    """desktop/js/mascot.js 的 STAMP_ICONS 鍵（前端畫得出來的印章）。"""
    try:
        src = MASCOT_JS.read_text(encoding="utf-8")
    except OSError:
        return None
    block = re.search(r"const STAMP_ICONS = \{(.*?)\n\s*\};", src, re.S)
    if not block:
        return None
    return set(re.findall(r"^\s*([a-z]+):\s*`", block.group(1), re.M))


def _words(text: str):
    return re.findall(r"[A-Za-z][A-Za-z'’-]*", text or "")


def validate_persona(key: str, p: dict, b, d0: date, clock: Clock, stamp_ids_js):
    """回傳 (errors, derived)。errors 非空就不寫入任何東西。"""
    errors = []
    err = errors.append
    zh = p.get("lang") == "zh-TW"
    if p.get("lang") not in ("zh-TW", "en"):
        err(f"lang must be zh-TW or en, got {p.get('lang')!r}")

    # --- 帳號與陪伴者設定
    accounts = p["accounts"]
    if len(accounts.get("password", "")) < 8:
        err("password must be at least 8 characters (backend password rule)")
    for role in ROLES_FULL + ("hello",):
        acct = accounts.get(role) or {}
        if not isinstance(acct.get("id"), int) or acct["id"] < 2:
            err(f"accounts.{role}.id must be an int >= 2 (never account id 1)")
        if not acct.get("username") or len(acct["username"]) > 50:
            err(f"accounts.{role}.username missing or longer than 50 chars")
    try:
        b.CompanionSettingsIn(**p["companion"])
    except Exception as exc:  # pydantic ValidationError
        err(f"companion settings rejected by the API schema: {exc}")
    if len(p["companion"].get("companion_name") or "") > 12:
        err("companion_name longer than 12 chars (onboarding NAME_MAX_CHARS)")
    if p.get("memory_write_mode") not in (None, "approval"):
        err("memory_write_mode must be null or 'approval'")

    # --- 初次見面
    answers = p["onboarding"]["answers"]
    if set(answers) != set(b.models.ONBOARDING_QUESTION_KEYS):
        err(f"onboarding answers must cover exactly {b.models.ONBOARDING_QUESTION_KEYS}")
    for qkey, text in answers.items():
        try:
            b.OnboardingAnswerIn(question_key=qkey, answer_text=text)
        except Exception as exc:
            err(f"onboarding answer {qkey!r} rejected by the API schema: {exc}")
    if answers.get("companion_naming") != p["companion"].get("companion_name"):
        err("onboarding companion_naming answer should equal companion.companion_name")

    # --- 日記與印章
    diaries = p["diaries"]
    days = [d["day"] for d in diaries]
    if len(set(days)) != len(days):
        err("diary days must be unique (one diary and one stamp per day)")
    if not DIARY_COUNT[0] <= len(diaries) <= DIARY_COUNT[1]:
        err(f"storyboard wants {DIARY_COUNT[0]}-{DIARY_COUNT[1]} diaries, got {len(diaries)}")
    if any(not DIARY_WINDOW[0] <= d <= DIARY_WINDOW[1] for d in days):
        err(f"diary days must be within D{DIARY_WINDOW[0]}..D{DIARY_WINDOW[1]}")
    if -1 not in days:
        err("storyboard §3.3-5: there must be a diary on D-1 (S7 check-in reads the latest diary within 3 days)")
    if len(p.get("diary_headings", [])) != 4:
        err("diary_headings must list the 4 section headings of the app's diary prompt")
    for spec in diaries:
        tag = f"diary D{spec['day']}"
        for field in ("title", "summary", "note", "stamp", "time"):
            if not spec.get(field):
                err(f"{tag}: missing {field}")
        body = spec.get("body") or {}
        if any(not body.get(part) for part in ("today", "feelings", "reflections", "tomorrow")):
            err(f"{tag}: body needs today/feelings/reflections/tomorrow")
        try:
            parse_hhmm(spec.get("time", ""))
        except (ValueError, TypeError):
            err(f"{tag}: time must be HH:MM")
        for field in ("valence", "arousal"):
            value = spec.get(field)
            if not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0:
                err(f"{tag}: {field} must be within 0..1")
        if zh:
            if len(spec["title"]) > 12:
                err(f"{tag}: zh title longer than 12 chars ({len(spec['title'])})")
            if len(spec["summary"]) > 50:
                err(f"{tag}: zh summary longer than 50 chars ({len(spec['summary'])})")
            if len(spec["note"]) > 30:
                err(f"{tag}: zh stamp phrase longer than 30 chars ({len(spec['note'])})")
        else:
            if len(_words(spec["title"])) > 8:
                err(f"{tag}: en title longer than 8 words")
            if len(_words(spec["summary"])) > 30:
                err(f"{tag}: en summary longer than 30 words")
        stamp = spec.get("stamp")
        if stamp not in b.day_stamp.STAMP_IDS:
            err(f"{tag}: stamp {stamp!r} is not a backend STAMP_IDS entry")
        if stamp_ids_js is not None and stamp not in stamp_ids_js:
            err(f"{tag}: stamp {stamp!r} is not drawn by desktop/js/mascot.js STAMP_ICONS")
        if isinstance(spec.get("valence"), (int, float)):
            finalized = b.day_stamp.finalize(stamp, spec.get("note"), spec["valence"])
            if finalized != (stamp, spec.get("note")):
                err(f"{tag}: the app would store {finalized!r} instead (heavy days need an encouragement "
                    f"stamp {b.day_stamp.ENCOURAGE_STAMPS}; phrases are cut at {b.day_stamp.NOTE_MAX} chars)")

    valences = [d["valence"] for d in diaries if isinstance(d.get("valence"), (int, float))]
    heavy = [v for v in valences if v < HEAVY_BELOW]
    neutral = [v for v in valences if BAND_NEUTRAL[0] <= v < BAND_NEUTRAL[1]]
    bright = [v for v in valences if BAND_BRIGHT[0] <= v <= BAND_BRIGHT[1]]
    if len(heavy) != 3 or not 2 <= len(neutral) <= 3 or not 9 <= len(bright) <= 10 \
            or len(heavy) + len(neutral) + len(bright) != len(valences):
        err(f"valence distribution must be 9-10 bright (0.55-0.85) / 2-3 neutral (0.45-0.55) / 3 heavy (<0.45); "
            f"got {len(bright)}/{len(neutral)}/{len(heavy)} of {len(valences)}")
    if heavy and min(heavy) < SAFE_FLOOR:
        err(f"heaviest day valence {min(heavy)} < {SAFE_FLOOR}: keep it sad-but-safe")
    stamps_used = {d.get("stamp") for d in diaries}
    for group in REQUIRED_STAMP_GROUPS:
        if not stamps_used.intersection(group):
            err(f"storyboard §3.3-5 needs a diary stamped {' or '.join(group)}")

    roles = p["storyboard_roles"]
    by_day = {d["day"]: d for d in diaries}
    target = by_day.get(roles.get("recall_target_day"))
    if roles.get("recall_target_day") != -16 or target is None:
        err("storyboard U04/U05: the recall target must be the D-16 diary")
    else:
        if not BAND_NEUTRAL[0] <= target["valence"] <= BAND_NEUTRAL[1]:
            err("recall target (D-16) should have valence around 0.5")
        text = f"{target['title']} {target['summary']}"
        u04 = p["demo_messages"].get("u04", "")
        for word in roles.get("recall_keywords", []):
            if zh:
                in_title, in_u04 = word in text, word in u04
            else:
                low = {w.lower() for w in _words(text)}
                in_title, in_u04 = word.lower() in low, word.lower() in {w.lower() for w in _words(u04)}
            if not in_title:
                err(f"recall keyword {word!r} missing from the D-16 title/summary")
            if not in_u04:
                err(f"recall keyword {word!r} missing from the U04 demo message (exact word)")
    bright_spec = by_day.get(roles.get("bright_day"))
    if not bright_spec or bright_spec["valence"] < 0.65 or bright_spec["stamp"] != "sun":
        err("storyboard U09/S6: bright_day needs valence >= 0.65 and the 'sun' stamp (晴朗有勁 / Sunny Spirit)")
    heavy_spec = by_day.get(roles.get("heavy_day"))
    if not heavy_spec or heavy_spec["valence"] >= HEAVY_BELOW or heavy_spec["stamp"] != "umbrella":
        err("storyboard U11/S6: heavy_day needs valence < 0.45 and the 'umbrella' stamp (雨天安好 / Rainy Comfort)")

    # --- 行事曆（用 API 的 CalendarEventCreate 驗證）
    events = p["calendar_events"]
    for ev in events:
        if "reminder_minutes" in ev:
            err(f"event {ev.get('title')!r}: no reminders in demo data (in-app reminder toasts would pop up during takes)")
        try:
            b.CalendarEventCreate(
                title=ev["title"], note=ev.get("note"), category=ev.get("category", "other"),
                event_date=shift(d0, ev["day"]), event_time=ev.get("time"),
                recurrence=ev.get("recurrence", "none"),
                end_date=shift(d0, ev["end_day"]) if "end_day" in ev else None, color=ev.get("color"))
        except Exception as exc:
            err(f"event {ev.get('title')!r} rejected by the API schema: {exc}")

    def occurs(pred, day):
        return any(pred(ev) and shift(d0, day) in expand_event(ev, d0, shift(d0, day), shift(d0, day))
                   for ev in events)

    if not any("end_day" in ev and ev["day"] == -14 and ev["end_day"] == -12 for ev in events):
        err("storyboard §3.3-7: a multi-day event D-14..D-12 (midterm week) is required")
    if not any("end_day" in ev and ev["day"] == 3 and ev["end_day"] == 4 for ev in events):
        err("storyboard §3.3-7: a future multi-day event D+3..D+4 is required")
    if not occurs(lambda ev: ev.get("recurrence") == "weekly" and ev.get("time") == "14:00", 0):
        err("storyboard §3.3-7: the weekly advisor meeting must occur on D0 at 14:00")
    if not occurs(lambda ev: ev.get("time") == "10:00", 1):
        err("storyboard U12: an event at 10:00 on D+1 is required")
    for stamp_group, category in ((("cake",), "anniversary"), (("camera", "plane"), "travel")):
        day = next((d["day"] for d in diaries if d["stamp"] in stamp_group), None)
        if day is None or not occurs(lambda ev, c=category: ev.get("category") == c, day):
            err(f"storyboard §3.3-7: a {category} event must fall on the {'/'.join(stamp_group)} day")
    if not any(ev.get("category") == "health" for ev in events):
        err("storyboard §3.3-7: a health event (dentist) is required")
    window = sum(len(expand_event(ev, d0, shift(d0, 0), shift(d0, 8))) for ev in events)
    if window > 10:
        err(f"check-in calendar context shows at most 10 lines; D0..D+8 has {window} occurrences")

    # --- 記憶檔與帳本
    contents, op_rows, touched, mem_errors = build_memory(p, d0, clock, b)
    errors.extend(mem_errors)
    n_review = sum(1 for bt in p["memory"]["batches"] if bt.get("source") == "review_pass")
    n_edit = sum(1 for bt in p["memory"]["batches"] if bt.get("source") == "user_edit")
    if not 2 <= n_review <= 4 or n_edit != 1:
        err(f"storyboard §3.3-4: 2-4 applied batches from diaries and 1 user edit; got {n_review} and {n_edit}")
    for file_key, (low, high) in (("user_profile", PROFILE_CHARS), ("companion_notes", COMPANION_CHARS)):
        count = len(contents.get(file_key, ""))
        if not low <= count <= high:
            err(f"storyboard §3.3-4: {file_key} must be {low}-{high} chars, got {count}")

    # --- 危機詞（STORYBOARD §3.4 第 5 點：種子與示範訊息一律不可出現）
    texts = []
    for spec in diaries:
        texts += [spec["title"], spec["summary"], spec["note"]] + list(spec["body"].values())
    texts += list(answers.values())
    texts += [ev["title"] for ev in events] + [ev.get("note") or "" for ev in events]
    texts += [contents[k] for k in contents] + [r["new_text"] or "" for r in op_rows]
    msgs = p["demo_messages"]
    texts += [msgs.get("u03", ""), msgs.get("u04", "")] + list(msgs.get("u10", []))
    for text in texts:
        level = b.check_sensitive_content(text)
        if level:
            err(f"crisis-list word (level {level}) found in: {text[:40]!r}…")
    u03 = msgs.get("u03", "")
    if zh and not 80 <= len(u03.replace(" ", "")) <= 120:
        err(f"U03 demo message should be about 100 chars, got {len(u03)}")
    if not zh and not 60 <= len(u03.split()) <= 80:
        err(f"U03 demo message should be 60-80 words, got {len(u03.split())}")

    derived = SimpleNamespace(contents=contents, op_rows=op_rows, touched=touched)
    return errors, derived


# ---------------------------------------------------------------------------
# 寫入
# ---------------------------------------------------------------------------

def create_schema(b):
    """與後端 startup 相同：建表、補欄、建 FTS5 虛擬表。"""
    b.models.Base.metadata.create_all(bind=b.engine)
    b.ensure_schema(b.engine)
    if not b.diary_fts.ensure_fts(b.engine):
        log("  ! FTS5 unavailable: keyword recall will fall back to LIKE (same as the app)")


def seed_full_account(b, p, role, d0, clock, derived, password_hash):
    acct = p["accounts"][role]
    uid = acct["id"]
    ob = p["onboarding"]
    ob_day = shift(d0, ob["day"])
    created = clock.utc(clock.real_local(shift(d0, p["account_created"]["day"]), p["account_created"]["time"]))
    last_checkin = clock.diary_datetime(shift(d0, p["last_checkin"]["day"]), p["last_checkin"]["time"])
    with b.db_session() as db:
        db.add(b.models.User(
            id=uid, username=acct["username"], password_hash=password_hash, created_at=created,
            companion_name=p["companion"].get("companion_name"),
            user_nickname=p["companion"].get("user_nickname"),
            memory_write_mode=p.get("memory_write_mode"),
            onboarding_completed_at=clock.utc(clock.real_local(ob_day, ob["completed_time"])),
            last_checkin_date=last_checkin))
        db.commit()

        # 初次見面：一題一列；收納戳記只蓋在「非 companion_naming」的答案上（與 App 相同）
        start = clock.real_local(ob_day, ob["start_time"])
        ingested = clock.utc(clock.real_local(ob_day, ob["completed_time"]) + timedelta(seconds=20))
        for i, qkey in enumerate(b.models.ONBOARDING_QUESTION_KEYS):
            db.add(b.models.OnboardingAnswer(
                user_id=uid, question_key=qkey, answer_text=ob["answers"][qkey],
                answered_at=clock.utc(start + timedelta(seconds=45 * i)),
                ingested_at=None if qkey == "companion_naming" else ingested))
        db.commit()

        # 日記＋印章（舊到新，id 跟著時間走）；upsert_day_note 會順手把小語併入 FTS 索引
        diary_ids = {}
        for spec in sorted(p["diaries"], key=lambda s: s["day"]):
            day = shift(d0, spec["day"])
            written = clock.utc(clock.real_local(day, spec["time"]))
            diary = b.models.Diary(
                user_id=uid, content=render_body(p, spec), title=spec["title"], summary=spec["summary"],
                valence=spec["valence"], arousal=spec["arousal"],
                diary_date=clock.diary_datetime(day, spec["time"]), created_at=written)
            db.add(diary)
            db.commit()
            db.refresh(diary)
            stamp, phrase = b.day_stamp.finalize(spec["stamp"], spec["note"], spec["valence"])
            note = b.crud.upsert_day_note(db, uid, day, stamp, phrase, source_diary_id=diary.id)
            note.created_at = note.updated_at = written + timedelta(seconds=5)
            db.commit()
            diary_ids[spec["day"]] = diary.id

        # 行事曆（沒有提醒：錄影中不能跳 in-app 提醒）
        for ev in p["calendar_events"]:
            payload = b.CalendarEventCreate(
                title=ev["title"], note=ev.get("note"), category=ev.get("category", "other"),
                event_date=shift(d0, ev["day"]), event_time=ev.get("time"),
                recurrence=ev.get("recurrence", "none"),
                end_date=shift(d0, ev["end_day"]) if "end_day" in ev else None, color=ev.get("color"))
            row = b.crud.create_calendar_event(
                db, uid, payload.title, payload.event_date, note=payload.note, category=payload.category,
                event_time=payload.event_time, recurrence=payload.recurrence,
                recurrence_until=payload.recurrence_until, reminder_minutes=payload.reminder_minutes,
                end_date=payload.end_date, color=payload.color)
            entered = min(max(payload.event_date - timedelta(days=7), shift(d0, -21)), shift(d0, -1))
            row.created_at = row.updated_at = clock.utc(clock.real_local(entered, "21:00"))
            db.commit()

        # 記憶檔＋帳本（全部「已生效」；核可制是之後才打開的，所以沒有 decided_at）
        for file_key, content in derived.contents.items():
            if not content:
                continue
            row = b.crud.upsert_memory_file(db, uid, file_key, content)
            row.updated_at = derived.touched[file_key]
            db.commit()
        batch_ids = {}
        rows = []
        for r in derived.op_rows:
            rows.append({
                "user_id": uid, "file_key": r["file_key"],
                "batch_id": batch_ids.setdefault(r["batch_key"], str(uuid.uuid4())),
                "action": r["action"], "section": r["section"],
                "target_text": r["target_text"], "new_text": r["new_text"],
                "status": "applied", "source": r["source"],
                "source_diary_id": diary_ids.get(r["diary_day"]) if r["diary_day"] is not None else None,
                "error": None, "created_at": r["created_at"], "decided_at": None})
        b.crud.create_memory_ops(db, rows)
    return diary_ids


def seed_hello_account(b, p, password_hash):
    acct = p["accounts"]["hello"]
    with b.db_session() as db:
        db.add(b.models.User(id=acct["id"], username=acct["username"], password_hash=password_hash,
                             created_at=datetime.utcnow()))
        db.commit()


# ---------------------------------------------------------------------------
# 種子後檢查
# ---------------------------------------------------------------------------

def recall_rank(b, uid: int, title: str, u03: str, u04: str):
    """D-16 在「U03 那一輪」與「U04 那一輪」的關鍵字檢索排名（App 取前 3 注入提示詞）。"""
    def rank(block):
        for i, line in enumerate(block.splitlines(), 1):
            if f"《{title}》" in line:
                return i
        return None
    first = b.memory_retrieval.get_relevant_memories(uid, u03, chat_history=None, semantic=False)
    history = [{"role": "user", "content": u03}, {"role": "assistant", "content": "…"}]
    second = b.memory_retrieval.get_relevant_memories(uid, u04, chat_history=history, semantic=False)
    return rank(first), rank(second)


def month_stamp_info(p, d0: date):
    in_month = sum(1 for d in p["diaries"] if shift(d0, d["day"]).month == d0.month
                   and shift(d0, d["day"]).year == d0.year)
    offsets = sorted(-d["day"] for d in p["diaries"])
    min_dom = offsets[11] + 1 if len(offsets) >= 12 else None
    return in_month, min_dom


def fts_counts(b):
    from sqlalchemy import text as sql_text
    with b.db_session() as db:
        diaries = db.execute(sql_text("SELECT count(*) FROM diaries")).scalar() or 0
        try:
            fts = db.execute(sql_text("SELECT count(*) FROM diary_fts")).scalar() or 0
        except Exception:
            fts = 0
    return diaries, fts


# ---------------------------------------------------------------------------
# 重拍工具
# ---------------------------------------------------------------------------

def maintenance(args, target: Path):
    manifest = load_manifest(target)
    if manifest is None:
        refuse(f"{target} has no {MANIFEST_NAME}; it was not seeded by seed_demo.py")
    accounts = {}
    for key, info in manifest["personas"].items():
        for role, acct in info["accounts"].items():
            accounts[acct["username"]] = (key, role, acct["id"])
    names = [n.strip() for n in (args.user or "").split(",") if n.strip()]
    if args.reset_hello:
        names = names or [u for u, (_, role, _) in accounts.items() if role == "hello"]
    unknown = [n for n in names if n not in accounts]
    if unknown:
        refuse(f"unknown demo account(s) {unknown}; known: {sorted(accounts)}")
    if not names:
        refuse("nothing to do: pass --user NAME with --set-checkin/--clear-chat, or --reset-hello")
    b = import_backend(target)
    from sqlalchemy import text as sql_text
    today = b.time_utils.get_diary_date()
    for name in names:
        key, role, uid = accounts[name]
        done = []
        if args.reset_hello:
            if role != "hello":
                refuse(f"--reset-hello only resets the hello accounts, not {name} ({role})")
            with b.db_session() as db:
                params = {"u": uid}
                db.execute(sql_text("DELETE FROM day_notes WHERE user_id = :u"), params)
                db.execute(sql_text("DELETE FROM memory_ops WHERE user_id = :u"), params)
                db.execute(sql_text("DELETE FROM diary_embeddings WHERE diary_id IN "
                                    "(SELECT id FROM diaries WHERE user_id = :u)"), params)
                try:
                    db.execute(sql_text("DELETE FROM diary_fts WHERE user_id = :u"), params)
                except Exception:
                    pass  # FTS5 不可用
                for table in ("diaries", "onboarding_answers", "memory_files", "chat_messages",
                              "calendar_events", "interaction_notes", "llm_credentials"):
                    db.execute(sql_text(f"DELETE FROM {table} WHERE user_id = :u"), params)
                db.execute(sql_text(
                    "UPDATE users SET companion_name = NULL, user_nickname = NULL, style_reply_length = NULL, "
                    "style_emoji = NULL, style_formality = NULL, memory_write_mode = NULL, "
                    "onboarding_completed_at = NULL, last_checkin_date = NULL WHERE id = :u"), params)
                db.commit()
            done.append("reset to brand-new (no name, no onboarding answers, no data; still logged in)")
        if args.clear_chat:
            b.memory_manager.clear_chat_history(uid)
            done.append("backend chat history cleared (same as DELETE /chat/clear/)")
        if args.set_checkin:
            value = (b.time_utils.get_diary_datetime() if args.set_checkin == "today"
                     else datetime.combine(today - timedelta(days=1), dtime(21, 5)))
            with b.db_session() as db:
                db.execute(sql_text("UPDATE users SET last_checkin_date = :v WHERE id = :u"),
                           {"v": value, "u": uid})
                db.commit()
            done.append(f"last_checkin_date = {value:%Y-%m-%d %H:%M} "
                        + ("(no greeting until tomorrow)" if args.set_checkin == "today"
                           else "(next app open greets)"))
        if not done:
            refuse("nothing to do for this account: add --set-checkin, --clear-chat or --reset-hello")
        for line in done:
            log(f"  {name} (id {uid}): {line}")
    return 0


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Seed the URDiary promo demo dataset into an isolated data dir (URDIARY_DATA_DIR).")
    ap.add_argument("--reset", action="store_true", help="wipe the target DB first if it already has accounts")
    ap.add_argument("--d0", type=date.fromisoformat, help="recording day D0 for both personas (default: app's today)")
    ap.add_argument("--d0-zh", type=date.fromisoformat, help="D0 for 語晴 only")
    ap.add_argument("--d0-en", type=date.fromisoformat, help="D0 for Maya only")
    ap.add_argument("--checkin-done", action="store_true",
                    help="mark today's daily check-in as already done (stub recording sessions)")
    ap.add_argument("--semantic", action="store_true", help="also build semantic-search vectors (optional)")
    ap.add_argument("--allow-dir", action="store_true", help="allow a data dir outside /tmp and the media root")
    ap.add_argument("--check-dir", action="store_true", help="only run the directory safety checks")
    ap.add_argument("--require-seeded", action="store_true", help="with --check-dir: also require a seeded dir")
    ap.add_argument("--stub-warning", action="store_true",
                    help="with --check-dir: warn about accounts that would get a stub check-in greeting today")
    ap.add_argument("--user", help="maintenance: demo account name(s), comma separated")
    ap.add_argument("--set-checkin", choices=("today", "yesterday"), help="maintenance: move last_checkin_date")
    ap.add_argument("--clear-chat", action="store_true", help="maintenance: clear the backend chat history")
    ap.add_argument("--reset-hello", action="store_true", help="maintenance: hello accounts back to brand-new")
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    target = resolve_data_dir(os.environ.get("URDIARY_DATA_DIR"), args.allow_dir)

    if args.check_dir:
        manifest = load_manifest(target)
        if args.require_seeded and manifest is None:
            refuse(f"{target} has no {MANIFEST_NAME}: seed it first with promo/demo/seed_demo.py")
        detail = ""
        if manifest:
            d0s = ", ".join(f"{k} D0={v['d0']}" for k, v in manifest["personas"].items())
            detail = f" (seeded {manifest['seeded_at_local']}; {d0s})"
        log(f"[seed_demo] demo dir OK: {target}{detail}")
        if args.stub_warning and manifest:
            stub_checkin_warning(target, manifest)
        return 0

    if args.user or args.reset_hello or args.set_checkin or args.clear_chat:
        return maintenance(args, target)

    personas = load_personas()
    ids = [acct["id"] for p in personas.values() for role, acct in p["accounts"].items() if role != "password"]
    names = [acct["username"] for p in personas.values() for role, acct in p["accounts"].items() if role != "password"]
    if len(set(ids)) != len(ids) or len(set(names)) != len(names):
        refuse("account ids and usernames must be unique across personas", code=3)

    present = existing_usernames(target)
    if present and not args.reset:
        refuse(f"{target / DB_NAME} already has {len(present)} account(s). Pass --reset to wipe and reseed "
               "(stop the demo backend on 8124 first).")
    foreign = sorted(present - set(names))
    if args.reset and foreign:
        refuse(f"{target / DB_NAME} contains account(s) that are not demo accounts ({', '.join(foreign[:5])}). "
               "--reset only wipes databases this script created; use a fresh directory.")
    if args.reset and port_in_use():
        refuse(f"something listens on {DEMO_HOST}:{DEMO_PORT} (probably the demo backend with this DB open). "
               "Stop it before --reset.")

    b = import_backend(target)
    clock = Clock(b)
    today = b.time_utils.get_diary_date()
    local_now = b.time_utils.get_local_now()
    d0s = {"zh": args.d0_zh or args.d0 or today, "en": args.d0_en or args.d0 or today}
    stamp_ids_js = mascot_stamp_ids()
    if stamp_ids_js is None:
        log("  ! could not parse STAMP_ICONS from desktop/js/mascot.js; checking backend STAMP_IDS only")

    all_errors, derived = [], {}
    for key, p in personas.items():
        errors, derived[key] = validate_persona(key, p, b, d0s[key], clock, stamp_ids_js)
        all_errors += [f"{PERSONA_FILES[key].name}: {e}" for e in errors]
    if all_errors:
        print("[seed_demo] persona validation failed; nothing was written:", file=sys.stderr)
        for line in all_errors:
            print(f"  - {line}", file=sys.stderr)
        return 3

    if args.reset:
        b.engine.dispose()
        for name in (DB_NAME, DB_NAME + "-wal", DB_NAME + "-shm", MANIFEST_NAME):
            path = target / name
            if path.exists():
                path.unlink()
        log(f"[seed_demo] --reset: removed the previous demo DB in {target}")

    create_schema(b)
    summary_rows = []
    for key, p in personas.items():
        d0 = d0s[key]
        password_hash = b.get_password_hash(p["accounts"]["password"])
        for role in ROLES_FULL:
            seed_full_account(b, p, role, d0, clock, derived[key], password_hash)
            summary_rows.append((key, role))
        seed_hello_account(b, p, password_hash)
        summary_rows.append((key, "hello"))

    if args.checkin_done:
        with b.db_session() as db:
            for key, p in personas.items():
                stamp = (b.time_utils.get_diary_datetime() if d0s[key] == today
                         else datetime.combine(d0s[key], dtime(8, 0)))
                for role in ROLES_FULL:
                    user = b.crud.get_user(db, p["accounts"][role]["id"])
                    user.last_checkin_date = stamp
            db.commit()

    n_diaries, n_fts = fts_counts(b)
    if n_fts != n_diaries:
        b.diary_fts.backfill()
        n_diaries, n_fts = fts_counts(b)
    semantic_note = "off (keyword recall only, as the storyboard asks)"
    if args.semantic:
        if b.memory_retrieval._fastembed_installed():
            from database.models import Diary
            with b.db_session() as db:
                rows = [(d.id, d.title, d.summary, d.content) for d in db.query(Diary).all()]
            for row in rows:
                b.memory_retrieval._index_diary_safe(*row)
            semantic_note = f"vectors built for {len(rows)} diaries"
        else:
            semantic_note = "requested, but fastembed is not installed"

    recall = {}
    for key, p in personas.items():
        spec = next(d for d in p["diaries"] if d["day"] == p["storyboard_roles"]["recall_target_day"])
        msgs = p["demo_messages"]
        recall[key] = recall_rank(b, p["accounts"]["main"]["id"], spec["title"], msgs["u03"], msgs["u04"])

    # --- manifest（驗證腳本與 run_demo_backend.sh 讀它；不含密碼）
    manifest = {
        "about": "URDiary promo demo dataset (promo/demo/seed_demo.py). Fictional people only.",
        "seeded_at_local": local_now.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "timezone": b.config.TIMEZONE,
        "day_boundary_hour": b.time_utils.DIARY_DAY_BOUNDARY_HOUR,
        "port": DEMO_PORT,
        "personas": {},
    }
    for key, p in personas.items():
        contents = derived[key].contents
        manifest["personas"][key] = {
            "lang": p["lang"], "persona": p["persona"], "d0": d0s[key].isoformat(),
            "persona_file": str(PERSONA_FILES[key].relative_to(REPO_ROOT)),
            "persona_sha256": persona_sha(key),
            "accounts": {role: p["accounts"][role] for role in ROLES_FULL + ("hello",)},
            "memory_chars": {k: len(v) for k, v in contents.items()},
            "memory_sha256": {k: hashlib.sha256(v.encode("utf-8")).hexdigest() for k, v in contents.items()},
            "checkin_done_today": bool(args.checkin_done),
        }
    (target / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                        encoding="utf-8")

    # --- 摘要
    log("")
    log(f"URDiary promo demo dataset seeded into {target}")
    log(f"  app 'today' = {today} (Asia/Taipei-style 05:00 rollover; TZ {b.config.TIMEZONE}); "
        f"local now {local_now:%Y-%m-%d %H:%M}")
    for key, p in personas.items():
        log(f"  D0 {p['persona']} ({key}) = {d0s[key]}  → diaries D-21..D-1 = "
            f"{shift(d0s[key], -21)}..{shift(d0s[key], -1)}")
        if d0s[key] != today:
            log(f"  ! D0 for {key} is not the app's today ({today}); the data is dated for {d0s[key]}.")
    if local_now.hour < b.time_utils.DIARY_DAY_BOUNDARY_HOUR and not (args.d0 or args.d0_zh or args.d0_en):
        log("  ! It is before 05:00: the app still treats this as yesterday. Pass --d0 for a later recording day.")
    log("")
    header = f"  {'id':>4}  {'username':<14}{'lang':<7}{'onboarding':<12}{'diaries':>7}{'stamps':>8}" \
             f"{'events':>8}  {'profile/notes':<14}{'ledger':<22}{'check-in':<18}"
    log(header)
    log("  " + "-" * (len(header) - 2))
    for key, role in summary_rows:
        p = personas[key]
        acct = p["accounts"][role]
        if role == "hello":
            log(f"  {acct['id']:>4}  {acct['username']:<14}{p['lang']:<7}{'NOT started':<12}{0:>7}{0:>8}{0:>8}"
                f"  {'-':<14}{'-':<22}{'(onboarding)':<18}")
            continue
        contents = derived[key].contents
        n_batches = len({r['batch_key'] for r in derived[key].op_rows})
        checkin = "done today" if args.checkin_done else "greets on open"
        log(f"  {acct['id']:>4}  {acct['username']:<14}{p['lang']:<7}{'complete':<12}{len(p['diaries']):>7}"
            f"{len(p['diaries']):>8}{len(p['calendar_events']):>8}  "
            f"{len(contents['user_profile'])}/{len(contents['companion_notes']):<10}"
            f"{str(n_batches) + ' batches, applied':<22}{checkin:<18}")
    log("")
    log(f"  FTS keyword index: {n_fts}/{n_diaries} diaries; semantic vectors: {semantic_note}")
    for key, p in personas.items():
        d0 = d0s[key]
        in_month, min_dom = month_stamp_info(p, d0)
        d1 = next(d for d in p["diaries"] if d["day"] == -1)
        spec = next(d for d in p["diaries"] if d["day"] == p["storyboard_roles"]["recall_target_day"])
        r1, r2 = recall[key]
        log(f"  [{key}] S7 backup: D-1 diary {shift(d0, -1)} 《{d1['title']}》 present")
        log(f"  [{key}] S4 recall of 《{spec['title']}》 ({shift(d0, -16)}): rank "
            f"{r1 or 'not found'} on the U03 turn, {r2 or 'not found'} on the U04 turn (top 3 are injected)")
        flag = "OK" if in_month >= 12 else f"LOW — D0 on day {min_dom}+ of a month gives >=12"
        log(f"  [{key}] U08 month grid {d0:%Y-%m}: {in_month} stamped days (needs >=12): {flag}")
    log("")
    for key, p in personas.items():
        users_list = ", ".join(p["accounts"][r]["username"] for r in ROLES_FULL + ("hello",))
        log(f"  Demo password ({p['persona']}: {users_list}): {p['accounts']['password']}")
    log(f"  Next: URDIARY_DATA_DIR={target} promo/demo/run_demo_backend.sh [--stub]   (port {DEMO_PORT})")
    log(f"        URDIARY_DATA_DIR={target} promo/demo/verify_demo.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
