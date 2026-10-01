#!/usr/bin/env python3
"""介紹影片旁白：逐句用 App 的 xAI TTS 路徑合成 → 響度正規化 → manifest（v2.6 1f.5）。

  .venv/bin/python promo/narration/generate_narration.py [--only S3,S6-A] [--langs zh,en]
        [--max-calls 40] [--skip-existing] [--out DIR] [--key-file PATH]

App 的 voice_service.text_to_speech() 固定送 language "auto"、24 kHz／128 kbps，
所以這裡在旁邊放一個薄包裝 tts_line()：同一個 _call()（同樣的錯誤映射、只記狀態碼），
但 payload 多送 language "zh"/"en"、sample_rate 48000、bit_rate 192000（docs 建議）。
backend/ 不動。聲音：zh=liora、en=liora（Brian 2026-10-01 改：英文也用 liora；lux 版保留在 raw/en-lux、normalized/en-lux）。

流程：raw mp3（不動）→ 前後補靜音再修剪（至少各留 120 ms）→ loudnorm 兩階段
（−16 LUFS／−1.5 dBTP，linear）→ 48 kHz PCM16 WAV ＋ 192 kbps mp3 → 實測長度／LUFS／真峰值。
超出分鏡預算時，用 speed 欄位重合成一次（每句最多一次，speed 上限 1.10，超過就只標記）。

金鑰鐵律：只在本程序 open().read().strip()；不印、不進命令列／檔名／檔案；
上游非 200 只印狀態碼，永遠不印 body。音檔寫到 git 外。
"""
import argparse, json, logging, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "backend" / "app"))
from services import voice_service  # noqa: E402

OUT = Path("/mnt/Data_SSD/urdiary-media/narration")
KEY_FILE = Path.home() / ".config" / "urdiary-promo" / "xai_key"
FFMPEG = "/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffmpeg"
FFPROBE = "/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffprobe"
VOICES = {"zh": "liora", "en": "liora"}
TARGET_I, TARGET_TP, TARGET_LRA = -16.0, -1.5, 20
PAD_S = 0.12
SPEED_MAX = 1.10


class _Status(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.last = None

    def emit(self, r):
        self.last = r.getMessage()


def tts_line(text, key, voice, lang, speed=None):
    """text_to_speech 的高品質版：同一個 _call，多 language／sample_rate／bit_rate／speed。"""
    payload = {"text": text, "language": lang, "voice_id": voice,
               "output_format": {"codec": "mp3", "sample_rate": 48000, "bit_rate": 192000}}
    if speed:
        payload["speed"] = speed
    return voice_service._call(f"{voice_service.XAI_VOICE_BASE}/tts", key, json=payload).content


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120)


def duration(path):
    r = run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(r.stdout.strip())


def measure(path):
    """loudnorm 只量不改（print_format json）→ (input_i, input_tp)。"""
    r = run([FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-af",
             f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
             "-f", "null", "-"])
    m = re.findall(r"\{[^{}]*\}", r.stderr, re.S)
    return json.loads(m[-1])


TRIM = (f"adelay={int(PAD_S*2000)}:all=1,apad=pad_dur={PAD_S*2},"
        f"silenceremove=start_periods=1:start_threshold=-45dB:start_silence={PAD_S},"
        f"areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence={PAD_S},areverse")


def normalize(raw: Path, wav: Path, mp3: Path):
    wav.parent.mkdir(parents=True, exist_ok=True)
    pre = f"aresample=48000,{TRIM}"
    p1 = measure_af(raw, pre)
    ln = (f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}"
          f":measured_I={p1['input_i']}:measured_TP={p1['input_tp']}"
          f":measured_LRA={p1['input_lra']}:measured_thresh={p1['input_thresh']}"
          f":offset={p1['target_offset']}:linear=true")
    r = run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), "-af",
             f"{pre},{ln},aresample=48000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)])
    if r.returncode:
        raise RuntimeError("ffmpeg wav failed: " + r.stderr[-300:])
    got = measure(wav)
    if abs(float(got["input_i"]) - TARGET_I) > 0.3:
        # 短句峰值高，loudnorm 的 linear 模式被真峰值上限卡住、整體偏小聲：
        # 改成「加增益到目標 LUFS ＋ 限幅器壓峰值」，再重量。
        gain = TARGET_I - float(p1["input_i"])
        r = run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), "-af",
                 f"{pre},volume={gain:.2f}dB,alimiter=limit=0.79:attack=3:release=60:level=0,aresample=48000",
                 "-ac", "1", "-c:a", "pcm_s16le", str(wav)])
        if r.returncode:
            raise RuntimeError("ffmpeg gain path failed: " + r.stderr[-300:])
    r = run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav),
             "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)])
    if r.returncode:
        raise RuntimeError("ffmpeg mp3 failed: " + r.stderr[-300:])


