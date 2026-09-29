#!/usr/bin/env node
// 書外文獻的辨讀讀稿：從 GCV 原始回應在符號層重建直排的閱讀序，切成一件一件的文獻，
// 寫 data/processed/external-drafts/ZJR-NNN.json。
//
// 為什麼不直接用 GCV 的段落：兩件的版面都是上下兩層欄位，同一條 x 上下兩層各有一欄，
// GCV 常把兩層併進同一段（pg-03 的記者按語裡混進下層另一篇文章的字）；哥德件是照相
// 掃描帶歪斜，段內的欄序也有錯。所以拿逐字座標自己排：頁內先按分層線切層，層內把
// 符號按 x 聚成欄、欄按 x 由大到小、欄內按 y 由小到大——這就是直排右起的閱讀序。
//
// 人工判定全部收在 data/materials/external/<SRC-id>/segmentation.json（進版控）：
//   paragraphMark  段落靠什麼標示。columnBreak（預設，報刊）段首不低格，段落換在欄的
//               交界上；indent（書）段首低格，低幾格算段首由 indentCells 定，欄排滿與否
//               不作數。《黨的組織與領導》段首低二格，量出來的縮排落在 1.75–2.9 格，接續欄
//               落在 -0.4–1.27 格，門檻取 1.3。
//   pages[]     每頁的界內窗（bodyX、bodyY）、分層線（bandSplitY）、原刊頁碼。
//               界外是版心、頁碼與欄外篇目（pg-01 右緣的「關於中德關係的討論　朱家驊博士」
//               這種邊欄是篇目資料，不是正文）。數值從符號座標量出，逐頁對過原頁圖。
//   ignores[]   從流裡剔除的字串（各須命中剛好一次）：篇題欄（titleInSource 已收在
//               related_index.json，讀稿不重複）與雜訊。
//   documents[] 各件的起錨（與收錨），按流序；件與件之間不許有未宣告的字。
//   leadingNote / trailingNote  流頭流尾捨棄的字為什麼捨（前一篇的末尾、下一篇文章）。
//
// 校訂表 data/materials/external/<SRC-id>/corrections/pg-NN.tsv（誤<TAB>正，\n 表換行）：
// 每條在全流命中剛好一次，且命中處落在記的那一頁，否則中止——判準與年譜、言論集同一套。
//
// 讀稿的定位與全書那批相同：索引與切段的依據，不是權威正文。要引用的句子回原頁圖逐字核。
//
// 手寫件走另一條路：segmentation.json 宣告 transcript 時，讀稿改由
// data/materials/external/<SRC-id>/transcript/<ZJR-id>.txt 供給，不碰 GCV。2026-09-11 收 JACAR
// C13050247000 時加的——那兩頁是行草手寫，Google Cloud Vision 三次辨讀（語言提示 zh-Hant、ja、
// 不給）只讀到表格的印刷欄名，手寫本文一字未出，字框重建這條路沒有輸入可用。轉錄檔的體例：
// # 開頭是註解，空行分段，「@pg N」宣告以下各段起於第 N 頁；正文照錄，不套標點歸位。
//
// --dump <SRC-id>：只印重建出來的流（帶頁與段界），供人工定錨與核對原頁圖，不寫檔。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { widen, cornerQuotes, dots } from './lib/punctuation.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

// --check：照常讀材料、套校訂、跑所有判準，但不寫檔也不刪檔。validate 拿它查
// 「校訂表的每一條在該頁剛好命中一次」——那道判準本來只在建置時跑，validate 因此
// 對一張命中 0 次的校訂表照樣回綠（2026-09-22 實測）。
const checkOnly = process.argv.includes('--check')
const dumpAt = process.argv.indexOf('--dump')
const dumpId = dumpAt >= 0 ? process.argv[dumpAt + 1] : null
if (dumpAt >= 0 && !dumpId) fail('--dump 要帶 SRC-id')

const sources = JSON.parse(readFileSync(join(root, 'data/derived/sources.json'), 'utf8')).sources
  .filter((s) => !s.primaryPending)
const relatedDocs = JSON.parse(readFileSync(join(root, 'data/derived/related_index.json'), 'utf8')).documents

// 段末視為說完了的字：跨層、跨頁時，前一段以這些收尾就不把下一層的頭一段接上去。
const TERMINAL = new Set(['。', '？', '！', '.', '」', '』', '）', ')', '：', ':'])

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// ---- 一頁 → 各層的段落單元 -------------------------------------------------

