#!/usr/bin/env node
// 書外文獻與主題的公開快照：把 data/derived 的 sources.json、related_index.json、subjects.json、
// supplement.json、retired-urls.json 併成 data/processed/related-documents.json。前端的補編、
// 主題頁、書外文獻總覽讀它；讀稿一件一檔另走 external-drafts/，sync-to-frontend.mjs 按需搬。
//
// 來源只投影書目欄位。權利判定（rights）、取得途徑（access）、掃描參數（digitisation）、
// 收錄日（capturedAt）與來歷（whyHere）是倉內登記，留在 derived；「待站主裁定」這種
// 工作用語不得出現在公開面（validate-related.mjs 驗快照的禁鍵與禁字）。
//
// 主題的成員可以是《言論集》書內的篇，篇名、起頁、日期與錨點取公開快照的篇目索引
// （zhu-jiahua-app.json，build-app-toc.mjs 產生），所以本支要排在 build-app-toc.mjs 之後。
//
// 2026-09-29 起沒有「案」：先前的 cases.json 退役，往還與論爭改由主題組織，單件的考述與
// 待核事項移到該件自己。來歷見 engineering/LOG.md 同日條。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dateLabel, UNDATED_BOOK, UNDATED_PRINT } from './lib/date-label.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'))
const fail = (msg) => { console.error(`✗ 書外文獻快照：${msg}`); process.exit(1) }

const sources = read('data/derived/sources.json').sources.map((s) => {
  const out = {}
  for (const k of ['id', 'kind', 'title', 'volume', 'number', 'issue', 'issueNote', 'bookPages',
    'bookPagesRunning', 'pages', 'dateIso', 'dateNote', 'language', 'script',
    'primaryPending', 'primaryPendingNote']) {
    if (k in s) out[k] = s[k]
  }
  if ('dateIso' in out) out.dateLabel = dateLabel(out.dateIso, UNDATED_PRINT)
  return out
})
const related = read('data/derived/related_index.json')
const subjectsFile = read('data/derived/subjects.json')
const supplement = read('data/derived/supplement.json')
const retired = read('data/derived/retired-urls.json')
const tocItems = read('data/processed/zhu-jiahua-app.json').tableOfContents.items
const tocById = new Map(tocItems.map((i) => [i.id, i]))
const docById = new Map(related.documents.map((d) => [d.id, d]))

const sourceLabel = (id) => {
  const src = sources.find((s) => s.id === id)
  return src.issue && src.kind !== '期刊附刊' ? `《${src.title}》${src.issue}` : `《${src.title}》`
}
const yearOf = (d) => (d.dateIso ? d.dateIso.slice(0, 4) : null)

// 主題的成員攤成一列一件：書內篇記部次與起頁，書外件記刊物；前端只組網址、只挑著印。
const memberRow = (id) => {
  if (id.startsWith('ZJH-')) {
    const item = tocById.get(id)
    if (!item) fail(`主題成員 ${id} 不在篇目索引`)
    return { kind: 'book', id, anchor: item.anchor, part: item.part, title: item.title, dateLabel: item.dateLabel,
      dateIso: item.dateIso ?? null, textPath: item.textPath ?? null, where: `《朱家驊先生言論集》${item.part}，原書第 ${item.bookStartPage} 頁` }
  }
  const doc = docById.get(id)
  if (!doc) fail(`主題成員 ${id} 不在書外文獻平表`)
  return { kind: 'supplement', id, anchor: doc.anchor, title: doc.title, author: doc.author ?? null,
    role: doc.role ?? null, dateIso: doc.dateIso ?? null, dateLabel: dateLabel(doc.dateIso, UNDATED_PRINT), where: `補編・${sourceLabel(doc.sourceId)}` }
}
const subjects = subjectsFile.subjects.map((s) => {
  const members = s.members.map(memberRow)
  const years = members.map((m) => m.dateIso?.slice(0, 4)).filter(Boolean).sort()
  const from = years[0]
  const to = years.at(-1)
  const yearsLabel = !from ? '—' : from === to ? from : `${from}–${to}`
  const book = members.filter((m) => m.kind === 'book').length
  // 抬頭與總覽頁印的件數一行，前端只挑著印
  const countsLabel = [book ? `書內 ${book} 篇` : null, members.length - book ? `書外 ${members.length - book} 件` : null].filter(Boolean).join('、')
  return { ...s, members, yearsLabel, countsLabel }
})

const subjectsOf = (id) => subjectsFile.subjects.filter((s) => s.members.includes(id)).map((s) => s.slug)
const documents = related.documents.map((d) => ({ ...d, dateLabel: dateLabel(d.dateIso, UNDATED_PRINT), subjects: subjectsOf(d.id) }))

const facet = (values, allLabel) => {
  const counts = new Map()
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [{ value: 'all', label: allLabel, hint: String(values.length) },
    ...[...counts].map(([value, count]) => ({ value, label: value, hint: String(count) }))]
}
const view = {
  documents: Object.fromEntries(documents.map((d) => [d.id, {
    year: yearOf(d), sourceLabel: sourceLabel(d.sourceId), authorLabel: d.author ?? '未署名',
  }])),
  // 《言論集》篇目反查所屬主題，篇頁據此列出主題
  subjectsByPiece: Object.fromEntries(tocItems.map((i) => [i.id, subjectsOf(i.id)]).filter(([, v]) => v.length)),
  facets: {
    relation: facet(documents.map((d) => d.relation), '全部關係'),
    year: facet(documents.map(yearOf), '全部年代'),
    source: facet(documents.map((d) => sourceLabel(d.sourceId)), '全部刊物'),
    author: facet(documents.map((d) => d.author ?? '未署名'), '全部作者'),
  },
}

const snapshot = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  relations: related.relations,
  sources,
  documents,
  supplement: { order: supplement.order },
  subjects,
  retiredUrls: retired.urls.map(({ from, to }) => ({ from, to })),
  view,
}
const target = join(root, 'data/processed/related-documents.json')
writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`書外文獻快照：來源 ${sources.length}、文獻 ${documents.length}、主題 ${subjects.length}、停用網址 ${retired.urls.length} → data/processed/related-documents.json`)
