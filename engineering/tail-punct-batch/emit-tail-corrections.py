#!/usr/bin/env python3
# 把 verdicts.tsv 裡判定為標點的段末，寫成各篇 corrections/ZJH-NNN.tsv 的一列。
# 讀的是 data/processed/reading-drafts，所以要在套用這批之前的建置狀態下跑；
# 跑完再 build-reading-drafts.mjs。已經套進去之後重跑，每一處都會回報「段末已有標點」。
# 段號是 paragraphs 的索引（0 起算）。誤＝段末往前取到篇內唯一的字串，正＝該字串加上原頁圖上讀到的標點，
# 頁＝該字串起處所在的原書頁（與 build-reading-drafts.mjs 的 pageAt 同一個判準）。
import json, os, sys

ROOT = os.path.expanduser('~/Documents/NTU/1142/zhu-jiahua-research-data')
HERE = os.path.dirname(os.path.abspath(__file__))
CORR = os.path.join(ROOT, 'data/materials/speeches/corrections')
DRAFTS = os.path.join(ROOT, 'data/processed/reading-drafts')
MARK = '# 2026-08-24 段末句讀批次，逐處裁原頁圖核過（判讀記錄 engineering/tail-punct-batch/verdicts.tsv）。'
PUNCT = set('。：？！，')

verdicts = {}
for line in open(os.path.join(HERE, 'verdicts.tsv')):
    if line.startswith('#') or not line.strip():
        continue
    key, mark = line.rstrip('\n').split('\t')
    if mark in PUNCT:
        verdicts[key] = mark

def page_at(breaks, para, offset):
    cur = None
    for b in breaks:
        if (b['para'], b['offset']) <= (para, offset):
            cur = b['bookPage']
    return cur

rows, problems = {}, []
for key, mark in sorted(verdicts.items()):
    num, para_no = key.split('-')
    pid = f'ZJH-{num}'
    draft = json.load(open(os.path.join(DRAFTS, f'{pid}.json')))
    paras = draft['paragraphs']
    text = paras[int(para_no)]
    if text[-1] in PUNCT:
        problems.append((key, f'段末已有標點「{text[-1]}」，本輪不重複加'))
        continue
    for n in range(4, min(len(text), 40) + 1):
        wrong = text[-n:]
        if sum(p.count(wrong) for p in paras) == 1:
            break
    else:
        problems.append((key, '取到 40 字仍不唯一'))
        continue
    bp = page_at(draft.get('pageBreaks', []), int(para_no), len(text) - len(wrong))
    if bp is None:
        problems.append((key, '取不到原書頁'))
        continue
    rows.setdefault(pid, []).append((wrong, wrong + mark, bp, f'原書第 {bp} 頁段末即印「{mark}」，GCV 掉了'))

for pid, items in sorted(rows.items()):
    path = os.path.join(CORR, f'{pid}.tsv')
    old = open(path).read() if os.path.exists(path) else ''
    # 同一輪重跑不疊加：先剝掉上一次本批次寫的那一段（標記行連同其後的資料列）。
    if MARK in old:
        kept, dropping = [], False
        for line in old.splitlines(True):
            if line.startswith(MARK):
                dropping = True
                continue
            if dropping and (line.startswith('#') or not line.strip()):
                dropping = False
            if not dropping:
                kept.append(line)
        old = ''.join(kept)
    body = ''.join('\t'.join(map(str, r)) + '\n' for r in items)
    with open(path, 'w') as f:
        f.write(old + ('' if old.endswith('\n') or not old else '\n') + MARK + '\n' + body)
print(f'寫入 {sum(len(v) for v in rows.values())} 列，涉及 {len(rows)} 篇')
for k, why in problems:
    print(f'  未寫入 {k}：{why}')