const symbolsOf = (gcv) => {
  const out = []
  for (const block of gcv.fullTextAnnotation.pages[0].blocks) {
    for (const para of block.paragraphs) {
      for (const word of para.words) {
        for (const sym of word.symbols) {
          const vs = sym.boundingBox.vertices
          const xs = vs.map((v) => v.x ?? 0)
          const ys = vs.map((v) => v.y ?? 0)
          out.push({
            cx: xs.reduce((a, b) => a + b) / 4,
            cy: ys.reduce((a, b) => a + b) / 4,
            top: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            text: sym.text,
          })
        }
      }
    }
  }
  return out
}

// 層內：符號按 cx 聚欄（相鄰 cx 差超過半個字寬就換欄）、欄右起、欄內由上而下。
// 分段的兩個判準，都在原頁圖上核過：
//   一、欄頂低於層頂一格以上是新段（篇端註記、詩行、按語、節標都是這一種）；
//   二、本刊的正文段落不低格，段落換在欄的交界上——前一欄沒排滿（欄底高於層底一格
//       以上）就是段落在那裡結束，下一欄起新段。
// 欄頂的量法要避開句讀：直排句號的字框只佔字格下半，一欄以「。」起頭時字框頂比字格頂
// 低半格，直接拿字框頂會把接續欄誤判成低格，所以句讀起頭的欄拿第二個字往回推一格。
// 層頂與層底不取極值取中位數（只算排滿的欄）——旋轉的拉丁字母字距小、字框零碎，
// 極值會被它拉走，pg-02 的 Frankfurter Zeitung 一欄就把整層的頂線拉高了一格。
const PUNCT = new Set(['。', '，', '、', '；', '：', '？', '！', '」', '』', '）', ')', '.', ','])
const bandUnits = (syms, charW, indentCells, byIndent) => {
  const sorted = [...syms].sort((a, b) => b.cx - a.cx)
  const cols = []
  for (const s of sorted) {
    const cur = cols.at(-1)
    if (cur && cur.items.at(-1).cx - s.cx <= charW * 0.5) cur.items.push(s)
    else cols.push({ items: [s] })
  }
  const pitches = []
  for (const c of cols) {
    c.items.sort((a, b) => a.cy - b.cy)
    for (let i = 1; i < c.items.length; i += 1) {
      const d = c.items[i].top - c.items[i - 1].top
      if (d > charW * 0.5 && d < charW * 2) pitches.push(d)
    }
  }
  const vpitch = pitches.length ? median(pitches) : charW * 1.1
  for (const c of cols) {
    c.cx = median(c.items.map((s) => s.cx))
    c.charW = median(c.items.map((s) => s.w))
    c.text = c.items.map((s) => s.text).join('')
    c.top = PUNCT.has(c.items[0].text) && c.items.length > 1
      ? Math.min(c.items[0].top, c.items[1].top - vpitch)
      : c.items[0].top
    c.bottom = Math.max(...c.items.map((s) => s.top)) + vpitch
  }
  const maxN = Math.max(...cols.map((c) => c.items.length))
  const full = cols.filter((c) => c.items.length >= Math.max(8, maxN * 0.5))
  const src = full.length ? full : cols
  // 頂線在 byIndent 的刊物取四分位而不取中位數：辨讀漏掉欄頂的字是這一批的常態，
  // pg-22 十六欄有一半漏了頭一兩個字，中位數因此被往下拉一格半，於是沒漏字的那八欄
  // 量出負的縮排，真正低二格的那一欄反而量成低 7.3 格。低分位數釘在沒漏字的那一群上。
  const quant = (xs, q) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * q))] }
  const topLine = byIndent ? quant(src.map((c) => c.top), 0.25) : median(src.map((c) => c.top))
  const botLine = byIndent ? quant(src.map((c) => c.bottom), 0.75) : median(src.map((c) => c.bottom))
  const indented = (c) => c.top - topLine > vpitch * indentCells
  const endsShort = (c) => botLine - c.bottom > vpitch * 1.0
  // 篇端註記與按語的小字接欄（縮排的整塊，欄與欄之間段落沒斷）幾何上與新段分不開
  // ——GCV 的字框量不出鉛字的號數。這一類由 segmentation.json 的 joins 逐處宣告。
  // byIndent 的刊物另要前一欄的收尾佐證：欄頂掉字會讓接續欄看起來縮排（pg-04 的
  // 「着——」漏讀，整欄低了 2.84 格），而前一欄排滿到層底、末字又不是句讀時，句子顯然
  // 還沒說完，那一欄無論低幾格都是同一段的下半截。段落真的在前一欄結束時，前一欄要嘛
  // 沒排滿，要嘛以句讀收尾。
  const closed = (c) => !c || endsShort(c) || TERMINAL.has(c.text.at(-1))
  const units = []
  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i]
    const prev = cols[i - 1]
    const starts = indented(c) && (!byIndent || closed(prev))
    if (units.length === 0 || starts || (!byIndent && endsShort(prev))) {
      units.push({ text: c.text, indentedStart: starts })
    } else units.at(-1).text += c.text
  }
  units.at(-1).endsShortLast = endsShort(cols.at(-1))
  return units
}

