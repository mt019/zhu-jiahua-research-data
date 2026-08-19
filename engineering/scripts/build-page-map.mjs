#!/usr/bin/env node
// 從 OCR 底稿抽出每一頁印著的原書頁碼，產生 PDF 頁與原書頁的對照表。
//
// 每一頁的頁碼印在書眉或書根，OCR 會把它連同部次一起讀進來（「叁【教育言論|二六 一」）。
// 單頁抽出來的候選不只一個，靠相鄰頁遞增挑選：以動態規劃取一條讓「頁碼比前一頁多一」
// 成立最多次的鏈。部次的隔頁、目次與版權頁沒有頁碼，鏈允許斷開。
//
// 產物 data/derived/page_map.json 的頁碼來自辨讀稿，未逐頁核對原頁圖，狀態一律是待核。

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const TXT_DIR = 'data/materials/speeches/gcv/txt'
const OUT = 'data/derived/page_map.json'
const DIGITS = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

const toNumber = (token) => {
  let value = 0
  for (const ch of token) {
    if (!(ch in DIGITS)) return null
    value = value * 10 + DIGITS[ch]
  }
  return value > 0 && value <= 999 ? value : null
}

// 頁碼印在書眉或書根，與書名或部次名各佔一行。取首尾各四行，只收「整行都是數字」的行：
// 正文行裡的中文數字（年份、條號、一二三的列舉）因此進不來。
// 兩種數字都要收——Vision 有時把「一」吐成阿拉伯數字 1（PDF 41），有時掉一位
// （PDF 100 的六〇只剩六）。掉位的那些頁在對照表裡留空，靠相鄰頁的偏移補不進來。
const NUMERIC_LINE = /^[〇一二三四五六七八九0-9\s.,:：|｜【】[\]]+$/
const candidates = (text) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const found = new Set()
  for (const line of [...lines.slice(0, 4), ...lines.slice(-4)]) {
    if (!NUMERIC_LINE.test(line)) continue
    const token = line.replace(/[^〇一二三四五六七八九0-9]/g, '')
    const value = /^[0-9]+$/.test(token) ? Number(token) : toNumber(token)
    if (value !== null && value > 0 && value <= 999) found.add(value)
  }
  return [...found].sort((a, b) => a - b)
}

const pages = readdirSync(TXT_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => ({ pdfPage: Number(f.match(/(\d+)\.txt$/)?.[1]), file: f }))
  .filter((p) => Number.isInteger(p.pdfPage))
  .sort((a, b) => a.pdfPage - b.pdfPage)
  // 試跑那幾頁與全書批次的檔名不同，同一頁會出現兩份，留一份
  .filter((p, i, all) => i === 0 || p.pdfPage !== all[i - 1].pdfPage)

if (!pages.length) throw new Error(`${TXT_DIR} 沒有可讀的辨讀稿`)

const options = pages.map((p) => ({
  ...p,
  values: [null, ...candidates(readFileSync(join(TXT_DIR, p.file), 'utf8'))],
}))

// 偏移（PDF 頁減原書頁）應該是分段常數：部次隔頁與插圖各讓它跳一次，其餘一路不變。
// 對偏移值做動態規劃，換一次扣 8 分，該頁的候選裡有 pdfPage - offset 得 3 分、沒有扣 1 分。
// 拿正文裡的「一、二、三」當頁碼接得起來的那種鏈，因此接不下去。
// 前面的目次與序自成一套頁碼（也從一起算），偏移落在完全不同的帶上；正文的偏移集中在
// 眾數附近，只留眾數上下六以內，目次那一套與零星的誤讀因此進不了鏈。
const rawOffsets = options.flatMap((page) =>
  page.values.filter((v) => v !== null).map((v) => page.pdfPage - v)).filter((o) => o >= 0)
const tally = new Map()
for (const o of rawOffsets) tally.set(o, (tally.get(o) ?? 0) + 1)
const mode = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
const offsetPool = [...new Set(rawOffsets)].filter((o) => Math.abs(o - mode) <= 6)

let previous = new Map(offsetPool.map((o) => [o, { score: 0, from: null }]))
const trail = []
for (const page of options) {
  const own = new Set(page.values.filter((v) => v !== null))
  const current = new Map()
  for (const offset of offsetPool) {
    let best = null
    for (const [prior, state] of previous) {
      const score = state.score + (prior === offset ? 0 : -8)
      if (!best || score > best.score) best = { score, from: prior }
    }
    best.score += own.has(page.pdfPage - offset) ? 3 : -1
    current.set(offset, best)
  }
  trail.push(current)
  previous = current
}

