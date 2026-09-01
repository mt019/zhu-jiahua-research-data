// PPM（pdftoppm 的 P6 原始輸出）轉八位元灰階 PNG，只用 node 內建的 zlib。
//
// 本機沒有 ImageMagick 也沒有 PIL，倉內既有的影像處理走 sips，而 sips 取不出單一色版。
// 哥德件的館藏紅印壓在版面上，取紅色版當灰階值就把它壓成接近白：紅印在紅色版是高值，
// 黑字三個色版都是低值。channel 選 'r' 即此；'luma' 是一般的灰階換算，留給沒有紅印的件。
import { deflateSync } from 'node:zlib'

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// P6 的標頭是三個以空白分隔的數值，中間允許 # 起首的註解行
export const parsePpm = (buf) => {
  if (buf[0] !== 0x50 || buf[1] !== 0x36) throw new Error('不是 P6 格式的 PPM')
  const fields = []
  let i = 2
  while (fields.length < 3) {
    while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i += 1
    if (buf[i] === 0x23) { while (i < buf.length && buf[i] !== 0x0a) i += 1; continue }
    let s = ''
    while (i < buf.length && !/\s/.test(String.fromCharCode(buf[i]))) { s += String.fromCharCode(buf[i]); i += 1 }
    fields.push(Number(s))
  }
  i += 1 // 標頭之後恰好一個空白字元
  const [width, height, maxval] = fields
  if (maxval !== 255) throw new Error(`只處理 maxval 255 的 PPM，讀到 ${maxval}`)
  const need = width * height * 3
  const pixels = buf.subarray(i, i + need)
  if (pixels.length !== need) throw new Error(`PPM 的像素長度是 ${pixels.length}，依標頭應為 ${need}`)
  return { width, height, pixels }
}

export const ppmToGrayPng = (ppmBuf, channel = 'r') => {
  const { width, height, pixels } = parsePpm(ppmBuf)
  // 每條掃描線前面加一個 0，表示不套 PNG 的行間預測
  const raw = Buffer.alloc(height * (width + 1))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 3
      const r = pixels[p]
      const g = pixels[p + 1]
      const b = pixels[p + 2]
      raw[rowStart + 1 + x] = channel === 'r'
        ? r
        : Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // 每色版八位元
  ihdr[9] = 0   // 灰階
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
