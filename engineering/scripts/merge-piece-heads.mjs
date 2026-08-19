#!/usr/bin/env node
// 把 piece_heads.json 抽出來的正文題下資訊掛回 toc_index.json 的各篇底下。
//
// 目次那幾欄（篇名、原文日期、起頁）逐頁核過原頁圖，是本檔的權威來源；辨讀稿抽出來的
// 場合、訖頁、正文篇名另放在 textHead 一格裡，狀態一律待核，不與目次那幾欄混在一起。

import { readFileSync, writeFileSync } from 'node:fs'

const TOC = 'data/derived/toc_index.json'
const HEADS = 'data/derived/piece_heads.json'

const toc = JSON.parse(readFileSync(TOC, 'utf8'))
const heads = JSON.parse(readFileSync(HEADS, 'utf8'))
const byId = new Map(heads.items.map((h) => [h.id, h]))

let merged = 0
for (const item of toc.items) {
  const h = byId.get(item.id)
  if (!h?.matched) {
    delete item.textHead
    continue
  }
  const block = {
    status: '待核',
    source: 'Google Cloud Vision 辨讀稿的正文標題行，見 data/derived/piece_heads.json',
    pdfStartPage: h.pdfPage,
    pdfEndPage: h.endPdfPage ?? null,
    bookEndPage: h.endBookPage ?? null,
    pdfPageCount: h.pdfPageCount ?? null,
    sharesStartPage: Boolean(h.sharesStartPage),
    sharesEndPage: Boolean(h.sharesEndPage),
    occasion: h.occasion ?? null,
  }
  // 正文的題與目次的題不一致時把兩者都留著：目次常縮寫機關全稱，也有用字不同的（感言／感想）
  if (h.titleInText && h.titleInText !== item.title.replace(/[「」—－\s]/g, '')) {
    block.titleInText = h.titleInText
  }
  if (h.dateInText) block.dateInText = h.dateInText
  if (h.note) block.note = h.note
  item.textHead = block
  merged += 1
}

toc.updatedAt = heads.updatedAt
if (!toc.caveats.some((c) => c.startsWith('textHead'))) {
  toc.caveats.push(
    'textHead 一格是從辨讀稿抽的正文題下資訊（場合、訖頁、正文用的篇名），未逐頁核對原頁圖，狀態待核；目次那幾欄不受它影響。',
  )
}
writeFileSync(TOC, `${JSON.stringify(toc, null, 2)}\n`)
console.log(`${TOC}：${merged}/${toc.items.length} 篇掛上 textHead`)