// ---- 主流程 ---------------------------------------------------------------

const outDir = join(root, 'data/processed/external-drafts')
mkdirSync(outDir, { recursive: true })
const written = new Set()
let totalDocs = 0

for (const src of sources) {
  const base = join(root, 'data/materials/external', src.id)
  if (!existsSync(base)) fail(`${src.id}：找不到 ${base}`)
  const segPath = join(base, 'segmentation.json')
  if (!existsSync(segPath) && dumpId !== src.id) fail(`${src.id}：找不到 segmentation.json（先用 --dump ${src.id} 看流再定錨）`)
  const seg = existsSync(segPath) ? JSON.parse(readFileSync(segPath, 'utf8')) : null
  if (dumpId && dumpId !== src.id) continue
  // 段落靠什麼標示：columnBreak 是報刊的排法，段首不低格，段落換在欄的交界上；
  // indent 是書的排法，段首低二格，欄排滿與否不作數。兩者的判準見 bandUnits。
  const mark = seg?.paragraphMark ?? 'columnBreak'
  if (!['columnBreak', 'indent'].includes(mark)) fail(`${src.id}：paragraphMark 只能是 columnBreak 或 indent，宣告的是「${mark}」`)
  const byIndent = mark === 'indent'

  // 轉錄檔供給的讀稿（手寫件）：一件一檔，不走字框重建，也不套標點歸位（正文照錄他館的翻刻）。
  if (seg?.transcript) {
    const t = seg.transcript
    const docsHere = relatedDocs.filter((d) => d.sourceId === src.id)
    const declared = t.documents ?? []
    if (declared.length !== docsHere.length ||
        declared.some((d) => !docsHere.find((r) => r.id === d.docId)))
      fail(`${src.id}：transcript 的 documents 與 related_index 對不上（${declared.map((d) => d.docId)} vs ${docsHere.map((d) => d.id)}）`)
    if (!t.status || !t.statusNote) fail(`${src.id}：transcript 要寫 status 與 statusNote（正文出自哪裡、限度在哪）`)
    const declaredPages = new Set((seg.pages ?? []).map((s) => s.sourcePage ?? s.page))
    for (const d of declared) {
      const file = join(base, 'transcript', d.file)
      if (!existsSync(file)) fail(`${src.id} ${d.docId}：找不到轉錄檔 ${file}`)
      const rel = docsHere.find((r) => r.id === d.docId)
      const paras = []
      const pageBreaks = []
      let page = null
      let blank = true
      for (const [i, raw] of readFileSync(file, 'utf8').split('\n').entries()) {
        const line = raw.replace(/\r$/, '')
        if (line.startsWith('#')) continue
        const pg = line.match(/^@pg\s+(\d+)$/)
        if (pg) {
          page = Number(pg[1])
          if (!declaredPages.has(page)) fail(`${src.id} ${d.file}:${i + 1}：@pg ${page} 不在 segmentation 的 pages 裡`)
          blank = true
          continue
        }
        if (!line.trim()) { blank = true; continue }
        if (page === null) fail(`${src.id} ${d.file}:${i + 1}：正文出現在任何 @pg 之前`)
        if (blank) {
          pageBreaks.push({ sourcePage: page, para: paras.length, offset: 0 })
          paras.push(line)
          blank = false
        } else paras[paras.length - 1] += line
      }
      if (!paras.length) fail(`${src.id} ${d.docId}：轉錄檔裡沒有正文`)
      // 頁界只留每一頁第一次出現的位置，與字框那條路同一個判準。
      const seen = new Set()
      const breaks = pageBreaks.filter((b) => (seen.has(b.sourcePage) ? false : seen.add(b.sourcePage)))
      const text = paras.join('\n')
      const doc = {
        id: d.docId,
        sourceId: src.id,
        title: rel.title,
        status: t.status,
        statusNote: t.statusNote,
        charCount: text.replace(/\s/g, '').length,
        textVersion: createHash('sha256').update(text).digest('hex').slice(0, 12),
        manualCorrections: 0,
        corrections: [],
        paragraphs: paras,
        pageBreaks: breaks,
      }
      if (t.sourceUrl) doc.transcriptSource = t.sourceUrl
      if (!checkOnly) writeFileSync(join(outDir, `${d.docId}.json`), `${JSON.stringify(doc, null, 2)}\n`)
      written.add(`${d.docId}.json`)
      console.log(`${d.docId}（${rel.title}）：轉錄稿 ${paras.length} 段 ${doc.charCount} 字，原刊頁 ${breaks.map((b) => b.sourcePage).join('、')}`)
      totalDocs += 1
    }
    continue
  }

  // 1. 逐頁重建，收成帶頁籤的段落流。paragraph = { pieces: [{ text, page }] }
  const pageSpecs = seg?.pages ?? readdirSync(join(base, 'gcv/json'))
    .filter((f) => /^pg-\d+\.json$/.test(f))
    .map((f) => ({ page: Number(f.match(/\d+/)[0]) }))
  const paragraphs = []
  for (const spec of pageSpecs) {
    const n = String(spec.page).padStart(2, '0')
    const gcv = JSON.parse(readFileSync(join(base, `gcv/json/pg-${n}.json`), 'utf8'))
    let syms = symbolsOf(gcv)
    const charW = median(syms.map((s) => s.w))
    if (spec.bodyX) syms = syms.filter((s) => s.cx >= spec.bodyX[0] && s.cx <= spec.bodyX[1])
    if (spec.bodyY) syms = syms.filter((s) => s.cy >= spec.bodyY[0] && s.cy <= spec.bodyY[1])
    if (syms.length === 0) fail(`${src.id} pg-${n}：界內窗裡一個符號都沒有`)
    const splits = spec.bandSplitY ?? []
    const bands = [...splits, Infinity].map((hi, i) => {
      const lo = i === 0 ? -Infinity : splits[i - 1]
      return syms.filter((s) => s.cy > lo && s.cy <= hi)
    }).filter((b) => b.length)

    const pageParas = []
    for (const band of bands) {
      const units = bandUnits(band, charW, spec.indentCells ?? seg?.indentCells ?? 0.6, byIndent)
      units[0].bandStart = true
      pageParas.push(...units)
    }
    // 標點歸位與言論集讀稿走同一份（半形轉全形、引號、句號串與重出）。
    for (const p of pageParas) p.text = dots(cornerQuotes(widen(p.text))).text

    // 2. 接流：層頭（或頁頭）第一段沒有段首縮排、前一層的末段沒說完（末字不是句讀收尾、
    // 末欄排滿到層底）的，是同一段的下半截。byIndent 的刊物不看末欄排滿到哪裡——頁末
    // 那一欄的底線是各欄底的分位數，末欄本身排到了底照樣量得出一格多的短少（pg-07 末欄
    // 三十八字排滿，量出來短 1.12 格），據以擋下接續，會把句子切在頁界上。
    for (const p of pageParas) {
      const prev = paragraphs.at(-1)
      const joinable = p.bandStart && !p.indentedStart && prev &&
        (byIndent || !prev.endsShort) &&
        !TERMINAL.has(prev.pieces.at(-1).text.at(-1))
      if (joinable) {
        prev.pieces.push({ text: p.text, page: spec.page })
        prev.endsShort = p.endsShortLast ?? false
      } else {
        paragraphs.push({ pieces: [{ text: p.text, page: spec.page }], endsShort: p.endsShortLast ?? false })
      }
    }
  }

  if (dumpId === src.id) {
    for (const [i, p] of paragraphs.entries()) {
      for (const piece of p.pieces) console.log(`¶${String(i).padStart(3)} pg-${piece.page} | ${piece.text}`)
    }
    process.exit(0)
  }

  // 4. 宣告過的接段：以 head 起頭的那一段接回前一段（小字按語與篇端註記的接欄，
  // 幾何判不出來，人工對原頁圖逐處判）。head 須命中剛好一段的開頭。
  for (const j of seg.joins ?? []) {
    const hits = paragraphs.filter((p) => p.pieces.map((x) => x.text).join('').startsWith(j.head))
    if (hits.length !== 1) fail(`${src.id}：join「${j.head.slice(0, 16)}⋯」起頭的段有 ${hits.length} 段，須剛好 1 段`)
    const idx = paragraphs.indexOf(hits[0])
    if (idx === 0) fail(`${src.id}：join「${j.head.slice(0, 16)}⋯」是流頭第一段，沒有前一段可接`)
    paragraphs[idx - 1].pieces.push(...hits[0].pieces)
    paragraphs[idx - 1].endsShort = hits[0].endsShort
    paragraphs.splice(idx, 1)
  }

  // 5. 校訂表：接完流再套，改法才寫得到跨欄、跨層的錯（欄頂被漏認的句讀就長在段界上）。
  // 每條在全流命中剛好一次，且命中處落在記的那一頁。
  paragraphs.corrections = []
  // 走訪 corrections/ 目錄本身，不從已宣告的頁次去組檔名：按頁次組路徑時，頁次打錯或
  // 該頁不在本件範圍的校訂表沒有人會讀到，而 validate 照樣回綠（2026-09-22 審查）。
  const corrDir = join(base, 'corrections')
  const declared = new Set(pageSpecs.map((spec) => spec.page))
  const corrFiles = existsSync(corrDir)
    ? readdirSync(corrDir).filter((f) => /^pg-\d+\.tsv$/.test(f)).sort()
    : []
  for (const file of corrFiles) {
    const page = Number(file.slice(3, -4))
    if (!declared.has(page)) {
      fail(`${src.id} corrections/${file}：pg-${page} 不在本件宣告的頁次裡，這張表沒有人會讀到`)
    }
  }
  let corrLines = 0
  for (const spec of pageSpecs) {
    const n = String(spec.page).padStart(2, '0')
    const corrPath = join(base, `corrections/pg-${n}.tsv`)
    if (!existsSync(corrPath)) continue
    readFileSync(corrPath, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '')
      if (!line.trim() || line.startsWith('#')) return
      const [wrongRaw, rightRaw = ''] = line.split('\t')
      const wrong = wrongRaw.replaceAll('\\n', '\n')
      const right = rightRaw.replaceAll('\\n', '\n')
      if (wrong.includes('\n') || right.includes('\n')) fail(`${src.id} corrections/pg-${n}.tsv:${i + 1}：流層的校訂不吃換行，段界的問題用 joins 宣告`)
      const at = locate(paragraphs, wrong, `${src.id} corrections/pg-${n}.tsv:${i + 1}`)
      const p = paragraphs[at.para]
      let pos = 0
      let hitPage = null
      for (const piece of p.pieces) {
        if (at.offset < pos + piece.text.length) { hitPage = piece.page; break }
        pos += piece.text.length
      }
      if (hitPage !== spec.page) fail(`${src.id} corrections/pg-${n}.tsv:${i + 1}「${wrong}」命中在 pg-${hitPage}，不在記的那一頁`)
      cutSpan(p, at.offset, wrong.length)
      insertAt(p, at.offset, right)
      paragraphs.corrections.push({ page: spec.page, from: wrong, to: right })
      corrLines += 1
    })
  }
  if (corrFiles.length) console.log(`  ${src.id} 校訂表 ${corrFiles.length} 張 ${corrLines} 條，逐條命中剛好一次`)

  // 6. 宣告過的分段：以 before 起首的位置把段切開（清單的相鄰兩點排在同一欄裡相接、
  // 前欄又排滿到層底時，幾何上切不開，人工對原頁圖宣告）。
  for (const sp of seg.splits ?? []) {
    const at = locate(paragraphs, sp.before, `${src.id} split「${sp.before.slice(0, 16)}⋯」`)
    if (at.offset === 0) continue
    const p = paragraphs[at.para]
    const head = { pieces: [], endsShort: false }
    const tail = { pieces: [], endsShort: p.endsShort }
    let pos = 0
    for (const piece of p.pieces) {
      const cut = Math.min(Math.max(at.offset - pos, 0), piece.text.length)
      if (cut > 0) head.pieces.push({ text: piece.text.slice(0, cut), page: piece.page })
      if (cut < piece.text.length) tail.pieces.push({ text: piece.text.slice(cut), page: piece.page })
      pos += piece.text.length
    }
    paragraphs.splice(at.para, 1, head, tail)
  }

  // 6b. 宣告過的補段：整條漏讀的節標（自成一欄、字大而稀，GCV 對 pg-04 的「一　前言」
  // 與 pg-69 的「2.對人民團體的領導」都沒有回傳字框），人工對原頁圖補回，插在 before 起首
  // 的那一段之前，頁籤照宣告。before 須落在段首；落在段中的是接段或校訂，不是補段。
  for (const ins of seg.inserts ?? []) {
    if (!ins.text || !ins.before || !ins.page) fail(`${src.id}：insert 要有 text、before、page`)
    if (!pageSpecs.some((s) => s.page === ins.page)) fail(`${src.id}：insert「${ins.text}」的 page ${ins.page} 不在 pages 裡`)
    const at = locate(paragraphs, ins.before, `${src.id} insert「${ins.text}」的 before`)
    if (at.offset !== 0) fail(`${src.id}：insert「${ins.text}」的 before 不在段首（位移 ${at.offset}）`)
    paragraphs.splice(at.para, 0, { pieces: [{ text: ins.text, page: ins.page }], endsShort: false })
  }

  // 7. 剔除宣告過的字串（篇題欄、雜訊），各須命中剛好一次。
  const streamText = () => paragraphs.map((p) => p.pieces.map((x) => x.text).join('')).join('\n')
  for (const ig of seg.ignores ?? []) {
    let found = 0
    for (const p of paragraphs) {
      const text = p.pieces.map((x) => x.text).join('')
      let at = text.indexOf(ig.text)
      while (at >= 0) { found += 1; at = text.indexOf(ig.text, at + 1) }
    }
    if (found !== 1) fail(`${src.id}：ignore「${ig.text.slice(0, 20)}⋯」命中 ${found} 次，須剛好 1 次`)
    for (const p of paragraphs) {
      const text = p.pieces.map((x) => x.text).join('')
      const at = text.indexOf(ig.text)
      if (at < 0) continue
      cutSpan(p, at, ig.text.length)
    }
  }
  const emptied = paragraphs.filter((p) => p.pieces.every((x) => !x.text))
  for (const p of emptied) paragraphs.splice(paragraphs.indexOf(p), 1)

  // 5. 起錨切件。錨在全流命中剛好一次；錨落在段中就把段切開。
  const docsHere = relatedDocs.filter((d) => d.sourceId === src.id)
  const segDocs = seg.documents ?? []
  if (segDocs.length !== docsHere.length ||
      segDocs.some((d, i) => !docsHere.find((r) => r.id === d.docId)))
    fail(`${src.id}：segmentation 的 documents 與 related_index 對不上（${segDocs.map((d) => d.docId)} vs ${docsHere.map((d) => d.id)}）`)

  const anchors = []
  for (const d of segDocs) {
    anchors.push({ ...d, at: locate(paragraphs, d.start, `${src.id} ${d.docId} 的起錨`) })
    if (d.end) {
      const e = locate(paragraphs, d.end, `${src.id} ${d.docId} 的收錨`)
      anchors.at(-1).endAt = { para: e.para, offset: e.offset + d.end.length }
    }
  }
  for (let i = 1; i < anchors.length; i += 1) {
    if (cmpPos(anchors[i].at, anchors[i - 1].at) <= 0) fail(`${src.id}：${anchors[i].docId} 的起錨在 ${anchors[i - 1].docId} 之前，順序錯了`)
  }

  // 流頭與流尾的捨棄要有說法；件與件之間不許有縫（下一件從上一件結束處接著起）。
  const leading = sliceStream(paragraphs, { para: 0, offset: 0 }, anchors[0].at)
  if (leading.trim() && !seg.leadingNote) fail(`${src.id}：流頭有 ${leading.length} 字沒宣告要捨（leadingNote）：「${leading.slice(0, 30)}⋯」`)
  const last = anchors.at(-1)
  const endPos = { para: paragraphs.length - 1, offset: paragraphs.at(-1).pieces.map((x) => x.text).join('').length }
  if (last.endAt) {
    const trailing = sliceStream(paragraphs, last.endAt, endPos)
    if (trailing.trim() && !seg.trailingNote) fail(`${src.id}：流尾有 ${trailing.length} 字沒宣告要捨（trailingNote）：「${trailing.slice(0, 30)}⋯」`)
  }
  for (let i = 0; i < anchors.length - 1; i += 1) {
    if (anchors[i].endAt) {
      const gap = sliceStream(paragraphs, anchors[i].endAt, anchors[i + 1].at)
      if (gap.trim()) fail(`${src.id}：${anchors[i].docId} 收錨之後、${anchors[i + 1].docId} 起錨之前還有字：「${gap.slice(0, 30)}⋯」`)
    }
  }

  // 側記號：data/materials/external/<SRC-id>/side-marks.tsv，人工逐處對原頁圖判讀。
  // 欄：docId、段序、種類、原文（⟦⟧界定被圈的字，前後帶文脈定位）、註記。
  // 文脈（去掉界定符）在該段須命中剛好一次，位移由命中處算。
  const sideMarks = new Map()
  const smPath = join(base, 'side-marks.tsv')
  if (existsSync(smPath)) {
    readFileSync(smPath, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '')
      if (!line.trim() || line.startsWith('#')) return
      const [docId, paraRaw, kind, ctx, note = ''] = line.split('\t')
      if (!['專名號', '書名號'].includes(kind)) fail(`${src.id} side-marks.tsv:${i + 1}：種類「${kind}」不在封閉集合`)
      const m = ctx?.match(/^(.*)⟦(.+)⟧(.*)$/s)
      if (!m) fail(`${src.id} side-marks.tsv:${i + 1}：原文欄缺 ⟦⟧ 界定`)
      if (!sideMarks.has(docId)) sideMarks.set(docId, [])
      sideMarks.get(docId).push({ para: Number(paraRaw), kind, pre: m[1], mark: m[2], post: m[3], note, line: i + 1 })
    })
  }

  // 6. 逐件輸出。
  const pageOf = Object.fromEntries(pageSpecs.map((s) => [s.page, s.sourcePage ?? s.page]))
  const matchedHeadings = new Set()
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i]
    const to = a.endAt ?? (i + 1 < anchors.length ? anchors[i + 1].at : endPos)
    const { paras, pageBreaks } = extract(paragraphs, a.at, to, pageOf)
    if (!paras.length) fail(`${src.id} ${a.docId}：切出來是空的`)
    const rel = docsHere.find((r) => r.id === a.docId)
    const text = paras.join('\n')
    const corrections = (paragraphs.corrections ?? []).filter((c) => text.includes(c.to))
    // 逐字校過的來源在 segmentation.json 宣告 review（2026-09-29 教師節兩件起）：全文逐欄對過原頁圖，
    // 辨讀錯字全數寫進校訂表，另由一個未參與判讀的人對原頁圖複核過一次。宣告了才寫成校訂稿，
    // 沒宣告的一律是未校辨讀稿。
    const review = seg.review
    if (review && (review.status !== '人工逐字校訂' || !review.verifiedAt || !review.glyphPolicy || !review.statusNote))
      fail(`${src.id}：segmentation.json 的 review 要有 status「人工逐字校訂」、verifiedAt、glyphPolicy 與 statusNote`)
    const doc = {
      id: a.docId,
      sourceId: src.id,
      title: rel.title,
      status: review ? review.status : '未校辨讀稿',
      statusNote: review ? review.statusNote : 'Google Cloud Vision 的辨讀結果，未經逐字人工校訂。直排的欄序由字框座標重排，上下兩層與跨頁的接續按段首縮排與句讀判定。引用前請核對原頁圖。',
      ...(review ? { verifiedAt: review.verifiedAt, glyphPolicy: review.glyphPolicy } : {}),
      charCount: text.replace(/\s/g, '').length,
      textVersion: createHash('sha256').update(text).digest('hex').slice(0, 12),
      manualCorrections: corrections.length,
      corrections: corrections.map((c) => ({ sourcePage: pageOf[c.page], from: c.from, to: c.to })),
      paragraphs: paras,
      pageBreaks,
    }
    // 節標：segmentation 的 headings[] 逐條與本件整段相符的段落剛好一段，寫成 para 索引。
    // 層級是封閉集合 1–4，第一條須是 1 級，之後每條最多比前一條深一級。
    if (seg.headings?.length) {
      const mine = []
      for (const h of seg.headings) {
        if (![1, 2, 3, 4].includes(h.level)) fail(`${src.id}：節標「${h.text}」的 level ${h.level} 不在 1–4`)
        const idx = paras.map((p, k) => (p === h.text ? k : -1)).filter((k) => k >= 0)
        if (idx.length > 1) fail(`${src.id} ${a.docId}：節標「${h.text}」整段相符的有 ${idx.length} 段，須剛好 1 段`)
        if (idx.length === 1) {
          // 節標所在的原刊頁由資料層算好（頁界依段、位移排序，取最後一個不晚於該段起點的），前端只印
          let sourcePage = null
          for (const b of pageBreaks) if (b.para < idx[0] || (b.para === idx[0] && b.offset === 0)) sourcePage = b.sourcePage
          // anchor 是正文標題與左欄樹共用的元素 id；tree 是左欄樹的一列（標題、縮排層級、提示），前端只加 href
          // 錨點用該件的公開錨點（related_index.json 的 anchor），編號不上網址
          const anchor = `${relatedDocs.find((r) => r.id === a.docId).anchor}-h${idx[0]}`
          mine.push({ para: idx[0], level: h.level, text: h.text, sourcePage, anchor,
            tree: { id: anchor, title: h.text, depth: h.level, hint: `原刊第 ${sourcePage} 頁` } })
          matchedHeadings.add(h.text)
        }
      }
      if (mine.length) {
        mine.sort((x, y) => x.para - y.para)
        if (mine[0].level !== 1) fail(`${src.id} ${a.docId}：第一條節標「${mine[0].text}」是 ${mine[0].level} 級，須是 1 級`)
        for (let k = 1; k < mine.length; k += 1) {
          if (mine[k].level > mine[k - 1].level + 1) fail(`${src.id} ${a.docId}：節標「${mine[k].text}」從 ${mine[k - 1].level} 級跳到 ${mine[k].level} 級`)
        }
        doc.headings = mine
        if (seg.headingsNote) doc.headingsNote = seg.headingsNote
      }
    }
    const marks = sideMarks.get(a.docId) ?? []
    if (marks.length) {
      doc.sideMarks = marks.map((mk) => {
        const p = paras[mk.para]
        if (p === undefined) fail(`${src.id} side-marks.tsv:${mk.line}：${a.docId} 沒有第 ${mk.para} 段`)
        const needle = mk.pre + mk.mark + mk.post
        const hits = p.split(needle).length - 1
        if (hits !== 1) fail(`${src.id} side-marks.tsv:${mk.line}：文脈在第 ${mk.para} 段命中 ${hits} 次，須剛好 1 次`)
        const from = p.indexOf(needle) + mk.pre.length
        const to = from + mk.mark.length
        if (p.slice(from, to) !== mk.mark) fail(`${src.id} side-marks.tsv:${mk.line}：切片與被圈的字對不上`)
        const entry = { para: mk.para, from, to, kind: mk.kind, text: mk.mark }
        if (mk.note) entry.note = mk.note
        return entry
      }).sort((x, y) => x.para - y.para || x.from - y.from)
      doc.sideMarksNote = seg.sideMarksNote ?? '原刊在字的左側加直線標人名、加波浪線標篇名與刊名，逐處對原頁圖判讀。'
      sideMarks.delete(a.docId)
    }
    const file = join(outDir, `${a.docId}.json`)
    if (!checkOnly) writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
    written.add(`${a.docId}.json`)
    console.log(`${a.docId}（${rel.title}）：${paras.length} 段 ${doc.charCount} 字，原刊頁 ${pageBreaks.map((b) => b.sourcePage).join('、')}`)
    totalDocs += 1
  }
  for (const docId of sideMarks.keys()) fail(`${src.id}：side-marks.tsv 記著 ${docId}，本次沒有這一件的輸出`)
  for (const h of seg.headings ?? []) if (!matchedHeadings.has(h.text)) fail(`${src.id}：節標「${h.text}」在任何一件的讀稿裡都沒有整段相符的段落`)
  void streamText
}

