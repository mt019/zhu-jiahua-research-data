#!/opt/homebrew/opt/python@3.13/bin/python3.13
# 段末無句讀 304 處：從讀稿定位段末字，回到該頁 GCV 的字框座標，裁欄末小圖並拼接觸表。
# 產物：scratchpad/tails/ 底下 sheet-NN.png 與 tails-index.tsv（每格的 id、段、末八字、頁）。
import json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.expanduser('~/Documents/NTU/1142/zhu-jiahua-research-data')
SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, 'tails')
os.makedirs(OUT, exist_ok=True)
PAGES = os.path.join(ROOT, 'data/materials/speeches/gcv/pages')
JSONS = os.path.join(ROOT, 'data/materials/speeches/gcv/txt/json')
PREFIX = '朱家驊先生言論集 (王聿均,孫斌合编)-'

heads = {h['id']: h for h in json.load(open(os.path.join(ROOT, 'data/derived/piece_heads.json')))['items']}
CJK = re.compile(r'[一-鿿豈-﫿]')

def audit_list():
    # 清單由 audit-drafts.mjs 事先存成 tail-list.tsv（node 子行程在背景 shell 會卡住，別在這裡呼叫）
    rows = []
    for line in open(os.path.join(SCRATCH, 'tail-list.tsv')):
        parts = line.rstrip('\n').split('\t')
        if len(parts) >= 4 and parts[1] == '段末無句讀':
            m = re.search(r'第 (\d+) 段', parts[3])
            rows.append((parts[2], int(m.group(1))))
    return rows

def book_page_at(brks, para, offset):
    best = None
    for b in brks:
        if (b['para'], b['offset']) <= (para, offset):
            best = b
    return best['bookPage'] if best else None

def gcv_page(pdf):
    f = os.path.join(JSONS, f'{PREFIX}{pdf:03d}.json')
    if not os.path.exists(f):
        return None
    return json.load(open(f))

def find_char_box(doc, tail_cjk):
    # 在 fullTextAnnotation 的段裡找末四個漢字（只比漢字，標點寬窄不一致），
    # 取最後一個漢字的字框。
    page = doc.get('fullTextAnnotation', {}).get('pages', [None])[0]
    if not page:
        return None
    target = tail_cjk[-4:]
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

rows = audit_list()
index = []
missing = []
for pid, para_no in rows:
    if not pid.startswith('ZJH-') or pid.startswith('ZJH-FM'):
        missing.append((pid, para_no, '非言論集正文'))
        continue
    draft = json.load(open(os.path.join(ROOT, f'data/processed/reading-drafts/{pid}.json')))
    paras = draft['paragraphs']
    # audit-drafts.mjs 印的「第 N 段」是 paragraphs 的索引（0 起算），不是第幾段。
    # 第一版按 1 起算讀 paras[N-1]，裁的是前一段的段末，263 格全部差一段；
    # 那一段多半有句讀，於是每一格都判成「原書有句號而 GCV 掉了」。
    if para_no >= len(paras):
        missing.append((pid, para_no, '段號超界'))
        continue
    text = paras[para_no]
    tail_cjk = ''.join(CJK.findall(text))[-8:]
    bp = book_page_at(draft.get('pageBreaks', []), para_no, len(text))
    h = heads.get(pid)
    if bp is None or h is None:
        missing.append((pid, para_no, '無頁碼'))
        continue
    pdf = h['pdfPage'] + (bp - h['bookStartPage'])
    hit = None
    for cand in (pdf, pdf + 1, pdf - 1):
        doc = gcv_page(cand)
        if doc:
            hit = find_char_box(doc, tail_cjk)
            if hit:
                pdf = cand
                break
    if not hit:
        missing.append((pid, para_no, f'頁 {pdf} 找不到末字 {tail_cjk[-4:]}'))
        continue
    cx, cy = hit
    src = os.path.join(PAGES, f'{PREFIX}{pdf:03d}.png')
    im = Image.open(src)
    box = (max(0, cx - 75), max(0, cy - 70), min(im.width, cx + 75), min(im.height, cy + 340))
    crop = im.crop(box)
    name = f'{pid}-p{para_no}.png'
    crop.save(os.path.join(OUT, name))
    index.append((pid, para_no, tail_cjk, bp, pdf, name))

with open(os.path.join(SCRATCH, 'tails-index.tsv'), 'w') as f:
    for r in index:
        f.write('\t'.join(map(str, r)) + '\n')
with open(os.path.join(SCRATCH, 'tails-missing.tsv'), 'w') as f:
    for r in missing:
        f.write('\t'.join(map(str, r)) + '\n')

# 接觸表：4 欄 × 5 列，每格上緣印 id 與段號、末四字
try:
    font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 22)
except Exception:
    font = ImageFont.load_default()
CELL_W, CELL_H, LABEL_H = 170, 460, 34
per_sheet = 20
for si in range(0, len(index), per_sheet):
    batch = index[si:si + per_sheet]
    sheet = Image.new('L', (CELL_W * 4, (CELL_H + LABEL_H) * 5), 255)
    d = ImageDraw.Draw(sheet)
    for k, (pid, para_no, tail, bp, pdf, name) in enumerate(batch):
        col, row = k % 4, k // 4
        x0, y0 = col * CELL_W, row * (CELL_H + LABEL_H)
        d.text((x0 + 4, y0 + 4), f'{pid[4:]}-{para_no} {tail[-4:]}', font=font, fill=0)
        crop = Image.open(os.path.join(OUT, name)).convert('L')
        r = min(CELL_W / crop.width, CELL_H / crop.height)
        crop = crop.resize((int(crop.width * r), int(crop.height * r)))
        sheet.paste(crop, (x0 + (CELL_W - crop.width) // 2, y0 + LABEL_H))
        d.rectangle([x0, y0, x0 + CELL_W - 1, y0 + LABEL_H + CELL_H - 1], outline=180)
    sheet.save(os.path.join(SCRATCH, f'tails-sheet-{si // per_sheet:02d}.png'))
print(f'located {len(index)}, missing {len(missing)}, sheets {(len(index)+per_sheet-1)//per_sheet}')
