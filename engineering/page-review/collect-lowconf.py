#!/usr/bin/env python3
# 數每一頁信心值低於門檻的格數，寫成 engineering/page-review/lowconf.tsv。
#   python3 engineering/page-review/collect-lowconf.py [門檻]
# 門檻預設 0.60：2026-08-27 的校準量到 18 個真值裡它涵蓋 17 個（0.45 只涵蓋 12 個）。
# 辨讀結果不在本機時直接報錯，不要印零筆過去。
import collections, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'data/materials/speeches/gcv/txt/json')
OUT = os.path.join(ROOT, 'engineering/page-review/lowconf.tsv')
EXPECTED_PAGES = 786
THRESHOLD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.60

if not os.path.isdir(SRC):
    sys.exit(f'辨讀結果不在本機：{SRC}')

pages = {}
for f in glob.glob(os.path.join(SRC, '*.json')):
    m = re.search(r'(\d+)\.json$', f)
    if m:
        pages.setdefault(int(m.group(1)), f)
if len(pages) != EXPECTED_PAGES:
    sys.exit(f'讀到 {len(pages)} 頁，與原 PDF 的 {EXPECTED_PAGES} 頁不符')

low = collections.Counter()
cells = collections.Counter()
for page, path in pages.items():
    doc = json.load(open(path, encoding='utf8'))
    for pg in doc.get('fullTextAnnotation', {}).get('pages', []):
        for block in pg.get('blocks', []):
            for para in block.get('paragraphs', []):
                for word in para.get('words', []):
                    for sym in word.get('symbols', []):
                        cells[page] += 1
                        if sym.get('confidence', 1) < THRESHOLD:
                            low[page] += 1

with open(OUT, 'w', encoding='utf8') as fh:
    fh.write(f'# 門檻 {THRESHOLD}；由 collect-lowconf.py 產，勿手改\n')
    fh.write('pdfPage\tlowConf\tcells\n')
    for page in sorted(pages):
        fh.write(f'{page}\t{low[page]}\t{cells[page]}\n')
print(f'{OUT}　{len(pages)} 頁，低於 {THRESHOLD} 的格 {sum(low.values())} 個，'
      f'每頁中位數 {sorted(low[p] for p in pages)[len(pages) // 2]}')
