#!/opt/homebrew/opt/python@3.13/bin/python3.13
# 待查的那幾處：整頁半尺寸，段末那個字框上畫一個方框，回原頁圖判讀時看得到前後欄。
import json, os, re, sys
from PIL import Image, ImageDraw

ROOT = os.path.expanduser('~/Documents/NTU/1142/zhu-jiahua-research-data')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'pending-pages')
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
    im = Image.open(os.path.join(PAGES, f'{PREFIX}{pdf:03d}.png')).convert('RGB')
    if box:
        d = ImageDraw.Draw(im)
        d.rectangle([box[0] - 12, box[1] - 12, box[2] + 12, box[3] + 12], outline=(220, 0, 0), width=7)
    im.resize((im.width // 2, im.height // 2)).save(os.path.join(OUT, f'{key}.png'))
    print(f'{key}\tpdf {pdf}\t書頁 {bp}\t{"框住 " + tail[-3:] if box else "找不到末字 " + tail}')
