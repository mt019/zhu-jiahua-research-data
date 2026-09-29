#!/usr/bin/env node
// 書外文獻的公開快照：把 data/derived 的 sources.json、related_index.json、cases.json
// 併成 data/processed/related-documents.json，前端總覽頁與案頁讀它；讀稿一件一檔另走
// external-drafts/，sync-to-frontend.mjs 按需搬。
//
// 來源只投影書目欄位。權利判定（rights）、取得途徑（access）、掃描參數（digitisation）、
// 收錄日（capturedAt）與來歷（whyHere）是倉內登記，留在 derived；「待站主裁定」這種
// 工作用語不得出現在公開面（validate-related.mjs 驗快照的禁鍵與禁字）。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'))

const sources = read('data/derived/sources.json').sources.map((s) => {
  const out = {}
  for (const k of ['id', 'kind', 'title', 'volume', 'number', 'issue', 'issueNote', 'bookPages',
    'bookPagesRunning', 'pages', 'dateIso', 'dateNote', 'language', 'script',
    'primaryPending', 'primaryPendingNote']) {
    if (k in s) out[k] = s[k]
  }
  return out
})
const related = read('data/derived/related_index.json')
const cases = read('data/derived/cases.json')

// 總覽頁的視圖欄位：件的年份、刊物標籤、作者標籤，案的年代標籤，四個篩選器的選項與計數。
// 這些都算得出來，照前端行數上限的規矩搬進資料層，JSX 只挑著印。
const sourceLabel = (id) => {
  const src = sources.find((s) => s.id === id)
  return src.issue && src.kind !== '期刊附刊' ? `《${src.title}》${src.issue}` : `《${src.title}》`
}
const yearOf = (d) => (d.dateIso ? d.dateIso.slice(0, 4) : null)
const facet = (values, allLabel) => {
  const counts = new Map()
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [{ value: 'all', label: allLabel, hint: String(values.length) },
    ...[...counts].map(([value, count]) => ({ value, label: value, hint: String(count) }))]
}
const docs = related.documents
const view = {
  documents: Object.fromEntries(docs.map((d) => [d.id, {
    year: yearOf(d), sourceLabel: sourceLabel(d.sourceId), authorLabel: d.author ?? '未署名',
  }])),
  cases: Object.fromEntries(cases.cases.map((c) => {
    const from = c.dateFrom ? c.dateFrom.slice(0, 4) : null
    const to = c.dateTo ? c.dateTo.slice(0, 4) : null
    return [c.id, { yearsLabel: !from ? '—' : to && to !== from ? `${from}–${to}` : from }]
  })),
  // 《言論集》篇目反查關連的案（relatedPieces 的反向），篇頁據此連回書外文獻
  casesByPiece: cases.cases.reduce((acc, c) => {
    for (const { id } of c.relatedPieces ?? []) (acc[id] ??= []).push(c.id)
    return acc
  }, {}),
  facets: {
    relation: facet(docs.map((d) => d.relation), '全部關係'),
    year: facet(docs.map(yearOf), '全部年代'),
    source: facet(docs.map((d) => sourceLabel(d.sourceId)), '全部刊物'),
    author: facet(docs.map((d) => d.author ?? '未署名'), '全部作者'),
  },
}

const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  idPrefixes: { source: 'SRC', document: 'ZJR', case: 'ZJC' },
  relations: related.relations,
  sources,
  documents: related.documents,
  cases: cases.cases,
  view,
}
const target = join(root, 'data/processed/related-documents.json')
writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`書外文獻快照：來源 ${sources.length}、文獻 ${related.documents.length}、案 ${cases.cases.length} → data/processed/related-documents.json`)
