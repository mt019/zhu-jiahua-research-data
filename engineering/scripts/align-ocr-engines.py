#!/usr/bin/env python3
"""把同一頁的兩份辨讀稿（GCV 與 PaddleOCR）逐字對齊，列出兩邊不同的位置。

兩邊都對的字不必看，兩邊都錯的字這個篩子也看不到（所以它是排查核順序的工具，
不是校訂本身的依據）；判準是「兩邊不同的位置回原頁圖判」。

用法：
  python3 engineering/scripts/align-ocr-engines.py --source SRC-... --only pg-59,pg-63,pg-65
  python3 engineering/scripts/align-ocr-engines.py --source SRC-... --out diffs.tsv
  python3 engineering/scripts/align-ocr-engines.py --self-test

比對前只留漢字與數字：兩個引擎的標點判讀本來就不同（逗號、頓號、圓點），全部納入會把
真正的錯字淹掉。標點的校訂走另一條線（第二輪 88 條那批）。

輸出一列一處：頁、在該頁漢字流的位置、GCV 讀到的、Paddle 讀到的、前後各十字的脈絡。
"""

import argparse
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MATERIALS = REPO / "data" / "materials" / "external"
KEEP = re.compile(r"[㐀-䶿一-鿿豈-﫿0-9A-Za-z]")


def normalise(text: str) -> str:
    return "".join(ch for ch in text if KEEP.match(ch))


def diff_page(gcv: str, paddle: str, context: int = 10):
    a, b = normalise(gcv), normalise(paddle)
    hits = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        hits.append({
            "position": i1,
            "gcv": a[i1:i2],
            "paddle": b[j1:j2],
            "context": a[max(0, i1 - context):i2 + context],
        })
    return hits, len(a), len(b)


def self_test() -> int:
    """負向測試：對同一份稿注入五種已知的差異（漏字、多字、換字），看報不報得出來；
    相同的稿與只差標點的稿要一處都不報。"""
    base = "主義領袖組織爲構成黨的領導力量的三大要素缺一不可本黨有正確的主義"
    cases = [
        ("漏一字（組織爲→組爲）", base.replace("組織爲", "組爲"), "織"),
        ("漏另一字（領導力量的→領導力的）", base.replace("領導力量的", "領導力的"), "量"),
        ("多一字", base.replace("三大要素", "三大要要素"), "要"),
        ("換字（爲→為）", base.replace("組織爲", "組織為"), "為"),
    ]
    cases.append(("換兩字（政權與治權→政與治樓）", "執行政與治樓", "權", "執行政權與治權"))
    failures = []
    for case in cases:
        name, mutated, needle = case[0], case[1], case[2]
        reference = case[3] if len(case) > 3 else base
        hits, _, _ = diff_page(reference, mutated)
        if not hits:
            failures.append(f"{name}：一處都沒報")
            continue
        if not any(needle in hit["gcv"] or needle in hit["paddle"] for hit in hits):
            failures.append(f"{name}：報了 {len(hits)} 處，但沒有一處含「{needle}」")
    same, _, _ = diff_page(base, base)
    if same:
        failures.append(f"相同的兩份稿報了 {len(same)} 處，應為 0")
    punct, _, _ = diff_page("一個領袖、一個主義", "一個領袖*一個主義")
    if punct:
        failures.append(f"只有標點不同的兩份稿報了 {len(punct)} 處，應為 0（標點在比對前剝掉）")
    for failure in failures:
        print(f"未通過 {failure}", file=sys.stderr)
    if failures:
        return 1
    print("自測通過：五種差異都報得出來，相同的稿與只差標點的稿都不報。")
    return 0


def known_errors(source_dir: Path, note_mark: str):
    """從校訂表取已知的錯字：註記含 note_mark 的那幾列。回傳 (頁, 誤, 正)。"""
    found = []
    for tsv in sorted((source_dir / "corrections").glob("pg-*.tsv")):
        for line in tsv.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 3 or note_mark not in parts[2]:
                continue
            found.append((tsv.stem, parts[0], parts[1]))
    return found


