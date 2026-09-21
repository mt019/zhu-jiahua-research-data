#!/usr/bin/env python3
"""把同一頁的兩份辨讀稿（GCV 與第二引擎）逐字對齊，列出兩邊不同的位置。

兩邊都對的字不必看，兩邊都錯的字這個篩子也看不到（所以它是排查核順序的工具，
不是校訂本身的依據）；判準是「兩邊不同的位置回原頁圖判」。

用法：
  python3 engineering/scripts/align-ocr-engines.py --source SRC-... --only pg-59,pg-63
  python3 engineering/scripts/align-ocr-engines.py --source SRC-... --insertions-only --out ins.tsv
  python3 engineering/scripts/align-ocr-engines.py --source SRC-... --check-known "站主 2026-09-21 點名"
  python3 engineering/scripts/align-ocr-engines.py --self-test

比對前只留漢字與數字（判定在 lib/ocr_align.py，裁圖那支共用同一份，位置才對得上）。

輸出一列一處：頁、在該頁漢字流的位置、GCV 讀到的、第二引擎讀到的、前後各十字的脈絡。
"""

import argparse
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from ocr_align import CJK, KEEP, MATERIALS, normalise, select_stems  # noqa: E402

# 第二引擎讀出來的字數不到 GCV 的兩成，當它沒讀到這一頁而不是讀出了一頁空白：
# 空稿餵進對齊會變成一個涵蓋全頁的刪除型命中，下游的覆蓋判定會把整頁都算成「看過了」。
MIN_SECOND_RATIO = 0.2


def diff_page(gcv: str, second: str, context: int = 10):
    a, b = normalise(gcv), normalise(second)
    if a and len(b) < len(a) * MIN_SECOND_RATIO:
        raise ValueError(f"第二引擎只讀到 {len(b)} 字，GCV 有 {len(a)} 字，這一頁不當作讀過")
    hits = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        hits.append({
            "position": i1,
            "gcv": a[i1:i2],
            "second": b[j1:j2],
            "context": a[max(0, i1 - context):i2 + context],
        })
    return hits, len(a), len(b)


def hit_span(hit):
    """命中在 GCV 位置流上涵蓋的區間。插入型的 i1 == i2，那個字落在前後兩字之間，
    區間取 [p-1, p+1)，否則字串尾端的漏字永遠算不到。"""
    start = hit["position"]
    length = len(hit["gcv"])
    if length == 0:
        return max(0, start - 1), start + 1
    return start, start + length


def wanted_chars(wrong: str, right: str):
    """「正」比「誤」多出或換掉的字。第二引擎要讀到其中之一，才算它指出了這一處。"""
    chars = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, normalise(wrong), normalise(right)).get_opcodes():
        if tag != "equal":
            chars.extend(normalise(right)[j1:j2])
    return set(chars)


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
    """驗收：已知的每一處錯字，這個篩子指不指得到它。

    算「蓋到」要同時成立兩件事：命中的區間與該處錯字相交，而且第二引擎在那裡讀到的字
    正是「正」比「誤」多出或換掉的字。只問區間相交會嚴重高估——每頁 97 處差異，
    十來字的誤欄隨便撞到一處無關的差異就算蓋到（2026-09-22 審查以 fixture 重現）。
    第二引擎讀到另一個錯字時這裡算漏掉，寧可低報。
    """
    gcv_dir, second_dir = source_dir / "gcv" / "txt", source_dir / second / "txt"
    cases = known_errors(source_dir, note_mark)
    if not cases:
        raise SystemExit(f"校訂表裡找不到註記含「{note_mark}」的列，沒有東西可驗。")
    misses = []
    for stem, wrong, right in cases:
        second_path = second_dir / f"{stem}.txt"
        if not second_path.exists():
            misses.append(f"{stem}「{wrong}」：這一頁還沒有第二引擎的稿")
            continue
        gcv_text = (gcv_dir / f"{stem}.txt").read_text(encoding="utf-8")
        try:
            hits, _, _ = diff_page(gcv_text, second_path.read_text(encoding="utf-8"), context)
        except ValueError as exc:
            misses.append(f"{stem}「{wrong}」：{exc}")
            continue
        if insertions_only:
            hits = [h for h in hits if not h["gcv"]]
        stream = normalise(gcv_text)
        needle = normalise(wrong)
        start = stream.find(needle)
        if start < 0:
            misses.append(f"{stem}「{wrong}」：在 GCV 稿裡找不到這段（校訂表與稿不同步？）")
            continue
        span = (start, start + len(needle))
        targets = wanted_chars(wrong, right)
        matched = [h for h in hits
                   if hit_span(h)[0] < span[1] and hit_span(h)[1] > span[0]
                   and (set(h["second"]) & targets)]
        print(f"{'蓋到' if matched else '漏掉'}\t{stem}\t{wrong} → {right}"
              + (f"\t第二引擎讀到 {matched[0]['second']}" if matched else ""))
        if not matched:
            misses.append(f"{stem}「{wrong}」沒有一處差異指到它")
    print(f"已知錯字 {len(cases)} 處，漏掉 {len(misses)} 處。")
    for miss in misses:
        print(f"  漏：{miss}", file=sys.stderr)
    return 1 if misses else 0


