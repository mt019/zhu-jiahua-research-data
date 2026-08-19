#!/usr/bin/env node
// 把全書辨讀底稿切成 198 篇的未校讀稿，輸出 data/processed/reading-drafts/。
//
// 底稿是 Google Cloud Vision 一頁一檔的辨讀結果（data/materials/speeches/gcv/txt，不入版控）。
// 切篇的依據是 piece_heads.json：每篇的起訖 PDF 頁、以及正文裡那一行標題的原字。同一頁常
// 接排兩篇，所以起頁從標題行切起，訖頁切到次篇的標題行為止。
//
// 每一頁單獨成一段並帶原書頁碼，讀者要回頭核原書時指得到位置。原書的分段靠首行縮排表示，
// 辨讀稿沒有留下縮排，所以段落還原不了，這裡不猜。
//
// 產物一律標著未校：字錯率見 LOG 2026-08-19（複核過的七篇 32 頁 20,828 字上 26 處，0.125%）。
// 逐頁人工校訂完成的篇另存 data/derived/transcriptions/，前端以那一份為準。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TXT_DIR = 'data/materials/speeches/gcv/txt'
const JSON_DIR = 'data/materials/speeches/gcv/txt/json'
const HEADS = 'data/derived/piece_heads.json'
const TOC = 'data/derived/toc_index.json'
const PAGE_MAP = 'data/derived/page_map.json'
const OUT_DIR = 'data/processed/reading-drafts'
const VARIANTS = `${process.env.HOME}/.claude/skills/cjk-print-ocr/variants.tsv`

if (!existsSync(TXT_DIR)) {
  console.log('辨讀底稿不在本機，讀稿建置跳過。')
  process.exit(0)
}

