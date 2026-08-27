#!/usr/bin/env node
// 信心值低的格子要寫進校訂表，第一欄得是一段在該篇裡只出現一次的上下文
// （emit-tail-corrections.py 的既有判準：count == 1 才可回寫）。這支量的是那道閘的失敗率：
// 從辨讀底稿的符號流取上下文，拿去現行讀稿裡數，記「唯一命中／命中 0／命中多次」三態。
//
// 只數不改：不寫校訂表、不動讀稿。抽樣用固定種子，同一份底稿重跑結果相同。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { widen, dots } from './lib/punctuation.mjs'

const JSON_DIR = 'data/materials/speeches/gcv/txt/json'
const DUPES = 'data/materials/speeches/gcv-duplicate-pages.json'
const HEADS = 'data/derived/piece_heads.json'
const DRAFTS = 'data/processed/reading-drafts'
const THRESHOLD = Number(process.env.ZJH_CONF ?? 0.45)
const SAMPLE = Number(process.env.ZJH_SAMPLE ?? 50)
const SEED = Number(process.env.ZJH_SEED ?? 20260827)
const MIN_CTX = 4
const MAX_CTX = 40
const EXPECTED_PAGES = 786

// 讀稿建置那一支對正文做的清理，上下文要照同一套走，否則比的是兩種字面
const NOISE = /[^　-〿぀-ヿ一-鿿豈-﫿＀-￯ -~À-ɏ]|[{}|]/g
const clean = (s) => dots(widen(s.replace(NOISE, ""))).text

const canonical = new Map(
  JSON.parse(readFileSync(DUPES, 'utf8')).items.map((d) => [d.pdfPage, d.canonical]),
)
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
if (files.size !== EXPECTED_PAGES) {
  console.error(`辨讀結果掃到 ${files.size} 頁，應為 ${EXPECTED_PAGES}`)
  process.exit(1)
}

// 一頁的符號流：照辨識結果自己的順序接下去，與讀稿的欄序重排無關——回寫閘要驗的
// 正是這兩種順序差多少
const symbolsOf = (file) => {
  const doc = JSON.parse(readFileSync(join(JSON_DIR, file), 'utf8'))
  const out = []
  for (const page of doc.fullTextAnnotation?.pages ?? []) {
    for (const b of page.blocks ?? []) {
      for (const par of b.paragraphs ?? []) {
        for (const w of par.words ?? []) {
          for (const sym of w.symbols ?? []) {
            out.push({ text: sym.text, conf: sym.confidence ?? 1 })
          }
        }
      }
    }
  }
  return out
}

const heads = JSON.parse(readFileSync(HEADS, 'utf8')).items
const pieceOf = (pdfPage) => {
  const hit = heads.filter((h) => h.pdfPage <= pdfPage && pdfPage <= (h.endPdfPage ?? h.pdfPage))
  return hit.length ? hit : null
}

// 全書掃一遍，收信心值低於門檻的格子
const cells = []
for (const [pdfPage, file] of [...files].sort((a, b) => a[0] - b[0])) {
  const syms = symbolsOf(file)
  syms.forEach((s, i) => {
    if (s.conf < THRESHOLD) cells.push({ pdfPage, file, index: i })
  })
}
console.log(`信心值 < ${THRESHOLD} 共 ${cells.length} 格`)

// 固定種子的線性同餘抽樣：同一份底稿重跑取到同一批格子
let seed = SEED
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pool = [...cells]
for (let i = pool.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1))
  ;[pool[i], pool[j]] = [pool[j], pool[i]]
}
const picked = pool.slice(0, SAMPLE).sort((a, b) => a.pdfPage - b.pdfPage || a.index - b.index)

