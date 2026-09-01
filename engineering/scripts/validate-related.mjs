#!/usr/bin/env node
// 書外文獻層的固定檢查。對象是 data/derived 的 sources.json、related_index.json、
// cases.json、leads.json 與 data/processed/external-drafts/。
//
// 覆蓋範圍自報：末行印來源、文獻、案、讀稿四個計數，任一為 0 就 exit 1——
// 一個對象都沒看到的檢查與沒有檢查等價（writing-ops-gates）。
// 掛帳（primaryPending）與待查線索每次執行都逐條列出，不是只在出錯時。
//
// --root <dir>：改讀另一棵資料樹（負向測試用；帶 --root 時不再自跑負向測試）。

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkTexts } from '@phenomcanvas/prose-rules'
import { checkDrafts } from '@phenomcanvas/prose-rules/ocr'

const selfPath = fileURLToPath(import.meta.url)
const rootAt = process.argv.indexOf('--root')
const root = rootAt >= 0 ? process.argv[rootAt + 1] : join(dirname(selfPath), '../..')
const fail = (msg) => { console.error(`✗ 書外文獻檢查：${msg}`); process.exit(1) }
const readJson = (rel) => {
  const p = join(root, rel)
  if (!existsSync(p)) fail(`找不到 ${rel}`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

const sourcesFile = readJson('data/derived/sources.json')
const relatedFile = readJson('data/derived/related_index.json')
const casesFile = readJson('data/derived/cases.json')
const leadsFile = readJson('data/derived/leads.json')
const tocIndex = readJson('data/derived/toc_index.json')

const sources = new Map()
for (const s of sourcesFile.sources) {
  if (!/^SRC-[a-z0-9-]+$/.test(s.id)) fail(`來源 id 形狀不對：${s.id}`)
  if (sources.has(s.id)) fail(`來源 id 重複：${s.id}`)
  if (!['pending', 'cleared', 'restricted'].includes(s.rights?.status)) fail(`${s.id} 的 rights.status「${s.rights?.status}」不在 pending／cleared／restricted 之列`)
  sources.set(s.id, s)
}

const relations = new Set(relatedFile.relations)
const docs = new Map()
for (const d of relatedFile.documents) {
  if (!/^ZJR-\d{3}$/.test(d.id)) fail(`文獻 id 形狀不對：${d.id}`)
  if (docs.has(d.id)) fail(`文獻 id 重複：${d.id}`)
  if (!relations.has(d.relation)) fail(`${d.id} 的 relation「${d.relation}」不在封閉集合 ${[...relations].join('、')}`)
  if (!sources.has(d.sourceId)) fail(`${d.id} 指向不存在的來源 ${d.sourceId}`)
  if (!Number.isInteger(d.seqInSource) || d.seqInSource < 1) fail(`${d.id} 的 seqInSource 要是正整數`)
  if ('author' in d && d.author === null && !d.authorNote) fail(`${d.id} 的 author 是 null 而沒有 authorNote 交代`)
  docs.set(d.id, d)
}
for (const [srcId] of sources) {
  const seqs = [...docs.values()].filter((d) => d.sourceId === srcId).map((d) => d.seqInSource)
  if (new Set(seqs).size !== seqs.length) fail(`${srcId} 之下的 seqInSource 有重複`)
}

// 案與平表的雙向對帳：cases 的 documents 是權威，related_index 的 caseId 是投影。
const tocIds = new Set(tocIndex.items.map((i) => i.id))
const cases = new Map()
for (const c of casesFile.cases) {
  if (cases.has(c.id)) fail(`案 id 重複：${c.id}`)
  cases.set(c.id, c)
  for (const sid of c.sourceIds ?? []) if (!sources.has(sid)) fail(`${c.id} 指向不存在的來源 ${sid}`)
  for (const entry of c.documents) {
    const d = docs.get(entry.docId)
    if (!d) fail(`${c.id} 收著不存在的文獻 ${entry.docId}`)
    if (d.caseId !== c.id) fail(`${c.id} 收著 ${entry.docId}，而它的 caseId 是 ${d.caseId}——兩邊對不上`)
  }
  for (const rp of c.relatedPieces ?? []) {
    if (!tocIds.has(rp.id)) fail(`${c.id} 的 relatedPieces 指向不存在的篇 ${rp.id}`)
  }
}
for (const d of docs.values()) {
  if (!d.caseId) continue
  const c = cases.get(d.caseId)
  if (!c) fail(`${d.id} 指向不存在的案 ${d.caseId}`)
  if (!c.documents.some((e) => e.docId === d.id)) fail(`${d.id} 記著 ${d.caseId}，該案的 documents 沒有它——投影缺角`)
}

// 讀稿的檔案集合要與平表一致：來源已在手的每一件都要有讀稿，多出來的檔也不放行。
const draftsDir = join(root, 'data/processed/external-drafts')
const expected = new Set([...docs.values()].filter((d) => !sources.get(d.sourceId).primaryPending).map((d) => d.id))
const draftFiles = existsSync(draftsDir) ? readdirSync(draftsDir).filter((f) => f.endsWith('.json')) : []
for (const f of draftFiles) {
  const id = f.replace(/\.json$/, '')
  if (!expected.has(id)) fail(`external-drafts/${f} 不在平表裡，或它的來源是掛帳的`)
}
for (const id of expected) {
  if (!draftFiles.includes(`${id}.json`)) fail(`${id} 的讀稿沒有產出（build-external-drafts.mjs）`)
}

const BANNED_KEYS = ['localPath', 'sha256', 'bytes']
const BANNED_WORDS = ['本輪', '列為未確認', '證據等級']
const drafts = []
for (const f of draftFiles) {
  const raw = readFileSync(join(draftsDir, f), 'utf8')
  const d = JSON.parse(raw)
  drafts.push(d)
  if (`${d.id}.json` !== f) fail(`${f} 裡的 id 是 ${d.id}`)
  const rel = docs.get(d.id)
  if (d.sourceId !== rel.sourceId) fail(`${d.id} 的 sourceId 與平表不同`)
  if (!Array.isArray(d.paragraphs) || d.paragraphs.length === 0) fail(`${d.id} 沒有段落`)
  const text = d.paragraphs.join('\n')
  if (d.charCount !== text.replace(/\s/g, '').length) fail(`${d.id} 的 charCount 與正文對不上`)
  if (d.textVersion !== createHash('sha256').update(text).digest('hex').slice(0, 12)) fail(`${d.id} 的 textVersion 與正文對不上`)
  if (d.manualCorrections !== (d.corrections?.length ?? 0)) fail(`${d.id} 的 manualCorrections 與 corrections 筆數不同`)
  // 頁界落在段落範圍內，原刊頁落在平表宣告的頁範圍內。
  const [pLo, pHi] = String(rel.sourcePages).split('-').map(Number)
  for (const b of d.pageBreaks) {
    if (!(b.para >= 0 && b.para < d.paragraphs.length)) fail(`${d.id} 的頁界指到不存在的第 ${b.para} 段`)
    if (!(b.offset >= 0 && b.offset <= d.paragraphs[b.para].length)) fail(`${d.id} 的頁界位移超出段落`)
    if (!(b.sourcePage >= pLo && b.sourcePage <= (pHi ?? pLo))) fail(`${d.id} 的頁界在原刊頁 ${b.sourcePage}，平表宣告的是 ${rel.sourcePages}`)
  }
  for (const m of d.sideMarks ?? []) {
    if (!['專名號', '書名號'].includes(m.kind)) fail(`${d.id} 側記號種類「${m.kind}」不在封閉集合`)
    if (d.paragraphs[m.para]?.slice(m.from, m.to) !== m.text) fail(`${d.id} 第 ${m.para} 段側記號切片與 text 不符：「${m.text}」`)
  }
  for (const key of BANNED_KEYS) if (raw.includes(`"${key}"`)) fail(`${d.id} 帶著不進公開面的鍵 ${key}`)
  for (const w of BANNED_WORDS) if (raw.includes(w)) fail(`${d.id} 的欄位裡有查核紀錄用語「${w}」，那是工程文件的字`)
}

// 散文欄位過共用文風層；讀者看得到的欄位算正文，倉內登記的來歷與線索算工程文件。
const proseFiles = []
const push = (path, text, kind) => { if (text) proseFiles.push({ path, text, kind }) }
for (const c of cases.values()) {
  push(`cases.json:${c.id}:account`, c.account, 'prose')
  ;(c.openQuestions ?? []).forEach((q, i) => push(`cases.json:${c.id}:openQuestions[${i}]`, q, 'prose'))
}
for (const d of docs.values()) {
  for (const k of ['titleNote', 'authorNote', 'translatorNote', 'dateNote']) push(`related_index.json:${d.id}:${k}`, d[k], 'prose')
}
for (const s of sources.values()) {
  for (const k of ['whyHere', 'issueNote', 'dateNote', 'primaryPendingNote']) push(`sources.json:${s.id}:${k}`, s[k], 'engineering')
}
for (const d of drafts) {
  push(`external-drafts/${d.id}:statusNote`, d.statusNote, 'prose')
  push(`external-drafts/${d.id}:sideMarksNote`, d.sideMarksNote, 'prose')
}
for (const l of leadsFile.leads) {
  for (const k of ['what', 'why', 'nextStep', 'found']) push(`leads.json:${l.id}:${k}`, l[k], 'engineering')
}
{
  const { results } = checkTexts(proseFiles)
  const bad = results.filter((r) => r.findings.length)
  if (bad.length) fail(`散文欄位有文風命中：\n${bad.map((r) => `  ${r.path}：${r.findings.join('；')}`).join('\n')}`)
}

// 讀稿過共用辨讀稿層：嚴重度「擋」的當場中止，「待核」列出來。
{
  const { results } = checkDrafts(drafts.map((d) => ({ path: `external-drafts/${d.id}.json`, paragraphs: d.paragraphs })))
  for (const r of results) {
    for (const f of r.findings) {
      if (f.severity === '擋') fail(`${r.path} 第 ${f.paragraph} 段是辨讀稿殘留（${f.rule}）：「${f.sample}」`)
      console.log(`  待核：${r.path} 第 ${f.paragraph} 段（${f.rule}）「${f.sample}」`)
    }
  }
}

// 公開快照與 derived 對帳，並掃不進公開面的鍵與字。
{
  const snapPath = join(root, 'data/processed/related-documents.json')
  if (!existsSync(snapPath)) fail('data/processed/related-documents.json 不在——先跑 build-related.mjs')
  const raw = readFileSync(snapPath, 'utf8')
  const snap = JSON.parse(raw)
  for (const key of [...BANNED_KEYS, 'access', 'capturedAt', 'rights', 'whyHere']) {
    if (raw.includes(`"${key}"`)) fail(`公開快照帶著倉內登記的鍵 ${key}`)
  }
  for (const w of [...BANNED_WORDS, '待站主裁定']) if (raw.includes(w)) fail(`公開快照裡有工作用語「${w}」`)
  const same = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`快照的 ${what} 與 derived 不一致——重跑 build-related.mjs`) }
  same(snap.documents, relatedFile.documents, 'documents')
  same(snap.cases, casesFile.cases, 'cases')
  same(snap.sources.map((s) => s.id), sourcesFile.sources.map((s) => s.id), '來源 id 序列')
}

