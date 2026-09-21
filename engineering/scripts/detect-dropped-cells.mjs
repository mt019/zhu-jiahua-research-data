#!/usr/bin/env node
// 漏字的偵測面：掉了的字在辨讀結果裡沒有符號，任何以符號為單位的篩選（信心值、n-gram）
// 都看不到它。版面上那一格的空位還在，而 GCV 每個符號都回 boundingBox，所以量得出來。
//
// 兩條規則，都在一欄之內比：
//   欄內間距　相鄰兩個符號的中心距超過該欄字距中位數的 GAP 倍 → 中間掉了字
//   欄首起排　一欄的起排比該頁的欄頂線低，而低的量不是段首縮排的那個量 → 欄首掉了字
// 直排右起，欄以 x 中心分群。只報位置與長相，不改任何檔。
//
//   node engineering/scripts/detect-dropped-cells.mjs            全書
//   node engineering/scripts/detect-dropped-cells.mjs 121 219    只跑這幾個 PDF 頁
//   ZJH_GAP=1.4 ZJH_TSV=out.tsv node engineering/scripts/detect-dropped-cells.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 預設是《言論集》那批；書外文獻各件的頁圖與辨讀稿在 data/materials/external/<SRC-id>/gcv/json，
// 用 ZJH_SOURCE=<SRC-id> 指過去（那些件沒有重拍頁的登記檔，跳過重頁檢查）。
const SOURCE = process.env.ZJH_SOURCE ?? ''
const JSON_DIR = SOURCE
  ? `data/materials/external/${SOURCE}/gcv/json`
  : 'data/materials/speeches/gcv/txt/json'
const DUPES = SOURCE ? '' : 'data/materials/speeches/gcv-duplicate-pages.json'

// 門檻按件計，不共用一組：《言論集》是印刷廠的排印件，行距整齊，真命中落在 0.90 到 3.05；
// 中央訓練團那本是 1944 年的戰時印件，行距本身就不勻，同一組門檻下 78 頁報 1,429 處、
// 55 頁被 PAGE_CAP 整頁跳過（含站主點名的 pg-59）。該件的值另量一次，依據寫在下面。
// 新收一件書外文獻而它的門檻沒量過，就是用《言論集》這一組，量過再進這張表。
const TUNED = {
  // 拿第二引擎（tesseract 直排）的插入型當校準面，逐個比值帶算重合率：1.5 到 1.8 是 0
  // 到 12%（可對位者僅 48 處），1.9 到 2.1 是 20 到 24%（512 處），2.4 到 3.9 是 23 到 26%
  // （74 處，而且第二引擎在那裡多讀到的多半是兩個字，掉兩格的空白本來就有兩倍寬），
  // 4.0 以上 19 處一處都不重合。下限取 1.9、上限取 4.0，已核的四條漏字校訂落在
  // 1.94 到 2.06。2.2 與 2.3 兩帶各自只有 8 到 12%，夾在中間不另切。
  // PAGE_CAP 取 30 剔掉七頁，那幾頁的欄分群不成立（pg-70 的兩欄交錯是已知的），
  // 逐處清單沒有用，要逐欄對原頁圖。
  'SRC-nlc-dang-de-zuzhi-yu-lingdao-1944': { GAP: 1.9, MAX_GAP: 4.0, PAGE_CAP: 30 },
}
const tuned = TUNED[SOURCE] ?? {}
const GAP = Number(process.env.ZJH_GAP ?? tuned.GAP ?? 1.5)
const HEAD_MIN = Number(process.env.ZJH_HEAD_MIN ?? 0.7)   // 欄首低於欄頂線幾個字才報
const INDENT = Number(process.env.ZJH_INDENT ?? 2)          // 段首縮排的字數
const INDENT_TOL = Number(process.env.ZJH_INDENT_TOL ?? 0.45)
const MIN_COL = Number(process.env.ZJH_MIN_COL ?? 6)        // 欄太短量不出字距，跳過
// 挪抬的稱謂：原書在這些詞之前空一格，那個空白不是掉字
const HONORIFIC = /^(總理|總統|總裁|國父|先總統|先總理|蔣公|蔣中正|蔣委員長|蔣主席|蔣先生|蔣總|主席|委員長|領袖|鈞座|鈞鑒|鈞長|台座|尊處|先生逝|公之)/
// 上限：超過這幾個字距的空白不是掉字，是版面本身（篇名行與小標的起排、段落止於欄中、
// 書眉殘留、表格欄）。實測十頁的真命中落在 0.90 到 3.05 之間
const MAX = { 欄內間距: Number(process.env.ZJH_MAX_GAP ?? tuned.MAX_GAP ?? 5), 欄首起排: Number(process.env.ZJH_MAX_HEAD ?? tuned.MAX_HEAD ?? 3.5), 欄末止排: Number(process.env.ZJH_MAX_TAIL ?? tuned.MAX_TAIL ?? 3) }
// 一頁報得太多，那一頁的逐處清單沒有用：要嘛版面不是連排的正文（表格、名錄、目次），
// 要嘛整頁辨讀壞掉、欄分群不成立。後者正是漏字最多的那幾頁，不是可以放掉的那幾頁——
// 這幾頁要逐欄對原頁圖，清單裡看不到它們，所以頁號印在畫面上並寫進 ZJH_HEAVY_TSV。
const PAGE_CAP = Number(process.env.ZJH_PAGE_CAP ?? tuned.PAGE_CAP ?? 10)

