#!/usr/bin/env python3
"""tesseract chi_tra_vert 讀外部來源的直排頁面影像，當對齊用的第二引擎。

一頁 1.1 秒、常駐以百 MB 計，與 GCV 讀的是同一批放大過的頁圖。輸出落在該來源目錄的
tess/txt，不進版控（從頁圖再跑一次就有）。

用法：
  python3 engineering/scripts/ocr-pages-tesseract.py --source SRC-nlc-dang-de-zuzhi-yu-lingdao-1944

它自己的字錯率遠高於 GCV，產出不作為正文的依據，只供 align-ocr-engines.py 指出兩邊
不同的位置。PaddleOCR 在這本書上不能當第二引擎：整欄四千餘像素壓進辨識模型的行高，
繁中 v3 與 v5 server 兩個模型的輸出都是亂字（2026-09-22 實測，見 LOG）。
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from ocr_align import MATERIALS, select_stems  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--only", default="")
    parser.add_argument("--lang", default="chi_tra_vert")
    parser.add_argument("--psm", default="5", help="5＝直排整頁")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    source_dir = MATERIALS / args.source
    pages_dir = source_dir / "pages"
    if not pages_dir.is_dir():
        raise SystemExit(f"查無頁面影像目錄：{pages_dir}")
    out_dir = source_dir / "tess" / "txt"
    out_dir.mkdir(parents=True, exist_ok=True)

    stems = select_stems(sorted(p.stem for p in pages_dir.glob("*.png")), args.only)
    if not stems:
        raise SystemExit(f"{pages_dir} 底下一張頁圖都沒有，沒有要讀的頁。")

    done = 0
    for stem in stems:
        target = out_dir / f"{stem}.txt"
        if target.exists() and not args.force:
            continue
        result = subprocess.run(
            ["tesseract", str(pages_dir / f"{stem}.png"), str(out_dir / stem),
             "-l", args.lang, "--psm", args.psm],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"{stem} 失敗：{result.stderr.strip()[:200]}", file=sys.stderr)
            return 1
        if not target.exists() or not target.read_text(encoding="utf-8").strip():
            # 空殼留著的話，下一次執行會因為檔案存在而跳過它，而對齊那支拿到空稿
            # 會把整頁算成一個涵蓋全頁的差異，覆蓋判定跟著失真（2026-09-22 審查）。
            target.unlink(missing_ok=True)
            print(f"{stem}：產物是空的，已刪除，不留空殼", file=sys.stderr)
            return 1
        done += 1
    print(f"{done} 頁新讀，{len(stems)} 頁在 {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