// 線索與掛帳，每次執行都列。
const leadStatuses = new Set(leadsFile.statuses)
const openLeads = []
for (const l of leadsFile.leads) {
  if (!leadStatuses.has(l.status)) fail(`${l.id} 的 status「${l.status}」不在 ${leadsFile.statuses.join('、')}`)
  if (['待查', '部分查得'].includes(l.status)) openLeads.push(l)
}
for (const l of openLeads) console.log(`  線索${l.status}：${l.id}　${l.what.slice(0, 40)}⋯`)
console.log(`線索待查 ${openLeads.length} 條。`)
const pending = [...sources.values()].filter((s) => s.primaryPending)
for (const s of pending) {
  const users = [...cases.values()].filter((c) => (c.sourceIds ?? []).includes(s.id)).map((c) => c.id)
  console.log(`  一手原件掛帳：${s.id}（${s.title}${s.issue ? '・' + s.issue : ''}）${users.length ? '，引用它的案：' + users.join('、') : ''}`)
}

if ([sources.size, docs.size, cases.size, drafts.length].some((n) => n === 0)) fail('來源、文獻、案、讀稿有一類是 0——檢查沒有看到東西')
console.log(`書外文獻檢查通過：來源 ${sources.size}（掛帳 ${pending.length}）、文獻 ${docs.size}、案 ${cases.size}、讀稿 ${drafts.length}。`)

