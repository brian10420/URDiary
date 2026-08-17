"""AI 日記印章：目錄、情緒分流、輸出淨化 (v2.5 Spec A)。

情緒判定的唯一權威在這裡：NEGATIVE_VALENCE_THRESHOLD 與前端 mascot.js 的
QUIET_VALENCE_THRESHOLD、api_service.getMoodFromValence 的 sad 界線 (>=0.45
即非負向) 是同一條語意線。未來使用者的專用情緒識別模型接入時，替換
is_negative() 一個函式即可，呼叫端不動。
"""
from typing import Optional, Tuple

# 與前端 MascotModule.stampIcon 的 STAMP_ICONS 鍵一一對應 (spec §3 清單順序)
STAMP_IDS = (
    "cake", "gift", "heart", "cheers", "trophy", "flag", "book", "star",
    "plane", "camera", "ball", "movie", "music", "food", "coffee", "flower",
    "sun", "umbrella", "moon", "rainbow", "sprout", "heal", "paw", "gradcap",
)
# 低落日 (負向情緒) 唯一允許的印章：陪伴與打氣，不慶祝
ENCOURAGE_STAMPS = ("umbrella", "moon", "rainbow", "sprout", "heal")
FALLBACK_ENCOURAGE = "heal"
NEGATIVE_VALENCE_THRESHOLD = 0.45
NOTE_MAX = 60   # 小語入庫硬上限 (提示詞要求 ≤30 字，這裡放寬一倍防溢出)


def is_negative(valence: float) -> bool:
    """負向情緒判定 (未來由專用情緒識別模型替換此函式)。"""
    return isinstance(valence, (int, float)) and valence < NEGATIVE_VALENCE_THRESHOLD


def clean_note(note: Optional[str]) -> str:
    if not note or not isinstance(note, str):
        return ""
    return " ".join(note.split())[:NOTE_MAX]


def finalize(stamp: Optional[str], note: Optional[str], valence: float) -> Tuple[Optional[str], str]:
    """把模型回的 stamp/note 淨化成可入庫的值。

    - stamp 不在 STAMP_IDS → (None, "")：這天不蓋章，絕不擋日記主流程
    - 負向情緒 (is_negative) 且 stamp 不在鼓勵組 → 硬替換為 FALLBACK_ENCOURAGE
      (spec §3 硬規則的伺服器端保底，不信任模型自覺)
    """
    if stamp not in STAMP_IDS:
        return None, ""
    if is_negative(valence) and stamp not in ENCOURAGE_STAMPS:
        stamp = FALLBACK_ENCOURAGE
    return stamp, clean_note(note)
