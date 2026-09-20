#!/usr/bin/env node
// 書外文獻整本書的版面參數草案：從 GCV 原始回應量出每頁的界內窗，印成 segmentation.json 的
// pages[] 供人核對，不寫檔。三頁的期刊件逐頁對原頁圖量 bodyX 就夠，七十四頁的講演錄一頁一頁量
// 不划算，而它的版面規則只有一條：書眉與漢字頁碼排在版心之外的邊欄。
//
// 做法：符號按 x 聚欄（與 build-external-drafts.mjs 同一個判準），找出書眉那一欄（文字含
// --head 給的字串，允許辨讀錯一兩個字），書眉在哪一側就把該側自書眉起往外的欄全部剔除
// （館藏印、索書號也在那裡）；另一側最外一欄若只有漢字數字，就是頁碼欄，也剔除。剩下的欄
// 取 cx 的範圍加半個字寬當 bodyX。頁碼欄與書眉欄裡的漢字數字換算成 sourcePage，逐頁印出，
// 頁碼不連續的地方另起一行報，人看過才寫進 segmentation.json。
//
// 用法：node propose-external-layout.mjs <SRC-id> --head 黨的組織與領導 --from 4 --to 77

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const srcId = process.argv[2]
const head = arg('--head')
const from = Number(arg('--from'))
const to = Number(arg('--to'))
if (!srcId || !head || !from || !to) fail('用法：propose-external-layout.mjs <SRC-id> --head <書眉> --from <PDF頁> --to <PDF頁>')

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const NUM = '〇一二三四五六七八九十'
const numeral = (t) => {
  if (!t || [...t].some((c) => !NUM.includes(c))) return null
  if (t === '十') return 10
  const i = t.indexOf('十')
  if (i < 0) return [...t].reduce((n, c) => n * 10 + NUM.indexOf(c), 0)
  const tens = i === 0 ? 1 : NUM.indexOf(t[i - 1])
  const ones = t.length > i + 1 ? NUM.indexOf(t[i + 1]) : 0
  return tens * 10 + ones
}
// 這本書的版面：正文是 16 欄的格，書眉與頁碼排在格外第 17 個欄位上——PDF 奇數頁在右緣、
// 偶數頁在左緣（首頁的大字篇題在右緣頂端，書眉照樣在左緣底端）。書眉的辨讀常缺字或錯字（「蓋約組織與顉蹲」、
// 只讀到頁碼「10」、讀成拉丁字母），所以三個判準並用：欄距量出來它在第 17 格、文字像書眉
// （七個字裡對上三個）、或整欄只有數字與拉丁字母。三者都不成立而該側最外欄仍很短，列出來給人看。
const HEAD_CHARS = new Set([...head])
// 節標（「乙、今後的領導工作」）也帶「的領導」三個字，靠命中比例分開：命中字要占漢字的四成以上
const looksLikeHead = (t) => {
  const cjk = [...t].filter((c) => /[\u3400-\u9fff]/.test(c))
  const hit = cjk.filter((c) => HEAD_CHARS.has(c)).length
  return t.length <= head.length + 5 && hit >= 3 && (hit >= 5 || hit / cjk.length >= 0.4)
}
const noCjk = (t) => !/[\u3400-\u9fff]/.test(t)
const numeralish = (t) => [...t].every((c) => (NUM + '0123456789').includes(c))
const headSide = (p) => (p % 2 === 1 ? 'right' : 'left')

