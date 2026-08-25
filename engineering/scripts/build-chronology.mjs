#!/usr/bin/env node
// 由年目索引、逐頁校訂全文、Google Cloud Vision 未校辨讀稿與《言論集》目次，組出前端要的年表。
//
// 輸入：data/derived/chronology/page_index.csv          1893–1963 共 71 個年目的起始頁
//       data/derived/chronology/transcriptions/p*.md    原書 377–393（PDF 25–41）的人工校訂全文，最高優先
//       data/materials/chronology/gcv/txt/pg-NN.txt     其餘原書 353–376、394–417（PDF 1–24、42–65）
//                                                        的 Google Cloud Vision 未校辨讀稿
//       data/derived/toc_index.json                     《言論集》198 篇，192 篇帶日期
// 輸出：data/processed/chronology.json
//
// 原書的年目正文連排，不分段。分段是本專案加的：只在句號之後、且下一句以日期起頭的
// 位置斷開，其餘一字不動。建置時逐年比對「各段接回去」與「原頁的行接起來」是否相同，
// 不同就中止——分段若動到了字，前端讀到的就不是原文了。
//
// 年目的認定不靠辨讀稿裡的民國紀年數字（那串數字本身可能是原書誤植或機器誤讀），
// 只靠「這是一行年目抬頭」這個形狀當分段標記，抬頭的先後順序對齊 page_index.csv
// 的 71 列——年目本來就是逐年遞增排列，位置比辨讀出來的數字可靠。

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { widen, dots, cornerQuotes } from './lib/punctuation.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const txDir = join(root, 'data/derived/chronology/transcriptions')
const gcvDir = join(root, 'data/materials/chronology/gcv/txt')
const OUT = join(root, 'data/processed/chronology.json')
const PAGE_OFFSET = 352

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

// ── 校訂全文：一頁一檔，行是原書的硬換行，最高優先 ───────────────────────────
const verifiedFiles = readdirSync(txDir).filter((f) => /^p\d+\.md$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
if (!verifiedFiles.length) fail('找不到校訂全文')
const verifiedBookPages = new Set(verifiedFiles.map((f) => Number(f.match(/\d+/)[0])))
const verifiedFirst = Math.min(...verifiedBookPages)
const verifiedLast = Math.max(...verifiedBookPages)

const linesFromVerified = (bookPage) => {
  const raw = readFileSync(join(txDir, `p${bookPage}.md`), 'utf8')
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
  const out = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('<!--')) continue
    out.push(t)
  }
  // 校訂稿的底稿是 macOS Vision，彎引號與半形標點是底稿留下的，原書排的是全形與「」。
  // 標點歸位只動標點的形，判準是鄰居字元，字一個不動，與校訂不衝突。
  return out.map((l) => dots(cornerQuotes(widen(l))).text)
}

// ── Google Cloud Vision 未校辨讀稿：結構性拆解＋標點歸位，不做字形正規化 ──────
// 校訂全文那七組一字兩形的正規化（為→爲等）是針對 macOS Vision 底稿逐頁核過原頁圖
// 才敢做的；這裡換了辨讀引擎，同一組誤讀比例未經核對，不得沿用。標點歸位（半形轉
// 全形、彎引號轉「」『』、句號串與重出）與讀稿產線共用 lib/punctuation.mjs，判準是
// 鄰居字元的類別，與字形無關。逐處核過原頁圖的錯字收 corrections/pg-NN.tsv，
// 每行「誤 TAB 正」，該頁至少命中一次，否則中止。
const HEADER_TEXT = '朱家驊先生年譜簡編'
const isCJK = (s) => /[㐀-鿿]/.test(s)
// 版面上不該出現的符號：漢字、CJK 標點、全形符號、基本西文（含帶重音的歐洲人名字母）、
// 少數常見標點與符號之外的字元，一律視為辨讀誤讀（本頁圖確認過原書 1964 年鉛印，
// 不可能出現希臘文送氣符或天城文縮寫號這類符號），逐字元剔除，不猜測正確字形應是什麼。
const STRAY_GLYPH = /[^㐀-鿿　-〿＀-￯ -~À-ſ–—‘’“”…○●〇]/g
const stripStrayGlyphs = (s) => s.replace(STRAY_GLYPH, '')

