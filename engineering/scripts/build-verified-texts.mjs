#!/usr/bin/env node
// 用 data/derived/transcriptions/*.md 重建公開快照的 verifiedTexts。
//
// 先前這一節是手抄的：校訂稿改一個字，快照要有人記得跟著改，而沒有任何檢查在看兩邊是否一致。
// 2026-08-19 七篇複核改了十九處，就是這支腳本產生的。校訂稿是單一事實來源，快照只是它的產物。
//
// 校訂記錄（`## 校訂記錄` 一節）與 frontmatter 的字形紀錄留在資料倉，不進快照。

import { readFileSync, writeFileSync } from 'node:fs'

const APP = 'data/processed/zhu-jiahua-app.json'
const DIR = 'data/derived/transcriptions'
const FILES = ['ZJH-001', 'ZJH-LE-001', 'ZJH-LE-002', 'ZJH-LE-003', 'ZJH-LE-004', 'ZJH-LE-005', 'ZJH-LE-006']

const app = JSON.parse(readFileSync(APP, 'utf8'))
const before = new Map(app.verifiedTexts.map((v) => [v.id, v]))

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) throw new Error('缺 frontmatter')
  const out = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0 || /^\s/.test(line)) continue
    out[line.slice(0, i)] = line.slice(i + 1).trim()
  }
  return { meta: out, body: text.slice(m[0].length) }
}

function pageRange(raw) {
  const pages = JSON.parse(raw)
  return pages.length === 1 ? String(pages[0]) : `${pages[0]}–${pages[pages.length - 1]}`
}

app.verifiedTexts = FILES.map((id) => {
  const { meta, body } = frontMatter(readFileSync(`${DIR}/${id}.md`, 'utf8'))
  const lines = body
    .split('\n---\n')[0]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines[0].startsWith('# ')) throw new Error(`${id}：正文第一行不是標題`)
  lines.shift()
  const dateLine = lines.shift()
  if (meta.occasion && lines[0] === meta.occasion) lines.shift()
  const entry = {
    id,
    title: meta.title,
    dateLine,
    bookPages: pageRange(meta.book_pages),
    status: meta.transcription_status,
    paragraphs: lines,
  }
  if (meta.verification_note) {
    entry.statusNote = meta.verification_note
    // 前端印的是 correctionNote：statusNote 開頭那一句寫的是怎麼核的（辨讀引擎、dpi、對齊
    // 方式），那是維護的紀錄，不上前端；讀者要的是這一篇改了哪幾處。切在第一個句號之後。
    const at = meta.verification_note.indexOf('。')
    const rest = at < 0 ? '' : meta.verification_note.slice(at + 1).trim()
    if (!rest) throw new Error(`${id} 的 verification_note 只有一句核對過程，沒有寫改了什麼`)
    entry.correctionNote = rest
  }
  const prev = before.get(id)
  for (const field of ['title', 'dateLine', 'bookPages']) {
    if (prev && prev[field] !== entry[field]) {
      throw new Error(`${id} 的 ${field} 與快照原值不同：「${prev[field]}」→「${entry[field]}」。確認是有意更動再改這支腳本的判定。`)
    }
  }
  return entry
})

writeFileSync(APP, `${JSON.stringify(app, null, 2)}\n`)
for (const v of app.verifiedTexts) {
  const prev = before.get(v.id)
  const changed = !prev || JSON.stringify(prev.paragraphs) !== JSON.stringify(v.paragraphs)
  console.log(`${v.id}　${v.paragraphs.length} 段　${v.status}${changed ? '　正文有更動' : ''}`)
}