const fold = new Map()
for (const line of readFileSync(VARIANTS, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [canon, ...rest] = line.trim().split(/\s+/)
  for (const v of rest) fold.set(v, canon)
}
// 比對用的正規化只在讀取端，寫出去的正文保留底稿原字（~/.claude/rules/轉錄體例.md）
const norm = (s) =>
  [...s.replace(/[\s·、。，．,.:：;；|｜【】()（）「」『』〈〉《》—─\-]/g, '')]
    .map((ch) => fold.get(ch) ?? ch)
    .join('')

const heads = JSON.parse(readFileSync(HEADS, 'utf8')).items
const toc = JSON.parse(readFileSync(TOC, 'utf8')).items
const pageMap = JSON.parse(readFileSync(PAGE_MAP, 'utf8'))
const bookByPdf = new Map()
for (const it of pageMap.items) {
  const b = it.bookPage ?? it.bookPageInferred
  if (Number.isInteger(b)) bookByPdf.set(it.pdfPage, b)
}
// 缺頁歸給哪一篇，依 toc_index.json 現行的起頁自己算：page_map 的 gaps 裡那一欄記的是
// 2026-08-19 更正之前的起頁，照它歸會把原書 124 頁記到 ZJH-034 而不是 ZJH-033。
const missingByPiece = new Map()
for (const g of pageMap.gaps) {
  let owner = null
  for (const t of toc) {
    if (t.bookStartPage <= g.bookPage) owner = t
    else break
  }
  if (!owner) continue
  missingByPiece.set(owner.id, [...(missingByPiece.get(owner.id) ?? []), g.bookPage])
}

// 段落取自辨讀結果自己的 paragraph 結構：實測它與原書的分段一致（原書靠首行縮排分段，
// 辨識引擎讀得到那個縮排）。純文字檔一行是一欄，接起來就沒有分段了，所以改讀 JSON。
// 部次名照原書的書眉寫法（沒有頓號），教／敎兩形都收；部次與部名之間辨讀稿有時多出
// 一兩個字元（【叁】教育言論、拾肆-追念師友），一併容許。
const headAlternatives = [...new Set(toc.map((t) => t.part))]
  .map((part) => {
    const [ordinal, name] = part.split('、')
    const names = name.includes('教') ? [name, name.replace('教', '敎')] : [name]
    return `【?${ordinal}】?[-—、,.\\s]{0,2}(?:${names.join('|')})`
  })
  .sort((a, b) => b.length - a.length)
const HEAD_IN_LINE = new RegExp(`(?:${headAlternatives.join('|')})`)

// 書眉與書根印在版心外的邊欄，辨識引擎有時把它們併進正文那一段。併進來的那幾個字，
// x 座標落在邊欄，與同段正文差得很遠：先按文字找到「部次＋部名」，再把同一段裡座標
// 落在同一條邊欄的字一併去掉——書根的頁碼就是這樣連帶去掉的。
// 部次那個字被認錯（壹讀成壺、柒讀成粜）時這一關過不了，殘留數見 engineering/LOG.md。
const stripMargin = (par) => {
  const syms = par.words.flatMap((w) =>
    w.symbols.map((sym) => {
      const v = sym.boundingBox?.vertices ?? []
      const xs = v.map((q) => q.x ?? 0)
      return { text: sym.text, cx: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : null }
    }),
  )
  const text = syms.map((s) => s.text).join('')
  const m = HEAD_IN_LINE.exec(text)
  if (!m) return text
  const band = syms
    .slice(m.index, m.index + m[0].length)
    .map((s) => s.cx)
    .filter((x) => x !== null)
  if (!band.length) return text
  const lo = Math.min(...band) - 60
  const hi = Math.max(...band) + 60
  return syms
    .filter((s, i) => {
      if (i >= m.index && i < m.index + m[0].length) return false
      return s.cx === null || s.cx < lo || s.cx > hi
    })
    .map((s) => s.text)
    .join('')
}

const pages = new Map()
let marginStripped = 0
for (const f of readdirSync(JSON_DIR)) {
  const n = Number(f.match(/(\d+)\.json$/)?.[1])
  if (!Number.isInteger(n) || pages.has(n)) continue
  const doc = JSON.parse(readFileSync(join(JSON_DIR, f), 'utf8'))
  const page = doc.fullTextAnnotation?.pages?.[0]
  const paras = []
  for (const b of page?.blocks ?? []) {
    for (const par of b.paragraphs ?? []) {
      const raw = par.words.flatMap((w) => w.symbols.map((sym) => sym.text)).join('')
      // 自成一段的書眉在下面 chrome() 那裡整段丟掉，這裡只處理併進正文的
      const t = raw.trim().length > 14 ? stripMargin(par) : raw
      if (t !== raw) marginStripped += 1
      if (t.trim()) paras.push(t.trim())
    }
  }
  pages.set(n, paras)
}
console.log(`書眉或書根併進正文段的 ${marginStripped} 段已剔除邊欄的字`)

// 書眉是書名或部次名，書根是頁碼；兩者各自成行，辨讀稿裡的頁碼常認錯，只認長相
const RUNNING_HEAD = /^(朱家驊先生言論集|[壹貳叁肆伍陸柒捌玖拾][、\s]?.{0,12})$/
const PAGE_NUMBER = /^[〇一二三四五六七八九十百0-9\s.,·]{1,6}$/
// 辨讀稿把全形逗號、冒號、問號讀成半形，原書排的是全形。夾在漢字之間的一律轉回全形。
const widen = (t) =>
  t
    .replace(/([\u3000-\u9fff]),/g, '$1，')
    .replace(/,([\u3000-\u9fff])/g, '，$1')
    .replace(/([\u3000-\u9fff]):/g, '$1：')
    .replace(/([\u3000-\u9fff]);/g, '$1；')
    .replace(/([\u3000-\u9fff])\?/g, '$1？')
    .replace(/([\u3000-\u9fff])!/g, '$1！')
const NOISE = /[^\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u0020-\u007e\u00c0-\u024f]/g

const chrome = (line) => !line || RUNNING_HEAD.test(line) || PAGE_NUMBER.test(line)

// 標題行在該頁的位置：拿正文那一行的原字去找，找不到就退回頁首
const titleLineIndex = (pdfPage, titleInText) => {
  const lines = pages.get(pdfPage) ?? []
  if (!titleInText) return 0
  const key = norm(titleInText)
  const exact = lines.findIndex((l) => norm(l).startsWith(key))
  if (exact >= 0) return exact
  const loose = lines.findIndex((l) => norm(l).includes(key.slice(0, Math.min(8, key.length))))
  return loose >= 0 ? loose : 0
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const byId = new Map(toc.map((t) => [t.id, t]))
const index = []
let totalChars = 0

for (let i = 0; i < heads.length; i += 1) {
  const h = heads[i]
  const next = heads[i + 1]
  const meta = byId.get(h.id)
  const startIdx = titleLineIndex(h.pdfPage, h.titleInText)
  const endPdf = h.endPdfPage ?? h.pdfPage
  const endIdx =
    next && next.pdfPage === endPdf ? titleLineIndex(next.pdfPage, next.titleInText) : Infinity

  const out = []
  let noiseRemoved = 0
  for (let p = h.pdfPage; p <= endPdf; p += 1) {
    const lines = pages.get(p) ?? []
    // 標題行由前端另外呈現，正文從它底下起；題下若另起一行寫場合（「在中央紀念週講」
    // 「於重慶」），那一行也是題下資訊，一併跳過
    let skip = startIdx + 1
    if (p === h.pdfPage && h.occasion) {
      const line = (pages.get(p) ?? [])[skip] ?? ''
      if (line && norm(line).includes(norm(h.occasion)) && line.length <= h.occasion.length + 6) skip += 1
    }
    const from = p === h.pdfPage ? skip : 0
    const to = p === endPdf ? Math.min(lines.length, endIdx) : lines.length
    const body = lines.slice(from, to).filter((l) => !chrome(l))
    // 掃描件上的墨點、勾記與污損被辨識成 ⚫ ✓ ○ ① 這類符號，落到站上是一個畫不出來的字。
    // 漢字、假名、拉丁字母、數字與常用標點以外的一律剔除，剔掉幾個記在 noiseRemoved。
    const paras = body.map((t) => widen(t.replace(NOISE, '')).trim()).filter(Boolean)
    const raw = body.join('')
    const text = paras.join('')
    noiseRemoved += raw.length - raw.replace(NOISE, '').length
    if (!text) continue
    // 原書頁碼由該篇目次所載的起頁往後數，不取 page_map 的推定值：目次那一欄逐欄核過，
    // 而 page_map 在讀不出頁碼的區段是拿相鄰頁的偏移推的，缺頁的位置一旦定得不準就整段偏一頁。
    // 兩者不一致時記下來，該頁的頁碼標為推定。
    const derived = meta ? meta.bookStartPage + (p - h.pdfPage) : null
    const fromMap = bookByPdf.get(p) ?? null
    const page = { bookPage: derived ?? fromMap, paragraphs: paras, text }
    if (derived !== null && fromMap !== null && derived !== fromMap) {
      page.bookPageStatus = '推定'
      page.bookPageNote = `page_map 由相鄰頁推得 ${fromMap}，本檔取目次起頁往後數的 ${derived}`
    }
    out.push(page)
  }

  const chars = out.reduce((n, p) => n + p.text.length, 0)
  totalChars += chars
  const draft = {
    id: h.id,
    title: meta?.title ?? h.title,
    part: meta?.part ?? null,
    dateOriginal: meta?.dateOriginal ?? null,
    bookPages: out.length ? `${out[0].bookPage ?? '?'}–${out.at(-1).bookPage ?? '?'}` : null,
    status: '未校辨讀稿',
    statusNote:
      'Google Cloud Vision 的辨讀結果，未經逐字人工校訂。以複核過的七篇（32 頁、20,828 字）為量尺，辨讀稿有 26 處與原書不符：誤認 16 字、漏 8 字、衍 1 字、一處欄序錯置，合 0.125%（engineering/LOG.md 2026-08-19）。引用前請核對原書。',
    charCount: chars,
    noiseRemoved,
    missingBookPages: missingByPiece.get(h.id) ?? [],
    pages: out,
  }
  if (draft.missingBookPages.length) {
    draft.missingNote = `掃描件缺原書第 ${draft.missingBookPages.join('、')} 頁，該頁正文不在本稿內。`
  }
  writeFileSync(join(OUT_DIR, `${h.id}.json`), `${JSON.stringify(draft, null, 2)}\n`)
  index.push({
    id: h.id,
    charCount: chars,
    noiseRemoved,
    pageCount: out.length,
    missingBookPages: draft.missingBookPages,
  })
}

writeFileSync(
  join(OUT_DIR, 'index.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), status: '未校辨讀稿', count: index.length, totalChars, items: index }, null, 2)}\n`,
)
console.log(`讀稿 ${index.length} 篇，合計 ${totalChars.toLocaleString('en-US')} 字，寫進 ${OUT_DIR}`)
