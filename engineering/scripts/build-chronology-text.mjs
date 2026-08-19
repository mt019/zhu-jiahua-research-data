#!/usr/bin/env node
// 由 Vision OCR 底稿 ＋ 逐頁人工校訂表，組出年譜的校訂全文。
//
// 輸入：data/materials/chronology/vision/pg-NN.txt      Vision OCR 底稿（每頁首行頁眉、末行頁碼）
//       data/materials/chronology/corrections/pg-NN.tsv 人工校訂表，每行「誤<TAB>正」
// 輸出：data/derived/chronology/transcriptions/p<原書頁>.md
//
// 校訂表沒有的頁一律不輸出——沒校過的辨讀稿不算原文，不得進 derived。
// 每條校訂在該頁必須剛好命中一次；命中零次或多次即中止，避免安靜地改錯地方。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const visionDir = join(root, 'data/materials/chronology/vision')
const corrDir = join(root, 'data/materials/chronology/corrections')
const outDir = join(root, 'data/derived/chronology/transcriptions')
const PAGE_OFFSET = 352

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

if (!existsSync(corrDir)) fail(`找不到校訂表目錄 ${corrDir}`)
mkdirSync(outDir, { recursive: true })

const pages = readdirSync(corrDir).filter((f) => /^pg-\d+\.tsv$/.test(f)).sort()
if (!pages.length) fail('校訂表目錄是空的')

let written = 0
for (const file of pages) {
  const pdfPage = Number(file.match(/pg-(\d+)/)[1])
  const bookPage = pdfPage + PAGE_OFFSET
  const src = join(visionDir, `pg-${String(pdfPage).padStart(2, '0')}.txt`)
  if (!existsSync(src)) fail(`pg-${pdfPage}：找不到 Vision 底稿 ${src}`)

  let lines = readFileSync(src, 'utf8').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())

  // 末行是頁碼，且必須認得出本頁的原書頁碼；首行是頁眉。兩者都不進正文。
  const footer = lines.at(-1).replace(/\D/g, '')
  if (!footer.includes(String(bookPage))) fail(`pg-${pdfPage}：末行 ${JSON.stringify(lines.at(-1))} 認不出原書頁 ${bookPage}`)
  lines = lines.slice(1, -1)

  // 三條全篇正規化，每條都在原頁圖上核過：
  //   為→爲  Vision 時而還原、時而輸出「為」（底稿 64 : 198），原書排的一律是「爲」。
  //   偽→僞  同上（底稿 0 : 10），原書排「僞蒙軍」「僞組織」。
  //   叉→又  Vision 的固定誤讀。底稿 11 處全部是「又」（又發、又任、又從、又增派…），
  //           沒有一處是真的「叉」；有真「叉」的頁出現時要改成逐頁校訂。
  //   欸→欵  同上（底稿 27 : 28），全部出現在賠欵、撥欵、借欵、捐欵、條欵的位置。
  let body = lines
    .map((l) => l.replace(/^[：:.,，、•·]+/, '')) // 掃描頁邊的髒點會被讀成行首標點
    .join('\n')
    .replaceAll('為', '爲')
    .replaceAll('偽', '僞')
    .replaceAll('叉', '又')
    .replaceAll('欸', '欵')
    //   底稿裡另有四組同樣的一字兩形，同樣以原頁圖為準（括號內是底稿的兩形出現次數）：
    .replaceAll('丢', '丟') //  0 : 3
    .replaceAll('双', '又') // 12 處全部是「又」，沒有一處是真的「双」
    .replaceAll('真', '眞') //  8 : 6
    .replaceAll('靑', '青') //  2 : 18

  const rules = readFileSync(join(corrDir, file), 'utf8').split('\n')
  rules.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.startsWith('#')) return
    // 校訂條目可用 \n 表示換行，才改得掉跨行的錯字與整行的掃描雜訊
    const [wrongRaw, rightRaw = ''] = line.split('\t')
    if (wrongRaw === undefined) fail(`${file}:${i + 1} 格式不對，應為「誤<TAB>正」`)
    const wrong = wrongRaw.replaceAll('\\n', '\n')
    const right = rightRaw.replaceAll('\\n', '\n')
    const hits = body.split(wrong).length - 1
    if (hits !== 1) fail(`${file}:${i + 1}「${wrong}」在本頁命中 ${hits} 次，須剛好 1 次`)
    body = body.replace(wrong, right)
  })

  const out = [
    '---',
    `bookPage: ${bookPage}`,
    `pdfPage: ${pdfPage}`,
    // 上面那幾條正規化都往原書排的那一形收，所以本批的字形政策是原書字形。
    // 體例見 ~/.claude/rules/轉錄體例.md：檢索與需要通用形的呈現在讀取端各自套對照表。
    'glyphPolicy: 原書字形',
    'transcriptionStatus: 人工逐頁對照原頁圖校訂',
    '---',
    '',
    `# 《朱家驊先生年譜簡編》原書第 ${bookPage} 頁`,
    '',
    `<!-- 胡頌平，《中央研究院歷史語言研究所集刊》第三十五本，1964。PDF 第 ${pdfPage} 頁。 -->`,
    `<!-- Vision OCR 底稿 ＋ 逐頁對照原頁圖人工校訂。校訂表：data/materials/chronology/corrections/${file} -->`,
    '',
    body,
    '',
  ].join('\n')
  writeFileSync(join(outDir, `p${bookPage}.md`), out)
  written += 1
}

console.log(`年譜校訂全文輸出 ${written} 頁 → data/derived/chronology/transcriptions/`)
