#!/usr/bin/env node
// 由年目索引、逐頁校訂全文與《言論集》目次，組出前端要的年表。
//
// 輸入：data/derived/chronology/page_index.csv          1893–1963 共 71 個年目的起始頁
//       data/derived/chronology/transcriptions/p*.md    原書 377–393 的人工校訂全文
//       data/derived/toc_index.json                     《言論集》198 篇，192 篇帶日期
// 輸出：data/processed/chronology.json
//
// 原書的年目正文連排，不分段。分段是本專案加的：只在句號之後、且下一句以日期起頭的
// 位置斷開，其餘一字不動。建置時逐年比對「各段接回去」與「原頁的行接起來」是否相同，
// 不同就中止——分段若動到了字，前端讀到的就不是原文了。

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const txDir = join(root, 'data/derived/chronology/transcriptions')
const OUT = join(root, 'data/processed/chronology.json')

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

// ── 年目索引 ────────────────────────────────────────────────────────────────
const csv = readFileSync(join(root, 'data/derived/chronology/page_index.csv'), 'utf8').trim().split('\n')
const header = csv.shift().split(',')
if (header.join(',') !== '西元年,民國紀年,PDF頁,原書頁,備註') fail(`page_index.csv 的欄位變了：${header.join(',')}`)
const index = csv.map((line) => {
  // 備註欄自己帶逗號（「原書年目誤印為⋯，正確為 1944」），只切前四欄
  const [ce, roc, pdfPage, bookPage, ...rest] = line.split(',')
  return { ce: Number(ce), rocLabel: roc, pdfPage: Number(pdfPage), bookPage: Number(bookPage), note: rest.join(',') || null }
})
if (index.length !== 71) fail(`年目應為 71 個，讀到 ${index.length}`)

// ── 校訂全文：一頁一檔，行是原書的硬換行 ──────────────────────────────────
const files = readdirSync(txDir).filter((f) => /^p\d+\.md$/.test(f)).sort()
if (!files.length) fail('找不到校訂全文')
const bookPages = files.map((f) => Number(f.match(/\d+/)[0]))
const stream = [] // { text, bookPage } 一行一項，全段連續
for (const f of files) {
  const bookPage = Number(f.match(/\d+/)[0])
  const raw = readFileSync(join(txDir, f), 'utf8')
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('<!--')) continue
    stream.push({ text: t, bookPage })
  }
}

// 年目的抬頭自成一行：民國紀年加括號裡的西元。括號裡的數字原書有誤植，換算以民國紀年為準。
const HEADING = /^([一二三四五六七八九十]+)年（(\d{4})）$/
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const rocToNumber = (s) => {
  const m = /^(.*?)十(.*)$/.exec(s)
  if (!m) return CN[s] ?? null
  const tens = m[1] ? CN[m[1]] : 1
  const ones = m[2] ? CN[m[2]] : 0
  return tens * 10 + ones
}

// 段落只在句號之後、下一句以日期起頭的位置斷開。日期的長相以本段十七頁實際出現的為準：
// 月日、單獨的日、元旦與陰曆的節令，以及「是年」「本年」這類承接整年的說法。
const DATE_START = /^(?:[〇一二三四五六七八九十廿卅]{1,4}月|[〇一二三四五六七八九十廿卅]{1,3}日|元旦|陰曆|是年|本年|同年|同月|同日)/

const splitParagraphs = (text) => {
  const out = []
  let cut = 0
  for (let i = 1; i < text.length; i += 1) {
    if (text[i - 1] !== '。') continue
    if (!DATE_START.test(text.slice(i, i + 6))) continue
    // 年目的頭一句是歲數（「四十六歲。」），它是這一年的抬頭語，不自成一段
    if (i - cut <= 6) continue
    out.push(text.slice(cut, i))
    cut = i
  }
  out.push(text.slice(cut))
  return out.filter((p) => p.length)
}

// 走一遍全段，切成年；每年記下正文與各原書頁從哪個字起
const runs = new Map() // ce → { text, marks: [{ bookPage, offset }], printed, roc }
let current = null
for (const line of stream) {
  const m = HEADING.exec(line.text)
  if (m) {
    const roc = rocToNumber(m[1])
    if (!roc) fail(`年目抬頭的民國紀年認不出來：${line.text}`)
    const ce = roc + 1911
    if (runs.has(ce)) fail(`民國 ${roc} 年在校訂稿裡出現兩次`)
    current = { ce, roc, printedCe: Number(m[2]), printedHeading: line.text, text: '', marks: [], startPage: line.bookPage }
    runs.set(ce, current)
    current.marks.push({ bookPage: line.bookPage, offset: 0 })
    continue
  }
  if (!current) {
    // 第一頁的抬頭在已校訂的範圍之外：這一段是民國二十六年（1937）的下半截
    current = { ce: 1937, roc: 26, printedCe: null, printedHeading: null, text: '', marks: [], startPage: line.bookPage, headless: true }
    runs.set(1937, current)
    current.marks.push({ bookPage: line.bookPage, offset: 0 })
  }
  if (current.marks.at(-1).bookPage !== line.bookPage) current.marks.push({ bookPage: line.bookPage, offset: current.text.length })
  current.text += line.text
}