def self_test() -> int:
    """負向測試：對同一份稿注入五種已知的差異（漏字、多字、換字），看報不報得出來；
    相同的稿與只差標點的稿要一處都不報；空的第二引擎稿要拋錯。"""
    base = "主義領袖組織爲構成黨的領導力量的三大要素缺一不可本黨有正確的主義"
    cases = [
        ("漏一字（組織爲→組爲）", base.replace("組織爲", "組爲"), "織", base),
        ("漏另一字（領導力量的→領導力的）", base.replace("領導力量的", "領導力的"), "量", base),
        ("多一字", base.replace("三大要素", "三大要要素"), "要", base),
        ("換字（爲→為）", base.replace("組織爲", "組織為"), "為", base),
        ("換兩字（政權與治權→政與治樓）", "執行政與治樓", "權", "執行政權與治權"),
    ]
    failures = []
    for name, mutated, needle, reference in cases:
        hits, _, _ = diff_page(reference, mutated)
        if not hits:
            failures.append(f"{name}：一處都沒報")
            continue
        if not any(needle in hit["gcv"] or needle in hit["second"] for hit in hits):
            failures.append(f"{name}：報了 {len(hits)} 處，但沒有一處含「{needle}」")
    same, _, _ = diff_page(base, base)
    if same:
        failures.append(f"相同的兩份稿報了 {len(same)} 處，應為 0")
    punct, _, _ = diff_page("一個領袖、一個主義", "一個領袖*一個主義")
    if punct:
        failures.append(f"只有標點不同的兩份稿報了 {len(punct)} 處，應為 0（標點在比對前剝掉）")

    # 覆蓋判定：尾端的漏字要蓋得到，無關的差異不算數。
    tail_hits, _, _ = diff_page("甲乙丙領導力", "甲乙丙領導力量")
    tail = [h for h in tail_hits
            if hit_span(h)[0] < 6 and hit_span(h)[1] > 3 and (set(h["second"]) & {"量"})]
    if not tail:
        failures.append("尾端的漏字沒被算成蓋到")
    noise_hits, _, _ = diff_page("甲乙丙丁戊己", "甲王丙丁戊己")
    noise = [h for h in noise_hits
             if hit_span(h)[0] < 6 and hit_span(h)[1] > 0 and (set(h["second"]) & {"偉"})]
    if noise:
        failures.append("無關的差異被算成蓋到")
    try:
        diff_page(base, "")
        failures.append("空的第二引擎稿沒有拋錯")
    except ValueError:
        pass

    for failure in failures:
        print(f"未通過 {failure}", file=sys.stderr)
    if failures:
        return 1
    print("自測通過：五種差異都報得出來；相同、只差標點的稿不報；"
          "尾端漏字蓋得到、無關差異不算數；空稿拋錯。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--only", default="")
    parser.add_argument("--second", default="tess",
                        help="第二引擎的目錄名（tess＝tesseract chi_tra_vert，paddle＝PaddleOCR）")
    parser.add_argument("--out", default="", help="寫成 TSV；不給就印到畫面")
    parser.add_argument("--context", type=int, default=10)
    parser.add_argument("--insertions-only", action="store_true",
                        help="只看 GCV 那邊是空的差異——第二引擎讀到而 GCV 漏掉的字")
    parser.add_argument("--cjk-only", action="store_true",
                        help="只留第二引擎讀到的是漢字的那些（剝掉它把標點讀成數字的雜訊）")
    parser.add_argument("--check-known", default="",
                        help="驗收模式：校訂表註記含這段字的列，逐處看這個篩子指不指得到")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.source:
        raise SystemExit("要嘛 --self-test，要嘛給 --source。")

    source_dir = MATERIALS / args.source
    if args.check_known:
        return check_known(source_dir, args.check_known, args.context, args.second,
                           args.insertions_only)
    gcv_dir, second_dir = source_dir / "gcv" / "txt", source_dir / args.second / "txt"
    if not second_dir.is_dir():
        raise SystemExit(f"查無第二引擎的辨讀稿：{second_dir}")
    stems = select_stems(sorted(p.stem for p in second_dir.glob("*.txt")), args.only)

    rows = ["頁\t位置\tGCV\t第二引擎\t脈絡（GCV）"]
    totals = []
    skipped = []
    for stem in stems:
        gcv_path = gcv_dir / f"{stem}.txt"
        if not gcv_path.exists():
            skipped.append(f"{stem}：沒有 GCV 稿")
            continue
        try:
            hits, len_a, len_b = diff_page(
                gcv_path.read_text(encoding="utf-8"),
                (second_dir / f"{stem}.txt").read_text(encoding="utf-8"),
                args.context,
            )
        except ValueError as exc:
            skipped.append(f"{stem}：{exc}")
            continue
        if args.insertions_only:
            hits = [h for h in hits if not h["gcv"]]
        if args.cjk_only:
            hits = [h for h in hits if CJK.match(h["second"] or "")]
        totals.append((stem, len(hits), len_a, len_b))
        for hit in hits:
            rows.append(f"{stem}\t{hit['position']}\t{hit['gcv']}\t{hit['second']}\t{hit['context']}")

    for problem in skipped:
        print(f"略過 {problem}", file=sys.stderr)
    if not totals:
        print(f"一頁都沒有對齊到（第二引擎目錄 {second_dir}，略過 {len(skipped)} 頁）。",
              file=sys.stderr)
        return 1
    total_hits = sum(c for _, c, _, _ in totals)
    total_chars = sum(a for _, _, a, _ in totals)
    for stem, count, len_a, len_b in totals:
        ratio = count / len_a * 100 if len_a else 0
        print(f"{stem}: 差異 {count} 處，GCV {len_a} 字、第二引擎 {len_b} 字（差異占 {ratio:.1f}%）")
    print(f"合計：{len(totals)} 頁，GCV {total_chars} 字，差異 {total_hits} 處"
          f"（每頁平均 {total_hits / len(totals):.0f} 處）"
          + (f"；另有 {len(skipped)} 頁略過" if skipped else ""))
    body = "\n".join(rows) + "\n"
    if args.out:
        Path(args.out).write_text(body, encoding="utf-8")
        print(f"→ {args.out}（{len(rows) - 1} 列）")
    else:
        print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