const out = []
const gaps = []
for (let p = from; p <= to; p += 1) {
  const n = String(p).padStart(2, '0')
  const gcv = JSON.parse(readFileSync(join(root, 'data/materials/external', srcId, `gcv/json/pg-${n}.json`), 'utf8'))
  const page = gcv.fullTextAnnotation.pages[0]
  const syms = []
  for (const b of page.blocks) for (const pa of b.paragraphs) for (const w of pa.words) for (const s of w.symbols) {
    const xs = s.boundingBox.vertices.map((v) => v.x ?? 0)
    const ys = s.boundingBox.vertices.map((v) => v.y ?? 0)
    syms.push({ cx: xs.reduce((a, c) => a + c) / 4, cy: ys.reduce((a, c) => a + c) / 4, w: Math.max(...xs) - Math.min(...xs), text: s.text })
  }
  const charW = median(syms.map((s) => s.w))
  const sorted = [...syms].sort((a, b) => b.cx - a.cx)
  const cols = []
  for (const s of sorted) {
    const cur = cols.at(-1)
    if (cur && cur.items.at(-1).cx - s.cx <= charW * 0.5) cur.items.push(s)
    else cols.push({ items: [s] })
  }
  for (const c of cols) {
    c.items.sort((a, b) => a.cy - b.cy)
    c.cx = median(c.items.map((s) => s.cx))
    c.text = c.items.map((s) => s.text).join('')
  }
  const diffs = cols.slice(1).map((c, i) => cols[i].cx - c.cx).filter((d) => d > charW * 0.6 && d < charW * 1.6)
  const pitch = diffs.length ? median(diffs) : charW * 1.1
  const side = headSide(p)
  const dropped = []
  let body = [...cols] // 由右到左
  const takeOuter = () => side === 'right' ? body.shift() : body.pop()
  const putBack = (c) => side === 'right' ? body.unshift(c) : body.push(c)
  const span = () => (body[0].cx - body.at(-1).cx) / pitch
  // 書眉那一側：最外欄逐一檢查，最多剔三欄（館藏印的碎字、書眉、頁碼可能各成一欄）。
  // 第一欄看四個判準；再往內的只看「只有數字或拉丁字母」與「在第 17 格」，節標帶著
  // 「的領導」三個字，靠比例還是會誤中，不讓它連坐。
  for (let k = 0; k < 3 && body.length > 1; k += 1) {
    const c = takeOuter()
    const garbage = noCjk(c.text) || numeralish(c.text)
    const why = k === 0 && looksLikeHead(c.text) ? '像書眉' : garbage ? '只有數字或拉丁字母'
      : k === 0 && side === 'right' && c.items.length <= 2 ? '右緣碎字'
      : span() >= 14.5 && c.items.length <= 12 ? '第 17 格的短欄' : null
    // 欄距只用來報警：剔完之後正文若仍超過 16 格，多半是辨讀把一欄拆成兩欄，或書眉黏在正文欄裡，去看原頁圖
    if (!why && span() >= 15.5) gaps.push(`pg-${n}：剔掉邊欄後正文仍有 ${Math.round(span()) + 1} 格（最外欄「${c.text.slice(0, 12)}」），去看原頁圖`)
    if (why) dropped.push({ ...c, why })
    else { putBack(c); break }
  }
  // 另一側：最外欄只有數字或拉丁字母、又短，是頁碼
  const inner = side === 'right' ? body.at(-1) : body[0]
  if (inner && inner.items.length <= 4 && (noCjk(inner.text) || numeralish(inner.text))) {
    dropped.push({ ...(side === 'right' ? body.pop() : body.shift()), why: '內側頁碼' })
  }
  if (!body.length) { gaps.push(`pg-${n}：剔掉邊欄之後沒有正文欄`); continue }
  const outerLeft = side === 'right' ? body.at(-1) : body[0]
  const cxs = body.map((c) => c.cx)
  const bodyX = [Math.round(Math.min(...cxs) - charW * 0.75), Math.round(Math.max(...cxs) + charW * 0.75)]
  // 頁碼：書眉側剔掉的欄裡的漢字數字；沒讀到就照 PDF 頁次推（pg-04 是書頁一），讀到而不合就報
  const expected = p - from + 1
  let read = null
  for (const d of dropped) {
    const t = d.text.replace(new RegExp(`[${head}]`, 'g'), '')
    const v = numeral(t) ?? (t.match(/^\d+$/) ? Number(t) : null)
    if (v !== null) { read = v; break }
  }
  if (read !== null && read !== expected) gaps.push(`pg-${n}：邊欄讀到頁碼 ${read}，按 PDF 頁次應是 ${expected}（${dropped.map((d) => d.text).join('｜')}）`)
  if (!dropped.length) gaps.push(`pg-${n}：書眉側沒剔掉任何欄（最外欄「${(side === 'right' ? cols[0] : cols.at(-1)).text.slice(0, 12)}」）`)
  if (body.length < 12 && p !== to) gaps.push(`pg-${n}：正文只剩 ${body.length} 欄`)
  out.push({ page: p, sourcePage: expected, read, bodyX, side, cols: body.length, dropped: dropped.map((d) => `${d.text.slice(0, 12)}(${d.why})`) })
}
for (const o of out) console.log(`pg-${String(o.page).padStart(2, '0')}  書頁 ${String(o.sourcePage).padStart(3)}${o.read !== null ? '' : '?'}  書眉在${o.side}  正文 ${String(o.cols).padStart(2)} 欄  bodyX ${o.bodyX.join('-')}  剔：${o.dropped.join('、')}`)
if (gaps.length) { console.log('\n要人看的：'); for (const g of gaps) console.log(`  ${g}`) }
console.log('\n--- pages[] ---')
console.log(JSON.stringify(out.map((o) => ({ page: o.page, sourcePage: o.sourcePage, bodyX: o.bodyX }))))