// 分段，並把頁碼的字元位置換算到段落座標
const textByCe = new Map()
for (const [ce, run] of runs) {
  const paragraphs = splitParagraphs(run.text)
  const rejoined = paragraphs.join('')
  if (rejoined !== run.text) fail(`${ce} 年分段後與原文不符（${rejoined.length} 對 ${run.text.length} 字）`)
  const bounds = []
  let at = 0
  for (const p of paragraphs) { bounds.push(at); at += p.length }
  const pageBreaks = run.marks.map(({ bookPage, offset }) => {
    let para = 0
    while (para + 1 < bounds.length && bounds[para + 1] <= offset) para += 1
    return { bookPage, para, offset: offset - bounds[para] }
  })
  textByCe.set(ce, { paragraphs, pageBreaks, charCount: run.text.length, run })
}

// ── 《言論集》的篇目掛到年上 ────────────────────────────────────────────────
const toc = JSON.parse(readFileSync(join(root, 'data/derived/toc_index.json'), 'utf8')).items
const piecesByCe = new Map()
for (const item of toc) {
  if (!item.dateIso) continue
  const ce = Number(item.dateIso.slice(0, 4))
  if (!Number.isInteger(ce)) continue
  piecesByCe.set(ce, [...(piecesByCe.get(ce) ?? []), {
    id: item.id,
    title: item.title,
    part: item.part,
    date: item.dateOriginal ?? null,
    dateIso: item.dateIso,
    bookStartPage: item.bookStartPage,
  }])
}
const datedPieces = toc.filter((t) => t.dateIso).length
const placed = [...piecesByCe.values()].reduce((n, list) => n + list.length, 0)
if (placed !== datedPieces) fail(`帶日期的 ${datedPieces} 篇裡只掛上 ${placed} 篇`)

// ── 組出年目 ────────────────────────────────────────────────────────────────
const transcribedFirst = bookPages[0]
const transcribedLast = bookPages.at(-1)
const years = index.map((entry, i) => {
  const text = textByCe.get(entry.ce)
  const next = index[i + 1]
  const out = {
    ce: entry.ce,
    rocLabel: entry.rocLabel,
    bookPage: entry.bookPage,
    age: entry.ce - 1893,
  }
  if (entry.note) out.indexNote = entry.note
  const pieces = piecesByCe.get(entry.ce) ?? []
  if (pieces.length) out.pieces = pieces
  if (text) {
    // 首尾兩年各有一截不在已校訂的頁裡：1937 的起處在原書 376 之前，1948 的結尾在 394 之後
    const headCut = entry.bookPage < transcribedFirst
    const tailCut = next ? next.bookPage > transcribedLast : true
    out.text = {
      paragraphs: text.paragraphs,
      pageBreaks: text.pageBreaks,
      charCount: text.charCount,
      coverage: headCut || tailCut ? '部分' : '全年',
    }
    if (headCut) out.text.coverageNote = `本年的條目起於原書第 ${entry.bookPage} 頁，已校訂的範圍自第 ${transcribedFirst} 頁起，前面一截未校訂。`
    else if (tailCut) out.text.coverageNote = `本年的條目續至原書第 ${next.bookPage} 頁（該頁下半是次年的條目），已校訂的範圍止於第 ${transcribedLast} 頁，第 ${transcribedLast + 1} 頁起未校訂。`
    if (text.run.printedCe !== null && text.run.printedCe !== entry.ce) {
      out.text.printedHeading = text.run.printedHeading
      out.text.printedHeadingNote = `原書的年目抬頭印作「${text.run.printedHeading}」，括號裡的西元誤植；民國紀年與本年條目所記的事都合於 ${entry.ce} 年。`
    }
  }
  return out
})

const withText = years.filter((y) => y.text)
const totalChars = withText.reduce((n, y) => n + y.text.charCount, 0)

