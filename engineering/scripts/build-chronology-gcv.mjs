#!/usr/bin/env node
// 對年譜全書 68 頁跑 Google Cloud Vision DOCUMENT_TEXT_DETECTION，取代原先的 tesseract 索引稿。
//
// 輸入：data/materials/chronology/pages/pg-01.png … pg-68.png
// 輸出：data/materials/chronology/gcv/txt/pg-NN.txt   純文字（每頁一份）
//       data/materials/chronology/gcv/json/pg-NN.json 原始回應（座標與逐字信心）
//
// 實際呼叫 ~/.claude/skills/cjk-print-ocr/gcv_ocr.py：languageHints 已內建 zh-Hant、
// 已有輸出的頁面自動跳過（斷點續跑、不重複收費）、單頁辨識不出文字一律中止並指出頁碼
// （不傳 --allow-empty，年譜全書沒有空白頁或圖版頁，辨識空白必然是故障）。
// 該腳本把純文字寫在 --out 本身、json 寫在 --out/json/，與本專案要的 gcv/txt/、gcv/json/
// 兩層平行目錄不同，這裡跑完之後把 json 目錄搬一層出去對齊。
//
// 金鑰讀取、重試與計價一律照 gcv_ocr.py 本身；本腳本不重複那套邏輯。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pagesDir = join(root, 'data/materials/chronology/pages')
const gcvDir = join(root, 'data/materials/chronology/gcv')
const txtDir = join(gcvDir, 'txt')
const jsonDir = join(gcvDir, 'json')
const gcvScript = join(homedir(), '.claude/skills/cjk-print-ocr/gcv_ocr.py')

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

if (!existsSync(pagesDir)) fail(`找不到頁面影像目錄 ${pagesDir}`)
if (!existsSync(gcvScript)) fail(`找不到 gcv_ocr.py：${gcvScript}`)

const pages = readdirSync(pagesDir).filter((f) => /^pg-\d+\.png$/.test(f)).sort()
if (pages.length !== 68) fail(`年譜頁面應為 68 頁，讀到 ${pages.length} 頁`)

mkdirSync(txtDir, { recursive: true })
mkdirSync(jsonDir, { recursive: true })

// gcv_ocr.py 的 json 子目錄跟著 --out 走，先指到 txt/ 讓純文字落在正確位置，
// 跑完再把 txt/json/ 底下的檔案搬到本專案要的 gcv/json/。
const result = spawnSync('python3', [gcvScript, '--out', txtDir, pagesDir], {
  stdio: 'inherit',
})
if (result.status !== 0) fail(`gcv_ocr.py 以非零狀態結束（${result.status}），OCR 未完整跑完`)

const tmpJsonDir = join(txtDir, 'json')
if (existsSync(tmpJsonDir)) {
  for (const f of readdirSync(tmpJsonDir)) {
    renameSync(join(tmpJsonDir, f), join(jsonDir, f))
  }
  rmdirSync(tmpJsonDir)
}

const txtOut = readdirSync(txtDir).filter((f) => /^pg-\d+\.txt$/.test(f))
const jsonOut = readdirSync(jsonDir).filter((f) => /^pg-\d+\.json$/.test(f))
if (txtOut.length !== 68) fail(`純文字輸出應為 68 頁，實得 ${txtOut.length} 頁`)
if (jsonOut.length !== 68) fail(`原始回應應為 68 頁，實得 ${jsonOut.length} 頁`)

console.log(`Google Cloud Vision OCR 完成：${txtOut.length} 頁純文字 → ${txtDir}`)
console.log(`原始回應 ${jsonOut.length} 頁 → ${jsonDir}`)
