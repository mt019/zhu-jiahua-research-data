#!/usr/bin/env node
// 把字框間距批次判成 drop 的那幾處，寫成各篇的人工校訂表。
//   node engineering/scripts/apply-gap-verdicts.mjs engineering/gap-batch/batch-01.tsv \
//        engineering/gap-batch/batch-01-verdicts.tsv [--write]
// 不帶 --write 只印報告。
//
// 誤欄不取 pending.tsv 的 context（那是 GCV 的符號串，與清理後的讀稿未必一字不差），
// 改在該篇讀稿的段落文字裡找 before＋after 相鄰的位置，向兩側各擴到全篇唯一命中為止；
// 正欄是同一段字中間插入判出的那個字。頁碼由讀稿自己的 pageBreaks 反查，
// 與 build-reading-drafts.mjs 的兩道關卡用同一個判準。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const DRAFTS = join(ROOT, 'data/processed/reading-drafts')
const CORR = join(ROOT, 'data/materials/speeches/corrections')
const TODAY = process.env.ZJH_DATE || new Date().toISOString().slice(0, 10)

const [listPath, verdictPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const WRITE = process.argv.includes('--write')
if (!listPath || !verdictPath) {
  console.error('用法：node apply-gap-verdicts.mjs <batch-NN.tsv> <batch-NN-verdicts.tsv> [--write]')
  process.exit(2)
}

const tsv = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.replace(/\r$/, '').split('\t'))

const listRows = tsv(listPath)
const listCols = listRows.shift()
const list = new Map(
  listRows.map((r) => [r[0], Object.fromEntries(listCols.map((c, i) => [c, r[i] ?? '']))]),
)

const verdicts = tsv(verdictPath).map(([idx, pdfPage, verdict, ch, note]) => ({
  idx,
  pdfPage: Number(pdfPage),
  verdict,
  ch: ch ?? '',
  note: note ?? '',
}))

// GCV 的符號多半是半形，讀稿是全形；比對時兩邊都轉成全形，長度不變，位置對得上。
const WIDE = { ',': '，', '.': '。', ';': '；', ':': '：', '!': '！', '?': '？', '(': '（', ')': '）' }
const norm = (s) => [...s].map((c) => WIDE[c] ?? c).join('')

const pageMap = new Map(
  JSON.parse(readFileSync(join(ROOT, 'data/derived/page_map.json'), 'utf8')).items.map((i) => [
    i.pdfPage,
    i.bookPage ?? i.bookPageInferred ?? null,
  ]),
)

const drafts = readdirSync(DRAFTS)
  .filter((f) => /^ZJH-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(DRAFTS, f), 'utf8')))

const pageAt = (pageBreaks, para, offset) => {
  let cur = null
  for (const b of pageBreaks) {
    if (b.para < para || (b.para === para && b.offset <= offset)) cur = b
  }
  return cur?.bookPage ?? null
}

// 在一篇裡找 key 的所有落點；先原樣找，找不到再兩邊都轉全形找。
const findAll = (piece, key) => {
  const out = []
  for (const variant of [key, norm(key)]) {
    piece.paragraphs.forEach((para, k) => {
      const hay = variant === key ? para : norm(para)
      let from = 0
      for (;;) {
        const at = hay.indexOf(variant, from)
        if (at < 0) break
        out.push({ para: k, at })
        from = at + 1
      }
    })
    if (out.length) break
  }
  return out
}

// 把窗往兩側擴到全篇唯一命中為止。回傳 [誤, 窗在段內的起點]。
const widen = (piece, para, at, len) => {
  const text = piece.paragraphs[para]
  let lo = at
  let hi = at + len
  for (let step = 0; step < 40; step += 1) {
    const win = text.slice(lo, hi)
    if (win.length >= 4) {
      let n = 0
      for (const p of piece.paragraphs) {
        let from = 0
        for (;;) {
          const i = p.indexOf(win, from)
          if (i < 0) break
          n += 1
          from = i + 1
        }
      }
      if (n === 1) return [win, lo]
    }
    if (step % 2 === 0 && lo > 0) lo -= 1
    else if (hi < text.length) hi += 1
    else if (lo > 0) lo -= 1
    else break
  }
  return [null, null]
}

const rows = new Map() // pieceId -> [[誤, 正, 頁, 註記]]
const problems = []
let ok = 0

