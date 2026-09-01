#!/usr/bin/env node
// 書外文獻的辨讀底稿：對 data/materials/external/<sourceId>/pages/ 的頁圖跑
// Google Cloud Vision DOCUMENT_TEXT_DETECTION，形狀照 build-chronology-gcv.mjs。
//
// 輸出：data/materials/external/<sourceId>/gcv/txt/pg-NN.txt   純文字
//       data/materials/external/<sourceId>/gcv/json/pg-NN.json 原始回應（座標與逐字信心，
//       側記號的位置判讀與間距分析都要它）
//
// 底稿的定位與全書那批相同：索引與切段的依據，不是權威正文。要引用的句子回原頁圖逐字核。
// 已有輸出的頁面由 gcv_ocr.py 自己跳過，中斷重跑即接續，不重複計費。
// 兩件合計 6 頁，在每月前 1,000 單位的免費額度內。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const gcvScript = join(homedir(), '.claude/skills/cjk-print-ocr/gcv_ocr.py')
if (!existsSync(gcvScript)) fail(`找不到 gcv_ocr.py：${gcvScript}`)

const only = (() => {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? process.argv[i + 1] : null
})()

const sources = JSON.parse(readFileSync(join(root, 'data/derived/sources.json'), 'utf8')).sources
  .filter((s) => !s.primaryPending && (!only || s.id === only))
if (sources.length === 0) fail(only ? `sources.json 沒有 ${only}，或它是掛帳的來源` : '沒有可辨讀的來源')

let done = 0
for (const src of sources) {
  const base = join(root, 'data/materials/external', src.id)
  const pagesDir = join(base, 'pages')
  if (!existsSync(pagesDir)) fail(`${src.id}：找不到頁圖目錄，先跑 build-external-pages.mjs`)
  const pages = readdirSync(pagesDir).filter((f) => /^pg-\d+\.png$/.test(f))
  if (pages.length === 0) fail(`${src.id}：頁圖目錄是空的`)

  const txtDir = join(base, 'gcv/txt')
  const jsonDir = join(base, 'gcv/json')
  mkdirSync(txtDir, { recursive: true })
  mkdirSync(jsonDir, { recursive: true })

  // gcv_ocr.py 把 json 寫在 --out/json/，本專案要 gcv/txt 與 gcv/json 兩層平行，跑完搬一層
  const r = spawnSync('python3', [gcvScript, '--out', txtDir, pagesDir], { stdio: 'inherit' })
  if (r.status !== 0) fail(`${src.id}：gcv_ocr.py 以非零狀態結束（${r.status}），辨讀未跑完`)

  const tmpJson = join(txtDir, 'json')
  if (existsSync(tmpJson)) {
    for (const f of readdirSync(tmpJson)) renameSync(join(tmpJson, f), join(jsonDir, f))
    rmdirSync(tmpJson)
  }

  const txt = readdirSync(txtDir).filter((f) => /^pg-\d+\.txt$/.test(f))
  const json = readdirSync(jsonDir).filter((f) => /^pg-\d+\.json$/.test(f))
  if (txt.length !== pages.length) fail(`${src.id}：純文字 ${txt.length} 份，頁圖 ${pages.length} 張，不相符`)
  if (json.length !== pages.length) fail(`${src.id}：原始回應 ${json.length} 份，頁圖 ${pages.length} 張，不相符`)
  const empty = txt.filter((f) => readFileSync(join(txtDir, f), 'utf8').trim().length === 0)
  if (empty.length) fail(`${src.id}：${empty.join('、')} 辨讀結果是空的，這兩件沒有空白頁，空白必是故障`)

  console.log(`${src.id}：${txt.length} 頁純文字與原始回應 → ${base.replace(root + '/', '')}/gcv/`)
  done += txt.length
}
console.log(`辨讀完成 ${done} 頁。`)
