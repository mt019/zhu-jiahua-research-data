#!/usr/bin/env node
// 產 data/processed/search-corpus.json：全文檢索的語料，四類材料收在同一份。
//
// 檢索在瀏覽器端做，這一份就是它讀的全部。約六十萬字，一個關鍵詞線性掃一遍是毫秒級，
// 所以不建倒排索引也不引檢索庫——索引庫要多一份依賴、多一套建置期產物，而它省下的
// 時間在這個量級量不出來。
//
// 收錄用自動發現：目錄底下符合形狀的檔就收，不寫死編號清單。新增一篇讀稿、新增一件
// 書外文獻，下一次執行自動進語料，不必回頭改這支腳本。
//
// 字形：正文照母本的原書字形寫進語料，這裡不做任何轉換（~/.claude/rules/轉錄體例.md
// 「正規化由讀取端各自執行」）。異體字對照表烤進 JSON 的 variants 欄，前端載入語料時
// 自己展開——前端因此不必去讀 ~/.claude 底下的東西。對照表每一組都是單一字元對單一
// 字元，所以正規化是等長的逐字映射，命中位置在兩個通道上是同一個座標。
//
// buildSearchCorpus() 供 validate-processed.mjs import：驗證器重建一份與磁碟上的比對，
// 判準因此只有這一份，不在兩處各寫一遍（母本改了而語料沒重產，那裡會報）。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dateLabel, UNDATED_BOOK, UNDATED_PRINT } from './lib/date-label.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DRAFT_DIR = `${ROOT}data/processed/reading-drafts`
const EXTERNAL_DIR = `${ROOT}data/processed/external-drafts`
const TRANSCRIPTION_DIR = `${ROOT}data/derived/transcriptions`
const APP = `${ROOT}data/processed/zhu-jiahua-app.json`
const CHRONOLOGY = `${ROOT}data/processed/chronology.json`
const RELATED = `${ROOT}data/processed/related-documents.json`
const VARIANTS = `${process.env.HOME}/.claude/skills/cjk-print-ocr/variants.tsv`
export const OUT = `${ROOT}data/processed/search-corpus.json`

// 語料的五種材料。驗證器照這張表獨立數一次各自來源的實數。
export const TYPES = ['verified', 'draft', 'front-matter', 'chronology', 'external']

// 校訂的四種狀態。語料只記代碼，讀者看到的那句話由前端給——母本的狀態欄寫著辨讀引擎的
// 名字（年譜是「Google Cloud Vision 未校辨讀稿」），那是維護的紀錄，不上前端。
export const REVIEWS = ['verified', 'reviewed', 'gcv', 'mixed']

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const body = (paragraphs) => paragraphs.map((p) => p.trim()).filter(Boolean).join('\n')

