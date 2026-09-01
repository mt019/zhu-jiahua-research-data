#!/usr/bin/env node
// 書外文獻的頁面影像：從 data/raw/articles/ 的原 PDF 逐頁取圖，寫進
// data/materials/external/<sourceId>/pages/pg-NN.png（不進版控，隨時可從原 PDF 再生）。
//
// 取圖的作法由 sources.json 的 digitisation.colour 決定，新收一件通常不必改這支：
//   1-bit：走 pdfimages -png，取的是頁面本身那個影像物件，館藏印是另一個彩色物件，
//          按像素數濾掉（改正條約會附刊的印是 262×265，頁面是 2519×3548 起跳）。
//   rgb  ：走 pdftoppm，再取紅色版當灰階值——紅印在紅色版是高值而被壓成接近白，
//          黑字三個色版都是低值。灰階換算會把紅印留成中灰，壓在字上就影響辨讀。
// 個別件要改判準時寫進 OVERRIDES，一件一列。
//
// 已有輸出的頁面跳過；--force 重做。頁數與 holdings 記的不符一律中止。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ppmToGrayPng } from './lib/gray-png.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

const OVERRIDES = {
  // sourceId: { method, dpi, channel, minPixels }
}

const force = process.argv.includes('--force')
const only = (() => {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? process.argv[i + 1] : null
})()

const sourcesPath = join(root, 'data/derived/sources.json')
if (!existsSync(sourcesPath)) fail(`找不到來源登記 ${sourcesPath}`)
const sources = JSON.parse(readFileSync(sourcesPath, 'utf8')).sources

const recipeFor = (src) => {
  const colour = src.digitisation?.colour
  const base = colour === '1-bit'
    ? { method: 'pdfimages', minPixels: 1_000_000 }
    : { method: 'pdftoppm', dpi: src.digitisation?.ppi || 300, channel: 'r' }
  return { ...base, ...(OVERRIDES[src.id] || {}) }
}

let total = 0
let skipped = 0
const held = sources.filter((s) => !s.primaryPending && (!only || s.id === only))
if (held.length === 0) fail(only ? `sources.json 沒有 ${only}，或它是掛帳的來源` : '沒有可取圖的來源')

for (const src of held) {
  const holdingPath = join(root, 'data/materials/holdings', `${src.id}.json`)
  if (!existsSync(holdingPath)) fail(`${src.id}：找不到 ${holdingPath}，原件的路徑只記在 holdings`)
  const holding = JSON.parse(readFileSync(holdingPath, 'utf8'))
  const pdf = join(root, holding.localPath)
  if (!existsSync(pdf)) fail(`${src.id}：原 PDF 不在 holdings 所記的位置 ${holding.localPath}`)
  const bytes = statSync(pdf).size
  if (holding.bytes && bytes !== holding.bytes) {
    fail(`${src.id}：原 PDF 的位元組數與 holdings 不符（記 ${holding.bytes}，實際 ${bytes}）`)
  }

  const pagesDir = join(root, 'data/materials/external', src.id, 'pages')
  mkdirSync(pagesDir, { recursive: true })
  const recipe = recipeFor(src)
  const pageCount = holding.pages
  if (!pageCount) fail(`${src.id}：holdings 沒有記頁數，取圖之後無從對帳`)

  for (let p = 1; p <= pageCount; p += 1) {
    const out = join(pagesDir, `pg-${String(p).padStart(2, '0')}.png`)
    if (existsSync(out) && !force) { skipped += 1; continue }
    const tmp = mkdtempSync(join(tmpdir(), 'zjh-ext-'))
    try {
      if (recipe.method === 'pdfimages') {
        execFileSync('pdfimages', ['-png', '-f', String(p), '-l', String(p), pdf, join(tmp, 'im')], { stdio: 'pipe' })
        const cand = readdirSync(tmp).filter((f) => f.endsWith('.png')).map((f) => {
          const file = join(tmp, f)
          const g = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
          const w = Number(/pixelWidth: (\d+)/.exec(g)[1])
          const h = Number(/pixelHeight: (\d+)/.exec(g)[1])
          return { file, w, h, px: w * h }
        })
        const kept = cand.filter((c) => c.px >= recipe.minPixels)
        if (kept.length !== 1) {
          fail(`${src.id} 第 ${p} 頁：像素數達 ${recipe.minPixels} 的影像有 ${kept.length} 個，`
            + `應恰為 1（抽出 ${cand.map((c) => `${c.w}×${c.h}`).join('、')}）`)
        }
        renameSync(kept[0].file, out)
      } else {
        const stem = join(tmp, 'pg')
        execFileSync('pdftoppm', ['-r', String(recipe.dpi), '-f', String(p), '-l', String(p), pdf, stem], { stdio: 'pipe' })
        const ppm = readdirSync(tmp).filter((f) => f.endsWith('.ppm'))
        if (ppm.length !== 1) fail(`${src.id} 第 ${p} 頁：pdftoppm 產出 ${ppm.length} 個 PPM，應為 1 個`)
        writeFileSync(out, ppmToGrayPng(readFileSync(join(tmp, ppm[0])), recipe.channel))
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    total += 1
  }

  const made = readdirSync(pagesDir).filter((f) => /^pg-\d+\.png$/.test(f))
  if (made.length !== pageCount) {
    fail(`${src.id}：頁圖 ${made.length} 張，holdings 記原件 ${pageCount} 頁，不相符`)
  }
  console.log(`${src.id}：${made.length} 張（${recipe.method}`
    + `${recipe.method === 'pdftoppm' ? `，${recipe.dpi} dpi，取 ${recipe.channel} 色版` : `，濾掉像素數低於 ${recipe.minPixels.toLocaleString('en-US')} 的物件`}）→ ${pagesDir.replace(root + '/', '')}`)
}

console.log(`本次新產 ${total} 張，沿用既有 ${skipped} 張。`)
