#!/usr/bin/env node
// 書外文獻層與主題的固定檢查。對象是 data/derived 的 sources.json、related_index.json、
// subjects.json、supplement.json、retired-urls.json、leads.json 與 data/processed/external-drafts/。
//
// 覆蓋範圍自報：末行印來源、文獻、主題、讀稿四個計數，任一為 0 就 exit 1——
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
const subjectsFile = readJson('data/derived/subjects.json')
const supplementFile = readJson('data/derived/supplement.json')
const retiredFile = readJson('data/derived/retired-urls.json')
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

// 公開錨點：一件一個，形狀是「四位年份-小寫短名」，上線後不改。案（caseId）自 2026-09-29 退役。
const ANCHOR = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/
const anchors = new Set()
for (const d of docs.values()) {
  if ('caseId' in d) fail(`${d.id} 還帶著 caseId；案已退役，改記主題（subjects.json）`)
  if (!ANCHOR.test(d.anchor ?? '')) fail(`${d.id} 的 anchor「${d.anchor}」形狀不對，要「年份-短名」`)
  if (anchors.has(d.anchor)) fail(`anchor 重複：${d.anchor}`)
  anchors.add(d.anchor)
  if (d.openQuestions && !Array.isArray(d.openQuestions)) fail(`${d.id} 的 openQuestions 要是陣列`)
}

// 補編的排列：每件剛好一次，不多不少。
{
  const order = supplementFile.order
  if (new Set(order).size !== order.length) fail('supplement.json 的 order 有重複')
  const missing = [...docs.keys()].filter((id) => !order.includes(id))
  const extra = order.filter((id) => !docs.has(id))
  if (missing.length || extra.length) fail(`supplement.json 的 order 與平表對不上：缺 ${missing.join('、') || '無'}，多 ${extra.join('、') || '無'}`)
}

// 主題：slug 公開且不改；成員是書內篇或書外件，存在、不重複，每題至少兩件。
const tocIds = new Set(tocIndex.items.map((i) => i.id))
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const subjects = new Map()
for (const s of subjectsFile.subjects) {
  if (!SLUG.test(s.slug)) fail(`主題 slug「${s.slug}」形狀不對`)
  if (subjects.has(s.slug)) fail(`主題 slug 重複：${s.slug}`)
  subjects.set(s.slug, s)
  for (const k of ['name', 'scope', 'account']) if (!s[k]) fail(`主題 ${s.slug} 缺 ${k}`)
  for (const k of ['title', 'description', 'keywords']) if (!s.seo?.[k]) fail(`主題 ${s.slug} 的 seo 缺 ${k}`)
  if (new Set(s.members).size !== s.members.length) fail(`主題 ${s.slug} 的成員有重複`)
  if (s.members.length < 2) fail(`主題 ${s.slug} 只有 ${s.members.length} 件；一件成不了主題，考述寫在該件自己`)
  for (const id of s.members) {
    if (!(tocIds.has(id) || docs.has(id))) fail(`主題 ${s.slug} 的成員 ${id} 不在篇目索引也不在書外文獻平表`)
  }
}