for (const v of verdicts) {
  if (v.verdict !== 'drop') continue
  const row = list.get(v.idx)
  if (!row) {
    problems.push(`#${v.idx} 不在名單檔裡`)
    continue
  }
  if (v.note.includes('本批不重複回寫')) continue

  const before = row.before || ''
  const key = before ? before + row.after : row.context.replace(/｜/g, '')
  const insertInKey = before ? 1 : 0
  const want = pageMap.get(v.pdfPage)

  const cands = drafts.filter((d) => {
    const nums = String(d.bookPages || '').match(/\d+/g)?.map(Number) ?? []
    return nums.length && want != null && want >= Math.min(...nums) && want <= Math.max(...nums)
  })
  const onWantedPage = (piece, h) => pageAt(piece.pageBreaks, h.para, h.at) === want

  let hits = []
  let searchKey = key
  let insertAt = insertInKey
  for (const piece of cands) {
    for (const h of findAll(piece, key)) if (onWantedPage(piece, h)) hits.push({ piece, ...h })
  }
  // before＋after 兩個字在同一頁出現不只一次時，改用整段 context 定位；context 裡若有
  // 好幾個同樣的交界，取最靠近中點的那一個——偵測器給的 context 就是以該處為中心取的。
  if (hits.length > 1 && before) {
    const ctx = row.context.replace(/｜/g, '')
    const bounds = []
    for (let i = 0; i + 1 < ctx.length; i += 1) {
      if (norm(ctx[i]) === norm(before) && norm(ctx[i + 1]) === norm(row.after)) bounds.push(i + 1)
    }
    if (bounds.length) {
      bounds.sort((a, b) => Math.abs(a - ctx.length / 2) - Math.abs(b - ctx.length / 2))
      searchKey = ctx
      insertAt = bounds[0]
      hits = []
      for (const piece of cands) {
        for (const h of findAll(piece, ctx)) if (onWantedPage(piece, h)) hits.push({ piece, ...h })
      }
    }
  }
  if (hits.length === 0) {
    // 讀稿本來就有那個字：這一處是偵測器誤報，不是漏字——GCV 把它按 x 中心分到了
    // 鄰欄，欄內因此空出一格。判定要改成 noise，不進校訂表。
    const already = before ? before + v.ch + row.after : v.ch + key
    const has = cands.some((piece) => findAll(piece, already).some((h) => onWantedPage(piece, h)))
    problems.push(
      has
        ? `#${v.idx} PDF ${v.pdfPage}「${already}」讀稿本來就有，判定應改為 noise`
        : `#${v.idx} PDF ${v.pdfPage}（原書 ${want} 頁）「${key}」在 ${cands.map((c) => c.id).join('、') || '（查不到篇）'} 該頁命中 0 次`,
    )
    continue
  }
  if (hits.length !== 1) {
    problems.push(
      `#${v.idx} PDF ${v.pdfPage}（原書 ${want} 頁）「${key}」在 ${cands.map((c) => c.id).join('、') || '（查不到篇）'} 該頁命中 ${hits.length} 次`,
    )
    continue
  }
  const { piece, para, at } = hits[0]
  const [wrong, lo] = widen(piece, para, at, searchKey.length)
  if (!wrong) {
    problems.push(`#${v.idx} PDF ${v.pdfPage}「${key}」擴到 40 字仍非唯一命中`)
    continue
  }
  const cut = at + insertAt - lo
  const right = wrong.slice(0, cut) + v.ch + wrong.slice(cut)
  const bookPage = pageAt(piece.pageBreaks, para, lo)
  if (bookPage !== want) {
    problems.push(`#${v.idx} 窗的起點落在原書 ${bookPage} 頁，核對所依的是 ${want} 頁`)
    continue
  }
  const note = `原書 ${bookPage} 頁該格印著「${v.ch}」，辨讀稿漏（${TODAY} 核 PDF ${v.pdfPage} 的原頁圖，字框間距偵測 #${v.idx}）。`
  if (!rows.has(piece.id)) rows.set(piece.id, [])
  rows.get(piece.id).push([wrong, right, String(bookPage), note])
  ok += 1
}

console.log(`可回寫 ${ok} 條，涉 ${rows.size} 篇；未能回寫 ${problems.length} 條`)
for (const p of problems) console.log('  ' + p)
for (const [id, rs] of [...rows].sort()) {
  console.log(`\n${id}.tsv`)
  for (const r of rs) console.log('  ' + r.slice(0, 3).join('\t'))
}

if (!WRITE) {
  console.log('\n（未加 --write，沒有動任何檔案）')
  process.exit(problems.length ? 1 : 0)
}

for (const [id, rs] of rows) {
  const path = join(CORR, `${id}.tsv`)
  const head = existsSync(path)
    ? readFileSync(path, 'utf8').replace(/\n*$/, '\n')
    : `# ${id} 讀稿的人工校訂表，體例見同目錄 README.md。\n`
  const body = rs.map((r) => r.join('\t')).join('\n') + '\n'
  writeFileSync(path, head + `# ${TODAY} 字框間距批次判讀所核出的條目，逐處回原頁圖。\n` + body)
}
console.log(`\n已寫入 ${rows.size} 個校訂表。`)
process.exit(problems.length ? 1 : 0)
