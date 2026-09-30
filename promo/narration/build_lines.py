#!/usr/bin/env python3
"""從 STORYBOARD.md §1.2 逐字抽旁白 → lines.json（id、zh/en 文字、入點、最晚結束、預算）。"""
import json, re
from pathlib import Path

SB = Path(__file__).resolve().parents[1] / "video" / "STORYBOARD.md"
text = SB.read_text(encoding="utf-8")
sec = text.split("### 1.2 分場")[1].split("## 2. README")[0]
lines = []
for block in re.split(r"\n#### ", sec)[1:]:
    sid = re.match(r"(S\d+)", block).group(1)
    zh_m = re.search(r"\*\*zh 旁白\*\*[^\n]*", block).group(0)
    en_m = re.search(r"\*\*en 旁白\*\*[^\n]*", block).group(0)
    chk = re.search(r"\*\*節奏核對\*\*：([^\n]*)", block).group(1)
    zh_chk, en_chk = chk.split("｜en ")
    zh_ends = [float(x) for x in re.findall(r"最晚 ([\d.]+) s", zh_chk)]
    en_ends = [float(x) for x in re.findall(r"最晚 ([\d.]+) s", en_chk)]
    if re.search(r"[ABC] 入點", zh_m):
        zh_parts = re.findall(r"([ABC]) 入點 ([\d.]+) s「([^」]*)」", zh_m)
        en_parts = re.findall(r"([ABC]) 入點 ([\d.]+) s \"([^\"]*)\"", en_m)
        assert len(zh_parts) == len(en_parts) == len(zh_ends) == len(en_ends), sid
        for (k, zi, zt), (k2, ei, et), ze, ee in zip(zh_parts, en_parts, zh_ends, en_ends):
            assert k == k2
            lines.append({"id": f"{sid}-{k}", "zh": zt, "en": et,
                          "in_point_s": {"zh": float(zi), "en": float(ei)},
                          "latest_end_s": {"zh": ze, "en": ee}})
    else:
        zi = float(re.search(r"入點 ([\d.]+) s", zh_m).group(1))
        ei = float(re.search(r"入點 ([\d.]+) s", en_m).group(1))
        zt = re.search(r"：「(.*)」$", zh_m).group(1)
        et = re.search(r"：\"(.*)\"$", en_m).group(1)
        assert len(zh_ends) == len(en_ends) == 1, sid
        lines.append({"id": sid, "zh": zt, "en": et,
                      "in_point_s": {"zh": zi, "en": ei},
                      "latest_end_s": {"zh": zh_ends[0], "en": en_ends[0]}})
for l in lines:
    l["budget_s"] = {k: round(l["latest_end_s"][k] - l["in_point_s"][k], 3) for k in ("zh", "en")}
out = Path(__file__).with_name("lines.json")
out.write_text(json.dumps({"source": "promo/video/STORYBOARD.md §1.2", "lines": lines},
                          ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(len(lines), "line ids ×2 langs =", len(lines) * 2)
