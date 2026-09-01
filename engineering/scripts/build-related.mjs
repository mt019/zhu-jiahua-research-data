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

const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  idPrefixes: { source: 'SRC', document: 'ZJR', case: 'ZJC' },
  relations: related.relations,
  sources,
  documents: related.documents,
  cases: cases.cases,
}
const target = join(root, 'data/processed/related-documents.json')
writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`書外文獻快照：來源 ${sources.length}、文獻 ${related.documents.length}、案 ${cases.cases.length} → data/processed/related-documents.json`)
