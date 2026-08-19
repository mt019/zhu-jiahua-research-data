#!/usr/bin/env node
// 把全書辨讀底稿切成 198 篇的未校讀稿，輸出 data/processed/reading-drafts/。
//
// 底稿是 Google Cloud Vision 一頁一檔的辨讀結果（data/materials/speeches/gcv/txt，不入版控）。
// 切篇的依據是 piece_heads.json：每篇的起訖 PDF 頁、以及正文裡那一行標題的原字。同一頁常
// 接排兩篇，所以起頁從標題行切起，訖頁切到次篇的標題行為止。
//
// 正文依原書自己的分段連續排下去，不按 PDF 分頁切段：原書靠首行縮排分段，直排版的縮排
// 就是該段第一欄的頂端往下讓兩格，辨識結果的座標讀得出來（實測續頁的接續段第一欄頂端
// 落在版心上緣 y≈314，縮排的段落落在 y≈430）。跨頁的段落因此接得回去，頁碼改記成
// pageBreaks 的字元位置，前端在對應的位置標頁碼。
//
// 產物一律標著未校：字錯率見 LOG 2026-08-19（複核過的七篇 32 頁 20,828 字上 26 處，0.125%）。
// 逐頁人工校訂完成的篇另存 data/derived/transcriptions/，前端以那一份為準。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TXT_DIR = 'data/materials/speeches/gcv/txt'
const JSON_DIR = 'data/materials/speeches/gcv/txt/json'
const HEADS = 'data/derived/piece_heads.json'
const TOC = 'data/derived/toc_index.json'
const PAGE_MAP = 'data/derived/page_map.json'
const OUT_DIR = 'data/processed/reading-drafts'
const VARIANTS = `${process.env.HOME}/.claude/skills/cjk-print-ocr/variants.tsv`

// 縮排判定的門檻：續頁接續段與版心上緣的落差實測在 10 以內，縮排段在 110 以上。
const INDENT_MIN = 60

if (!existsSync(TXT_DIR)) {
  console.log('辨讀底稿不在本機，讀稿建置跳過。')
  process.exit(0)
}