def measure_af(raw, pre):
    r = run([FFMPEG, "-hide_banner", "-nostats", "-i", str(raw), "-af",
             f"{pre},loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
             "-f", "null", "-"])
    m = re.findall(r"\{[^{}]*\}", r.stderr, re.S)
    return json.loads(m[-1])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", default="")
    ap.add_argument("--langs", default="zh,en")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--key-file", type=Path, default=KEY_FILE)
    ap.add_argument("--max-calls", type=int, default=40)
    ap.add_argument("--skip-existing", action="store_true", help="raw 已存在就不重打 API")
    args = ap.parse_args()
    out = args.out.resolve()
    if REPO in out.parents or out == REPO:
        sys.exit("輸出目錄不可在 repo 裡")
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    langs = [l for l in args.langs.split(",") if l]
    lines = [l for l in json.loads((HERE / "lines.json").read_text(encoding="utf-8"))["lines"]
             if not only or l["id"] in only]

    cap = _Status()
    logging.getLogger("services.voice_service").addHandler(cap)
    try:
        key = open(args.key_file, encoding="utf-8").read().strip()
    except OSError as e:
        sys.exit(f"金鑰檔讀不到（{e.__class__.__name__}）")
    if not key:
        sys.exit("金鑰檔是空的")

    calls, entries = 0, []
    for ln in lines:
        for lang in langs:
            lid, voice = ln["id"], VOICES[lang]
            raw = out / "raw" / lang / f"{lid}.mp3"
            wav = out / "normalized" / lang / f"{lid}.wav"
            mp3 = out / "normalized" / lang / f"{lid}.mp3"
            raw.parent.mkdir(parents=True, exist_ok=True)
            budget = ln["budget_s"][lang]
            speed, retried, note = None, False, None
            while True:
                if not (args.skip_existing and raw.exists() and not retried):
                    if calls >= args.max_calls:
                        sys.exit(f"呼叫上限 {args.max_calls} 已到，停在 {lid}/{lang}")
                    calls += 1
                    cap.last = None
                    try:
                        audio = tts_line(ln[lang], key, voice, lang, speed)
                    except voice_service.VoiceServiceError as e:
                        print(f"[{lid}/{lang}] FAILED mapped={e.status_code}；upstream: {cap.last}")
                        note = f"tts failed ({cap.last})"
                        break
                    if not audio:
                        print(f"[{lid}/{lang}] 200 但空 body")
                        note = "empty body"
                        break
                    raw.write_bytes(audio)
                normalize(raw, wav, mp3)
                dur = duration(wav)
                if dur > budget and not retried:
                    # 需要的加速比：內容長度（扣掉兩端 0.12 s 邊）縮到預算內，再留 2% 餘裕
                    need = (dur - 2 * PAD_S) / max(budget - 2 * PAD_S, 0.1) * 1.02
                    if need <= SPEED_MAX:
                        speed, retried = round(max(need, 1.02), 2), True
                        print(f"[{lid}/{lang}] {dur:.2f}s > 預算 {budget}s → 以 speed {speed} 重合成")
                        continue
                    note = f"overrun {dur - budget:.2f}s；需要 speed {need:.2f} 超過上限 {SPEED_MAX}，僅標記"
                elif dur > budget:
                    note = f"overrun {dur - budget:.2f}s 即使 speed {speed} 仍超出，僅標記"
                break
            if note and note.startswith(("tts failed", "empty")):
                entries.append({"id": lid, "lang": lang, "voice": voice, "text": ln[lang], "error": note})
                continue
            final = measure(wav)
            e = {"id": lid, "lang": lang, "voice": voice, "text": ln[lang],
                 "in_point_s": ln["in_point_s"][lang], "latest_end_s": ln["latest_end_s"][lang],
                 "budget_s": budget, "duration_s": round(duration(wav), 3),
                 "lufs": round(float(final["input_i"]), 2),
                 "true_peak_db": round(float(final["input_tp"]), 2),
                 "margin_s": round(budget - duration(wav), 3),
                 "speed": speed, "note": note,
                 "files": {"raw_mp3": str(raw), "wav": str(wav), "mp3": str(mp3)}}
            e["ends_at_s"] = round(e["in_point_s"] + e["duration_s"], 3)
            entries.append(e)
            print(f"[{lid}/{lang}] {e['duration_s']}s / 預算 {budget}s（餘 {e['margin_s']}）"
                  f" {e['lufs']} LUFS {e['true_peak_db']} dBTP" + (f" ⚠ {note}" if note else ""))
    manifest = {"generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                "voices": VOICES, "calls_made": calls,
                "request": {"endpoint": f"{voice_service.XAI_VOICE_BASE}/tts",
                            "fields": ["text", "language(zh|en)", "voice_id",
                                       "output_format{codec:mp3,sample_rate:48000,bit_rate:192000}",
                                       "speed(only on retry)"]},
                "loudness_target": {"integrated_lufs": TARGET_I, "true_peak_db": TARGET_TP},
                "entries": entries}
    txt = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (out / "manifest.json").write_text(txt, encoding="utf-8")
    (HERE / "manifest.json").write_text(txt, encoding="utf-8")
    print(f"完成：{calls} 次呼叫，{sum('error' not in e for e in entries)}/{len(entries)} 成功")


if __name__ == "__main__":
    main()
