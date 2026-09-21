#!/usr/bin/env python3
"""把兩條路指出的漏字候選併成一份待判清單，位置一律換算到 GCV 的字流上。

兩條路各自看得到對方看不到的東西：幾何偵測（detect-dropped-cells.mjs）量版面上的空位，
掉的字在兩個引擎都沒讀到時只有它報得出來；第二引擎對齊（align-ocr-engines.py）看的是
tesseract 讀到而 GCV 沒有的字，版面沒有留空位的那些漏字只有它報得出來。兩邊都指到的
那幾處最值得先判。

幾何那一份的定位是座標與前後字，接觸表（make-drop-sheet.py）吃的是字流位置，所以要換算：
拿命中前後那一小段脈絡回 gcv/txt 的字流找唯一的落點，找不到或不只一處的列進未對位，
不硬塞一個看起來合理的位置。

用法：
  node engineering/scripts/detect-dropped-cells.mjs            （ZJH_SOURCE=… ZJH_TSV=geo.tsv）
  python3 engineering/scripts/align-ocr-engines.py --source … --insertions-only --out ins.tsv
  python3 engineering/scripts/merge-drop-candidates.py --source … --geo geo.tsv --ins ins.tsv \
      --out queue.tsv
  python3 engineering/scripts/make-drop-sheet.py --source … --hits queue.tsv --all-kinds \
      --batch 0 --size 8 --out sheet-00.png

輸出的欄與接觸表相容（頁、位置、GCV、第二引擎），後面接來源、比值與脈絡。
接觸表預設只裁第四欄是單一漢字的那些，這份清單已經篩過，裁的時候加 --all-kinds。
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from ocr_align import MATERIALS, normalise  # noqa: E402

SEP = "｜"


def locate(stream: str, window: str, offset: int):
    """window 在字流上只出現一次時，回傳它起點加 offset；否則回 None。

    脈絡逐步縮短：八個字對不到（兩個引擎在那一段讀得不一樣）就退到六個、四個，
    退到兩個字還不唯一就放棄——再短的窗口在一頁裡本來就會撞上好幾次。
    """
    for width in (len(window), 6, 4, 2):
        if width < 2 or width > len(window):
            continue
        # 以命中點為中心裁窗口，命中點在 window 裡的位置是 offset
        start = max(0, offset - width // 2)
        sub = window[start:start + width]
        if len(sub) < 2:
            continue
        first = stream.find(sub)
        if first < 0 or stream.find(sub, first + 1) >= 0:
            continue
        return first + (offset - start)
    return None


def geo_rows(path: Path, streams):
    kept, unmapped = [], []
    for line in path.read_text(encoding="utf-8").splitlines()[1:]:
        if not line.strip():
            continue
        page, kind, ratio, _x, _y, before, after, context = (line.split("\t") + [""] * 8)[:8]
        stem = f"pg-{int(page):02d}"
        stream = streams.get(stem)
        if stream is None:
            continue
        if kind == "欄末止排":
            # 脈絡是「上一欄末四字｜下一欄首四字」，命中在下一欄的欄首
            tail = context.split(SEP)[-1]
            window, offset = normalise(tail), 0
        elif kind == "欄首起排":
            window, offset = normalise(context), 0
        else:
            pair = before + after
            head = context.split(pair)[0] + before if pair and pair in context else ""
            window, offset = normalise(context), len(normalise(head))
        row = [stem, kind, ratio, before, after, context]
        if not window:
            unmapped.append(row)
            continue
        pos = locate(stream, window, offset)
        if pos is None:
            unmapped.append(row)
            continue
        kept.append({"stem": stem, "position": pos, "kind": kind, "ratio": ratio,
                     "context": context})
    return kept, unmapped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--geo", required=True)
    ap.add_argument("--ins", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--near", type=int, default=1, help="兩條路的位置差幾個字之內算同一處")
    args = ap.parse_args()

    src = MATERIALS / args.source
    streams = {f.stem: normalise(f.read_text(encoding="utf-8"))
               for f in sorted((src / "gcv" / "txt").glob("pg-*.txt"))}

    ins = []
    for line in Path(args.ins).read_text(encoding="utf-8").splitlines()[1:]:
        if not line.strip():
            continue
        stem, position, gcv, second, context = (line.split("\t") + [""] * 5)[:5]
        if gcv:                      # 插入型的 GCV 欄是空的；換字型不屬漏字
            continue
        ins.append({"stem": stem, "position": int(position), "second": second,
                    "context": context})

    geo, unmapped = geo_rows(Path(args.geo), streams)

    used = set()
    rows = []
    for g in geo:
        match = next((i for i, h in enumerate(ins)
                      if h["stem"] == g["stem"] and abs(h["position"] - g["position"]) <= args.near
                      and i not in used), None)
        second = ""
        if match is not None:
            used.add(match)
            second = ins[match]["second"]
        rows.append([g["stem"], g["position"], "", second,
                     "兩者" if second else "幾何", g["ratio"], g["context"]])
    for i, h in enumerate(ins):
        if i in used:
            continue
        rows.append([h["stem"], h["position"], "", h["second"], "第二引擎", "", h["context"]])

    rows.sort(key=lambda r: (r[0], r[1]))
    header = ["頁", "位置", "GCV", "第二引擎", "來源", "比值", "脈絡"]
    Path(args.out).write_text(
        "\t".join(header) + "\n" + "\n".join("\t".join(str(c) for c in r) for r in rows) + "\n",
        encoding="utf-8")

    both = sum(1 for r in rows if r[4] == "兩者")
    print(f"幾何 {len(geo)} 處對到位置、{len(unmapped)} 處對不到；第二引擎插入型 {len(ins)} 處。")
    print(f"→ {args.out}（{len(rows)} 列：兩者都指到 {both}、"
          f"只有幾何 {sum(1 for r in rows if r[4] == '幾何')}、"
          f"只有第二引擎 {sum(1 for r in rows if r[4] == '第二引擎')}）")
    if unmapped:
        print("對不到位置的（脈絡在兩個引擎之間對不齊，要回原頁圖）：", file=sys.stderr)
        for r in unmapped[:20]:
            print("  " + "\t".join(r), file=sys.stderr)
        if len(unmapped) > 20:
            print(f"  …另 {len(unmapped) - 20} 處", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
