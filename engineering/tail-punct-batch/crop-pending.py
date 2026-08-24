#!/opt/homebrew/opt/python@3.13/bin/python3.13
# 待查的那幾格單獨重裁：比接觸表寬、比接觸表高，且不縮圖。
# 用法：crop-pending.py 029-14 032-54 ...（不給參數就讀 verdicts.tsv 裡所有「待查」）
import json, os, re, sys
from PIL import Image

ROOT = os.path.expanduser('~/Documents/NTU/1142/zhu-jiahua-research-data')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'pending')
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

def find_char_box(doc, tail_cjk):
    page = doc.get('fullTextAnnotation', {}).get('pages', [None])[0]
    if not page:
        return None
    for n in (4, 3, 2):
        target = tail_cjk[-n:]
        for b in page.get('blocks', []):
            for par in b.get('paragraphs', []):
                syms = [(s['text'], s.get('boundingBox', {}).get('vertices', []))
                        for w in par['words'] for s in w['symbols']]
                cjk_seq = [(t, v) for t, v in syms if CJK.match(t)]
                joined = ''.join(t for t, _ in cjk_seq)
                i = joined.rfind(target)
                if i == -1:
                    continue
                t, v = cjk_seq[i + len(target) - 1]
                xs = [q.get('x', 0) for q in v]
                ys = [q.get('y', 0) for q in v]
                if not xs:
                    continue
                return (min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2
    return None

args = sys.argv[1:]
if not args:
    args = [l.split('\t')[0] for l in open(os.path.join(HERE, 'verdicts.tsv'))
            if l.rstrip('\n').endswith('\t待查')]
for key in args:
    num, para_no = key.split('-')[0], int(key.split('-')[1])
    pid = f'ZJH-{num}'
    draft = json.load(open(os.path.join(ROOT, f'data/processed/reading-drafts/{pid}.json')))
    paras = draft['paragraphs']
    text = paras[para_no]
    tail_cjk = ''.join(CJK.findall(text))[-8:]
    bp = book_page_at(draft.get('pageBreaks', []), para_no, len(text))
    h = heads.get(pid)
    pdf = h['pdfPage'] + (bp - h['bookStartPage'])
    hit = None
    for cand in (pdf, pdf + 1, pdf - 1, pdf + 2):
        f = os.path.join(JSONS, f'{PREFIX}{cand:03d}.json')
        if not os.path.exists(f):
            continue
        hit = find_char_box(json.load(open(f)), tail_cjk)
        if hit:
            pdf = cand
            break
    if not hit:
        print(f'{key}\tMISS\t{tail_cjk}\tbookPage {bp}')
        continue
    cx, cy = hit
    im = Image.open(os.path.join(PAGES, f'{PREFIX}{pdf:03d}.png'))
    box = (max(0, cx - 210), max(0, cy - 160), min(im.width, cx + 210), min(im.height, cy + 620))
    im.crop(box).save(os.path.join(OUT, f'{key}.png'))
    print(f'{key}\tOK\tpdf {pdf}\tbookPage {bp}\t末字 {tail_cjk}')
