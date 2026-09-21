#!/usr/bin/env python3
"""繁中 PaddleOCR 讀外部來源的頁面影像，逐頁存原始 JSON 與依直排欄序接好的純文字。

用途是當第二個引擎：GCV 的辨讀稿與本腳本的輸出逐字對齊，兩邊不同的位置才回原頁圖判，
比 74 頁逐欄通校便宜一個數量級（教訓見 ~/.claude/rules/harness診斷 2026-08-19）。

用法（venv 在 court 倉，本倉不另建一份）：
  ~/Documents/NTU/1142/phenom-court-data/engineering/.venv-ocr/bin/python \
      engineering/scripts/ocr-pages-paddle.py --source SRC-nlc-dang-de-zuzhi-yu-lingdao-1944 \
      --only pg-59,pg-63,pg-65

讀的是 materials 底下該來源的 pages/*.png——那批影像已照 digitisation.ocrScale 放大過，
與送進 GCV 的是同一批，對齊才成立。輸出落在同一個來源目錄的 paddle/json 與 paddle/txt。

記憶體：一頁的常駐以 GB 計，16 GB 這台一次只准跑一支（檔案鎖），每一批子進程開始前看
可用記憶體與 memory_pressure，不足就停下並保留已完成的頁。限制的來歷與數字見
phenom-court-data 的 ocr_gazette_paddle.py 檔頭與 2026-08-18 那次強制重開。

辨識模型固定 chinese_cht_PP-OCRv3_mobile_rec：PP-OCRv5_server_rec 在大理院掃描件上
220 行吐 43 個不當簡化字，繁中模型 0 個（court 倉 LOG 2026-07-22）。

直排欄序：偵測框按中心 x 由大到小排（由右而左），x 相近者按 y 由小到大。欄寬取全頁
框寬的中位數，同欄的判準是中心 x 相差不到一個欄寬的一半。
"""

import argparse
import fcntl
import json
import os
import re
import signal
import statistics
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MATERIALS = REPO / "data" / "materials" / "external"
LOCK_PATH = REPO / "engineering" / ".ocr-pages-paddle.lock"
MIN_FREE_GB = 6.0
MIN_PRESSURE_FREE_PCT = 35


def acquire_lock():
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    handle = LOCK_PATH.open("w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit(
            f"另一支 {Path(__file__).name} 正在跑（鎖檔 {LOCK_PATH}）。一次只准跑一支。"
        )
    handle.write(f"pid {os.getpid()}\n")
    handle.flush()
    return handle


def free_gb() -> float:
    out = subprocess.run(["vm_stat"], capture_output=True, text=True, check=True).stdout
    size = int(re.search(r"page size of (\d+) bytes", out).group(1))
    counts = dict(re.findall(r"^(.+?):\s+(\d+)\.$", out, re.M))
    keys = ["Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"]
    return sum(int(counts.get(k, 0)) for k in keys) * size / 1024 ** 3


def pressure_free_pct() -> int:
    out = subprocess.run(["memory_pressure"], capture_output=True, text=True, check=True).stdout
    match = re.search(r"free percentage:\s*(\d+)%", out)
    return int(match.group(1)) if match else 100


def swap_used_gb() -> float:
    out = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True, check=True).stdout
    match = re.search(r"used\s*=\s*([\d.]+)([MG])", out)
    if not match:
        return 0.0
    value = float(match.group(1))
    return value / 1024 if match.group(2) == "M" else value


def install_signal_handlers():
    def bye(signum, _frame):
        print(f"收到信號 {signum}，本頁不存檔，已完成的頁面都在。", file=sys.stderr, flush=True)
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)


def boxes_to_columns(polys, texts):
    """直排：框按中心 x 由右而左分欄，欄內按 y 由上而下。回傳接好的每一欄文字。"""
    items = []
    for poly, text in zip(polys, texts):
        xs = [float(p[0]) for p in poly]
        ys = [float(p[1]) for p in poly]
        items.append({
            "cx": sum(xs) / len(xs),
            "cy": sum(ys) / len(ys),
            "width": max(xs) - min(xs),
            "text": text,
        })
    if not items:
        return []
    column_width = statistics.median(i["width"] for i in items) or 1.0
    items.sort(key=lambda i: -i["cx"])
    columns, current = [], [items[0]]
    for item in items[1:]:
        if abs(item["cx"] - current[-1]["cx"]) <= column_width / 2:
            current.append(item)
        else:
            columns.append(current)
            current = [item]
    columns.append(current)
    lines = []
    for column in columns:
        column.sort(key=lambda i: i["cy"])
        lines.append("".join(i["text"] for i in column))
    return lines


