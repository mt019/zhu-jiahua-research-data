#!/usr/bin/env node
// 研究資料層的原件檢查：原 PDF、辨讀底稿、以及各自的第二份還在不在。
//
// data/materials 不入版控，validate-processed.mjs 看不到它，所以掃描件或底稿被清掉的時候
// 沒有任何東西會講。這支腳本補的是這一段：清單在 data/materials/source_manifest.json
// （同樣不入版控，原件的絕對路徑只准寫在那裡）。
//
// 整個 data/materials 不在本機時直接跳過。公開倉 clone 下來只有 .gitkeep，沒有原件。
// 清單裡的 copies 是空的時候印一行待決，不算失敗：第二份放哪裡由站主決定，
// 在他決定之前讓檢查一直紅著，下一個人只會學會忽略它。

import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MATERIALS = 'data/materials'
// 負向測試用 ZJH_MANIFEST 指到假清單，正常執行不設這個變數
const MANIFEST = process.env.ZJH_MANIFEST || join(MATERIALS, 'source_manifest.json')
const GCV_TXT = join(MATERIALS, 'speeches/gcv/txt')
const GCV_PAGES = join(MATERIALS, 'speeches/gcv/pages')

const problems = []
const pending = []
const notes = []

if (!existsSync(MATERIALS) || readdirSync(MATERIALS).filter((n) => n !== '.gitkeep').length === 0) {
  console.log('研究資料層不在本機，原件檢查跳過。')
  process.exit(0)
}

if (!existsSync(MANIFEST)) {
  problems.push(`${MANIFEST} 不存在：原件清單是這支檢查的唯一依據，缺了它就查不出東西有沒有掉。`)
} else {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))

  if (!m.localPath) {
    problems.push('清單沒有 localPath，不知道原 PDF 在哪裡。')
  } else if (!existsSync(m.localPath)) {
    problems.push(`原 PDF 不在清單所記的位置：${m.localPath}`)
  } else {
    const bytes = statSync(m.localPath).size
    if (m.bytes && bytes !== m.bytes) {
      problems.push(`原 PDF 的位元組數與清單不符：清單 ${m.bytes}，實際 ${bytes}`)
    } else {
      notes.push(`原 PDF ${bytes.toLocaleString('en-US')} bytes，與清單相符。`)
    }
  }

  const copies = Array.isArray(m.copies) ? m.copies : []
  if (copies.length === 0) {
    pending.push('清單的 copies 是空的：原 PDF 與辨讀底稿目前各只有一份，落點待站主決定。')
  }
  for (const c of copies) {
    if (!c.path) {
      problems.push('copies 有一筆沒有寫 path。')
    } else if (!existsSync(c.path)) {
      problems.push(`第二份不在所記的位置：${c.path}${c.note ? `（${c.note}）` : ''}`)
    } else {
      notes.push(`第二份在 ${c.path}${c.note ? `（${c.note}）` : ''}`)
    }
  }

  // 辨讀底稿的頁數要與原 PDF 的頁數相同；少了就是某幾頁的產物被清掉，而字數統計看不出來
  const expected = m.pages
  const stem = m.localPath ? m.localPath.split('/').pop().replace(/\.pdf$/i, '') : ''
  for (const [dir, label, ext] of [
    [GCV_TXT, '辨讀稿純文字', '.txt'],
    [GCV_PAGES, '頁圖', null],
  ]) {
    if (!existsSync(dir)) {
      problems.push(`${label}目錄不存在：${dir}`)
      continue
    }
    // 全書那一批的檔名是「PDF 主檔名-頁次」；另有幾件是選型時單頁試跑的產物，分開數
    const files = readdirSync(dir).filter((f) => (ext ? f.endsWith(ext) : /\.(jpe?g|png)$/i.test(f)))
    const n = files.filter((f) => f.startsWith(stem)).length
    const extra = files.length - n
    if (n === 0 && files.length > 0) {
      problems.push(`${dir} 裡沒有以「${stem}」起頭的檔：清單的 localPath 與底稿的檔名對不上`)
    } else if (expected && n !== expected) {
      problems.push(`${label} ${n} 件，原書 ${expected} 頁，不相符（${dir}）`)
    } else {
      notes.push(`${label} ${n} 件，與原 PDF 的頁數相符${extra ? `；另有試跑產物 ${extra} 件` : ''}。`)
    }
  }
}

for (const n of notes) console.log(`  ${n}`)
for (const p of pending) console.log(`待決：${p}`)
if (problems.length) {
  console.error('\n原件檢查未通過：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('原件檢查通過。')
