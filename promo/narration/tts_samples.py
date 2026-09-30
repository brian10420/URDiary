#!/usr/bin/env python3
"""介紹影片旁白試聽：用 App 自己的 xAI TTS 路徑合成候選聲音的樣本（v2.6 1f.4）。

走 backend/app/services/voice_service.text_to_speech()（in-process、扁平 import），
所以請求形狀和 App 朗讀功能一模一樣（language 固定 "auto"、output_format
{"codec": "mp3"}、voice_id 有給才送）——這同時是該路徑第一次拿真金鑰實測。

用法（一律用 repo 的 .venv；音檔寫到 git 外）：
    .venv/bin/python promo/narration/tts_samples.py
    #   --voices eve,lux,carina     候選聲音（預設就是這三個；順序＝呼叫順序）
    #   --langs zh,en               語言（預設兩種；文字固定是 STORYBOARD S3 那句）
    #   --out DIR                   輸出目錄（預設 /mnt/Data_SSD/urdiary-media/narration/samples）
    #   --key-file PATH             金鑰檔（預設 ~/.config/urdiary-promo/xai_key）
    #   --skip-list                 不打 GET /v1/tts/voices
    #   --max-calls N               呼叫上限保險絲（預設 12，含 list）
    #   --ffprobe PATH              ffprobe 執行檔（預設 ComfyUI venv 的 static_ffprobe）

金鑰鐵律：只在本程序內 open().read().strip()；不印、不進命令列、不進檔名、不寫入
任何檔案；上游非 200 只留狀態碼，永遠不印 body（body 可能帶金鑰相關細節）。
"""
import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKEND_APP = REPO / "backend" / "app"
DEFAULT_OUT = Path("/mnt/Data_SSD/urdiary-media/narration/samples")
DEFAULT_KEY_FILE = Path.home() / ".config" / "urdiary-promo" / "xai_key"
DEFAULT_FFPROBE = Path("/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffprobe")

# STORYBOARD.md S3 旁白（zh 入點 16.6 s；en 同）
LINES = {
    "zh": "它會先聽你說完，接住你的心情，不急著給建議。",
    "en": "It listens first, sits with how you feel, and doesn't rush to give advice.",
}
DEFAULT_VOICES = ["eve", "lux", "carina"]


class _StatusCapture(logging.Handler):
    """接住 voice_service 的 warning（只含狀態碼與端點名，不含 body／金鑰）。"""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.last = None

    def emit(self, record):
        self.last = record.getMessage()


def load_key(path: Path) -> str:
    try:
        key = open(path, encoding="utf-8").read().strip()
    except OSError as exc:
        sys.exit(f"金鑰檔讀不到：{path}（{exc.__class__.__name__}）")
    if not key:
        sys.exit(f"金鑰檔是空的：{path}")
    return key