const linesFromGcv = (pdfPage, bookPage) => {
  const raw = readFileSync(join(gcvDir, `pg-${String(pdfPage).padStart(2, '0')}.txt`), 'utf8')
  let lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)

  // 書眉「朱家驊先生年譜簡編」多半是首行，但頁面轉角處的雜訊字元有時排在它前面，
  // 只在前五行找，找不到就中止——寧可停下等人看，不猜書眉在哪。
  const headerIdx = lines.slice(0, 5).findIndex((l) => l.replace(/^[·•●○\-\s]+/, '') === HEADER_TEXT)
  if (headerIdx === -1) fail(`pg-${pdfPage}（原書第 ${bookPage} 頁）：前五行找不到書眉「${HEADER_TEXT}」`)
  lines.splice(headerIdx, 1)

  // 頁碼在頁尾，形式不一（-353-、354、·362、- 365 -、394~），但去掉非數字字元後
  // 一定等於原書頁碼；全頁只找一次，找不到或找到兩次都中止。
  const footerIdxs = lines.reduce((acc, l, i) => {
    if (!isCJK(l) && l.replace(/[^0-9]/g, '') === String(bookPage)) acc.push(i)
    return acc
  }, [])
  if (footerIdxs.length !== 1) fail(`pg-${pdfPage}（原書第 ${bookPage} 頁）：頁碼「${bookPage}」命中 ${footerIdxs.length} 次，須剛好 1 次`)
  lines.splice(footerIdxs[0], 1)

  // 版面裝飾線與污點常被讀成孤立的短字元（-、,、·、0、1、Sp、mang）。真正的正文
  // 一定含漢字；不含漢字又在六個字以內的行，一律當雜訊丟棄。
  lines = lines.filter((l) => isCJK(l) || l.length > 6)
  // 首頁書眉下另印作者署名「胡頌平」（辨讀稿偶爾夾一個空格），只出現這一次，不是正文
  lines = lines.filter((l) => !/^胡\s*頌\s*平$/.test(l))
  // 行內偶爾夾雜辨讀引擎誤讀出的孤立符號（希臘文送氣符、天城文縮寫號一類），
  // 這類符號不可能是 1964 年鉛印本身的字，逐字元剔除
  lines = lines.map(stripStrayGlyphs).filter(Boolean)
  // GCV 在直排欄位間插的空格是版面雜訊，原書漢字間不排空格。兩側是漢字或全形符號的
  // 空格收掉；左鄰是緊跟著漢字的半形逗號句號也一併收（「九月, 先生」），收完 widen
  // 才看得到全形鄰居。拉丁詞之間的空格兩側都不是漢字，不動。
  const CJKISH = '[一-鿿㐀-䶿豈-﫿　-〿＀-￯]'
  const SPACE_RUN = new RegExp(`(${CJKISH}[,.]?)[ \\t]+(?=${CJKISH})`, 'g')
  // 彎引號要先轉成「」『』，widen 的鄰居判斷才認得它們是全形
  lines = lines.map((l) => dots(widen(cornerQuotes(l.replace(SPACE_RUN, '$1')))).text)
  const applyCorrections = (file, label, requireHit) => {
    if (!existsSync(file)) return
    for (const row of readFileSync(file, 'utf8').split('\n')) {
      // 正欄留空＝刪去該串（辨讀稿把一欄的字排到頁尾去了，原位另有一條把它接回）。
      // 因此先切欄再看內容，不先 trim——trim 會把行末那個 TAB 一併吃掉，空的正欄
      // 就變成只有一欄的壞格式。
      const t = row.replace(/\r$/, '')
      if (!t.trim() || t.trimStart().startsWith('#')) continue
      const [wrong, right] = t.split('\t')
      if (!wrong || right === undefined) fail(`${file}：格式須為「誤 TAB 正」，讀到「${t}」`)
      const hits = lines.reduce((n, l) => n + l.split(wrong).length - 1, 0)
      if (!hits && requireHit) fail(`${label}：校訂表的「${wrong}」在本頁 0 命中`)
      if (hits) {
        lines = lines.map((l) => l.replaceAll(wrong, right))
        gcvCommonHits.set(wrong, (gcvCommonHits.get(wrong) ?? 0) + hits)
      }
    }
  }
  // 全書性的 GCV 固定誤讀（同一個誤讀散在多頁），一張表套所有 GCV 頁，命中數建置完驗總數
  applyCorrections(join(root, 'data/materials/chronology/corrections/gcv-common.tsv'), 'gcv-common', false)
  // 該頁逐處核過原頁圖的錯字，每條在該頁至少命中一次
  applyCorrections(join(root, 'data/materials/chronology/corrections', `pg-${String(pdfPage).padStart(2, '0')}.tsv`), `pg-${pdfPage}（原書第 ${bookPage} 頁）`, true)
  return lines
}
// gcv-common.tsv 每一條在全書至少要命中一次，否則它已經失效（底稿換過或已被別的表改掉）
const gcvCommonHits = new Map()