let offset = [...previous.entries()].sort((a, b) => b[1].score - a[1].score)[0][0]
const chain = []
for (let i = options.length - 1; i >= 0; i -= 1) {
  const own = new Set(options[i].values.filter((v) => v !== null))
  // 該頁自己讀不到相符的頁碼時留空，不要拿偏移硬推一個出來
  chain[i] = own.has(options[i].pdfPage - offset) ? options[i].pdfPage - offset : null
  offset = trail[i].get(offset).from
}

// 讀不到頁碼的頁，用該頁所屬那一段的偏移推一個出來，另存一欄並標明來源。
// AGENTS.md 規定未核對者不得推定，所以推來的值不寫進 bookPage。
const runOffset = []
{
  let offset = null
  for (let i = 0; i < options.length; i += 1) {
    if (chain[i] !== null) offset = options[i].pdfPage - chain[i]
    runOffset[i] = offset
  }
  offset = null
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (chain[i] !== null) offset = options[i].pdfPage - chain[i]
    if (runOffset[i] === null) runOffset[i] = offset
  }
}

const items = options.map((page, i) => ({
  pdfPage: page.pdfPage,
  bookPage: chain[i],
  offset: chain[i] === null ? null : page.pdfPage - chain[i],
  bookPageInferred: chain[i] === null && runOffset[i] !== null
    ? page.pdfPage - runOffset[i] : null,
  inferredFrom: chain[i] === null && runOffset[i] !== null ? '相鄰頁的偏移' : null,
}))
const named = items.filter((i) => i.bookPage !== null)
// 掃描件少掉的原書頁，以及它落在哪一篇裡。校訂到那幾篇時會撞上洞，先讓它被機器看見。
const toc = JSON.parse(readFileSync('data/derived/toc_index.json', 'utf8')).items
const gaps = []
for (let i = 1; i < named.length; i += 1) {
  const step = named[i].pdfPage - named[i - 1].pdfPage
  const jump = named[i].bookPage - named[i - 1].bookPage
  if (jump <= step) continue
  for (let page = named[i - 1].bookPage + step; page < named[i].bookPage; page += 1) {
    const piece = [...toc].reverse().find((t) => t.bookStartPage <= page)
    const next = toc.find((t) => t.bookStartPage > page)
    gaps.push({
      bookPage: page,
      afterPdfPage: named[i - 1].pdfPage,
      locatedIn: named[i].pdfPage - named[i - 1].pdfPage > 1
        ? `${named[i - 1].bookPage + 1}–${named[i].bookPage - 1} 之間某頁，該段讀不出頁碼` : '確定',
      piece: piece ? { id: piece.id, title: piece.title, bookStartPage: piece.bookStartPage } : null,
      nextPieceStartsAt: next ? next.bookStartPage : null,
    })
  }
}
const offsets = [...new Set(named.map((i) => i.offset))].sort((a, b) => a - b)
const breaks = named.filter((item, i) => i > 0 && item.offset !== named[i - 1].offset)
  .map((item) => ({ pdfPage: item.pdfPage, bookPage: item.bookPage, offset: item.offset }))

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify({
  schemaVersion: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  source: 'Google Cloud Vision 辨讀稿的書眉與書根',
  status: '待核：頁碼取自辨讀稿，未逐頁核對原頁圖',
  caveats: [
    'bookPage 是該頁自己印著、辨讀稿讀出來的；bookPageInferred 由相鄰頁的偏移推得，未經核對。',
    '偏移在六處各減一，各少掉一個原書頁：124 上下（實際位置在 112 至 124 之間，該段沒有一頁'
      + '讀得出頁碼）、350、432、636、696、722。逐處讀了前一頁的末行正文：349、431、695、721'
      + '四處話已說完，少的那頁多半是分節前的空白背面；123 與 635 兩處停在句子中間，'
      + '那兩頁有正文而掃描件裡沒有。',
    '前面的目次與序自成一套頁碼，不在本表的偏移帶內，一律留空。',
  ],
  totalPdfPages: items.length,
  numberedPages: named.length,
  offsets,
  offsetBreaks: breaks,
  gaps,
  items,
}, null, 2)}\n`)

console.log(`${items.length} 頁，抽出頁碼 ${named.length} 頁，未編頁 ${items.length - named.length} 頁`)
console.log(`偏移值 ${offsets.join('、')}；換值 ${breaks.length} 次`)
for (const b of breaks.slice(0, 12)) console.log(`  PDF ${b.pdfPage} = 原書 ${b.bookPage}（偏移 ${b.offset}）`)