const fold = new Map()
for (const line of readFileSync(VARIANTS, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [canon, ...rest] = line.trim().split(/\s+/)
  for (const v of rest) fold.set(v, canon)
}
// 比對用的正規化只在讀取端，寫出去的正文保留底稿原字（~/.claude/rules/轉錄體例.md）
const norm = (s) =>
  [...s.replace(/[\s·、。，．,.:：;；|｜【】()（）「」『』〈〉《》—─\-]/g, '')]
    .map((ch) => fold.get(ch) ?? ch)
    .join('')

const heads = JSON.parse(readFileSync(HEADS, 'utf8')).items
const toc = JSON.parse(readFileSync(TOC, 'utf8')).items
const pageMap = JSON.parse(readFileSync(PAGE_MAP, 'utf8'))
const bookByPdf = new Map()
for (const it of pageMap.items) {
  const b = it.bookPage ?? it.bookPageInferred
  if (Number.isInteger(b)) bookByPdf.set(it.pdfPage, b)
}
// 缺頁歸給哪一篇，依 toc_index.json 現行的起頁自己算：page_map 的 gaps 裡那一欄記的是
// 2026-08-19 更正之前的起頁，照它歸會把原書 124 頁記到 ZJH-034 而不是 ZJH-033。
const missingByPiece = new Map()
for (const g of pageMap.gaps) {
  let owner = null
  for (const t of toc) {
    if (t.bookStartPage <= g.bookPage) owner = t
    else break
  }
  if (!owner) continue
  missingByPiece.set(owner.id, [...(missingByPiece.get(owner.id) ?? []), g.bookPage])
}

// 部次名照原書的書眉寫法（沒有頓號），教／敎兩形都收；部次與部名之間辨讀稿有時多出
// 一兩個字元（【叁】教育言論、拾肆-追念師友），一併容許。
const headAlternatives = [...new Set(toc.map((t) => t.part))]
  .map((part) => {
    const [ordinal, name] = part.split('、')
    const names = name.includes('教') ? [name, name.replace('教', '敎')] : [name]
    // 序數的異體與常見誤認一併收：原書排叄而字元集寫叁，壹常被認成臺。
    const ords = [...new Set([ordinal, ordinal.replace('叁', '叄'), ordinal.replace('壹', '臺')])]
    return `【?(?:${ords.join('|')})】?[-—、,.\\s]{0,2}(?:${names.join('|')})`
  })
  .sort((a, b) => b.length - a.length)
const HEAD_IN_LINE = new RegExp(`(?:${headAlternatives.join('|')})`)

// 書眉與書根印在版心外的邊欄，辨識引擎有時把它們併進正文那一段。直排版的版心是等距的
// 欄，邊欄與版心之間空著一整欄：把一段的字按 x 分欄之後，開頭或結尾那一欄若只有幾個字、
// 而且與相鄰欄的距離超過欄距的 1.15 倍，那一欄就是邊欄，整欄丟掉。實測 p-517 的書根
// 「四八〇」在 x≈1971，正文最右欄在 x≈1858，欄距 88——邊欄離得比一欄還遠。
//
// 這一關不看文字長什麼樣，所以部次那個字被認錯（壹讀成壺、柒讀成粜）照樣攔得住；先前
// 只按「部次＋部名」的字面找邊欄，認錯就整段漏掉。
//
// 回傳留下來的字，以及留下來的第一個字的頂端 y 與最右欄的 x——縮排判定與欄序都要用它。
// 書眉是書名或部次名，書根是頁碼；兩者各自成行，辨讀稿裡的頁碼常認錯，只認長相
const RUNNING_HEAD = /^(朱家驊先生言論集|[壹貳叁肆伍陸柒捌玖拾][、\s]?.{0,12})$/

// 書眉印的是部次名或節名，兩者都在目次裡，所以認的是目次自己的字串，不是猜的字面。
// 只按「序數字＋名稱」的長相認，漏掉三種：序數被認成別的字（壹→臺）、序數整個沒被認出
// （只剩「教育言論」）、以及序數的異體（原書排的是叄，先前的字元集寫的是叁）。
// 判準改成：整段除掉序數、頁碼與分隔符之後，剩下的正好是目次裡的一個名稱。
const HEAD_NAMES = (() => {
  const names = new Set(['朱家驊先生言論集'])
  for (const t of toc) {
    for (const raw of [t.part, t.section, t.subsection]) {
      if (!raw) continue
      names.add(raw.includes('、') ? raw.split('、').slice(1).join('、') : raw)
    }
  }
  return new Set([...names].map((n) => n.replace(/[敎]/g, '教')))
})()

// 序數（中文數字與大寫數字）、頁碼的中文數字、以及分隔符都剝掉；辨讀常混的異體字先歸一。
const headKey = (t) =>
  t
    .replace(/[敎]/g, '教')
    .replace(/[叄参]/g, '叁')
    .replace(/[（(][一二三四五六七八九十]+[）)]/g, '')
    .replace(/^[壹貳叁肆伍陸柒捌玖拾臺壺粜一二三四五六七八九十]{1,3}/, '')
    .replace(/[〇一二三四五六七八九十百]+$/, '')
    .replace(/[、,.．・\s【】\-—]/g, '')

const isRunningHead = (t) => {
  const s = t.trim()
  if (!s || s.length > 16) return false
  const key = headKey(s)
  return key.length >= 2 && HEAD_NAMES.has(key)
}
const PAGE_NUMBER = /^[〇一二三四五六七八九十百0-9\s.,·]{1,6}$/

const COLUMN_TOLERANCE = 25
const MARGIN_GAP_RATIO = 1.15
const MARGIN_MAX_SYMBOLS = 14

const columnsOf = (syms) => {
  const cols = []
  for (const s of [...syms].sort((a, b) => b.cx - a.cx)) {
    const last = cols[cols.length - 1]
    if (last && Math.abs(last.cx - s.cx) <= COLUMN_TOLERANCE) {
      last.items.push(s)
      last.cx = (last.cx * (last.items.length - 1) + s.cx) / last.items.length
    } else cols.push({ cx: s.cx, items: [s] })
  }
  return cols
}

const dropMarginColumns = (syms) => {
  let cols = columnsOf(syms)
  if (cols.length < 3) return { syms, dropped: 0 }
  let dropped = 0
  for (let round = 0; round < 3 && cols.length >= 3; round += 1) {
    const gaps = []
    for (let i = 1; i < cols.length; i += 1) gaps.push(cols[i - 1].cx - cols[i].cx)
    const pitch = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    if (!pitch) break
    const head = cols[0]
    const tail = cols[cols.length - 1]
    if (head.items.length <= MARGIN_MAX_SYMBOLS && gaps[0] > pitch * MARGIN_GAP_RATIO) {
      dropped += head.items.length
      cols = cols.slice(1)
      continue
    }
    if (tail.items.length <= MARGIN_MAX_SYMBOLS && gaps[gaps.length - 1] > pitch * MARGIN_GAP_RATIO) {
      dropped += tail.items.length
      cols = cols.slice(0, -1)
      continue
    }
    break
  }
  const keep = new Set(cols.flatMap((c) => c.items))
  return { syms: syms.filter((s) => keep.has(s)), dropped }
}

// 詞距只補在拉丁字母、數字與它們的標點之間：直排的漢字之間辨識結果也常標 SPACE，
// 照補就會把整段中文拆成一個字一個空格。
const LATINISH = /[A-Za-z0-9À-ɏ.,;:'’\-]/
const joinSyms = (list) => {
  let out = ''
  for (let i = 0; i < list.length; i += 1) {
    out += list[i].text
    const next = list[i + 1]
    if (list[i].space && next && LATINISH.test(list[i].text.slice(-1)) && LATINISH.test(next.text[0])) out += ' '
  }
  return out
}

const readParagraph = (par) => {
  const syms = par.words.flatMap((w) =>
    w.symbols.map((sym) => {
      const v = sym.boundingBox?.vertices ?? []
      const xs = v.map((q) => q.x ?? 0)
      const ys = v.map((q) => q.y ?? 0)
      return {
        text: sym.text,
        // 拉丁文的詞距在辨識結果裡不是一個字元，是這個符號的 detectedBreak；只取符號的
        // 文字就會把「Academia Sinica」黏成一個詞（歌德那首詩整行黏成一串也是這個原因）。
        space: ['SPACE', 'EOL_SURE_SPACE'].includes(sym.property?.detectedBreak?.type ?? ''),
        cx: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0,
        top: ys.length ? Math.min(...ys) : null,
      }
    }),
  )
  const raw = joinSyms(syms)
  // 先按座標丟整條邊欄，再按字面補一刀：書眉與正文擠在同一欄的少數頁靠後者
  let { syms: kept, dropped } = dropMarginColumns(syms)
  const text0 = joinSyms(kept)
  const m = text0.trim().length > 14 ? HEAD_IN_LINE.exec(text0) : null
  if (m) {
    const band = kept.slice(m.index, m.index + m[0].length).map((s) => s.cx)
    const lo = Math.min(...band) - 60
    const hi = Math.max(...band) + 60
    const before = kept.length
    kept = kept.filter((s, i) => {
      if (i >= m.index && i < m.index + m[0].length) return false
      return s.cx < lo || s.cx > hi
    })
    dropped += before - kept.length
  }
  return { syms: kept, dropped, raw }
}

// 一段留下來的字算出前端要的欄位
const shapeParagraph = (kept) => {
  const tops = kept.map((s) => s.top).filter((y) => y !== null)
  return {
    text: joinSyms(kept).trim(),
    firstTop: tops.length ? tops[0] : null,
    minTop: tops.length ? Math.min(...tops) : null,
    headX: kept.length ? Math.max(...kept.map((s) => s.cx)) : 0,
  }
}

const pages = new Map()
let marginStripped = 0
for (const f of readdirSync(JSON_DIR)) {
  const n = Number(f.match(/(\d+)\.json$/)?.[1])
  if (!Number.isInteger(n) || pages.has(n)) continue
  const doc = JSON.parse(readFileSync(join(JSON_DIR, f), 'utf8'))
  const page = doc.fullTextAnnotation?.pages?.[0]
  const read = []
  for (const b of page?.blocks ?? []) {
    for (const par of b.paragraphs ?? []) {
      const p = readParagraph(par)
      if (p.syms.length) read.push(p)
    }
  }
  // 書眉與書根各自成段時，它們的 x 就把這一頁的邊欄位置指出來了；同一條欄上的字，
  // 不管落在哪一段，都是邊欄。上面按欄距判的那一關漏掉的（欄距差得不夠遠）由這一關收。
  // 只認落在版面最外側的：正文裡也有整段只有幾個數字的（節次、條號），拿它當邊欄會
  // 把整條版心當成邊欄刷掉
  const outer = (page?.width ?? 2262) * 0.15
  const bands = read
    .filter((p) => {
      const t = p.syms.map((s) => s.text).join('').trim()
      if (!t || !(RUNNING_HEAD.test(t) || PAGE_NUMBER.test(t))) return false
      const cx = p.syms.map((s) => s.cx)
      const mid = (Math.min(...cx) + Math.max(...cx)) / 2
      return mid < outer || mid > (page?.width ?? 2262) - outer
    })
    .map((p) => {
      const cx = p.syms.map((s) => s.cx)
      return [Math.min(...cx) - 30, Math.max(...cx) + 30]
    })
  const paras = []
  for (const p of read) {
    let kept = p.syms
    if (bands.length) {
      const onBand = (x) => bands.some(([lo, hi]) => x >= lo && x <= hi)
      const inside = kept.filter((s) => onBand(s.cx))
      // 整段都在邊欄上的是書眉或書根本身，留給 chrome() 整段丟；只剔部分併進正文的
      if (inside.length && inside.length < kept.length) {
        kept = kept.filter((s) => !onBand(s.cx))
        p.dropped += inside.length
      }
    }
    if (p.dropped > 0 && p.raw.trim()) marginStripped += 1
    const shaped = shapeParagraph(kept)
    if (shaped.text) paras.push(shaped)
  }
  // 直排右起：辨識結果的段落順序不可靠（實測 p-518 有一個單獨的「。」排在整頁最前面），
  // 依每段最右一欄的 x 由大到小重排，就是原書的閱讀順序。
  paras.sort((a, b) => b.headX - a.headX)
  // 版心上緣：全頁留下來的字裡最高的那一個。書眉在外側邊欄、書根在版心下方，
  // 兩者的頂端都比正文低，不會把這條線拉上去。
  const tops = paras.map((p) => p.minTop).filter((y) => y !== null)
  const pageTop = tops.length ? Math.min(...tops) : 0
  for (const p of paras) p.indented = p.firstTop === null || p.firstTop - pageTop >= INDENT_MIN
  pages.set(n, paras)
}
console.log(`書眉或書根併進正文段的 ${marginStripped} 段已剔除邊欄的字`)


// 辨讀稿把全形標點讀成半形，原書排的是全形。判準是這個標點的左右鄰居——鄰居是漢字、
// 假名或全形標點就轉回全形。句號與逗號要求兩邊都是，否則會動到拉丁文裡的
// 「F.J.M.Bourdrez」與「Bologna, Padua, Pisa」。
const CJK_CTX = /[　-〿぀-ヿ一-鿿豈-﫿＀-￯]/
const WIDE = { ',': '，', '.': '。', ':': '：', ';': '；', '?': '？', '!': '！', '(': '（', ')': '）' }
const BOTH_SIDES = new Set([',', '.'])
const widen = (t) => {
  const out = [...t]
  // 兩趟：第一趟把括號轉成全形，第二趟「）;」的分號才看得到全形的鄰居
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < out.length; i += 1) {
      const w = WIDE[out[i]]
      if (!w) continue
      const left = CJK_CTX.test(out[i - 1] ?? '')
      const right = CJK_CTX.test(out[i + 1] ?? '')
      // 句號與逗號預設要求兩邊都是漢字，免得動到「Bologna, Padua, Pisa」與
      // 「F.J.M.Bourdrez」；但拉丁詞後面接漢字的那一個（「Academia Sinica，大家」）
      // 原書排的是全形，只看右鄰。左鄰是數字的不算（1,000 元的千分位）。
      const digitLeft = /[0-9]/.test(out[i - 1] ?? '')
      if (BOTH_SIDES.has(out[i]) ? (left && right) || (right && !digitLeft) : left || right) out[i] = w
    }
  }
  return out.join('')
}