// ── 兩層來源依 PDF 頁序合併成一條連續的行流 ───────────────────────────────────
// 377–393（PDF 25–41）用校訂全文；其餘 353–376、394–417（PDF 1–24、42–65）
// 用 Google Cloud Vision 辨讀稿。全書只處理到原書 417 頁（PDF 65）——418 頁起是
// 後記，不是年目正文，不在年表的範圍內。
const stream = [] // { text, bookPage, source: 'verified' | 'gcv' }
for (let pdfPage = 1; pdfPage <= 65; pdfPage += 1) {
  const bookPage = pdfPage + PAGE_OFFSET
  const source = verifiedBookPages.has(bookPage) ? 'verified' : 'gcv'
  const lines = source === 'verified' ? linesFromVerified(bookPage) : linesFromGcv(pdfPage, bookPage)
  for (const text of lines) stream.push({ text, bookPage, source })
}

// 年目的抬頭自成一行：「（民前｜民國）？某種寫法的紀年＋年＋半形或全形括號裡的西元」。
// 這裡只拿它當分段標記，不拿括號裡的數字或民國紀年當年份依據——校訂全文那 17 頁的
// 紀年是人核過的，但另外 48 頁是機器辨讀，數字本身可能就是誤讀；年目的先後順序
// 逐年遞增，位置比數字可靠。
const HEADING_MARKER = /^(?:民前|民國)?[^\d\s（(]{0,4}年[（(](\d{4})[）)]$/

// 段落只在句號之後、下一句以日期起頭的位置斷開。日期的長相以已核過的十七頁實際出現的為準：
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

// 走一遍全段，靠抬頭切成 71 個連續的年目段落
const runsArr = []
let current = null
for (const line of stream) {
  const m = HEADING_MARKER.exec(line.text)
  if (m) {
    current = { printedYear: Number(m[1]), printedHeadingLine: line.text, text: '', marks: [] }
    runsArr.push(current)
    current.marks.push({ bookPage: line.bookPage, offset: 0, source: line.source })
    continue
  }
  if (!current) fail(`第一個年目抬頭之前出現了正文（原書第 ${line.bookPage} 頁）：${line.text.slice(0, 20)}`)
  const lastMark = current.marks.at(-1)
  if (lastMark.bookPage !== line.bookPage || lastMark.source !== line.source) {
    current.marks.push({ bookPage: line.bookPage, offset: current.text.length, source: line.source })
  }
  current.text += line.text
}
if (runsArr.length !== index.length) fail(`偵測到 ${runsArr.length} 個年目抬頭，年目索引記了 ${index.length} 個，兩者須相等`)

// gcv-common.tsv 的每一條在全書至少命中一次（0 命中＝這一條已失效，該刪或該查）
const gcvCommonFile = join(root, 'data/materials/chronology/corrections/gcv-common.tsv')
if (existsSync(gcvCommonFile)) {
  for (const row of readFileSync(gcvCommonFile, 'utf8').split('\n')) {
    const t = row.trim()
    if (!t || t.startsWith('#')) continue
    const wrong = t.split('\t')[0]
    if (!gcvCommonHits.get(wrong)) fail(`gcv-common.tsv 的「${wrong}」全書 0 命中`)
  }
}

// 年目依位置對齊 page_index.csv：兩邊都是逐年遞增排列，順序本身就是核對依據
for (let i = 0; i < index.length; i += 1) runsArr[i].ce = index[i].ce

// 分段，並把頁碼／來源的字元位置換算到段落座標
const textByCe = new Map()
for (const run of runsArr) {
  const paragraphs = splitParagraphs(run.text)
  const rejoined = paragraphs.join('')
  if (rejoined !== run.text) fail(`${run.ce} 年分段後與原文不符（${rejoined.length} 對 ${run.text.length} 字）`)
  const bounds = []
  let at = 0
  for (const p of paragraphs) { bounds.push(at); at += p.length }
  const pageBreaks = run.marks.map(({ bookPage, offset, source }) => {
    let para = 0
    while (para + 1 < bounds.length && bounds[para + 1] <= offset) para += 1
    return { bookPage, para, offset: offset - bounds[para], source }
  })
  const sources = new Set(run.marks.map((m) => m.source))
  const transcriptionStatus = sources.size > 1 ? 'mixed' : [...sources][0]
  textByCe.set(run.ce, { paragraphs, pageBreaks, charCount: run.text.length, transcriptionStatus, run })
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

const STATUS_LABEL = {
  verified: '人工逐頁校訂',
  gcv: 'Google Cloud Vision 未校辨讀稿',
  mixed: '人工逐頁校訂與 Google Cloud Vision 未校辨讀稿並存（本年條目跨越兩種材料的交界）',
}

// ── 組出年目 ────────────────────────────────────────────────────────────────
const transcribedFirst = 353 // PDF 1，全書年目正文的起點
const transcribedLast = 417 // PDF 65；418 頁起是後記，不算年目正文
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
    // 只有最後一年（1963）會被切斷：條目續至 417 頁以後的後記與附錄，本站止於 417 頁
    const tailCut = next ? next.bookPage > transcribedLast : true
    out.text = {
      paragraphs: text.paragraphs,
      pageBreaks: text.pageBreaks,
      charCount: text.charCount,
      coverage: tailCut ? '部分' : '全年',
      transcriptionStatus: text.transcriptionStatus,
      transcriptionStatusLabel: STATUS_LABEL[text.transcriptionStatus],
    }
    if (tailCut) out.text.coverageNote = `本年的條目續至原書第 ${transcribedLast + 1} 頁以後（後記與附錄），本站的年目正文止於第 ${transcribedLast} 頁。`
    if (text.transcriptionStatus === 'mixed') {
      out.text.coverageNote = `${out.text.coverageNote ?? ''} 本年條目橫跨已校訂與未校訂的頁面，各段的來源逐段標明，引用前請先看清楚該段屬於哪一種。`.trim()
    }
  }
  return out
})

