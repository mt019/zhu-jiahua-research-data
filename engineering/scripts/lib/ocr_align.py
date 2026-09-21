"""兩份辨讀稿對齊時共用的判定：哪些字算進位置流、來源目錄在哪、--only 怎麼解析。

`align-ocr-engines.py` 與 `make-drop-sheet.py` 靠位置互通（前者印位置、後者按位置裁圖），
兩支對「哪些字算數」必須是同一套；各抄一份的話，改一邊位置就整批偏移。
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MATERIALS = REPO / "data" / "materials" / "external"

# 比對前只留漢字與數字、拉丁字母：兩個引擎的標點判讀本來就不同，全納入會把錯字淹掉。
KEEP = re.compile(r"[㐀-䶿一-鿿豈-﫿0-9A-Za-z]")
CJK = re.compile(r"^[㐀-䶿一-鿿豈-﫿]+$")


def normalise(text: str) -> str:
    return "".join(ch for ch in text if KEEP.match(ch))


def keep_index(text: str):
    """回傳位置流的每個字在原文裡的索引，裁圖與回推原文共用這一份對照。"""
    return [i for i, ch in enumerate(text) if KEEP.match(ch)]


def select_stems(stems, only: str):
    if not only:
        return list(stems)
    wanted = {s.strip() for s in only.split(",") if s.strip()}
    missing = wanted - set(stems)
    if missing:
        raise SystemExit(f"查無這幾頁：{sorted(missing)}")
    return [s for s in stems if s in wanted]
