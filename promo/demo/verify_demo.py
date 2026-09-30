#!/usr/bin/env python3
"""用真的 HTTP API 核對示範資料（promo/demo/verify_demo.sh 會先把 demo 後端開好）。

只用標準函式庫、只發 GET（外加登入），不呼叫任何 LLM 端點：
  - 每位人物的 main／copy 帳號：日記（日期、標題、摘要、內文、情緒分數、印章＋小語）、
    印章 API、行事曆（區間內每一個 occurrence）、D0 所在月份的月格、記憶檔（字數、內容雜湊、
    核可制、待核可 0）、帳本批次、初次見面狀態、陪伴者名字、目前生效的 AI 設定；
  - 分鏡前提：S4 回憶目標（D-16）、S6 兩枚印章（晴朗有勁／雨天安好）、S7 備案的 D-1 日記、
    U08 月格 ≥12 枚印章；
  - hello 帳號：初次見面未開始、沒有名字、沒有任何資料；
  - 所有示範帳號 id ≠ 1。

用法：URDIARY_DATA_DIR=<已種好的目錄> .venv/bin/python promo/demo/verify_demo.py [--expect-llm stub|real|any]
期望值一律從 promo/demo/personas/*.json＋目錄裡的 demo_manifest.json（D0、帳號、記憶檔雜湊）算出來。
核對的是「錄影前」的種子狀態：真的錄過 U06 之後（D0 多一篇日記、帳本多待核可批次）回報差異是正常的。
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
I18N_JS = REPO_ROOT / "desktop" / "js" / "i18n.js"
MANIFEST_NAME = "demo_manifest.json"

RESULTS = []   # (status, label, detail)


def record(ok, label, detail="", warn=False):
    status = "PASS" if ok else ("WARN" if warn else "FAIL")
    RESULTS.append((status, label, detail))
    line = f"{status}  {label}"
    if detail:
        line += f" — {detail}"
    print(line, flush=True)
    return ok


class Api:
    def __init__(self, base):
        self.base = base.rstrip("/")

    def call(self, method, path, token=None, lang=None, form=None, params=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Accept": "application/json"}
        data = None
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if lang:
            headers["X-Language"] = lang
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            try:
                return exc.code, json.loads(body)
            except ValueError:
                return exc.code, body


def shift(d0, day):
    return d0 + timedelta(days=day)


def render_body(persona, spec):
    """與 seed_demo.render_body 同一份規則（四段標題＋內文）。"""
    h = persona["diary_headings"]
    b = spec["body"]
    parts = [(h[0], b["today"]), (h[1], b["feelings"]), (h[2], b["reflections"]), (h[3], b["tomorrow"])]
    return "\n\n".join(f"{title}\n{text.strip()}" for title, text in parts)


def expand_event(ev, d0, start, end):
    """與 seed_demo.expand_event 同一份規則；獨立於後端，拿來對照 API 的展開結果。"""
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


def stamp_names():
    """desktop/js/i18n.js 的印章名稱（zh-TW 區塊在前、en 在後）；讀不到就回空。"""
    try:
        src = I18N_JS.read_text(encoding="utf-8")
    except OSError:
        return {}, {}
    found = re.findall(r"'stamp\.([a-z]+)':\s*'([^']*)'", src)
    zh, en = {}, {}
    for key, name in found:
        (en if key in zh else zh)[key] = name
    return zh, en


def month_bounds(d):
    first = d.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return first, nxt - timedelta(days=1)


def login(api, username, password, lang):
    status, body = api.call("POST", "/users/login", lang=lang,
                            form={"username": username, "password": password})
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        return None, None
    return body["access_token"], body.get("user_id")


def check_full_account(api, key, persona, info, role, names_zh, names_en, expect_llm, db_path):
    acct = info["accounts"][role]
    lang = persona["lang"]
    d0 = date.fromisoformat(info["d0"])
    who = f"{key}/{acct['username']}"
    token, uid = login(api, acct["username"], persona["accounts"]["password"], lang)
    if not record(token is not None, f"{who} login", f"user_id={uid}"):
        return
    record(uid == acct["id"] and uid != 1, f"{who} account id", f"{uid} (expected {acct['id']}, never 1)")

    # --- 日記
    status, body = api.call("GET", f"/diaries/{uid}", token, lang, params={"limit": 100})
    diaries = body.get("diaries", []) if status == 200 else []
    by_date = {d["diary_date"][:10]: d for d in diaries}
    expected = {shift(d0, s["day"]).isoformat(): s for s in persona["diaries"]}
    mismatches = []
    for iso, spec in expected.items():
        got = by_date.get(iso)
        if got is None:
            mismatches.append(f"{iso} missing")
            continue
        for field, want in (("title", spec["title"]), ("summary", spec["summary"]),
                            ("content", render_body(persona, spec)), ("stamp", spec["stamp"]),
                            ("stamp_phrase", spec["note"])):
            if got.get(field) != want:
                mismatches.append(f"{iso} {field}")
        for field in ("valence", "arousal"):
            if abs((got.get(field) or -1) - spec[field]) > 1e-9:
                mismatches.append(f"{iso} {field}")
    extra = sorted(set(by_date) - set(expected))
    span = f"{min(expected)}..{max(expected)}"
    record(status == 200 and not mismatches and not extra and len(diaries) == len(expected),
           f"{who} diaries", f"{len(diaries)} entries {span}; dates/titles/summaries/bodies/valence/"
           f"arousal/stamps " + ("match" if not mismatches else f"MISMATCH {mismatches[:4]}")
           + (f"; unexpected dates {extra}" if extra else ""))
    ordered = [d["diary_date"] for d in diaries]
    record(ordered == sorted(ordered, reverse=True), f"{who} diary list order", "newest first")

    d1 = shift(d0, -1).isoformat()
    d1_spec = expected.get(d1)
    record(d1 in by_date, f"{who} S7 precondition",
           f"diary dated D-1 = {d1} 《{d1_spec['title'] if d1_spec else '?'}》 (check-in reads the latest diary within 3 days)")
    roles = persona["storyboard_roles"]
    target = next(s for s in persona["diaries"] if s["day"] == roles["recall_target_day"])
    t_iso = shift(d0, target["day"]).isoformat()
    record(by_date.get(t_iso, {}).get("title") == target["title"], f"{who} S4/U05 recall target",
           f"{t_iso} 《{target['title']}》 valence {target['valence']}")

    # --- 印章 API
    start, end = shift(d0, -21), shift(d0, -1)
    status, body = api.call("GET", "/calendar/day-notes", token, lang,
                            params={"start": start.isoformat(), "end": end.isoformat()})
    notes = body.get("notes", []) if status == 200 else []
    bad = []
    for n in notes:
        spec = expected.get(n["date"])
        diary = by_date.get(n["date"])
        if not spec or n["stamp"] != spec["stamp"] or n["phrase"] != spec["note"] \
                or not diary or n["source_diary_id"] != diary["diary_id"]:
            bad.append(n["date"])
    record(status == 200 and len(notes) == len(expected) and not bad, f"{who} day-notes",
           f"{len(notes)} stamps with phrases, each linked to its diary" + (f"; bad {bad}" if bad else ""))
    for role_key, stamp_id in (("bright_day", "sun"), ("heavy_day", "umbrella")):
        spec = next(s for s in persona["diaries"] if s["day"] == roles[role_key])
        iso = shift(d0, spec["day"]).isoformat()
        got = next((n for n in notes if n["date"] == iso), None)
        label = f"{names_zh.get(stamp_id, stamp_id)} / {names_en.get(stamp_id, stamp_id)}"
        record(bool(got) and got["stamp"] == stamp_id, f"{who} S6 {'left' if stamp_id == 'sun' else 'right'} stamp",
               f"{iso} {stamp_id}「{label}」 valence {spec['valence']}: {spec['note']}")

    # --- 行事曆：D-21..D+7 每一個 occurrence
    win_start, win_end = shift(d0, -21), shift(d0, 7)
    status, body = api.call("GET", "/calendar/events", token, lang,
                            params={"start": win_start.isoformat(), "end": win_end.isoformat()})
    occ = body.get("occurrences", []) if status == 200 else []
    got_set = {(o["title"], o["date"], o["time"]) for o in occ}
    want_set = {(ev["title"], d.isoformat(), ev.get("time")) for ev in persona["calendar_events"]
                for d in expand_event(ev, d0, win_start, win_end)}
    record(status == 200 and got_set == want_set and len(occ) == len(want_set), f"{who} calendar D-21..D+7",
           f"{len(occ)} occurrences from {len(persona['calendar_events'])} events"
           + ("" if got_set == want_set else f"; missing {sorted(want_set - got_set)[:3]} extra {sorted(got_set - want_set)[:3]}"))
    multi = sorted({(o["title"], o["span_total"]) for o in occ if (o.get("span_total") or 1) > 1})
    record(len(multi) >= 2, f"{who} multi-day bars", ", ".join(f"{t} ({n} days)" for t, n in multi))
    today_occ = [f"{o['time']} {o['title']}" for o in occ if o["date"] == d0.isoformat() and o["time"]]
    tomorrow_occ = [f"{o['time']} {o['title']}" for o in occ if o["date"] == shift(d0, 1).isoformat() and o["time"]]
    record(bool(today_occ) and bool(tomorrow_occ), f"{who} today/tomorrow plans",
           f"D0 {d0}: {today_occ}; D+1: {tomorrow_occ}")
    cats = sorted({o["category"] for o in occ})
    record(len(cats) >= 5, f"{who} category icons", ", ".join(cats))

    # --- D0 所在月份（U08 月格）
    m_start, m_end = month_bounds(d0)
    s1, month_notes = api.call("GET", "/calendar/day-notes", token, lang,
                               params={"start": m_start.isoformat(), "end": m_end.isoformat()})
    s2, month_events = api.call("GET", "/calendar/events", token, lang,
                                params={"start": m_start.isoformat(), "end": m_end.isoformat()})
    n_stamps = len(month_notes.get("notes", [])) if s1 == 200 else -1
    n_occ = len(month_events.get("occurrences", [])) if s2 == 200 else -1
    record(n_stamps >= 12, f"{who} U08 month grid {d0:%Y-%m}",
           f"{n_stamps} stamped days, {n_occ} event occurrences (needs >=12 stamps)", warn=(s1 == 200))

    # --- 記憶檔與帳本
    status, mem = api.call("GET", "/users/me/memory", token, lang)
    if record(status == 200, f"{who} memory overview", f"write_mode={mem.get('write_mode') if status == 200 else '?'}"):
        files = mem["files"]
        prof = files["user_profile"]["content"]
        comp = files["companion_notes"]["content"]
        want_sha = info["memory_sha256"]
        record(hashlib.sha256(prof.encode()).hexdigest() == want_sha["user_profile"]
               and hashlib.sha256(comp.encode()).hexdigest() == want_sha["companion_notes"],
               f"{who} memory files content", "identical to what the seeder built with memory_files.apply_op")
        record(400 <= len(prof) <= 560 and 150 <= len(comp) <= 300, f"{who} memory sizes",
               f"user profile {len(prof)}/800 chars (storyboard 400-560), companion notes {len(comp)}/600 (150-300)")
        record(mem.get("write_mode") == "approval" and mem.get("pending_count") == 0, f"{who} U15 preconditions",
               f"ask-first mode on, {mem.get('pending_count')} pending before U06")
    status, ops_body = api.call("GET", "/users/me/memory/ops", token, lang)
    ops = ops_body.get("ops", []) if status == 200 else []
    batches = []
    for op in ops:   # 新→舊
        if not batches or batches[-1]["id"] != op["batch_id"]:
            batches.append({"id": op["batch_id"], "ops": []})
        batches[-1]["ops"].append(op)
    want = list(reversed(persona["memory"]["batches"]))
    titles = {s["day"]: s["title"] for s in persona["diaries"]}
    problems = []
    if len(batches) != len(want):
        problems.append(f"{len(batches)} batches, expected {len(want)}")
    for got_b, want_b in zip(batches, want):
        first = got_b["ops"][0]
        if first["source"] != want_b["source"]:
            problems.append(f"source {first['source']} != {want_b['source']}")
        if want_b["source"] == "review_pass" and first.get("source_diary_title") != titles.get(want_b["diary_day"]):
            problems.append(f"batch from 《{first.get('source_diary_title')}》, expected 《{titles.get(want_b['diary_day'])}》")
        n_want = 1 if want_b["source"] == "user_edit" else len(want_b["ops"])
        if len(got_b["ops"]) != n_want:
            problems.append(f"{len(got_b['ops'])} ops, expected {n_want}")
    if any(op["status"] != "applied" for op in ops):
        problems.append("non-applied op present")
    summary = ", ".join(
        f"{b['ops'][0]['created_at'][:10]}・" + (
            f"《{b['ops'][0]['source_diary_title']}》" if b['ops'][0]['source'] == 'review_pass'
            else b['ops'][0]['source']) for b in batches)
    record(not problems, f"{who} memory ledger", (summary if not problems else "; ".join(problems)))

    # --- 初次見面、陪伴者、AI 設定
    status, state = api.call("GET", "/users/onboarding/state", token, lang)
    record(status == 200 and state.get("completed") is True
           and set(state.get("answered_keys", [])) == set(persona["onboarding"]["answers"]),
           f"{who} onboarding", f"completed={state.get('completed')}, {len(state.get('answered_keys', []))} answers")
    status, comp_body = api.call("GET", "/users/me/companion", token, lang)
    record(status == 200 and comp_body.get("companion_name") == persona["companion"]["companion_name"]
           and comp_body.get("user_nickname") == persona["companion"]["user_nickname"],
           f"{who} companion", f"name {comp_body.get('companion_name')}, calls her {comp_body.get('user_nickname')}")
    status, llm = api.call("GET", "/users/me/llm", token, lang)
    shown = {k: llm.get(k) for k in ("configured", "source", "provider", "model")} if status == 200 else {}
    if expect_llm == "stub":
        ok = shown.get("configured") is False
    elif expect_llm == "real":
        ok = shown.get("configured") is True and shown.get("provider") == "grok" and shown.get("model") == "grok-4.3"
    else:
        ok = status == 200
    record(ok, f"{who} AI provider seen by the app", f"{shown} (key never printed)")

    if db_path.exists():
        con = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
        try:
            row = con.execute("SELECT last_checkin_date FROM users WHERE id = ?", (uid,)).fetchone()
        finally:
            con.close()
        value = row[0] if row else None
        print(f"INFO  {who} last_checkin_date = {value} "
              f"({'greets on next open' if value and value[:10] < d0.isoformat() else 'no greeting today'})")


def check_hello(api, key, persona, info):
    acct = info["accounts"]["hello"]
    lang = persona["lang"]
    who = f"{key}/{acct['username']}"
    token, uid = login(api, acct["username"], persona["accounts"]["password"], lang)
    if not record(token is not None, f"{who} login", f"user_id={uid}"):
        return
    record(uid == acct["id"] and uid != 1, f"{who} account id", f"{uid} (expected {acct['id']}, never 1)")
    _, state = api.call("GET", "/users/onboarding/state", token, lang)
    _, comp = api.call("GET", "/users/me/companion", token, lang)
    _, diaries = api.call("GET", f"/diaries/{uid}", token, lang)
    _, mem = api.call("GET", "/users/me/memory", token, lang)
    record(state.get("completed") is False and state.get("answered_keys") == []
           and comp.get("companion_name") is None and diaries.get("diaries") == []
           and mem.get("files", {}).get("user_profile", {}).get("content") == "",
           f"{who} S2/U02 brand-new", f"onboarding not started, no answers, no name, no diaries, empty memory")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=os.environ.get("URDIARY_DEMO_BASE", "http://127.0.0.1:8124"))
    ap.add_argument("--expect-llm", choices=("stub", "real", "any"), default="any")
    args = ap.parse_args()
    raw = os.environ.get("URDIARY_DATA_DIR")
    if not raw:
        print("URDIARY_DATA_DIR is not set (point it at the seeded demo dir)", file=sys.stderr)
        return 2
    data_dir = Path(raw).expanduser().resolve()
    manifest_path = data_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        print(f"{manifest_path} not found: not a seeded demo dir", file=sys.stderr)
        return 2
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    api = Api(args.base)

    status, health = api.call("GET", "/health")
    record(status == 200 and health.get("db_ok") is True, "backend /health",
           f"{args.base} env={health.get('env') if isinstance(health, dict) else '?'} db_ok="
           f"{health.get('db_ok') if isinstance(health, dict) else '?'}")
    names_zh, names_en = stamp_names()
    all_ids = []
    for key, info in manifest["personas"].items():
        persona_path = REPO_ROOT / info["persona_file"]
        persona = json.loads(persona_path.read_text(encoding="utf-8"))
        same = hashlib.sha256(persona_path.read_bytes()).hexdigest() == info["persona_sha256"]
        record(same, f"{key} persona file unchanged since seeding", info["persona_file"]
               + ("" if same else " was edited after seeding: reseed with --reset"))
        print(f"INFO  {key} {info['persona']}: D0 = {info['d0']}")
        for role in ("main", "copy"):
            check_full_account(api, key, persona, info, role, names_zh, names_en, args.expect_llm,
                               data_dir / "urdiary.db")
        check_hello(api, key, persona, info)
        all_ids += [a["id"] for a in info["accounts"].values()]
    record(1 not in all_ids and len(set(all_ids)) == len(all_ids), "no demo account uses id 1",
           f"ids {sorted(all_ids)}")

    fails = [r for r in RESULTS if r[0] == "FAIL"]
    warns = [r for r in RESULTS if r[0] == "WARN"]
    print(f"\nverify_demo: {len(RESULTS) - len(fails) - len(warns)} passed, {len(warns)} warnings, "
          f"{len(fails)} failed", flush=True)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