def list_voices(key: str, out_dir: Path):
    """GET /v1/tts/voices → 存 voices.json；回 (status, voices|None)。"""
    import httpx
    from services.voice_service import XAI_VOICE_BASE, _TIMEOUT_SECONDS
    try:
        resp = httpx.get(f"{XAI_VOICE_BASE}/tts/voices",
                         headers={"Authorization": f"Bearer {key}"},
                         timeout=_TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        return f"transport:{exc.__class__.__name__}", None
    if resp.status_code != 200:
        return resp.status_code, None
    try:
        body = resp.json()
    except ValueError:
        return "200-but-not-json", None
    voices = body.get("voices") if isinstance(body, dict) else None
    (out_dir / "voices.json").write_text(
        json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 200, voices


def ffprobe(path: Path, exe: Path):
    if not exe.exists():
        return {"error": f"ffprobe not found: {exe}"}
    cmd = [str(exe), "-v", "error", "-show_entries",
           "format=duration,bit_rate,format_name:stream=codec_name,sample_rate,channels",
           "-of", "json", str(path)]
    try:
        raw = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"error": exc.__class__.__name__}
    if raw.returncode != 0:
        return {"error": f"ffprobe rc={raw.returncode}", "stderr": raw.stderr.strip()[:300]}
    info = json.loads(raw.stdout or "{}")
    fmt = info.get("format", {})
    streams = info.get("streams") or [{}]
    st = streams[0]
    return {
        "duration_s": round(float(fmt.get("duration", 0) or 0), 3),
        "bit_rate": int(fmt.get("bit_rate", 0) or 0),
        "format_name": fmt.get("format_name"),
        "codec": st.get("codec_name"),
        "sample_rate": int(st.get("sample_rate", 0) or 0),
        "channels": st.get("channels"),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--voices", default=",".join(DEFAULT_VOICES))
    ap.add_argument("--langs", default="zh,en")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--key-file", type=Path, default=DEFAULT_KEY_FILE)
    ap.add_argument("--skip-list", action="store_true")
    ap.add_argument("--max-calls", type=int, default=12)
    ap.add_argument("--ffprobe", type=Path, default=DEFAULT_FFPROBE)
    args = ap.parse_args()

    out_dir = args.out.resolve()
    if REPO in out_dir.parents or out_dir == REPO:
        sys.exit(f"輸出目錄不可在 repo 裡：{out_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    voices = [v.strip().lower() for v in args.voices.split(",") if v.strip()]
    langs = [l.strip() for l in args.langs.split(",") if l.strip()]
    for l in langs:
        if l not in LINES:
            sys.exit(f"沒有 {l} 的旁白句子；可用：{','.join(LINES)}")
    planned = len(voices) * len(langs) + (0 if args.skip_list else 1)
    if planned > args.max_calls:
        sys.exit(f"預計 {planned} 次呼叫 > 上限 {args.max_calls}；縮小 --voices/--langs 或調 --max-calls")

    sys.path.insert(0, str(BACKEND_APP))
    from services import voice_service  # noqa: E402  扁平 import，和 routes/voice.py 一樣

    capture = _StatusCapture()
    logging.getLogger("services.voice_service").addHandler(capture)

    key = load_key(args.key_file)
    calls = 0
    manifest = {
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "request_shape": {
            "endpoint": f"{voice_service.XAI_VOICE_BASE}/tts",
            "fields": {"text": "<line>", "language": "auto",
                       "output_format": {"codec": "mp3"}, "voice_id": "<voice or omitted>"},
            "via": "backend/app/services/voice_service.text_to_speech (in-process)",
        },
        "lines": LINES,
        "voices_list": None,
        "samples": [],
    }

    if not args.skip_list:
        calls += 1
        status, listed = list_voices(key, out_dir)
        manifest["voices_list"] = {"status": status,
                                   "count": len(listed) if listed else None,
                                   "ids": [v.get("voice_id") for v in listed] if listed else None}
        print(f"[list] GET /v1/tts/voices → {status}"
              + (f"；{len(listed)} 個聲音：{', '.join(v.get('voice_id', '?') for v in listed)}" if listed else ""))

    for voice in voices:
        for lang in langs:
            calls += 1
            fname = f"{voice}-{lang}.mp3"
            target = out_dir / fname
            capture.last = None
            t0 = time.monotonic()
            rec = {"file": fname, "voice_id": voice, "lang": lang,
                   "chars": len(LINES[lang]), "ok": False}
            try:
                audio = voice_service.text_to_speech(LINES[lang], key, voice)
            except voice_service.VoiceServiceError as exc:
                rec.update(mapped_status=exc.status_code, message_key=exc.message_key,
                           upstream_note=capture.last, elapsed_s=round(time.monotonic() - t0, 2))
                print(f"[tts] {fname}: FAILED mapped={exc.status_code} {exc.message_key}"
                      f"；upstream: {capture.last or '(transport error / timeout)'}")
                manifest["samples"].append(rec)
                continue
            rec["elapsed_s"] = round(time.monotonic() - t0, 2)
            rec["bytes"] = len(audio)
            if not audio:
                rec["upstream_note"] = "200 but empty body"
                print(f"[tts] {fname}: 200 但空 body")
                manifest["samples"].append(rec)
                continue
            target.write_bytes(audio)
            rec["ok"] = True
            rec["head"] = audio[:3].hex()
            rec["probe"] = ffprobe(target, args.ffprobe)
            p = rec["probe"]
            print(f"[tts] {fname}: {len(audio)} B in {rec['elapsed_s']} s；"
                  f"{p.get('duration_s')} s, {p.get('codec')} {p.get('sample_rate')} Hz "
                  f"{p.get('bit_rate')} bps ch={p.get('channels')}"
                  if "error" not in p else f"[tts] {fname}: {len(audio)} B；ffprobe 失敗 {p['error']}")
            manifest["samples"].append(rec)

    manifest["calls_made"] = calls
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ok = sum(1 for s in manifest["samples"] if s["ok"])
    print(f"完成：{calls} 次呼叫，{ok}/{len(manifest['samples'])} 個樣本成功 → {out_dir}")


if __name__ == "__main__":
    main()
