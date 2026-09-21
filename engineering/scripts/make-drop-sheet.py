#!/usr/bin/env python3
"""把「第二引擎讀到而 GCV 漏掉」的那些位置裁成接觸表，一張圖判一批。

GCV 的逐字框在 gcv/json，命中的位置回那批框取前後各幾個字的方框，裁原頁圖、轉正、
橫排成一張圖。判讀的依據是原頁圖本身，第二引擎讀到什麼只是線索——它自己也會吐雜訊
（2026-09-22 抽驗八處，五處是真的漏字，三處是 tesseract 讀標點讀出來的字）。

用法：
  python3 engineering/scripts/align-ocr-engines.py --source SRC-... --second tess \
      --insertions-only --out /tmp/ins.tsv
  python3 engineering/scripts/make-drop-sheet.py --source SRC-... --hits /tmp/ins.tsv \
      --batch 0 --size 8 --out /tmp/sheet-00.png

裁出來的每一格印在畫面上的那一行是「頁、位置、第二引擎插入的字、GCV 前後文」，
判完把結論寫進該頁的校訂表（命中須剛好一次且落在記的那一頁）。
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from ocr_align import CJK, KEEP, MATERIALS, keep_index  # noqa: E402


def symbol_boxes(source_dir: Path, stem: str):
    data = json.loads((source_dir / "gcv" / "json" / f"{stem}.json").read_text(encoding="utf-8"))
    out = []
    for page in data["fullTextAnnotation"]["pages"]:
        for block in page["blocks"]:
            for para in block["paragraphs"]:
                for word in para["words"]:
                    for sym in word["symbols"]:
                        if not KEEP.match(sym["text"]):
                            continue
                        vertices = sym["boundingBox"]["vertices"]
                        xs = [v.get("x", 0) for v in vertices]
                        ys = [v.get("y", 0) for v in vertices]
                        out.append((sym["text"], min(xs), min(ys), max(xs), max(ys)))
    return out


def raw_context(source_dir: Path, stem: str, position: int, window: int) -> str:
    """把命中位置換算回 gcv/txt 的原文（帶標點），供辨識該處長什麼樣。

    校訂表真正的比對面是 build-external-drafts.mjs 接完流、半形轉全形之後的那一串，
    不是 gcv/txt（2026-09-22 審查指出，四條裡有一條的逗號就差在這裡）；誤欄逐字照抄
    之前用該腳本的 --dump 核一次。
    """
    text = (source_dir / "gcv" / "txt" / f"{stem}.txt").read_text(encoding="utf-8")
    index = keep_index(text)
    if not index:
        return ""
    first = index[max(0, position - window)]
    last_at = min(position + window, len(index) - 1)
    return text[first:index[last_at]].replace("\n", "␤")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--hits", required=True, help="align-ocr-engines.py --insertions-only 的 TSV")
    parser.add_argument("--batch", type=int, default=0)
    parser.add_argument("--size", type=int, default=8)
    parser.add_argument("--window", type=int, default=6, help="命中位置前後各取幾個字")
    parser.add_argument("--out", required=True)
    parser.add_argument("--all-kinds", action="store_true",
                        help="不篩，連第二引擎插入非漢字的那些也裁（預設只裁插入單一漢字的）")
    args = parser.parse_args()

    source_dir = MATERIALS / args.source
    lines = Path(args.hits).read_text(encoding="utf-8").splitlines()
    rows = [line.split("\t") for line in lines[1:] if line.strip()]
    if not args.all_kinds:
        rows = [r for r in rows if len(r) > 3 and CJK.match(r[3] or "") and len(r[3]) == 1]
    chunk = rows[args.batch * args.size:(args.batch + 1) * args.size]
    if not chunk:
        print(f"第 {args.batch} 批是空的（篩選後共 {len(rows)} 筆，每批 {args.size}）", file=sys.stderr)
        return 1

    tiles = []
    for row in chunk:
        stem, position, inserted = row[0], int(row[1]), row[3]
        boxes = symbol_boxes(source_dir, stem)
        window = boxes[max(0, position - args.window):position + args.window]
        if not window:
            print(f"{stem} pos{position}：取不到字框，略過", file=sys.stderr)
            continue
        x0 = min(b[1] for b in window) - 25
        x1 = max(b[3] for b in window) + 25
        y0 = min(b[2] for b in window) - 25
        y1 = max(b[4] for b in window) + 25
        image = Image.open(source_dir / "pages" / f"{stem}.png").convert("L").crop((x0, y0, x1, y1))
        if image.width > image.height:
            image = image.rotate(-90, expand=True)
        image.thumbnail((300, 900))
        tiles.append(image)
        print(f"{stem}\t{position}\t+{inserted}\t{''.join(b[0] for b in window)}"
              f"\t{raw_context(source_dir, stem, position, args.window + 4)}")

    if not tiles:
        print("這一批一格都裁不出來。", file=sys.stderr)
        return 1
    sheet = Image.new("L", (sum(t.width + 30 for t in tiles), max(t.height for t in tiles)), 255)
    x = 0
    for tile in tiles:
        sheet.paste(tile, (x, 0))
        x += tile.width + 30
    sheet.save(args.out)
    total = (len(rows) + args.size - 1) // args.size
    print(f"→ {args.out}（{len(tiles)} 格；第 {args.batch + 1}/{total} 批，篩選後共 {len(rows)} 筆）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