// ---- 負向測試：把資料樹複製出去、各壞一處，逐個要求本檢查以非零狀態結束 ----
if (rootAt < 0) {
  const mutations = [
    ['relation 不在封閉集合', (t) => edit(t, 'data/derived/related_index.json', (j) => { j.documents[0].relation = '路過' })],
    ['案的投影缺角', (t) => edit(t, 'data/derived/cases.json', (j) => { j.cases[0].documents.pop() })],
    ['sourceId 指向不存在的來源', (t) => edit(t, 'data/derived/related_index.json', (j) => { j.documents[0].sourceId = 'SRC-nonesuch' })],
    ['側記號切片不符', (t) => edit(t, 'data/processed/external-drafts/ZJR-005.json', (j) => { j.sideMarks[0].text = '壞' })],
    ['多出未登記的讀稿', (t) => writeFileSync(join(t, 'data/processed/external-drafts/ZJR-999.json'), '{"id":"ZJR-999"}')],
    ['rights.status 非法值', (t) => edit(t, 'data/derived/sources.json', (j) => { j.sources[0].rights.status = 'open' })],
    ['查核紀錄用語進讀稿', (t) => edit(t, 'data/processed/external-drafts/ZJR-001.json', (j) => { j.statusNote += '列為未確認。' })],
    ['related_index 不在', (t) => renameSync(join(t, 'data/derived/related_index.json'), join(t, 'data/derived/related_index.json.away'))],
    ['快照與 derived 不同步', (t) => edit(t, 'data/processed/related-documents.json', (j) => { j.documents.pop() })],
    ['工作用語進快照', (t) => edit(t, 'data/processed/related-documents.json', (j) => { j.cases[0].account += '待站主裁定。' })],
  ]
  const edit = (t, rel, mutate) => {
    const p = join(t, rel)
    const j = JSON.parse(readFileSync(p, 'utf8'))
    mutate(j)
    writeFileSync(p, JSON.stringify(j))
  }
  let passed = 0
  for (const [name, mutate] of mutations) {
    const t = mkdtempSync(join(tmpdir(), 'zjr-fixture-'))
    for (const rel of ['data/derived', 'data/processed/external-drafts', 'data/processed/related-documents.json']) {
      cpSync(join(root, rel), join(t, rel), { recursive: true })
    }
    mutate(t)
    const run = spawnSync(process.execPath, [selfPath, '--root', t], { encoding: 'utf8' })
    rmSync(t, { recursive: true, force: true })
    if (run.status === 0) fail(`負向測試「${name}」沒有被抓到`)
    passed += 1
  }
  console.log(`負向測試 ${passed} 項全部照預期失敗。`)
}
