#!/usr/bin/env node
// 用 toc_index.json 重建公開快照裡的篇目索引。
//
// 公開快照的其餘各節是手寫的，這支只動 tableOfContents.items 與那三個計數，
// 其餘欄位（textPath 這類前端用的）原樣留著。篇目的單一事實來源是 toc_index.json，
// 先前兩邊各存一份，起頁更正之後快照沒有跟著動，validate-processed.mjs 現在會查這件事。

import { readFileSync, writeFileSync } from 'node:fs'
import { dateLabel, UNDATED_BOOK } from './lib/date-label.mjs'
import { dropHonorificSpace } from './lib/honorific-space.mjs'

const TOC = 'data/derived/toc_index.json'
const APP = 'data/processed/zhu-jiahua-app.json'

const toc = JSON.parse(readFileSync(TOC, 'utf8'))
const app = JSON.parse(readFileSync(APP, 'utf8'))
const keep = new Map(app.tableOfContents.items.map((i) => [i.id, i]))

// 網址錨點取原書起頁（p330），讀者看得懂也引得了；同一頁起兩篇時第二篇起加序號（p12-2）。
// 錨點公開後不再改，所以序號按目次先後定，validate-processed.mjs 驗它與起頁、唯一性相符。
// 舊網址的 #ZJH-NNN 由前端的對照表接住，id 本身不上網址。
const seenStart = new Map()
const anchorOf = (item) => {
  const n = (seenStart.get(item.bookStartPage) ?? 0) + 1
  seenStart.set(item.bookStartPage, n)
  return n === 1 ? `p${item.bookStartPage}` : `p${item.bookStartPage}-${n}`
}