def run_pages(source_dir: Path, stems, rec_model: str, force: bool):
    from paddleocr import PaddleOCR

    out_json = source_dir / "paddle" / "json"
    out_txt = source_dir / "paddle" / "txt"
    out_json.mkdir(parents=True, exist_ok=True)
    out_txt.mkdir(parents=True, exist_ok=True)

    ocr = PaddleOCR(
        text_recognition_model_name=rec_model,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=True,
        device="cpu",
    )
    for index, stem in enumerate(stems, 1):
        raw_json = out_json / f"{stem}.json"
        if force or not raw_json.exists():
            results = list(ocr.predict(str(source_dir / "pages" / f"{stem}.png")))
            if len(results) != 1:
                raise RuntimeError(f"{stem}：預期一個結果，得到 {len(results)}")
            results[0].save_to_json(str(raw_json))
        data = json.loads(raw_json.read_text(encoding="utf-8"))
        data = data.get("res", data)
        texts = data.get("rec_texts", [])
        scores = data.get("rec_scores", [])
        polys = data.get("rec_polys") or data.get("dt_polys") or []
        lines = boxes_to_columns(polys, texts) if polys else texts
        (out_txt / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        mean = round(sum(scores) / len(scores), 4) if scores else 0.0
        chars = sum(len(t) for t in texts)
        print(f"[{index}/{len(stems)}] {stem}: {len(texts)} 框 {len(lines)} 欄 {chars} 字 平均信心 {mean}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="materials/external 底下的來源 id")
    parser.add_argument("--only", default="", help="逗號分隔的頁 stem，預設該來源全部")
    parser.add_argument("--rec-model", default="chinese_cht_PP-OCRv3_mobile_rec")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--min-free-gb", type=float, default=MIN_FREE_GB)
    parser.add_argument("--pages-per-child", type=int, default=5)
    parser.add_argument("--child", action="store_true", help="內部用：由母進程叫起，不取鎖")
    args = parser.parse_args()
    install_signal_handlers()

    source_dir = MATERIALS / args.source
    pages_dir = source_dir / "pages"
    if not pages_dir.is_dir():
        raise SystemExit(f"查無頁面影像目錄：{pages_dir}")
    stems = sorted(p.stem for p in pages_dir.glob("*.png"))
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        missing = wanted - set(stems)
        if missing:
            raise SystemExit(f"查無這幾頁：{sorted(missing)}")
        stems = [s for s in stems if s in wanted]
    if not stems:
        raise SystemExit("沒有要跑的頁。")

    if args.child:
        run_pages(source_dir, stems, args.rec_model, args.force)
        return

    lock = acquire_lock()
    try:
        available = free_gb()
        if available < args.min_free_gb:
            raise SystemExit(
                f"可用記憶體 {available:.1f} GB，低於門檻 {args.min_free_gb} GB，不開跑。"
                "先關掉其他程式，或用 --min-free-gb 明確放寬。"
            )
        pending = [s for s in stems
                   if args.force or not (source_dir / "paddle" / "json" / f"{s}.json").exists()]
        if not pending:
            print("這些頁都已經有結果，沒有要跑的。", flush=True)
            return
        size = max(1, args.pages_per_child)
        groups = [pending[i:i + size] for i in range(0, len(pending), size)]
        print(f"待辦 {len(pending)} 頁，一支子進程連跑 {size} 頁，共 {len(groups)} 支。", flush=True)
        done = 0
        for group in groups:
            available, pressure = free_gb(), pressure_free_pct()
            if available < args.min_free_gb or pressure < MIN_PRESSURE_FREE_PCT:
                print(
                    f"停在第 {done + 1}/{len(pending)} 頁（{group[0]}）：可用記憶體 {available:.1f} GB"
                    f"（門檻 {args.min_free_gb}），memory_pressure 可用 {pressure}%"
                    f"（門檻 {MIN_PRESSURE_FREE_PCT}%），交換空間已用 {swap_used_gb():.1f} GB。"
                    "已完成的頁都已存檔，重跑會接續。",
                    file=sys.stderr, flush=True,
                )
                break
            command = [sys.executable, str(Path(__file__).resolve()), "--child",
                       "--source", args.source, "--only", ",".join(group),
                       "--rec-model", args.rec_model]
            if args.force:
                command.append("--force")
            result = subprocess.run(command, stdin=subprocess.DEVNULL)
            if result.returncode != 0:
                print(f"{group[0]} 起這 {len(group)} 頁的子進程回 {result.returncode}，停下。",
                      file=sys.stderr, flush=True)
                break
            done += len(group)
            print(f"[{done}/{len(pending)}] {group[-1]} 完成，可用 {free_gb():.1f} GB，"
                  f"壓力可用 {pressure_free_pct()}%，交換空間 {swap_used_gb():.1f} GB", flush=True)
    finally:
        lock.close()


if __name__ == "__main__":
    main()