// 上次執行寫過而本次沒有再產的檔要清掉，不清的話舊檔會被當成本次的產物。
for (const f of readdirSync(outDir).filter((f) => f.endsWith('.json'))) {
  if (!written.has(f) && !checkOnly) { unlinkSync(join(outDir, f)); console.log(`清掉上一輪的 ${f}`) }
}
console.log(`書外文獻讀稿輸出 ${totalDocs} 件 → data/processed/external-drafts/`)

// ---- 流上的座標工具 -------------------------------------------------------

function locate(paragraphs, needle, what) {
  const hits = []
  for (const [para, p] of paragraphs.entries()) {
    const text = p.pieces.map((x) => x.text).join('')
    let at = text.indexOf(needle)
    while (at >= 0) { hits.push({ para, offset: at }); at = text.indexOf(needle, at + 1) }
  }
  if (hits.length !== 1) fail(`${what}「${needle.slice(0, 20)}⋯」命中 ${hits.length} 次，須剛好 1 次`)
  return hits[0]
}

function cmpPos(a, b) { return a.para - b.para || a.offset - b.offset }

function insertAt(p, at, text) {
  let pos = 0
  for (const piece of p.pieces) {
    if (at <= pos + piece.text.length) {
      const cut = at - pos
      piece.text = piece.text.slice(0, cut) + text + piece.text.slice(cut)
      return
    }
    pos += piece.text.length
  }
  p.pieces.at(-1).text += text
}

