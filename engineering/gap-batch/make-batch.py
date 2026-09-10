#!/usr/bin/env python3
# 從 pending.tsv 排出一批要判的處，寫成 batch-NN.tsv。
#   python3 engineering/gap-batch/make-batch.py <批次號> [筆數]
# 順序：文言的序跋公牘（拾叁書序、拾肆追念師友、書信與意見書那幾篇）先，
# 其餘按該 PDF 頁的處數由多到少。欄位沿用 pending.tsv，前面加 idx 與 pieceId。
import csv, json, glob, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PENDING = os.path.join(ROOT, 'engineering/gap-batch/pending.tsv')
PAGE_MAP = os.path.join(ROOT, 'data/derived/page_map.json')
DRAFTS = os.path.join(ROOT, 'data/processed/reading-drafts')

batch = sys.argv[1] if len(sys.argv) > 1 else '01'
want = int(sys.argv[2]) if len(sys.argv) > 2 else 100


def book_page_map():
    items = json.load(open(PAGE_MAP, encoding='utf8'))['items']
    return {i['pdfPage']: (i.get('bookPage') if i.get('bookPage') is not None
                           else i.get('bookPageInferred')) for i in items}


def draft_ranges():
    out = []
    for f in sorted(glob.glob(os.path.join(DRAFTS, 'ZJH-*.json'))):
        d = json.load(open(f, encoding='utf8'))
        bp = str(d.get('bookPages') or '')
        nums = [int(n) for n in re.findall(r'\d+', bp)]
        if not nums:
            continue
        out.append((d['id'], min(nums), max(nums), d.get('part', '')))
    return out


BOOKISH = re.compile(r'(序|跋|呈|電|函|書|意見書|祭文|啓|啟|銘|傳略|誄)$')
PRIOR_PARTS = ('拾叁', '拾肆', '拾貳')

def judged_idx():
    # 已經有判定的處不再排進新的批次；判定檔是同目錄的 batch-NN-verdicts.tsv。
    seen = set()
    for f in sorted(glob.glob(os.path.join(ROOT, 'engineering/gap-batch/batch-*-verdicts.tsv'))):
        for row in csv.reader(open(f, encoding='utf8'), delimiter='\t'):
            if row and not row[0].startswith('#') and row[0].strip().isdigit():
                seen.add(int(row[0]))
    return seen


bp = book_page_map()
ranges = draft_ranges()
done = judged_idx()
rows = list(csv.DictReader(open(PENDING, encoding='utf8'), delimiter='\t'))
per_page = collections.Counter(int(r['pdfPage']) for r in rows)

titles = {}
for f in sorted(glob.glob(os.path.join(DRAFTS, 'ZJH-*.json'))):
    d = json.load(open(f, encoding='utf8'))
    titles[d['id']] = d.get('title', '')

enriched = []
for i, r in enumerate(rows):
    page = int(r['pdfPage'])
    book = bp.get(page)
    hits = [x for x in ranges if book is not None and x[1] <= book <= x[2]]
    pid = ';'.join(x[0] for x in hits)
    part = hits[0][3] if hits else ''
    literary = any(BOOKISH.search(titles.get(x[0], '')) for x in hits) or \
        any(part.startswith(p) for p in PRIOR_PARTS)
    enriched.append({'idx': i, 'pieceId': pid, 'part': part,
                     'literary': bool(hits) and literary,
                     'pageCount': per_page[page], **r})

pool = [e for e in enriched if e['pieceId'] and e['idx'] not in done]
pool.sort(key=lambda e: (not e['literary'], -e['pageCount'], int(e['pdfPage']), e['idx']))
picked = pool[:want]
picked.sort(key=lambda e: e['idx'])

out = os.path.join(ROOT, f'engineering/gap-batch/batch-{batch}.tsv')
cols = ['idx', 'pieceId', 'part', 'pdfPage', 'kind', 'ratio', 'x', 'y',
        'before', 'after', 'context']
with open(out, 'w', encoding='utf8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, delimiter='\t', extrasaction='ignore')
    w.writeheader()
    for e in picked:
        w.writerow(e)
print(out, len(picked), '筆；文言', sum(1 for e in picked if e['literary']),
      '處，涉', len({e['pdfPage'] for e in picked}), '頁；已判', len(done),
      '處，池中還剩', len(pool) - len(picked), '處')
