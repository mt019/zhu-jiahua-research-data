#!/usr/bin/env node
// 從辨讀稿抽各篇正文題下的場合與訖頁，產生 data/derived/piece_heads.json。
//
// 目次只載篇名、日期與起頁；場合（在哪裡講、對誰講、什麼形式）印在正文的標題行與其下一行，
// 例如「中國大學教育的現狀及應行注意各點 民國二十年春 / 在中央紀念週講」。起頁換算成
// PDF 頁靠 page_map.json 的偏移，再在該頁前後找標題行。
//
// 正文的篇名常比目次長（目次「評議會第二屆第一次年會致詞」，正文「國立中央研究院評議會
// 第二屆第一次年會致辭」），所以比對用相似度不用相等，門檻 0.55，命中的原句一併寫進產物。
//
// 辨讀稿未經逐頁核對，本檔所有欄位的狀態一律是待核（AGENTS.md：未核對者不得推定）。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TXT_DIR = 'data/materials/speeches/gcv/txt'
const TOC = 'data/derived/toc_index.json'
const PAGE_MAP = 'data/derived/page_map.json'
const OUT = 'data/derived/piece_heads.json'
const VARIANTS = `${process.env.HOME}/.claude/skills/cjk-print-ocr/variants.tsv`
const MIN_RATIO = 0.7

// 讀取端的正規化：辨讀稿與目次抄本可能各排一形，比對之前折到同一形。母本不動。
const fold = new Map()
for (const line of readFileSync(VARIANTS, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [canon, ...rest] = line.trim().split(/\s+/)
  for (const v of rest) fold.set(v, canon)
}
const norm = (s) =>
  [...s.replace(/[\s·、。，．,.:：;；|｜【】()（）「」『』〈〉《》—─\-]/g, '')]
    .map((ch) => fold.get(ch) ?? ch)
    .join('')

// 兩串字的相似度：最長公共子序列除以較短的一串。正文的篇名常比目次多一段機關全稱
// （目次「勉中國地理研究所大地測量組同仁」，正文「勉大地測量組同人」），除以較長的那串
// 會把這種真命中壓到門檻底下。改除以較短的一串，另外要求公共子序列至少六個字。
const similarity = (a, b) => {
  if (!a || !b) return 0
  const prev = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j]
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1])
      diag = tmp
    }
  }
  const lcs = prev[b.length]
  const shorter = Math.min(a.length, b.length)
  // 四個字以下的重合不算命中：正文裡「感」「序」這種殘行會拿滿分
  return shorter >= 4 && lcs >= Math.min(5, shorter) ? lcs / shorter : 0
}