app.tableOfContents.items = toc.items.map((item) => {
  const prev = keep.get(item.id) ?? {}
  const head = item.textHead
  const out = {
    id: item.id,
    anchor: anchorOf(item),
    title: dropHonorificSpace(item.title),
    part: item.part,
    bookStartPage: item.bookStartPage,
  }
  if (item.section) out.section = item.section
  // dateOriginal 是目次照錄的紀年，前端只在篇頭印一行；列表與右欄一律印 dateLabel（lib/date-label.mjs）
  if (item.dateOriginal) out.dateOriginal = item.dateOriginal
  if (item.dateIso) out.dateIso = item.dateIso
  out.dateLabel = dateLabel(item.dateIso, UNDATED_BOOK)
  if (prev.textPath) out.textPath = prev.textPath
  // revisionNote（哪一欄改過、舊值是什麼）留在資料倉，不進公開快照：校勘自己抄本的紀錄
  // 屬工程痕跡，讀者要的是對的那個頁碼。
  if (item.note) out.note = item.note
  // 正文題下的日期比目次細（目次「民國二十年　月」，正文「民國二十年春」）時一併印出來
  if (head?.dateInText && head.dateInText !== item.dateOriginal?.replace(/\s/g, '')) {
    out.dateInText = head.dateInText
    out.dateInTextStatus = '待核'
  }
  // 篇頭在 dateLabel 底下另起一行照錄原書的紀年，標明是目次的還是篇端的；前端照印不再組字
  const dateSources = [
    item.dateOriginal ? `原書目次：${item.dateOriginal}` : null,
    out.dateInText ? `篇端署：${out.dateInText}　待核` : null,
  ].filter(Boolean)
  if (dateSources.length) out.dateSources = dateSources
  if (head?.occasion) {
    out.occasion = head.occasion
    out.occasionStatus = '待核'
  }
  // 本站標注：會議與場合用統一格式（「教育部法律教育委員會第三次會議」），篇端的原文照錄在 occasion；
  // firstPrinting 記首刊的刊物、卷期、頁碼與原刊題名。兩欄都是本站所加，母本在 toc_index.json。
  if (item.siteOccasion) out.siteOccasion = item.siteOccasion
  if (item.firstPrinting) {
    const f = item.firstPrinting
    out.firstPrinting = { ...f, label: `${f.publication}${f.issue}（${f.year}），頁 ${f.pages}，題作〈${f.title}〉${f.subtitle ? `，副題「${f.subtitle}」` : ''}` }
  }
  if (head?.bookEndPage) {
    out.bookEndPage = head.bookEndPage
    out.bookEndPageStatus = '待核'
    out.sharesEndPage = Boolean(head.sharesEndPage)
  }
  // 篇頭與右欄印的起訖頁（「121–125」，只有起頁時為「121」），前端照印
  out.bookExtent = out.bookEndPage && out.bookEndPage !== item.bookStartPage ? `${item.bookStartPage}–${out.bookEndPage}` : String(item.bookStartPage)
  return out
})
// 卷首三項不在 198 篇裡，另記一份：獻詞與緣起已切成讀稿，圖片頁只有影像。
// id 對得上 data/processed/reading-drafts 的檔名，前端照它去載正文。
const FRONT_MATTER_DRAFTS = { 獻詞: 'ZJH-FM-001', 緣起: 'ZJH-FM-002' }
// 網址錨點給讀者看得懂的短名；舊網址帶的內部編號（#ZJH-FM-001）記在 legacyAnchor，前端照它對回。
const FRONT_MATTER_ANCHORS = { 獻詞: 'dedication', 緣起: 'origins', 圖片: 'plates' }
// 圖版（PDF 15–26）：圖說逐字錄在 data/materials/plates/plates.json。照片本身要等
// 攝影著作的權利狀態查清楚，rights.status 是 public 才把圖檔的路徑寫進來；
// 本機預覽用 ZJH_PLATES=1 帶進去看版面。
const plates = JSON.parse(readFileSync('data/materials/plates/plates.json', 'utf8'))
const platesPublic = plates.rights.status === 'public' || process.env.ZJH_PLATES === '1'
app.tableOfContents.frontMatter = toc.frontMatter.map((entry) => {
  const id = FRONT_MATTER_DRAFTS[entry.title] ?? null
  const out = { title: entry.title, anchor: FRONT_MATTER_ANCHORS[entry.title], legacyAnchor: id ?? 'ZJH-FM-PLATES' }
  if (!out.anchor) throw new Error(`卷首「${entry.title}」沒有登記網址錨點`)
  if (!id) {
    out.plateCount = plates.items.length
    out.plates = plates.items.map((plate) => {
      const one = {
        id: plate.id,
        caption: plate.caption,
        pdfPage: plate.pdfPage,
      }
      if (plate.dateOriginal) one.dateOriginal = plate.dateOriginal
      if (platesPublic && plate.rotate !== null) one.image = `/zhujiahua-plates/${plate.id}.jpg`
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

// 法學教育六篇是手寫的一節，日期欄照篇目索引的兩欄改：原文紀年叫 dateOriginal，印的是 dateLabel。
for (const item of app.legalEducation.items) {
  if ('date' in item) {
    item.dateOriginal = item.date
    delete item.date
  }
  item.dateLabel = dateLabel(item.dateIso, UNDATED_BOOK)
}

// 著作權標示：讀稿頁右欄、單篇頁與卷首頁的頁末印的短句，母本在 data/materials/rights.json；
// note 欄寫給維護的人看，不進快照。
const { note: _rightsNote, ...rights } = JSON.parse(readFileSync('data/materials/rights.json', 'utf8'))
app.rights = rights

app.tableOfContents.itemCount = app.tableOfContents.items.length
app.tableOfContents.readableCount = app.tableOfContents.items.filter((i) => i.textPath).length
app.generatedAt = toc.updatedAt

writeFileSync(APP, `${JSON.stringify(app, null, 2)}\n`)
console.log(`${APP}：篇目索引重建 ${app.tableOfContents.items.length} 筆，其中 ${app.tableOfContents.items.filter((i) => i.occasion).length} 筆帶場合`)
