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
// --dump <SRC-id>：只印重建出來的流（帶頁與段界），供人工定錨與核對原頁圖，不寫檔。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { widen, cornerQuotes, dots } from './lib/punctuation.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

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
const bandUnits = (syms, charW, indentCells) => {
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
  const topLine = median((full.length ? full : cols).map((c) => c.top))
  const botLine = median((full.length ? full : cols).map((c) => c.bottom))
  const indented = (c) => c.top - topLine > vpitch * indentCells
  const endsShort = (c) => botLine - c.bottom > vpitch * 1.0
  // 篇端註記與按語的小字接欄（縮排的整塊，欄與欄之間段落沒斷）幾何上與新段分不開
  // ——GCV 的字框量不出鉛字的號數。這一類由 segmentation.json 的 joins 逐處宣告。
  const units = []
  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i]
    const prev = cols[i - 1]
    if (units.length === 0 || indented(c) || endsShort(prev)) {
      units.push({ text: c.text, indentedStart: indented(c) })
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
      const units = bandUnits(band, charW, spec.indentCells ?? seg?.indentCells ?? 0.6)
      units[0].bandStart = true
      pageParas.push(...units)
    }
    // 標點歸位與言論集讀稿走同一份（半形轉全形、引號、句號串與重出）。
    for (const p of pageParas) p.text = dots(cornerQuotes(widen(p.text))).text

    // 2. 接流：層頭（或頁頭）第一段沒有段首縮排、前一層的末段沒說完（末字不是句讀收尾、
    // 末欄排滿到層底）的，是同一段的下半截。
    for (const p of pageParas) {
      const prev = paragraphs.at(-1)
      const joinable = p.bandStart && !p.indentedStart && prev && !prev.endsShort &&
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
    })
  }

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
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i]
    const to = a.endAt ?? (i + 1 < anchors.length ? anchors[i + 1].at : endPos)
    const { paras, pageBreaks } = extract(paragraphs, a.at, to, pageOf)
    if (!paras.length) fail(`${src.id} ${a.docId}：切出來是空的`)
    const rel = docsHere.find((r) => r.id === a.docId)
    const text = paras.join('\n')
    const corrections = (paragraphs.corrections ?? []).filter((c) => text.includes(c.to))
    const doc = {
      id: a.docId,
      sourceId: src.id,
      title: rel.title,
      status: '未校辨讀稿',
      statusNote: 'Google Cloud Vision 的辨讀結果，未經逐字人工校訂。直排的欄序由字框座標重排，上下兩層與跨頁的接續按段首縮排與句讀判定。引用前請核對原頁圖。',
      charCount: text.replace(/\s/g, '').length,
      textVersion: createHash('sha256').update(text).digest('hex').slice(0, 12),
      manualCorrections: corrections.length,
      corrections: corrections.map((c) => ({ sourcePage: pageOf[c.page], from: c.from, to: c.to })),
      paragraphs: paras,
      pageBreaks,
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
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
    written.add(`${a.docId}.json`)
    console.log(`${a.docId}（${rel.title}）：${paras.length} 段 ${doc.charCount} 字，原刊頁 ${pageBreaks.map((b) => b.sourcePage).join('、')}`)
    totalDocs += 1
  }
  for (const docId of sideMarks.keys()) fail(`${src.id}：side-marks.tsv 記著 ${docId}，本次沒有這一件的輸出`)
  void streamText
}

// 上次執行寫過而本次沒有再產的檔要清掉，不清的話舊檔會被當成本次的產物。
for (const f of readdirSync(outDir).filter((f) => f.endsWith('.json'))) {
  if (!written.has(f)) { unlinkSync(join(outDir, f)); console.log(`清掉上一輪的 ${f}`) }
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