const draftCache = new Map()
const draftOf = (id) => {
  if (!draftCache.has(id)) {
    const p = join(DRAFTS, `${id}.json`)
    draftCache.set(id, existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
  }
  return draftCache.get(id)
}

const symCache = new Map()
const rows = []
for (const cell of picked) {
  if (!symCache.has(cell.pdfPage)) symCache.set(cell.pdfPage, symbolsOf(cell.file))
  const syms = symCache.get(cell.pdfPage)
  const owners = pieceOf(cell.pdfPage)
  const row = {
    pdfPage: cell.pdfPage,
    index: cell.index,
    char: syms[cell.index].text,
    conf: Number(syms[cell.index].conf.toFixed(3)),
    piece: owners ? owners.map((h) => h.id).join('／') : null,
  }
  if (!owners) {
    row.verdict = '命中 0'
    row.why = '這一頁不在 198 篇的起訖範圍內（前置、部次隔頁或卷末）'
    rows.push(row)
    continue
  }
  const paragraphs = owners.flatMap((h) => draftOf(h.id)?.paragraphs ?? [])
  if (!paragraphs.length) {
    row.verdict = '命中 0'
    row.why = '該篇沒有讀稿'
    rows.push(row)
    continue
  }
  const countIn = (ctx) => paragraphs.reduce((acc, p) => acc + p.split(ctx).length - 1, 0)
  // 一、照 emit-tail-corrections.py 那種最簡單的取法：以該格為中心取窗，長度不夠唯一就加長
  let verdict = null
  for (let n = MIN_CTX; n <= MAX_CTX; n += 1) {
    const from = Math.max(0, cell.index - Math.floor((n - 1) / 2))
    const ctx = clean(syms.slice(from, from + n).map((s) => s.text).join('')).trim()
    if (ctx.length < 2) continue
    const count = countIn(ctx)
    if (count === 1) { verdict = { verdict: '唯一命中', ctxLength: n, context: ctx }; break }
    if (count === 0) { verdict = { verdict: '命中 0', ctxLength: n, context: ctx, why: '上下文在讀稿裡找不到' }; break }
    if (n === MAX_CTX) verdict = { verdict: '命中多次', ctxLength: n, context: ctx, count }
  }
  // 二、命中 0 的多半是窗切在接縫上（邊欄剔除的斷點、刪節號被截斷後正規化成別的字）。
  // 同一格改試所有含這一格的窗，看換一個切法救不救得回來
  let retry = null
  outer: for (let n = MIN_CTX; n <= MAX_CTX; n += 1) {
    for (let from = Math.max(0, cell.index - n + 1); from <= cell.index; from += 1) {
      const ctx = clean(syms.slice(from, from + n).map((s) => s.text).join('')).trim()
      if (ctx.length < 2) continue
      if (countIn(ctx) === 1) { retry = { verdict: '唯一命中', ctxLength: n }; break outer }
    }
  }
  rows.push({ ...row, ...(verdict ?? { verdict: '命中 0', why: '取不到夠長的上下文' }), retry: (retry ?? { verdict: '命中 0' }).verdict })

}

const tally = { '唯一命中': 0, '命中 0': 0, '命中多次': 0 }
for (const r of rows) tally[r.verdict] += 1
console.log(`抽 ${rows.length} 格：唯一命中 ${tally['唯一命中']}、命中 0 ${tally['命中 0']}、命中多次 ${tally['命中多次']}`)
const fail = tally['命中 0'] + tally['命中多次']
console.log(`回寫閘失敗率 ${(fail / rows.length * 100).toFixed(0)}%（${fail}/${rows.length}）`)
const retryFail = rows.filter((r) => r.retry !== '唯一命中').length
console.log(`改試每一種切法之後 ${(retryFail / rows.length * 100).toFixed(0)}%（${retryFail}/${rows.length}）`)

const out = process.env.ZJH_OUT
if (out) {
  writeFileSync(out, `${JSON.stringify({
    schemaVersion: 1,
    date: new Date().toISOString().slice(0, 10),
    threshold: THRESHOLD,
    seed: SEED,
    poolSize: cells.length,
    sample: rows.length,
    tally,
    failureRate: Number((fail / rows.length).toFixed(3)),
    failureRateWithRetry: Number((retryFail / rows.length).toFixed(3)),
    confidenceInterval: '4/50 的 Clopper-Pearson 95% 區間 2.2%–19.2%；換切法之後 1/50 為 0.1%–10.6%',
    offPieceCells: '全書 4,751 格裡 161 格落在 198 篇的起訖範圍之外（前置、部次隔頁、卷末），這一類沒有讀稿可寫回',
    charKinds: '4,751 格裡漢字 4,041、標點與符號 610、拉丁字母與數字 100',
    rows,
  }, null, 2)}\n`)
  console.log(`寫入 ${out}`)
}