const doc = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString().slice(0, 10),
  source: {
    title: '朱家驊先生年譜簡編',
    author: '胡頌平',
    publishedIn: '中央研究院歷史語言研究所集刊第三十五本（故院長朱家驊先生紀念論文集）',
    year: 1964,
    bookPages: '353–419',
    url: 'https://www1.ihp.sinica.edu.tw/Publications/Bulletin/888',
    pdfUrl: 'https://www11.ihp.sinica.edu.tw/storage/w2_file/4072VJcqaKL.pdf',
    note: '原書頁＝PDF 頁 ＋ 352。',
  },
  rights:
    '胡頌平 1904 年生、1988 年歿，本篇的著作財產權在我國存續至 2038 年底。本站標明出處並附史語所官方全文連結。朱家驊本人的著作已於 2013 年底進入公共領域。',
  materialNature: [
    '胡頌平在後記寫：「他晚年時常和我談起他生平的事蹟，可以說是他的回憶錄，我都保留住每次談話的紀錄。這裏採取的資料，大部分是根據這種紀錄的。不過他憑記憶記錯的地方也不少，我所知道的，都已設法查明改正了。」（原書 419）年譜的材料因此是朱家驊本人的回憶，編者更正的是他自己知道的錯處；所載的日期與事實要與獨立來源核對後才能引用。',
    '朱家驊遺下的檔案交由近代史研究所整理，到 1964 年 2 月只完成兩箱多的目錄，胡頌平寫年譜時原始檔案還不能用（原書 418）。',
    '1964 年 2 月 6 日陳槃提議編這份年譜，5 月底完成初稿約十八萬字，7 月初因紀念論文集篇幅所限重寫成六萬字的簡編，7 月 25 日夜寫定後記。',
  ],
  transcription: {
    bookPages: `${transcribedFirst}–${transcribedLast}`,
    pageCount: files.length,
    years: `${withText[0].ce}–${withText.at(-1).ce}`,
    charCount: totalChars,
    method:
      'Google Cloud Vision 辨讀底稿加逐頁對照原頁圖的人工校訂表；校訂表每條在該頁必須剛好命中一次。用字保留原書字形（爲、僞、眞、欵），檢索與需要通用形的呈現在讀取端各自套異體字對照表。',
    paragraphing:
      '原書的年目正文連排不分段。本站的分段只在句號之後、下一句以日期起頭的位置斷開，字句一字未動；建置時逐年比對各段接回去與原頁的行接起來是否相同。',
  },
  untranscribed: {
    bookPages: `353–${transcribedFirst - 1}、${transcribedLast + 1}–419`,
    note: '這五十頁只有機器辨讀底稿，字準確率約七八成，本站不列正文，只列年目與原書頁碼。',
  },
  errata: {
    official: {
      note: '原書 419 末所附「本文勘誤表」三條。',
      items: [
        { bookPage: 379, line: 4, wrong: '汴', right: '濮' },
        { bookPage: 381, line: 23, wrong: '船', right: '全' },
        { bookPage: 386, line: 26, wrong: '汴', right: '濮' },
      ],
    },
    foundHere: {
      note: '勘誤表未收，由本專案核出。年目的兩處誤植已在下表標明，正文的三處一律照原書轉錄，不在正文改字。',
      items: [
        { bookPage: 384, text: '年目抬頭印作「三十三年（1954）」。民國三十三年是 1944 年；該年條目記「五十二歲」與十一月二十日發表教育部長，均合於 1944 年。' },
        { bookPage: 413, text: '年目抬頭印作「五十一年（1964）」。民國五十一年是 1962 年；該年條目記二月二十四日胡適逝世，胡適逝於 1962 年。' },
        { bookPage: 391, text: '「李宗任當選爲副總統」，應作李宗仁。放大原頁圖確認印的就是「任」，兩個辨識引擎也都讀作「任」。' },
        { bookPage: 391, text: '「先生在四十四年注意的課程標準」出現在民國三十七年的條目裡。所指是原書 384 民國三十四年（1945）指定四校檢討課程標準那件事。' },
        { bookPage: 393, text: '薩本棟「十一月三十一日去世」。十一月無三十一日。' },
      ],
    },
  },
  stats: {
    yearCount: years.length,
    yearsWithText: withText.length,
    pieceCount: toc.length,
    datedPieceCount: datedPieces,
    yearsWithPieces: years.filter((y) => y.pieces).length,
  },
  years,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`)
const paras = withText.reduce((n, y) => n + y.text.paragraphs.length, 0)
console.log(`年表 ${years.length} 個年目，其中 ${withText.length} 年帶正文（${totalChars.toLocaleString('en-US')} 字、${paras} 段）`)
console.log(`《言論集》${placed} 篇掛到 ${years.filter((y) => y.pieces).length} 個年目上 → ${OUT}`)