const canonical = DUPES
  ? new Map(JSON.parse(readFileSync(DUPES, 'utf8')).items.map((d) => [d.pdfPage, d.canonical]))
  : new Map()
const files = new Map()
for (const f of readdirSync(JSON_DIR)) {
  const n = Number(f.match(/(\d+)\.json$/)?.[1])
  if (!Number.isInteger(n)) continue
  if (canonical.has(n)) {
    if (f === canonical.get(n)) files.set(n, f)
    continue
  }
  if (files.has(n)) throw new Error(`PDF ${n} 有兩份辨讀結果而 ${DUPES} 沒有登記：${files.get(n)}／${f}`)
  files.set(n, f)
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

const symbolsOf = (file) => {
  const doc = JSON.parse(readFileSync(join(JSON_DIR, file), 'utf8'))
  const out = []
  for (const page of doc.fullTextAnnotation?.pages ?? []) {
    for (const b of page.blocks ?? []) {
      for (const par of b.paragraphs ?? []) {
        for (const w of par.words ?? []) {
          for (const sym of w.symbols ?? []) {
            const v = sym.boundingBox?.vertices ?? []
            if (v.length < 4 || v.some((q) => q.x === undefined || q.y === undefined)) continue
            const xs = v.map((q) => q.x)
            const ys = v.map((q) => q.y)
            out.push({
              text: sym.text,
              x0: Math.min(...xs),
              x1: Math.max(...xs),
              y1: Math.max(...ys),
              cx: (Math.min(...xs) + Math.max(...xs)) / 2,
              cy: (Math.min(...ys) + Math.max(...ys)) / 2,
              top: Math.min(...ys),
              w: Math.max(...xs) - Math.min(...xs),
              h: Math.max(...ys) - Math.min(...ys),
            })
          }
        }
      }
    }
  }
  return out
}

// 一頁分欄：以 x 中心排序，相鄰兩個符號的 x 差超過半個字寬就開新欄
const columnsOf = (syms) => {
  if (!syms.length) return []
  const charW = median(syms.map((s) => s.w).filter((w) => w > 0)) || 20
  const sorted = [...syms].sort((a, b) => b.cx - a.cx)   // 直排右起
  const cols = []
  let cur = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    if (cur[cur.length - 1].cx - sorted[i].cx > charW * 0.6) { cols.push(cur); cur = [] }
    cur.push(sorted[i])
  }
  cols.push(cur)
  return cols.map((c) => c.sort((a, b) => a.cy - b.cy))
}

const pages = process.argv.slice(2).map(Number).filter(Number.isInteger)
const targets = pages.length ? pages : [...files.keys()].sort((a, b) => a - b)

