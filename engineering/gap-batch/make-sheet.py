#!/usr/bin/env python3
# 把待判的若干處裁成小圖，排成一頁可以在瀏覽器逐筆看的判讀表。
#   python3 engineering/gap-batch/make-sheet.py <起> <迄> [輸出目錄]      # 取 pending.tsv 的區間
#   python3 engineering/gap-batch/make-sheet.py --list batch-01.tsv [輸出目錄] [--verdicts f.tsv]
# 每筆左邊是原頁圖的裁切、右邊是讀稿現在的樣子與該處的規則、比值；給了判定檔就一併印出
# 判定與判出的那個字，供抽查。
import csv, os, subprocess, sys, html

PDF = os.path.expanduser('~/Documents/mba_books/朱家驊先生言論集 (王聿均,孫斌合编).pdf')
TSV = 'engineering/gap-batch/pending.tsv'
DPI = int(os.environ.get('ZJH_SHEET_DPI', 450))   # 辨讀影像是 400 dpi，座標乘 DPI/400
SCALE = DPI / 400
# 裁切窗（400 dpi 單位）：以該處為原點往左 DX、往上 DY，取 W×H。
# 預設是窄條，只夠看該欄；判讀時常要看左右鄰欄，用 ZJH_CROP_* 放寬。
DX = int(os.environ.get('ZJH_CROP_DX', 70))
DY = int(os.environ.get('ZJH_CROP_DY', 240))
CW = int(os.environ.get('ZJH_CROP_W', 260))
CH = int(os.environ.get('ZJH_CROP_H', 620))

argv = sys.argv[1:]
verdicts = {}
if '--verdicts' in argv:
    i = argv.index('--verdicts')
    for r in csv.reader(open(argv[i + 1], encoding='utf8'), delimiter='\t'):
        if r and not r[0].startswith('#') and len(r) >= 3:
            verdicts[r[0]] = (r[2], r[3] if len(r) > 3 else '', r[4] if len(r) > 4 else '')
    del argv[i:i + 2]

if argv and argv[0] == '--list':
    rows = list(csv.DictReader(open(argv[1], encoding='utf8'), delimiter='\t'))
    out = argv[2] if len(argv) > 2 else 'engineering/gap-batch/sheet'
    total, title = len(rows), os.path.basename(argv[1])
else:
    lo = int(argv[0]) if argv else 0
    hi = int(argv[1]) if len(argv) > 1 else lo + 40
    out = argv[2] if len(argv) > 2 else 'engineering/gap-batch/sheet'
    ALL = list(csv.DictReader(open(TSV, encoding='utf8'), delimiter='\t'))
    rows = ALL[lo:hi]
    for i, r in enumerate(rows):
        r['idx'] = str(lo + i)
    total, title = len(ALL), f'pending.tsv 第 {lo}–{lo + len(rows)} 筆'

os.makedirs(out, exist_ok=True)
cards = []
for r in rows:
    page, x, y = int(r['pdfPage']), int(r['x']), int(r['y'])
    name = f"{int(r['idx']):04d}-p{page}"
    subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-r', str(DPI), '-png',
                    '-x', str(max(0, int((x - DX) * SCALE))),
                    '-y', str(max(0, int((y - DY) * SCALE))),
                    '-W', str(int(CW * SCALE)), '-H', str(int(CH * SCALE)),
                    PDF, os.path.join(out, name)], check=True)
    img = next(f for f in sorted(os.listdir(out)) if f.startswith(name) and f.endswith('.png'))
    v = verdicts.get(r['idx'])
    vline = ''
    if v:
        label = {'drop': '判：原書有而讀稿沒有', 'blank': '判：原書本來就空',
                 'unsure': '判：看不準'}.get(v[0], f'判：{v[0]}')
        vline = (f'<br><b>{html.escape(label)}'
                 + (f'　「{html.escape(v[1])}」' if v[1] else '') + '</b>'
                 + (f'<br><span class=n>{html.escape(v[2])}</span>' if v[2] else ''))
    cards.append(f'''<figure>
  <img src="{html.escape(img)}" alt="PDF {page}">
  <figcaption>
    <b>#{r['idx']}</b>　PDF {page}　{html.escape(r.get('pieceId', ''))}　{html.escape(r['kind'])}　比值 {r['ratio']}<br>
    讀稿：<span class=t>{html.escape(r['context'])}</span><br>
    空白落在　{html.escape(r['before'] or '（欄首）')}　與　{html.escape(r['after'])}　之間{vline}
  </figcaption>
</figure>''')

open(os.path.join(out, 'index.html'), 'w', encoding='utf8').write(f'''<!doctype html>
<meta charset="utf-8"><title>字框間距待判　{html.escape(title)}</title>
<style>
 body{{font:16px/1.7 "Songti TC",serif;margin:2rem;background:#fbfaf7;color:#1a1a1a}}
 h1{{font-size:1.2rem;font-weight:600}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.5rem}}
 figure{{margin:0;display:flex;gap:1rem;border-top:1px solid #ddd;padding-top:1rem}}
 img{{max-height:340px;image-rendering:crisp-edges}}
 figcaption{{font-size:.85rem;line-height:1.6}}
 .t{{font-family:"Songti TC",serif;background:#fff3d6}}
 .n{{color:#555}}
</style>
<h1>字框間距的判讀表　{html.escape(title)}　{len(rows)} 筆（全書待判 722 筆）</h1>
<p>左邊是原書 {DPI} dpi 的裁切，直排右起讀。右邊是讀稿現在的樣子。圖上空白處印著字而讀稿沒有，就是掉了。</p>
<div class=grid>{''.join(cards)}</div>
''')
print(f'{out}/index.html　{len(rows)} 筆')
