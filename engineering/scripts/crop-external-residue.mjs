// 書外文獻讀稿殘留的裁圖：用法 node crop-external-residue.mjs <SRC-id> <out目錄> <PDF頁>:<字串|另一字串> ...
// 從 GCV 符號座標找到字串所在，用 sips 裁一塊圖給人判讀（TALL=8 環境變數加高裁切），
// 判讀寫進 corrections/pg-NN.tsv。2026-09-21 收《黨的組織與領導》時寫，47 條校訂全靠它。
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const [srcId, outDir, ...specs] = process.argv.slice(2)
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(outDir, { recursive: true })
let k = 0
for (const spec of specs) {
  const i = spec.indexOf(':'); const pg = spec.slice(0, i), needle = spec.slice(i + 1)
  const n = String(pg).padStart(2, '0')
  const g = JSON.parse(readFileSync(`${root}/data/materials/external/${srcId}/gcv/json/pg-${n}.json`, 'utf8'))
  const syms = []
  for (const b of g.fullTextAnnotation.pages[0].blocks) for (const pa of b.paragraphs) for (const w of pa.words) for (const s of w.symbols) {
    const xs = s.boundingBox.vertices.map((v) => v.x ?? 0), ys = s.boundingBox.vertices.map((v) => v.y ?? 0)
    syms.push({ text: s.text, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) })
  }
  const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
  const cw = median(syms.map((s) => s.x1 - s.x0))
  syms.sort((a, b) => (b.x0 + b.x1) - (a.x0 + a.x1))
  const cols = []
  for (const s of syms) { const c = cols.at(-1); if (c && ((c.at(-1).x0 + c.at(-1).x1) - (s.x0 + s.x1)) / 2 <= cw * 0.5) c.push(s); else cols.push([s]) }
  const flow = cols.flatMap((c) => c.sort((a, b) => a.y0 - b.y0))
  const text = flow.map((s) => s.text).join('')
  k += 1
  let at = -1, used = null
  for (const cand of needle.split('|').filter(Boolean)) { at = text.indexOf(cand); if (at >= 0) { used = cand; break } }
  if (at < 0) { console.log(`${k} pg-${n}「${needle}」在辨讀稿裡找不到`); continue }
  const hit = flow.slice(at, at + used.length)
  const x0 = Math.max(0, Math.min(...hit.map((s) => s.x0)) - cw * 2), x1 = Math.max(...hit.map((s) => s.x1)) + cw * 2
  const TALL = Number(process.env.TALL || 3); const y0 = Math.max(0, Math.min(...hit.map((s) => s.y0)) - cw * TALL), y1 = Math.max(...hit.map((s) => s.y1)) + cw * TALL
  const out = `${outDir}/${String(k).padStart(2, '0')}-pg${n}.png`
  copyFileSync(`${root}/data/materials/external/${srcId}/pages/pg-${n}.png`, out)
  execFileSync('sips', ['-c', String(Math.round(y1 - y0)), String(Math.round(x1 - x0)), '--cropOffset', String(Math.round(y0)), String(Math.round(x0)), out], { stdio: 'pipe' })
  console.log(`${k} pg-${n} ${needle} → ${out}`)
}