const hits = []
for (const pdfPage of targets) {
  const file = files.get(pdfPage)
  if (!file) { console.error(`PDF ${pdfPage} 沒有辨讀結果`); continue }
  const all = columnsOf(symbolsOf(file)).filter((c) => c.length >= MIN_COL)
  // 書眉與頁碼排在同一欄的兩端，欄內留著一段整頁高的空白（實測 27–32 個字距）。這種欄
  // 三條規則都會報，而它不是正文；先按「欄內有一段十倍字距以上的空白」認出來剔掉，
  // 頂線與底線也不能拿它算
  const isHead = (col) => {
    const pitch = median(col.slice(1).map((s, i) => s.cy - col[i].cy))
    return pitch > 0 && col.slice(1).some((s, i) => (s.cy - col[i].cy) / pitch >= 10)
  }
  const cols = all.filter((c) => !isHead(c))
  if (cols.length < 3) continue
  // 欄頂線與欄底線取各欄的中位數，不取極值——書眉那一欄排在正文之上，取最小值會把它當成
  // 頂線，正文各欄的起排就一律低於它四五個字，真的掉了字的那一欄反而看不出來
  const topLine = median(cols.map((c) => c[0].top))
  const botLine = median(cols.map((c) => c[c.length - 1].cy))
  for (const col of cols) {
    const pitch = median(col.slice(1).map((s, i) => s.cy - col[i].cy))
    if (!(pitch > 0)) continue
    for (let i = 1; i < col.length; i += 1) {
      const d = (col[i].cy - col[i - 1].cy) / pitch
      // 篇端行的篇名與日期之間留一個空格，是排版本身的體例
      const rest = col.slice(i, i + 4).map((x) => x.text).join('')
      if (d >= GAP && d < 2.6 && /^(中華民國|民國|一九)/.test(rest)) continue
      // 挪抬：稱謂之前空一格，原書的體例。實測 959 處裡有 249 處是這一種
      if (d >= GAP && d < 3 && HONORIFIC.test(rest)) continue
      if (d >= GAP) {
        hits.push({
          pdfPage, kind: '欄內間距', ratio: Number(d.toFixed(2)),
          x: Math.round(col[i].x0), y: Math.round(col[i - 1].y1),
          before: col[i - 1].text, after: col[i].text,
          context: col.slice(Math.max(0, i - 4), i + 4).map((s) => s.text).join(''),
        })
      }
    }
    const headGap = (col[0].top - topLine) / pitch
    if (headGap >= HEAD_MIN && Math.abs(headGap - INDENT) > INDENT_TOL) {
      hits.push({
        pdfPage, kind: '欄首起排', ratio: Number(headGap.toFixed(2)),
        x: Math.round(col[0].x0), y: Math.round(topLine),
        before: '', after: col[0].text,
        context: col.slice(0, 8).map((s) => s.text).join(''),
      })
    }
    // 欄末：一欄止排比欄底線高，而下一欄不是新起的段（下一欄從欄頂線起排）→ 欄末掉了字
    const idx = cols.indexOf(col)
    const next = cols[idx + 1]
    const tailGap = (botLine - col[col.length - 1].cy) / pitch
    if (tailGap >= HEAD_MIN && next && (next[0].top - topLine) / pitch < HEAD_MIN) {
      hits.push({
        pdfPage, kind: '欄末止排', ratio: Number(tailGap.toFixed(2)),
        x: Math.round(col[0].x0), y: Math.round(col[col.length - 1].y1),
        before: col[col.length - 1].text, after: next[0].text,
        context: `${col.slice(-4).map((s) => s.text).join('')}｜${next.slice(0, 4).map((s) => s.text).join('')}`,
      })
    }
  }
}

const byPage = new Map()
for (const h of hits) byPage.set(h.pdfPage, (byPage.get(h.pdfPage) ?? 0) + 1)
const heavy = [...byPage].filter(([, n]) => n > PAGE_CAP).map(([p]) => p)
const kept = hits.filter((h) => h.ratio <= MAX[h.kind] && !heavy.includes(h.pdfPage))
if (heavy.length) console.log(`整頁另案，要逐欄對原頁圖：${heavy.length} 頁報超過 ${PAGE_CAP} 處，共 ${hits.length - hits.filter((h) => !heavy.includes(h.pdfPage)).length} 處未列：${heavy.join(' ')}`)
console.log(`上限之外（版面本身）${hits.filter((h) => h.ratio > MAX[h.kind] && !heavy.includes(h.pdfPage)).length} 處未列`)
for (const h of kept) console.log(`${h.pdfPage}\t${h.kind}\t${h.ratio}\t${h.before}｜${h.after}\t${h.context}`)
console.log(`--- ${targets.length} 頁，列出 ${kept.length} 處（欄內間距 ${kept.filter((h) => h.kind === '欄內間距').length}、欄首起排 ${kept.filter((h) => h.kind === '欄首起排').length}、欄末止排 ${kept.filter((h) => h.kind === '欄末止排').length}），偵測到 ${hits.length} 處，門檻 GAP=${GAP} HEAD_MIN=${HEAD_MIN} MAX_GAP=${MAX.欄內間距} PAGE_CAP=${PAGE_CAP}${TUNED[SOURCE] ? `（${SOURCE} 的量過的值）` : ''}`)

// 整頁另案的那幾頁只印在畫面上就沒有人看得到第二次，留一份檔案。
const heavyTsv = process.env.ZJH_HEAVY_TSV
if (heavyTsv) {
  writeFileSync(
    heavyTsv,
    `${['pdfPage', 'hits'].join('\t')}\n${heavy
      .sort((a, b) => a - b)
      .map((p) => [p, byPage.get(p)].join('\t'))
      .join('\n')}\n`,
  )
  console.log(`整頁另案的 ${heavy.length} 頁寫入 ${heavyTsv}`)
}

const tsv = process.env.ZJH_TSV
if (tsv) {
  writeFileSync(tsv, `${['pdfPage', 'kind', 'ratio', 'x', 'y', 'before', 'after', 'context'].join('\t')}\n${
    kept.map((h) => [h.pdfPage, h.kind, h.ratio, h.x, h.y, h.before, h.after, h.context].join('\t')).join('\n')}\n`)
  console.log(`寫入 ${tsv}`)
}