// 停用網址：落點要是現行的主題頁或補編裡的錨點；停用的網址不得與現行網址相撞。
for (const { from, to } of retiredFile.urls) {
  if (!from.startsWith('/zhujiahua/')) fail(`停用網址 ${from} 不在 /zhujiahua/ 底下`)
  const subj = to.match(/^\/zhujiahua\/subject\/([^/#]+)$/)
  const sup = to.match(/^\/zhujiahua\/part\/supplement#(.+)$/)
  if (subj ? !subjects.has(subj[1]) : sup ? !anchors.has(sup[1]) : true) fail(`停用網址 ${from} 的落點 ${to} 不存在`)
  const live = from.match(/^\/zhujiahua\/subject\/([^/#]+)$/)
  if (live && subjects.has(live[1])) fail(`停用網址 ${from} 與現行主題頁相撞`)
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
  // 正文不出自本倉辨讀的（手寫件走轉錄檔那條路），要指得出它抄自哪裡。
  // 本倉逐字校過的件（segmentation.json 宣告 review）另要校訂日期與字形政策，字形政策是封閉集合。
  if (d.status === '人工逐字校訂') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.verifiedAt ?? '')) fail(`${d.id} 是人工逐字校訂而沒有 verifiedAt`)
    if (!['原書字形', '通用字形'].includes(d.glyphPolicy)) fail(`${d.id} 的 glyphPolicy「${d.glyphPolicy}」不在原書字形／通用字形之列`)
  } else if (d.status !== '未校辨讀稿' && !d.transcriptSource) fail(`${d.id} 的讀稿狀態是「${d.status}」而沒有 transcriptSource`)
  if (d.transcriptSource && !/^https?:\/\//.test(d.transcriptSource)) fail(`${d.id} 的 transcriptSource 不是網址：${d.transcriptSource}`)
  // 頁界落在段落範圍內，原刊頁落在平表宣告的頁範圍內。
  const [pLo, pHi] = String(rel.sourcePages).split('-').map(Number)
  for (const b of d.pageBreaks) {
    if (!(b.para >= 0 && b.para < d.paragraphs.length)) fail(`${d.id} 的頁界指到不存在的第 ${b.para} 段`)
    if (!(b.offset >= 0 && b.offset <= d.paragraphs[b.para].length)) fail(`${d.id} 的頁界位移超出段落`)
    if (!(b.sourcePage >= pLo && b.sourcePage <= (pHi ?? pLo))) fail(`${d.id} 的頁界在原刊頁 ${b.sourcePage}，平表宣告的是 ${rel.sourcePages}`)
  }
  // 節標：para 指得到、text 與那一段整段相同、level 在 1–4。前端拿它渲染標題與章節樹，
  // 指錯一段就是把正文當標題印。
  for (const h of d.headings ?? []) {
    if (!(Number.isInteger(h.para) && h.para >= 0 && h.para < d.paragraphs.length)) fail(`${d.id} 的節標指到不存在的第 ${h.para} 段`)
    if (d.paragraphs[h.para] !== h.text) fail(`${d.id} 第 ${h.para} 段與節標宣告不同：「${h.text}」`)
    if (![1, 2, 3, 4].includes(h.level)) fail(`${d.id} 節標「${h.text}」的 level ${h.level} 不在 1–4`)
    if (!Number.isInteger(h.sourcePage)) fail(`${d.id} 節標「${h.text}」沒有 sourcePage`)
    if (h.anchor !== `${docs.get(d.id).anchor}-h${h.para}` || h.tree?.id !== h.anchor) fail(`${d.id} 節標「${h.text}」的 anchor 與 tree.id 不是 <該件錨點>-h<para>`)
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
for (const s of subjects.values()) {
  for (const k of ['scope', 'account']) push(`subjects.json:${s.slug}:${k}`, s[k], 'prose')
  push(`subjects.json:${s.slug}:seo.description`, s.seo.description, 'prose')
  ;(s.openQuestions ?? []).forEach((q, i) => push(`subjects.json:${s.slug}:openQuestions[${i}]`, q, 'prose'))
}
for (const d of docs.values()) {
  for (const k of ['titleNote', 'authorNote', 'translatorNote', 'dateNote', 'account']) push(`related_index.json:${d.id}:${k}`, d[k], 'prose')
  ;(d.openQuestions ?? []).forEach((q, i) => push(`related_index.json:${d.id}:openQuestions[${i}]`, q, 'prose'))
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
  const headingParas = new Map(drafts.map((d) => [`external-drafts/${d.id}.json`, new Set((d.headings ?? []).map((h) => h.para))]))
  for (const r of results) {
    for (const f of r.findings) {
      if (f.severity === '擋') fail(`${r.path} 第 ${f.paragraph} 段是辨讀稿殘留（${f.rule}）：「${f.sample}」`)
      // 宣告過的節標本來就沒有句讀，不列待核；別的規則照列。
      if (f.rule === '段末無句讀' && headingParas.get(r.path)?.has(f.paragraph)) continue
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
  same(snap.documents.map(({ subjects: _s, ...d }) => d), relatedFile.documents, 'documents')
  same(snap.subjects.map((s) => [s.slug, s.members.map((m) => m.id)]), subjectsFile.subjects.map((s) => [s.slug, s.members]), '主題與成員')
  same(snap.supplement.order, supplementFile.order, '補編排列')
  same(snap.retiredUrls, retiredFile.urls.map(({ from, to }) => ({ from, to })), '停用網址')
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
  const users = [...docs.values()].filter((d) => d.sourceId === s.id).map((d) => d.id)
  console.log(`  一手原件掛帳：${s.id}（${s.title}${s.issue ? '・' + s.issue : ''}）${users.length ? '，引用它的文獻：' + users.join('、') : ''}`)
}

if ([sources.size, docs.size, subjects.size, drafts.length].some((n) => n === 0)) fail('來源、文獻、主題、讀稿有一類是 0——檢查沒有看到東西')
// ---- 印到前端的文句不帶工程編號與工程用語 ----
// 同步出去的三類產物裡，凡含漢字的字串都是讀者讀得到的文句；純編號、網址、欄位值不含漢字，不在此列。
// 2026-09-29 站主點名案頁考述裡的「ZJH-080〈教師節之感言〉」，同批另有「本倉所據」兩處。
const FRONT_ID = /(?:ZJ[HRC]|SRC|LEAD)-[\w-]+/
// 「辨讀稿」「校訂表」是凡例向讀者解說過的用語，不在此列。
// 辨讀引擎的名字照轉錄體例也不該進前端，但目前由四支建置腳本寫進讀稿與年表的凡例，待另一輪改完再收進這張表。
const FRONT_WORDS = ['本倉', '快照', '資料層', '前端']
const HAN = /[一-鿿]/
const frontFiles = ['data/processed/related-documents.json', 'data/processed/chronology.json',
  ...draftFiles.map((f) => `data/processed/external-drafts/${f}`)]
const frontHits = []
const scanFront = (v, file, path) => {
  if (typeof v === 'string') {
    if (!HAN.test(v)) return
    const id = v.match(FRONT_ID)?.[0]
    const word = FRONT_WORDS.find((w) => v.includes(w))
    if (id || word) frontHits.push(`${file} ${path}：「${id ?? word}」`)
  } else if (Array.isArray(v)) v.forEach((x, i) => scanFront(x, file, `${path}[${i}]`))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scanFront(x, file, `${path}.${k}`)
}
for (const rel of frontFiles) {
  const p = join(root, rel)
  if (existsSync(p)) scanFront(JSON.parse(readFileSync(p, 'utf8')), rel, '$')
}
if (frontHits.length) fail(`印到前端的文句帶工程編號或工程用語 ${frontHits.length} 處：\n  ${frontHits.slice(0, 20).join('\n  ')}`)

console.log(`書外文獻檢查通過：來源 ${sources.size}（掛帳 ${pending.length}）、文獻 ${docs.size}、主題 ${subjects.size}、讀稿 ${drafts.length}。`)

// ---- 負向測試：把資料樹複製出去、各壞一處，逐個要求本檢查以非零狀態結束 ----
if (rootAt < 0) {
  const mutations = [
    ['relation 不在封閉集合', (t) => edit(t, 'data/derived/related_index.json', (j) => { j.documents[0].relation = '路過' })],
    ['補編漏排一件', (t) => edit(t, 'data/derived/supplement.json', (j) => { j.order.pop() })],
    ['主題只剩一件', (t) => edit(t, 'data/derived/subjects.json', (j) => { j.subjects[0].members = j.subjects[0].members.slice(0, 1) })],
    ['主題成員不存在', (t) => edit(t, 'data/derived/subjects.json', (j) => { j.subjects[0].members.push('ZJH-999') })],
    ['錨點重複', (t) => edit(t, 'data/derived/related_index.json', (j) => { j.documents[1].anchor = j.documents[0].anchor })],
    ['停用網址落點不存在', (t) => edit(t, 'data/derived/retired-urls.json', (j) => { j.urls[0].to = '/zhujiahua/subject/nonesuch' })],
    ['文獻還帶 caseId', (t) => edit(t, 'data/derived/related_index.json', (j) => { j.documents[0].caseId = 'ZJC-01' })],
    ['sourceId 指向不存在的來源', (t) => edit(t, 'data/derived/related_index.json', (j) => { j.documents[0].sourceId = 'SRC-nonesuch' })],
    ['側記號切片不符', (t) => edit(t, 'data/processed/external-drafts/ZJR-005.json', (j) => { j.sideMarks[0].text = '壞' })],
    ['節標宣告與段落不符', (t) => edit(t, 'data/processed/external-drafts/ZJR-009.json', (j) => { j.headings[0].text = '壞' })],
    ['多出未登記的讀稿', (t) => writeFileSync(join(t, 'data/processed/external-drafts/ZJR-999.json'), '{"id":"ZJR-999"}')],
    ['rights.status 非法值', (t) => edit(t, 'data/derived/sources.json', (j) => { j.sources[0].rights.status = 'open' })],
    ['工程編號進考述', (t) => edit(t, 'data/processed/related-documents.json', (j) => { j.subjects[0].account += '見 ZJH-080。' })],
    ['工程用語進待核事項', (t) => edit(t, 'data/processed/related-documents.json', (j) => { j.subjects[0].openQuestions.push('本倉所據是另一本。') })],
    ['查核紀錄用語進讀稿', (t) => edit(t, 'data/processed/external-drafts/ZJR-001.json', (j) => { j.statusNote += '列為未確認。' })],
    ['related_index 不在', (t) => renameSync(join(t, 'data/derived/related_index.json'), join(t, 'data/derived/related_index.json.away'))],
    ['快照與 derived 不同步', (t) => edit(t, 'data/processed/related-documents.json', (j) => { j.documents.pop() })],
    ['工作用語進快照', (t) => edit(t, 'data/processed/related-documents.json', (j) => { j.subjects[0].account += '待站主裁定。' })],
    ['他館翻刻的讀稿沒有出處', (t) => edit(t, 'data/processed/external-drafts/ZJR-008.json', (j) => { delete j.transcriptSource })],
    ['轉錄出處不是網址', (t) => edit(t, 'data/processed/external-drafts/ZJR-008.json', (j) => { j.transcriptSource = 'JACAR' })],
    ['校訂稿沒有校訂日期', (t) => edit(t, 'data/processed/external-drafts/ZJR-001.json', (j) => { j.status = '人工逐字校訂'; j.glyphPolicy = '原書字形' })],
    ['校訂稿的字形政策非法', (t) => edit(t, 'data/processed/external-drafts/ZJR-001.json', (j) => { j.status = '人工逐字校訂'; j.verifiedAt = '2026-09-29'; j.glyphPolicy = '隨便' })],
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
    // stdin 明確給 ignore：這支負向測試起的副本自己還會再起共用層的 ocr_check.py，
    // 孫行程繼承呼叫端的 stdio 時會停在讀 stdin 上（2026-09-21 實測，整條鏈不動而 CPU 用量是零）。
    const run = spawnSync(process.execPath, [selfPath, '--root', t], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    rmSync(t, { recursive: true, force: true })
    if (run.status === 0) fail(`負向測試「${name}」沒有被抓到`)
    passed += 1
  }
  console.log(`負向測試 ${passed} 項全部照預期失敗。`)
}
