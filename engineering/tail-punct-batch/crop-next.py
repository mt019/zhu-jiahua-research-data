#!/opt/homebrew/opt/python@3.13/bin/python3.13
# 段末那個字的下一欄從欄頂起的十來個字：判「原書這裡是句讀、還是句子還沒完」用這個就夠，
# 比整頁圖省。左邊三欄、從版心上緣往下 760px。
import json, os, re, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.expanduser('~/Documents/NTU/1142/zhu-jiahua-research-data')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'next-col')
os.makedirs(OUT, exist_ok=True)
PAGES = os.path.join(ROOT, 'data/materials/speeches/gcv/pages')
JSONS = os.path.join(ROOT, 'data/materials/speeches/gcv/txt/json')
PREFIX = '朱家驊先生言論集 (王聿均,孫斌合编)-'
heads = {h['id']: h for h in json.load(open(os.path.join(ROOT, 'data/derived/piece_heads.json')))['items']}
CJK = re.compile(r'[一-鿿豈-﫿]')

def book_page_at(brks, para, offset):
    best = None
    for b in brks:
        if (b['para'], b['offset']) <= (para, offset):
            best = b
    return best['bookPage'] if best else None

def find_box(doc, tail):
    page = doc.get('fullTextAnnotation', {}).get('pages', [None])[0]
    if not page:
        return None
    for n in (5, 4, 3):
        target = tail[-n:]
        for b in page.get('blocks', []):
            for par in b.get('paragraphs', []):
                syms = [(s['text'], s.get('boundingBox', {}).get('vertices', []))
                        for w in par['words'] for s in w['symbols']]
                seq = [(t, v) for t, v in syms if CJK.match(t)]
                joined = ''.join(t for t, _ in seq)
                i = joined.rfind(target)
                if i == -1:
                    continue
                v = seq[i + len(target) - 1][1]
                xs = [q.get('x', 0) for q in v]
                ys = [q.get('y', 0) for q in v]
                if xs:
                    return min(xs), min(ys), max(xs), max(ys)
    return None

try:
    font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 26)
except Exception:
    font = ImageFont.load_default()

for key in sys.argv[1:]:
    num, idx = key.split('-')[0], int(key.split('-')[1])
    pid = f'ZJH-{num}'
    draft = json.load(open(os.path.join(ROOT, f'data/processed/reading-drafts/{pid}.json')))
    text = draft['paragraphs'][idx]
    tail = ''.join(CJK.findall(text))[-8:]
    bp = book_page_at(draft.get('pageBreaks', []), idx, len(text))
    h = heads[pid]
    pdf = h['pdfPage'] + (bp - h['bookStartPage'])
    box = None
    for cand in (pdf, pdf + 1, pdf - 1, pdf + 2):
        f = os.path.join(JSONS, f'{PREFIX}{cand:03d}.json')
        if not os.path.exists(f):
            continue
        box = find_box(json.load(open(f)), tail)
        if box:
            pdf = cand
            break
    if not box:
        print(f'{key}\tMISS')
        continue
    im = Image.open(os.path.join(PAGES, f'{PREFIX}{pdf:03d}.png')).convert('RGB')
    x0, y0, x1, y1 = box
    # 上半：段末那個字往下到欄底；下半：左邊三欄從版心上緣起
    top = Image.new('RGB', (im.width, 1), (255, 255, 255))
    a = im.crop((max(0, x0 - 40), max(0, y0 - 30), min(im.width, x1 + 40), min(im.height, y1 + 300)))
    b = im.crop((max(0, x0 - 300), max(0, y0 - 30 - 900), min(im.width, x1 + 40), max(0, y0 - 30)))
    c = im.crop((max(0, x0 - 300), 250, min(im.width, x1 + 10), 1150))
    W = a.width + b.width + c.width + 60
    H = max(a.height, b.height, c.height) + 40
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    sheet.paste(a, (10, 30)); d.text((10, 2), '末字往下', font=font, fill=(200, 0, 0))
    sheet.paste(b, (a.width + 30, 30)); d.text((a.width + 30, 2), '末字往上', font=font, fill=(0, 0, 200))
    sheet.paste(c, (a.width + b.width + 50, 30)); d.text((a.width + b.width + 50, 2), '左三欄頂', font=font, fill=(0, 130, 0))
    sheet.save(os.path.join(OUT, f'{key}.png'))
    print(f'{key}\tpdf {pdf}\t{tail[-4:]}')