// 掃描件上的墨點、勾記與污損被辨識成 ⚫ ✓ ○ ① 這類符號，落到站上是一個畫不出來的字。
// 漢字、假名、拉丁字母、數字與常用標點以外的一律剔除。大括號與直槓在正文裡沒有用處
// （實測全書 68 處全是污損與書根碎片），一併剔除。
const NOISE = /[^　-〿぀-ヿ一-鿿豈-﫿＀-￯ -~À-ɏ]|[{}|]/g

const chrome = (line) => !line || RUNNING_HEAD.test(line) || PAGE_NUMBER.test(line) || isRunningHead(line)

// 標題行在該頁的位置：拿正文那一行的原字去找，找不到就退回頁首
const titleLineIndex = (pdfPage, titleInText) => {
  const lines = pages.get(pdfPage) ?? []
  if (!titleInText) return 0
  const key = norm(titleInText)
  const exact = lines.findIndex((l) => norm(l.text).startsWith(key))
  if (exact >= 0) return exact
  const loose = lines.findIndex((l) => norm(l.text).includes(key.slice(0, Math.min(8, key.length))))
  return loose >= 0 ? loose : 0
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const byId = new Map(toc.map((t) => [t.id, t]))
const index = []
let totalChars = 0
let joined = 0
let marginLeftovers = 0
let movedMarks = 0

for (let i = 0; i < heads.length; i += 1) {
  const h = heads[i]
  const next = heads[i + 1]
  const meta = byId.get(h.id)
  const startIdx = titleLineIndex(h.pdfPage, h.titleInText)
  const endPdf = h.endPdfPage ?? h.pdfPage
  const endIdx =
    next && next.pdfPage === endPdf ? titleLineIndex(next.pdfPage, next.titleInText) : Infinity

  const paragraphs = []
  const pageBreaks = []
  let pendingMark = null
  const bookPages = []
  let noiseRemoved = 0
  for (let p = h.pdfPage; p <= endPdf; p += 1) {
    const lines = pages.get(p) ?? []
    // 標題行由前端另外呈現，正文從它底下起；題下若另起一行寫場合（「在中央紀念週講」
    // 「於重慶」），那一行也是題下資訊，一併跳過
    let skip = startIdx + 1
    if (p === h.pdfPage && h.occasion) {
      const line = lines[skip]?.text ?? ''
      if (line && norm(line).includes(norm(h.occasion)) && line.length <= h.occasion.length + 6) skip += 1
    }
    const from = p === h.pdfPage ? skip : 0
    const to = p === endPdf ? Math.min(lines.length, endIdx) : lines.length
    const body = lines.slice(from, to).filter((l) => !chrome(l.text))
    const cleaned = body
      .map((l) => {
        const t = l.text.replace(NOISE, '')
        noiseRemoved += l.text.length - t.length
        return { text: widen(t).trim(), indented: l.indented }
      })
      // 掃描件上的髒點被辨識成一兩個拉丁字母或符號，自成一段（實測原書 573、585、616
      // 三頁各留下一個 f、}、n）。不含漢字又短的整段丟掉；只有標點的那一段是上一段
      // 末尾被切出來的收尾符號（原書 481 的句號），留著但不讓它自成一段。
      // 邊欄與掃描髒點留下來的碎片，在剔過雜訊字元之後才看得出長相，所以這一關放在清理之後：
      // 書眉與書根整段（上一關按原字判，遇到雜訊字元夾在中間就認不出來）、只剩一個漢字的
      // 段（邊欄的字被切成一欄一字，正文沒有一個字自成一段）、以及不含漢字又短的段
      // （110K、GDGY、Ol!! 這類髒點；歌德那幾行拉丁文詩每行都在十二字以上，不會被誤刪）。
      .filter((l) => {
        if (!l.text) return false
        if (isRunningHead(l.text)) return false
        const cjk = /[\u4e00-\u9fff\uf900-\ufaff]/.test(l.text)
        if (!cjk) return l.text.length >= 12 || /^[\u3000-\u303f\uff00-\uffef]+$/.test(l.text)
        return [...l.text].length > 1
      })
      .map((l) => (/^[\u3000-\u303f\uff00-\uffef]+$/.test(l.text) ? { ...l, indented: false, tail: true } : l))
    if (!cleaned.length) continue

    // 原書頁碼由該篇目次所載的起頁往後數，不取 page_map 的推定值：目次那一欄逐欄核過，
    // 而 page_map 在讀不出頁碼的區段是拿相鄰頁的偏移推的，缺頁的位置一旦定得不準就整段偏一頁。
    // 兩者不一致時記下來，該頁的頁碼標為推定。
    const derived = meta ? meta.bookStartPage + (p - h.pdfPage) : null
    const fromMap = bookByPdf.get(p) ?? null
    const bookPage = derived ?? fromMap
    bookPages.push(bookPage)
    const brk = { bookPage, para: 0, offset: 0 }
    if (derived !== null && fromMap !== null && derived !== fromMap) {
      brk.status = '推定'
      brk.note = `page_map 由相鄰頁推得 ${fromMap}，本檔取目次起頁往後數的 ${derived}`
    }

    for (let k = 0; k < cleaned.length; k += 1) {
      const line = { ...cleaned[k] }
      // 該頁第一段沒有縮排，表示它是上一頁那一段的下半截，接回去；篇的第一段不接
      // 縮排是幾何判準，遇到整段低兩格的引文就會失效：原書 2 頁末「預薦足下擔任教職，將」
      // 接 3 頁首「來當由翁兄逕行接洽之」，續頁首行的 y 落在縮排的位置，於是被判成新段。
      // 中文的段落不會停在「將」「對陳君」這種字上，所以前一段結尾沒有標點時一律接回，
      // 這一條比縮排可靠。
      const unfinished = paragraphs.length > 0 && !/[。！？；：、，」』）]$/.test(paragraphs[paragraphs.length - 1])
      const continues = k === 0 && paragraphs.length > 0 && (!line.indented || unfinished)
      // 直排右起，一段的最後若只剩一個句號，它常被排到別的位置：辨讀稿有時把它切成
      // 單獨一段（原書 481 頁），有時把它讀成次頁第一行的開頭（原書 105 頁）。兩種都
      // 不能就地接上去——那一段可能還沒接完，接了就落在句子中間（「發起組設中央研。
      // 究院籌備委員會」）。改成記著，等該段真的結束再補到段末。
      if (continues && pendingMark && pendingMark.para === paragraphs.length - 1) {
        paragraphs[pendingMark.para] = paragraphs[pendingMark.para].slice(0, -pendingMark.text.length)
        for (const b of pageBreaks) {
          if (b.para === pendingMark.para && b.offset > paragraphs[b.para].length) b.offset = paragraphs[b.para].length
        }
        pendingMark = { ...pendingMark, para: null }
      }
      if (k === 0) {
        brk.para = continues ? paragraphs.length - 1 : paragraphs.length
        brk.offset = continues ? paragraphs[paragraphs.length - 1].length : 0
        pageBreaks.push(brk)
      }
      if (k === 0 && continues) {
        // 續頁第一行若以標點開頭，那個標點是頁首的污損：直排鉛印避頭點，句號與逗號
        // 不排在行首（原書 104 頁末「⋯發起組設中央研」接 105 頁首，辨讀稿在「究院」
        // 前面多讀出一個句號）。
        // 續頁第一行若以句號開頭，那個句號是上一段的結尾被排到這裡：直排鉛印避頭點，
        // 句號不排在行首。頓號與逗號不動——原書 481 頁「講演、著述」的頓號也落在這個
        // 位置，而它是句子中間真正的標點。
        const head = line.text[0]
        if (head && /[。.]/.test(head)) {
          line.text = line.text.slice(1)
          pendingMark = { text: '。', para: paragraphs.length - 1 }
        }
        paragraphs[paragraphs.length - 1] += line.text
        joined += 1
      } else if (line.tail && paragraphs.length) {
        paragraphs[paragraphs.length - 1] += line.text
        pendingMark = { text: line.text, para: paragraphs.length - 1 }
      } else if (k === 0 || line.indented) {
        // 前一段到此結束：欠著的句號補到它的末尾（末尾已有標點就不補）
        if (pendingMark && paragraphs.length) {
          const prev = paragraphs.length - 1
          if (!/[。！？」』）]$/.test(paragraphs[prev])) {
            paragraphs[prev] += pendingMark.text
            movedMarks += 1
          }
          pendingMark = null
        }
        paragraphs.push(line.text)
      } else {
        paragraphs[paragraphs.length - 1] += line.text
      }
    }
  }

  // 篇的最後一段也要補
  if (pendingMark && paragraphs.length) {
    const last = paragraphs.length - 1
    if (!/[。！？」』）]$/.test(paragraphs[last])) {
      paragraphs[last] += pendingMark.text
      movedMarks += 1
    }
  }

  // 行尾的標點在切行的當下看不到右鄰居（「⋯眞知眞理,」接下一行的「而不問其他。」），
  // 接完再走一次
  for (let k = 0; k < paragraphs.length; k += 1) paragraphs[k] = widen(paragraphs[k])

  // 邊欄的字與正文擠在同一欄時，上面按座標的兩關都認不出來，剩下的殘字黏在段落的兩端：
  //
  // 段末——「⋯各種事業依然是很落後。並」的並、「⋯應趕速推行。華僑」的華僑。判準是句號、
  // 驚嘆號或問號之後還掛著一兩個字，而那一兩個字裡沒有標點。收尾的引號不算（「⋯共同幸福
  // 之目標。」），所以引號要排除在外；正常的句子也不會在句號後面再接一兩個字就結束。
  //
  // 段首——原書第 42 頁的書根「四二」黏在該頁第一句前面（「四二代環境的影響」）。只在
  // 頁碼的位置檢查，而且要與該頁的頁碼一字不差才剝，兩位數的中文數字在正文裡很常見。
  const TAIL_LEFTOVER = /[。！？]([^。！？，、；：「『（）」』\s]{1,2})$/
  for (let k = 0; k < paragraphs.length; k += 1) {
    const m = TAIL_LEFTOVER.exec(paragraphs[k])
    if (m && paragraphs[k].length > 20) {
      paragraphs[k] = paragraphs[k].slice(0, -m[1].length)
      marginLeftovers += 1
    }
  }
  const CN_DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  for (const brk of pageBreaks) {
    if (!(brk.bookPage >= 10)) continue
    const cn = String(brk.bookPage).split('').map((d) => CN_DIGIT[Number(d)]).join('')
    const para = paragraphs[brk.para]
    if (typeof para !== 'string') continue
    if (para.slice(brk.offset, brk.offset + cn.length) !== cn) continue
    paragraphs[brk.para] = para.slice(0, brk.offset) + para.slice(brk.offset + cn.length)
    marginLeftovers += 1
    for (const other of pageBreaks) {
      if (other !== brk && other.para === brk.para && other.offset > brk.offset) other.offset -= cn.length
    }
  }
  for (const brk of pageBreaks) {
    const para = paragraphs[brk.para]
    if (typeof para === 'string' && brk.offset > para.length) brk.offset = para.length
  }

  const chars = paragraphs.reduce((n, t) => n + t.length, 0)
  totalChars += chars
  const draft = {
    id: h.id,
    title: meta?.title ?? h.title,
    part: meta?.part ?? null,
    dateOriginal: meta?.dateOriginal ?? null,
    bookPages: bookPages.length ? `${bookPages[0] ?? '?'}–${bookPages.at(-1) ?? '?'}` : null,
    status: '未校辨讀稿',
    statusNote:
      'Google Cloud Vision 的辨讀結果，未經逐字人工校訂。以複核過的七篇（32 頁、20,828 字）為量尺，辨讀稿有 26 處與原書不符：誤認 16 字、漏 8 字、衍 1 字、一處欄序錯置，合 0.125%（engineering/LOG.md 2026-08-19）。引用前請核對原書。',
    charCount: chars,
    noiseRemoved,
    missingBookPages: missingByPiece.get(h.id) ?? [],
    paragraphs,
    pageBreaks,
  }
  if (draft.missingBookPages.length) {
    draft.missingNote = `掃描件缺原書第 ${draft.missingBookPages.join('、')} 頁，該頁正文不在本稿內。`
  }
  writeFileSync(join(OUT_DIR, `${h.id}.json`), `${JSON.stringify(draft, null, 2)}\n`)
  index.push({
    id: h.id,
    charCount: chars,
    noiseRemoved,
    pageCount: bookPages.length,
    paragraphCount: paragraphs.length,
    missingBookPages: draft.missingBookPages,
  })
}

writeFileSync(
  join(OUT_DIR, 'index.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), status: '未校辨讀稿', count: index.length, totalChars, items: index }, null, 2)}\n`,
)
console.log(`跨頁接回的段落 ${joined} 處`)
console.log(`段落兩端的邊欄殘字 ${marginLeftovers} 處`)
console.log(`排錯位置的段末句號 ${movedMarks} 處已移回段尾`)
console.log(`讀稿 ${index.length} 篇，合計 ${totalChars.toLocaleString('en-US')} 字，寫進 ${OUT_DIR}`)
