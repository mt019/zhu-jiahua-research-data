#!/usr/bin/env node
// 用 toc_index.json 重建公開快照裡的篇目索引。
//
// 公開快照的其餘各節是手寫的，這支只動 tableOfContents.items 與那三個計數，
// 其餘欄位（textPath 這類前端用的）原樣留著。篇目的單一事實來源是 toc_index.json，
// 先前兩邊各存一份，起頁更正之後快照沒有跟著動，validate-processed.mjs 現在會查這件事。

import { readFileSync, writeFileSync } from 'node:fs'

const TOC = 'data/derived/toc_index.json'
const APP = 'data/processed/zhu-jiahua-app.json'

const toc = JSON.parse(readFileSync(TOC, 'utf8'))
const app = JSON.parse(readFileSync(APP, 'utf8'))
const keep = new Map(app.tableOfContents.items.map((i) => [i.id, i]))

app.tableOfContents.items = toc.items.map((item) => {
  const prev = keep.get(item.id) ?? {}
  const head = item.textHead
  const out = {
    id: item.id,
    title: item.title,
    part: item.part,
    bookStartPage: item.bookStartPage,
  }
  if (item.section) out.section = item.section
  if (item.dateOriginal) out.date = item.dateOriginal
  if (item.dateIso) out.dateIso = item.dateIso
  if (prev.textPath) out.textPath = prev.textPath
  // revisionNote（哪一欄改過、舊值是什麼）留在資料倉，不進公開快照：校勘自己抄本的紀錄
  // 屬工程痕跡，讀者要的是對的那個頁碼。
  if (item.note) out.note = item.note
  // 正文題下的日期比目次細（目次「民國二十年　月」，正文「民國二十年春」）時一併印出來
  if (head?.dateInText && head.dateInText !== item.dateOriginal?.replace(/\s/g, '')) {
    out.dateInText = head.dateInText
    out.dateInTextStatus = '待核'
  }
  if (head?.occasion) {
    out.occasion = head.occasion
    out.occasionStatus = '待核'
  }
  if (head?.bookEndPage) {
    out.bookEndPage = head.bookEndPage
    out.bookEndPageStatus = '待核'
    out.sharesEndPage = Boolean(head.sharesEndPage)
  }
  return out
})
// 卷首三項不在 198 篇裡，另記一份：獻詞與緣起已切成讀稿，圖片頁只有影像。
// id 對得上 data/processed/reading-drafts 的檔名，前端照它去載正文。
const FRONT_MATTER_DRAFTS = { 獻詞: 'ZJH-FM-001', 緣起: 'ZJH-FM-002' }
// 圖版（PDF 15–26）：圖說逐字錄在 data/materials/plates/plates.json。照片本身要等
// 攝影著作的權利狀態查清楚，rights.status 是 public 才把圖檔的路徑寫進來；
// 本機預覽用 ZJH_PLATES=1 帶進去看版面。
const plates = JSON.parse(readFileSync('data/materials/plates/plates.json', 'utf8'))
const platesPublic = plates.rights.status === 'public' || process.env.ZJH_PLATES === '1'
app.tableOfContents.frontMatter = toc.frontMatter.map((entry) => {
  const id = FRONT_MATTER_DRAFTS[entry.title] ?? null
  const out = { title: entry.title }
  if (!id) {
    out.plateCount = plates.items.length
    out.plates = plates.items.map((plate) => {
      const one = {
        id: plate.id,
        caption: plate.caption,
        pdfPage: plate.pdfPage,
      }
      if (plate.dateLabel) one.dateLabel = plate.dateLabel
      if (platesPublic && plate.rotate !== null) one.image = `/zhujiahua/plates/${plate.id}.jpg`
      return one
    })
    return out
  }
  const draft = JSON.parse(readFileSync(`data/processed/reading-drafts/${id}.json`, 'utf8'))
  out.id = id
  out.author = draft.author
  out.bookPages = draft.bookPages
  out.charCount = draft.charCount
  out.status = draft.status
  return out
})

app.tableOfContents.itemCount = app.tableOfContents.items.length
app.tableOfContents.readableCount = app.tableOfContents.items.filter((i) => i.textPath).length
app.generatedAt = toc.updatedAt

writeFileSync(APP, `${JSON.stringify(app, null, 2)}\n`)
console.log(`${APP}：篇目索引重建 ${app.tableOfContents.items.length} 筆，其中 ${app.tableOfContents.items.filter((i) => i.occasion).length} 筆帶場合`)