def check_known(source_dir: Path, note_mark: str, context: int, second: str = "tess",
                insertions_only: bool = False) -> int:
    """驗收：已知的每一處錯字，在該頁的差異清單裡有沒有被蓋到。

    蓋到的判準是位置區間相交——誤與正逐字比出哪幾個位置不同，那些位置要落在
    某一個被報出來的差異區間內。沒被蓋到就是這個篩子漏掉它，(b) 這條路不成立。
    """
    gcv_dir, paddle_dir = source_dir / "gcv" / "txt", source_dir / second / "txt"
    cases = known_errors(source_dir, note_mark)
    if not cases:
        raise SystemExit(f"校訂表裡找不到註記含「{note_mark}」的列，沒有東西可驗。")
    misses = []
    for stem, wrong, right in cases:
        paddle_path = paddle_dir / f"{stem}.txt"
        if not paddle_path.exists():
            misses.append(f"{stem}「{wrong}」：這一頁還沒有第二引擎的稿")
            continue
        gcv_text = gcv_dir / f"{stem}.txt"
        hits, _, _ = diff_page(gcv_text.read_text(encoding="utf-8"),
                               paddle_path.read_text(encoding="utf-8"), context)
        if insertions_only:
            hits = [h for h in hits if not h["gcv"]]
        stream = normalise(gcv_text.read_text(encoding="utf-8"))
        needle = normalise(wrong)
        start = stream.find(needle)
        if start < 0:
            misses.append(f"{stem}「{wrong}」：在 GCV 稿裡找不到這段（校訂表與稿不同步？）")
            continue
        span = (start, start + len(needle))
        covered = any(hit["position"] < span[1] and hit["position"] + max(len(hit["gcv"]), 1) > span[0]
                      for hit in hits)
        mark = "蓋到" if covered else "漏掉"
        print(f"{mark}\t{stem}\t{wrong} → {right}")
        if not covered:
            misses.append(f"{stem}「{wrong}」不在任何一個差異區間內")
    print(f"已知錯字 {len(cases)} 處，漏掉 {len(misses)} 處。")
    for miss in misses:
        print(f"  漏：{miss}", file=sys.stderr)
    return 1 if misses else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--only", default="")
    parser.add_argument("--out", default="", help="寫成 TSV；不給就印到畫面")
    parser.add_argument("--context", type=int, default=10)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--second", default="tess",
                        help="第二引擎的目錄名（tess＝tesseract chi_tra_vert，paddle＝PaddleOCR）")
    parser.add_argument("--insertions-only", action="store_true",
                        help="只看 GCV 那一側是空的差異——也就是第二引擎讀到而 GCV 漏掉的字")
    parser.add_argument("--check-known", default="",
                        help="驗收模式：校訂表註記含這段字的列，逐處看有沒有落在差異裡")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.source:
        raise SystemExit("要嘛 --self-test，要嘛給 --source。")

    source_dir = MATERIALS / args.source
    if args.check_known:
        return check_known(source_dir, args.check_known, args.context, args.second,
                           args.insertions_only)
    gcv_dir, paddle_dir = source_dir / "gcv" / "txt", source_dir / args.second / "txt"
    if not paddle_dir.is_dir():
        raise SystemExit(f"查無第二引擎的辨讀稿：{paddle_dir}")
    stems = sorted(p.stem for p in paddle_dir.glob("*.txt"))
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        missing = wanted - set(stems)
        if missing:
            raise SystemExit(f"這幾頁還沒有 Paddle 稿：{sorted(missing)}")
        stems = [s for s in stems if s in wanted]

    rows = ["頁\t位置\tGCV\tPaddle\t脈絡（GCV）"]
    totals = []
    for stem in stems:
        gcv_path = gcv_dir / f"{stem}.txt"
        if not gcv_path.exists():
            print(f"{stem}：沒有 GCV 稿，略過", file=sys.stderr)
            continue
        hits, len_a, len_b = diff_page(
            gcv_path.read_text(encoding="utf-8"),
            (paddle_dir / f"{stem}.txt").read_text(encoding="utf-8"),
            args.context,
        )
        if args.insertions_only:
            hits = [h for h in hits if not h["gcv"]]
        totals.append((stem, len(hits), len_a, len_b))
        for hit in hits:
            rows.append(f"{stem}\t{hit['position']}\t{hit['gcv']}\t{hit['paddle']}\t{hit['context']}")

    total_hits = sum(c for _, c, _, _ in totals)
    total_chars = sum(a for _, _, a, _ in totals)
    for stem, count, len_a, len_b in totals:
        ratio = count / len_a * 100 if len_a else 0
        print(f"{stem}: 差異 {count} 處，GCV {len_a} 字、第二引擎 {len_b} 字（差異占 {ratio:.1f}%）")
    print(f"合計：{len(totals)} 頁，GCV {total_chars} 字，差異 {total_hits} 處"
          f"（每頁平均 {total_hits / max(1, len(totals)):.0f} 處）")
    body = "\n".join(rows) + "\n"
    if args.out:
        Path(args.out).write_text(body, encoding="utf-8")
        print(f"→ {args.out}（{len(rows) - 1} 列）")
    else:
        print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