export function buildSearchCorpus() {
  // ── 異體字對照 ──────────────────────────────────────────────────────────
  // 第一欄是正規化的落點，其餘各欄折到它。表以外的組不轉。
  const variants = {}
  for (const line of readFileSync(VARIANTS, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [canon, ...rest] = line.trim().split(/\s+/)
    for (const form of [canon, ...rest]) {
      if ([...form].length !== 1) {
        throw new Error(`variants.tsv 有一組不是單一字元：「${form}」。等長逐字映射是命中位置能共用座標的前提`)
      }
    }
    for (const form of rest) variants[form] = canon
  }
  if (!Object.keys(variants).length) throw new Error(`${VARIANTS} 讀不到任何一組異體字`)

  const app = readJson(APP)
  const tocById = Object.fromEntries(app.tableOfContents.items.map((item) => [item.id, item]))
  const frontById = Object.fromEntries(
    app.tableOfContents.frontMatter.filter((entry) => entry.id).map((entry) => [entry.id, entry]),
  )
  const draftIndex = readJson(`${DRAFT_DIR}/index.json`)
  const reviewedDrafts = new Set(draftIndex.items.filter((item) => item.reviewed).map((item) => item.id))

  const records = []

  // 校訂稿。frontmatter 的 book_pages 起頁對回全書篇目——校訂全文自己的編號（ZJH-LE-001）
  // 與篇目編號（ZJH-074）在法律教育六篇上不同號，而兩邊都沒有記對方的編號，起頁是唯一
  // 對得起來的欄位。對不上就停，別猜一個看起來合理的。
  const withTextPath = app.tableOfContents.items.filter((item) => item.textPath)
  const tocByStartPage = new Map(withTextPath.map((item) => [item.bookStartPage, item]))
  const supersededTocIds = new Set()
  for (const file of readdirSync(TRANSCRIPTION_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const raw = readFileSync(`${TRANSCRIPTION_DIR}/${file}`, 'utf8')
    const matched = raw.match(/^---\n([\s\S]*?)\n---\n/)
    if (!matched) throw new Error(`${file}：缺 frontmatter`)
    const meta = {}
    for (const line of matched[1].split('\n')) {
      const at = line.indexOf(':')
      if (at < 0 || /^\s/.test(line)) continue
      meta[line.slice(0, at)] = line.slice(at + 1).trim()
    }
    const pages = JSON.parse(meta.book_pages)
    const toc = tocByStartPage.get(pages[0])
    if (!toc) throw new Error(`${file}：起頁 ${pages[0]} 在全書篇目裡找不到帶 textPath 的篇`)
    supersededTocIds.add(toc.id)
    // 正文：去掉 frontmatter 與標題行；校訂記錄一節（正文之後的 --- 之下）不進語料。
    const lines = raw.slice(matched[0].length).split('\n---\n')[0].split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines[0].startsWith('# ')) throw new Error(`${file}：正文第一行不是標題`)
    lines.shift()
    records.push({
      id: meta.id,
      tocId: toc.id,
      type: 'verified',
      review: 'verified',
      title: meta.title,
      part: toc.part,
      dateOriginal: meta.date_original ?? null,
      dateIso: meta.date_iso ?? null,
      dateLabel: dateLabel(meta.date_iso, UNDATED_BOOK),
      bookPages: pages.length === 1 ? String(pages[0]) : `${pages[0]}–${pages[pages.length - 1]}`,
      text: body(lines),
    })
  }
  if (supersededTocIds.size !== withTextPath.length) {
    throw new Error(`帶 textPath 的篇目 ${withTextPath.length} 筆，對得上校訂稿的只有 ${supersededTocIds.size} 筆`)
  }

  // 讀稿。已有校訂稿的那幾篇（法律教育六篇與 ZJH-001）只收校訂那一份，語料不放兩份正文。
  // 卷首的獻詞與緣起也在這個目錄裡，它們不在全書篇目而在 frontMatter，連結的去處不同。
  for (const file of readdirSync(DRAFT_DIR).filter((f) => /^ZJH-.*\.json$/.test(f)).sort()) {
    const draft = readJson(`${DRAFT_DIR}/${file}`)
    if (supersededTocIds.has(draft.id)) continue
    const toc = tocById[draft.id]
    const front = frontById[draft.id]
    if (!toc && !front) throw new Error(`${file}：既不在全書篇目也不在卷首，不知道它該連到哪裡`)
    records.push({
      id: draft.id,
      type: front ? 'front-matter' : 'draft',
      review: reviewedDrafts.has(draft.id) ? 'reviewed' : 'gcv',
      title: draft.title ?? front.title,
      part: toc?.part ?? '卷首',
      dateOriginal: draft.dateOriginal ?? null,
      dateIso: toc?.dateIso ?? null,
      dateLabel: dateLabel(toc?.dateIso, UNDATED_BOOK),
      bookPages: draft.bookPages ?? front?.bookPages ?? null,
      text: body(draft.paragraphs),
    })
  }

  // 年譜。一年一筆。
  for (const year of readJson(CHRONOLOGY).years) {
    if (!year.text) throw new Error(`年譜 ${year.ce} 沒有正文`)
    records.push({
      id: `year-${year.ce}`,
      type: 'chronology',
      review: year.text.transcriptionStatus,
      title: `${year.ce}　${year.rocLabel}`,
      ce: year.ce,
      bookPages: String(year.bookPage),
      text: body(year.text.paragraphs),
    })
  }

  // 書外文獻。讀稿只有正文；日期、原刊頁碼與這一件在案裡的關係記在 related-documents.json，
  // 兩邊按編號接起來。接不上就停——那表示有一件正文沒有它的著錄。
  const relatedById = Object.fromEntries(readJson(RELATED).documents.map((doc) => [doc.id, doc]))
  for (const file of readdirSync(EXTERNAL_DIR).filter((f) => /^ZJR-.*\.json$/.test(f)).sort()) {
    const draft = readJson(`${EXTERNAL_DIR}/${file}`)
    const doc = relatedById[draft.id]
    if (!doc) throw new Error(`${file}：related-documents.json 裡沒有這一件的著錄`)
    records.push({
      id: draft.id,
      type: 'external',
      review: draft.status === '人工逐字校訂' ? 'verified' : 'gcv',
      title: draft.title,
      author: doc.author ?? null,
      relation: doc.relation ?? null,
      dateIso: doc.dateIso ?? null,
      dateLabel: dateLabel(doc.dateIso, UNDATED_PRINT),
      sourcePages: doc.sourcePages ?? null,
      text: body(draft.paragraphs),
    })
  }

  const unknown = records.filter((record) => !REVIEWS.includes(record.review))
  if (unknown.length) {
    throw new Error(`校訂狀態不在 REVIEWS 裡：${unknown.slice(0, 5).map((r) => `${r.id}=${r.review}`).join('、')}`)
  }
  const chars = records.reduce((sum, record) => sum + [...record.text].length, 0)
  return {
    schemaVersion: 1,
    note: '全文檢索的語料。正文照母本的原書字形，異體字的折合在讀取端用 variants 做。',
    variants,
    stats: {
      records: records.length,
      chars,
      byType: Object.fromEntries(TYPES.map((type) => [type, records.filter((r) => r.type === type).length])),
    },
    records,
    supersededTocIds: [...supersededTocIds],
  }
}

// ── 以下只在直接執行時跑 ──────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const corpus = buildSearchCorpus()
  const { supersededTocIds, ...out } = corpus

  let empty = false
  for (const type of TYPES) {
    const rows = corpus.records.filter((r) => r.type === type)
    const chars = rows.reduce((sum, r) => sum + [...r.text].length, 0)
    console.log(`${type.padEnd(12)} ${String(rows.length).padStart(4)} 筆　${chars.toLocaleString('en-US').padStart(9)} 字`)
    if (!rows.length) { console.error(`FAIL: ${type} 一筆都沒有收到——來源目錄空了或形狀變了`); empty = true }
    const blank = rows.filter((r) => !r.text)
    if (blank.length) { console.error(`FAIL: ${type} 有正文是空的：${blank.map((r) => r.id).join('、')}`); empty = true }
  }
  if (empty) process.exit(1)

  for (const id of supersededTocIds) console.log(`讀稿 ${id} 由校訂稿取代，語料只收校訂那一份`)

  writeFileSync(OUT, `${JSON.stringify({ ...out, generatedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`共 ${corpus.stats.records} 筆、${corpus.stats.chars.toLocaleString('en-US')} 字，異體字 ${Object.keys(corpus.variants).length} 形 → ${OUT.slice(ROOT.length)}`)
}