function cutSpan(p, at, len) {
  let pos = 0
  for (const piece of p.pieces) {
    const origLen = piece.text.length
    const start = Math.max(at - pos, 0)
    const end = Math.min(at + len - pos, origLen)
    if (end > start) piece.text = piece.text.slice(0, start) + piece.text.slice(end)
    pos += origLen
  }
}

function sliceStream(paragraphs, from, to) {
  if (cmpPos(from, to) >= 0) return ''
  const parts = []
  for (let i = from.para; i <= to.para && i < paragraphs.length; i += 1) {
    const text = paragraphs[i].pieces.map((x) => x.text).join('')
    const s = i === from.para ? from.offset : 0
    const e = i === to.para ? to.offset : text.length
    parts.push(text.slice(s, e))
  }
  return parts.join('\n')
}

// 取 [from, to) 的段落與頁界。頁界：這一件裡每個原刊頁第一次出現的位置。
function extract(paragraphs, from, to, pageOf) {
  const kept = []
  for (let i = from.para; i <= to.para && i < paragraphs.length; i += 1) {
    const p = paragraphs[i]
    let pos = 0
    let out = ''
    const marks = []
    const s = i === from.para ? from.offset : 0
    const e = i === to.para ? to.offset : Infinity
    for (const piece of p.pieces) {
      const a = Math.max(s - pos, 0)
      const b = Math.min(e - pos, piece.text.length)
      if (b > a) {
        marks.push({ page: piece.page, offset: out.length })
        out += piece.text.slice(a, b)
      }
      pos += piece.text.length
    }
    if (out.trim()) kept.push({ text: out, marks })
  }
  const paras = kept.map((k) => k.text)
  const pageBreaks = []
  const seen = new Set()
  for (const [para, k] of kept.entries()) {
    for (const m of k.marks) {
      if (seen.has(m.page)) continue
      seen.add(m.page)
      pageBreaks.push({ sourcePage: pageOf[m.page], para, offset: m.offset })
    }
  }
  return { paras, pageBreaks }
}
