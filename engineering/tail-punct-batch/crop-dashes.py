#!/opt/homebrew/opt/python@3.13/bin/python3.13
# 貼著漢字的半形連字號 10 處：定位連字號前的漢字，裁欄段小圖拼一張表。
import json, os, re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.expanduser('~/Documents/NTU/1142/zhu-jiahua-research-data')
SCRATCH = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(ROOT, 'data/materials/speeches/gcv/pages')
JSONS = os.path.join(ROOT, 'data/materials/speeches/gcv/txt/json')
PREFIX = '朱家驊先生言論集 (王聿均,孫斌合编)-'
heads = {h['id']: h for h in json.load(open(os.path.join(ROOT, 'data/derived/piece_heads.json')))['items']}
CJK = re.compile(r'[一-鿿豈-﫿]')

ITEMS = [  # (pid, para, 連字號前的漢字錨，錨後偏移說明)
    ('ZJH-027', 2, '院士選舉'),
    ('ZJH-057', 10, '公費生待遇'),
    ('ZJH-060', 60, '大學的責任'),
    ('ZJH-082', 10, '也是接近'),
    ('ZJH-134', 3, '致命的打擊'),
    ('ZJH-134', 8, '東南歐鄰境'),
    ('ZJH-134', 8, '有絕對優勢'),
    ('ZJH-136', 1, '的一個主角'),
    ('ZJH-194', 7, '生的主張'),
#    ('ZJH-FM-001', 10, '大學附設醫院'),  # 前置篇不在 piece_heads，單獨裁
]

def book_page_at(brks, para, offset):
    best = None
    for b in brks:
        if (b['para'], b['offset']) <= (para, offset):
            best = b
    return best['bookPage'] if best else None

def find_box(doc, anchor):
    page = doc.get('fullTextAnnotation', {}).get('pages', [None])[0]
    if not page: return None
    for b in page.get('blocks', []):
        for par in b.get('paragraphs', []):
            syms = [(s['text'], s.get('boundingBox', {}).get('vertices', []))
                    for w in par['words'] for s in w['symbols']]
            cjk_seq = [(t, v) for t, v in syms if CJK.match(t)]
            joined = ''.join(t for t, _ in cjk_seq)
            i = joined.find(anchor)
            if i == -1: continue
            t, v = cjk_seq[i + len(anchor) - 1]
            xs = [q.get('x', 0) for q in v]; ys = [q.get('y', 0) for q in v]
            if xs: return (min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2
    return None

rows = []
for pid, para_no, anchor in ITEMS:
    d = json.load(open(os.path.join(ROOT, f'data/processed/reading-drafts/{pid}.json')))
    text = d['paragraphs'][para_no - 1]
    pos = text.find(anchor)
    bp = book_page_at(d.get('pageBreaks', []), para_no - 1, max(pos, 0))
    h = heads[pid]
    pdf0 = h['pdfPage'] + (bp - h['bookStartPage'])
    hit = None
    for cand in (pdf0, pdf0 + 1, pdf0 - 1):
        f = os.path.join(JSONS, f'{PREFIX}{cand}.json')
        if not os.path.exists(f): continue
        hit = find_box(json.load(open(f)), anchor)
        if hit: pdf0 = cand; break
    if not hit:
        rows.append((pid, para_no, anchor, bp, pdf0, None)); continue
    cx, cy = hit
    im = Image.open(os.path.join(PAGES, f'{PREFIX}{pdf0}.png'))
    crop = im.crop((max(0, cx - 75), max(0, cy - 120), min(im.width, cx + 75), min(im.height, cy + 420)))
    rows.append((pid, para_no, anchor, bp, pdf0, crop))

font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 22)
CELL_W, CELL_H, LABEL_H = 170, 540, 34
sheet = Image.new('L', (CELL_W * 5, (CELL_H + LABEL_H) * 2), 255)
dr = ImageDraw.Draw(sheet)
for k, (pid, para_no, anchor, bp, pdf, crop) in enumerate(rows):
    col, row = k % 5, k // 5
    x0, y0 = col * CELL_W, row * (CELL_H + LABEL_H)
    dr.text((x0 + 4, y0 + 4), f'{pid.replace("ZJH-","")}-{para_no} {anchor[-3:]}', font=font, fill=0)
    if crop:
        r = min(CELL_W / crop.width, CELL_H / crop.height)
        crop = crop.convert('L').resize((int(crop.width * r), int(crop.height * r)))
        sheet.paste(crop, (x0 + (CELL_W - crop.width) // 2, y0 + LABEL_H))
    else:
        dr.text((x0 + 4, y0 + LABEL_H + 4), 'MISS', font=font, fill=0)
    dr.rectangle([x0, y0, x0 + CELL_W - 1, y0 + LABEL_H + CELL_H - 1], outline=180)
sheet.save(os.path.join(SCRATCH, 'dashes-sheet.png'))
print('done', sum(1 for r in rows if r[5]), '/', len(rows))
