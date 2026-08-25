#!/usr/bin/env node
// 圖版：依 data/materials/plates/plates.json 記的方框，從頁圖裁出照片本身，
// 轉正之後寫進 data/derived/plates/。原書把橫幅照片轉印在直式頁面上，rotate
// 記的是轉回來要幾度（sips 順時針），null 表示還沒判定，該件跳過。
//
// 產物不進版控也不進建置：攝影著作的保護期間未查（見 plates.json 的 rights）。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

const doc = JSON.parse(readFileSync(join(root, 'data/materials/plates/plates.json'), 'utf8'))
const pagesDir = join(root, 'data/materials/speeches/gcv/pages')
const outDir = join(root, 'data/derived/plates')
mkdirSync(outDir, { recursive: true })

const pageFile = (pdfPage) =>
  join(pagesDir, `朱家驊先生言論集 (王聿均,孫斌合编)-${String(pdfPage).padStart(3, '0')}.png`)

let made = 0
let pending = 0
for (const item of doc.items) {
  const src = pageFile(item.pdfPage)
  if (!existsSync(src)) fail(`${item.id}：找不到頁圖 ${src}`)
  if (item.rotate === null || item.rotate === undefined) { pending += 1; continue }
  const { x, y, w, h, pageW, pageH } = item.crop
  // 方框以頁圖的像素記，頁圖換過就對不上，先驗尺寸
  const size = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' })
  const got = { w: Number(/pixelWidth: (\d+)/.exec(size)[1]), h: Number(/pixelHeight: (\d+)/.exec(size)[1]) }
  if (got.w !== pageW || got.h !== pageH) fail(`${item.id}：頁圖是 ${got.w}×${got.h}，方框記的是 ${pageW}×${pageH}`)

  const out = join(outDir, `${item.id}.jpg`)
  rmSync(out, { force: true })
  // sips 的 --crop 由中心裁起，offset 換算成中心位移
  // sips 把負的位移當成旗標，命令列直接失敗；方框偏離頁心的量在個位數像素，
  // 負值就收成 0，等於少偏那幾個像素，照片本身不會被切到。
  const dx = Math.max(0, Math.round(x + w / 2 - pageW / 2))
  const dy = Math.max(0, Math.round(y + h / 2 - pageH / 2))
  const args = ['-c', String(h), String(w), '--cropOffset', String(dy), String(dx), src, '--out', out]
  if (item.rotate) args.push('-r', String(item.rotate))
  execFileSync('sips', [...args, '-s', 'format', 'jpeg', '-s', 'formatOptions', '85'], { stdio: 'ignore' })
  execFileSync('sips', ['-Z', '1600', out], { stdio: 'ignore' })
  made += 1
}

console.log(`圖版 ${made} 件 → ${outDir}`)
if (pending) console.log(`待判定轉向 ${pending} 件（plates.json 的 rotate 是 null）`)
console.log(`權利狀態：${doc.rights.status}——${doc.rights.why}`)