const withText = years.filter((y) => y.text)
const totalChars = withText.reduce((n, y) => n + y.text.charCount, 0)
const verifiedYears = years.filter((y) => y.text?.transcriptionStatus === 'verified').length
const gcvYears = years.filter((y) => y.text?.transcriptionStatus === 'gcv').length
const mixedYears = years.filter((y) => y.text?.transcriptionStatus === 'mixed').length

const doc = {
  schemaVersion: '2.0',
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
    bookPages: `${verifiedFirst}–${verifiedLast}`,
    pageCount: verifiedFiles.length,
    method:
      'macOS Vision 辨讀底稿加逐頁對照原頁圖的人工校訂表；校訂表每條在該頁必須剛好命中一次。用字保留原書字形（爲、僞、眞、欵），檢索與需要通用形的呈現在讀取端各自套異體字對照表。',
    paragraphing:
      '原書的年目正文連排不分段。本站的分段只在句號之後、下一句以日期起頭的位置斷開，字句一字未動；建置時逐年比對各段接回去與原頁的行接起來是否相同。',
  },
  unreviewedOcr: {
    engine: 'Google Cloud Vision（DOCUMENT_TEXT_DETECTION，languageHints: zh-Hant）',
    bookPages: `353–${verifiedFirst - 1}、${verifiedLast + 1}–417`,
    pageCount: 65 - verifiedFiles.length,
    note:
      '這批頁面經過書眉、頁碼與版面雜訊的結構性剔除，標點依鄰字歸位為全形（含彎引號轉「」『』、句號串與重出），引號成對與否照辨讀稿原樣。字形未正規化——換了辨讀引擎，既有的異體字誤讀比例未經核對，不套用校訂全文那組替換表；逐處核過原頁圖的錯字另收校訂表。未經逐頁人工校對，全書未抽樣量測字準確率；要引用請先自行核對原頁圖。',
  },
  errata: {
    official: {
      note: '原書 419 末所附「本文勘誤表」三條，落在已校訂範圍內。',
      items: [
        { bookPage: 379, line: 4, wrong: '汴', right: '濮' },
        { bookPage: 381, line: 23, wrong: '船', right: '全' },
        { bookPage: 386, line: 26, wrong: '汴', right: '濮' },
      ],
    },
    foundHere: {
      note: '勘誤表未收，由本專案在已校訂範圍內核出。年目的兩處誤植已在下表標明，正文的三處一律照原書轉錄，不在正文改字。',
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
    verifiedYears,
    gcvYears,
    mixedYears,
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
console.log(`人工逐頁校訂 ${verifiedYears} 年、Google Cloud Vision 未校辨讀稿 ${gcvYears} 年、跨界混合 ${mixedYears} 年`)
console.log(`《言論集》${placed} 篇掛到 ${years.filter((y) => y.pieces).length} 個年目上 → ${OUT}`)