const pages = new Map()
for (const f of readdirSync(TXT_DIR)) {
  const n = Number(f.match(/(\d+)\.txt$/)?.[1])
  if (!Number.isInteger(n) || pages.has(n)) continue
  pages.set(
    n,
    readFileSync(join(TXT_DIR, f), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  )
}

const toc = JSON.parse(readFileSync(TOC, 'utf8'))
const pageMap = JSON.parse(readFileSync(PAGE_MAP, 'utf8'))
const pdfToBook = new Map()
const bookToPdf = new Map()
for (const it of pageMap.items) {
  const book = it.bookPage ?? it.bookPageInferred
  if (!Number.isInteger(book) || book <= 0) continue
  pdfToBook.set(it.pdfPage, book)
  if (!bookToPdf.has(book)) bookToPdf.set(book, it.pdfPage)
}
// 偏移只在 34 到 40 之間變動（page_map 的 offsets），起頁換算成 PDF 頁的搜尋窗照這個帶寬開
const OFFSETS = pageMap.offsets
const WINDOW_LO = Math.min(...OFFSETS) - 1
const WINDOW_HI = Math.max(...OFFSETS) + 1

// 題下的日期絕大多數是民國紀年，〈牛頓與近代科學〉這種對外的講詞用西元
const DATE_RE = /(?:民國)?[〇一二三四五六七八九十廿卅百0-9]{2,4}年(?:[〇一二三四五六七八九十百0-9]{1,3}月)?(?:[〇一二三四五六七八九十廿卅百0-9]{1,3}日)?[春夏秋冬]?/g
// 「三十年來的中央研究院」「六十年來中國教育與　蔣主席」這兩個篇名自己以「N十年」起首，
// 只取第一個命中會把篇名的頭幾個字當成日期。年號或月份缺一不可，兩者皆無的命中跳過。
const matchDate = (line) => {
  DATE_RE.lastIndex = 0
  for (const m of line.matchAll(DATE_RE)) {
    if (/^(?:民國|西元)/.test(m[0]) || m[0].includes('月')) return m
  }
  return null
}
const CHROME = /^(朱家驊先生言論集|[壹貳叁肆伍陸柒捌玖拾]\s|[〇一二三四五六七八九0-9\s.,:：|｜【】[\]']+$)/
// 場合單獨成行時很短，而且不是完整的句子：「在中央紀念週講」「於重慶」「對全國廣播」
const OCCASION_LINE = /^[在於對向與代答覆復][^。]{1,22}$|^[^。]{2,16}(講|講演|演講|演說|詞|辭|廣播|訓話|報告|談話|書面|典禮)$/

// 同一頁前後常有相近的篇名（第一屆與第二屆留英學生訓詞、第二次年會與第五次年會），
// 只比相似度會挑錯。所以每一篇先收下所有夠像的候選行，再對全書做一次排列：
// 印刷本的篇序與頁序一致，被選中的標題行必須一路往後走，198 篇的選擇因此互相牽制。
// 相似度過不去的一篇：目次作「附史汀生致朱先生函」，正文的題作「附美國陸軍部長史汀生氏
// 來函（譯文）」，兩者只共用五個字。位置由辨讀稿 PDF 697 讀出，與前一篇同頁接排。
const OVERRIDES = {
  'ZJH-169': {
    pdfPage: 697,
    lineIndex: 8,
    ratio: null,
    titleInText: '附美國陸軍部長史汀生氏來函譯文',
    dateInText: null,
    occasion: null,
    sharesStartPage: true,
    note: '篇名與目次差距過大，位置由辨讀稿人工指定',
  },
}

const collect = (title, lo, hi, expected) => {
  const key = norm(title)
  const out = []
  for (let pdf = lo; pdf <= hi; pdf += 1) {
    if (!pages.has(pdf)) continue
    const lines = pages.get(pdf)
    for (let i = 0; i < lines.length; i += 1) {
      const line = norm(lines[i])
      if (CHROME.test(lines[i])) continue
      const m = matchDate(line)
      const titlePart = m && m.index > 0 ? line.slice(0, m.index) : line
      if (titlePart.length > key.length * 2 + 8) continue
      const ratio = similarity(key, titlePart)
      if (ratio < MIN_RATIO) continue
      const trailing = m ? line.slice(m.index + m[0].length) : ''
      const extra = []
      for (const nxt of lines.slice(i + 1, i + 3)) {
        if (OCCASION_LINE.test(norm(nxt))) extra.push(norm(nxt))
        else break
      }
      const before = lines.slice(0, i).filter((l) => !CHROME.test(l))
      out.push({
        pdfPage: pdf,
        lineIndex: i,
        score: ratio + (m ? 0.2 : 0) - (expected ? 0.03 * Math.abs(pdf - expected) : 0),
        ratio: Number(ratio.toFixed(2)),
        titleInText: titlePart,
        dateInText: m ? m[0] : null,
        occasion: [trailing, ...extra].filter(Boolean).join('／') || null,
        sharesStartPage: before.length > 0,
      })
    }
  }
  return out
}

const candidates = toc.items.map((item) => {
  if (OVERRIDES[item.id]) return [{ ...OVERRIDES[item.id], score: 99 }]
  const expected = bookToPdf.get(item.bookStartPage) ?? null
  const near = expected ? collect(item.title, expected - 2, expected + 2, expected) : []
  if (near.length) return near
  const band = collect(item.title, item.bookStartPage + WINDOW_LO, item.bookStartPage + WINDOW_HI, expected)
  return band.length ? band : collect(item.title, 41, 786, expected)
})

// 逐篇往下挑，位置不准比前一篇挑到的早；挑不到就跳過那一篇，扣一分。
const pos = (c) => c.pdfPage * 1000 + c.lineIndex
const picks = (() => {
  let chosen = []
  let floor = 0
  for (let i = 0; i < candidates.length; i += 1) {
    const viable = candidates[i].filter((c) => pos(c) >= floor)
    if (!viable.length) {
      chosen.push(null)
      continue
    }
    // 這一篇挑掉某一行之後，後面的篇還挑不挑得到——往後看兩篇就夠分出優劣
    let best = null
    for (const c of viable) {
      const nextOk = candidates
        .slice(i + 1, i + 3)
        .filter((list) => list.length)
        .every((list) => list.some((n) => pos(n) > pos(c)))
      const score = c.score + (nextOk ? 0.5 : 0)
      if (!best || score > best.score) best = { ...c, score }
    }
    chosen.push(best)
    floor = pos(best) + 1
  }
  return chosen
})()

const items = toc.items.map((item, idx) => {
  const head = picks[idx]
  const out = {
    id: item.id,
    title: item.title,
    bookStartPage: item.bookStartPage,
    matched: Boolean(head),
  }
  if (!head) return out
  const { score, lineIndex, ...rest } = head
  Object.assign(out, rest)
  out.impliedOffset = head.pdfPage - item.bookStartPage
  out.offsetInBand = out.impliedOffset >= WINDOW_LO && out.impliedOffset <= WINDOW_HI
  return out
})

// 訖頁：下一篇的標題行往前推一頁；下一篇的標題上面還有正文時，兩篇共用那一頁。
for (let i = 0; i < items.length; i += 1) {
  const cur = items[i]
  const next = items[i + 1]
  if (!cur.matched || !next?.matched) continue
  cur.endPdfPage = next.sharesStartPage ? next.pdfPage : next.pdfPage - 1
  cur.sharesEndPage = Boolean(next.sharesStartPage)
  cur.endBookPage = pdfToBook.get(cur.endPdfPage) ?? null
  cur.pdfPageCount = cur.endPdfPage - cur.pdfPage + 1
}

// 最後一篇沒有下一篇可推訖頁，止於全書最後一個印著自己頁碼的頁：再往後是版權頁與英文
// 書名頁。缺了這一條，末篇只收到起頁那一頁——《丁文江與中央研究院》原書 745–750，
// 讀稿一度只有 745 那一頁。
const lastBodyPdfPage = Math.max(
  ...pageMap.items.filter((it) => it.bookPage !== null).map((it) => it.pdfPage),
)
for (let i = items.length - 1; i >= 0; i -= 1) {
  const last = items[i]
  if (!last.matched) continue
  if (last.endPdfPage === undefined && last.pdfPage <= lastBodyPdfPage) {
    last.endPdfPage = lastBodyPdfPage
    last.sharesEndPage = false
    last.endBookPage = pdfToBook.get(last.endPdfPage) ?? null
    last.pdfPageCount = last.endPdfPage - last.pdfPage + 1
  }
  break
}

const matched = items.filter((i) => i.matched).length
const offBand = items.filter((i) => i.matched && !i.offsetInBand)
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      updatedAt: '2026-08-19',
      source: 'Google Cloud Vision 辨讀稿的正文標題行；PDF 頁與原書頁的對照取自 page_map.json',
      status: '待核：場合、訖頁與正文篇名取自辨讀稿，未逐頁核對原頁圖',
      caveats: [
        '場合是標題行扣掉篇名與日期之後剩下的字，加上緊接的短行，辨讀稿的錯字原樣留著。',
        '訖頁以下一篇的標題行位置推得；下一篇的標題上方還有正文時記為共頁，兩篇的頁數各算一次。',
        '末篇沒有下一篇可推，訖頁留空。',
        'offsetInBand 為否的篇，起頁與標題行對不上 page_map 的偏移帶，要回原頁圖判。',
      ],
      stats: {
        total: items.length,
        matched,
        unmatched: items.length - matched,
        offsetOutOfBand: offBand.length,
      },
      items,
    },
    null,
    2,
  )}\n`,
)
console.log(`${OUT}：${matched}/${items.length} 篇找到標題行，偏移落在帶外 ${offBand.length} 篇`)
for (const o of offBand) console.log(`  帶外 ${o.id} 起頁 ${o.bookStartPage} → PDF ${o.pdfPage}（偏移 ${o.impliedOffset}）${o.titleInText}`)
