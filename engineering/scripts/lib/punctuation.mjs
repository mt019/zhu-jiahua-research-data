// 辨讀稿的標點歸位，讀稿產線（build-reading-drafts.mjs）與年表產線（build-chronology.mjs）
// 共用這一份。規則的來歷與已核過的實例寫在各函式上方；改動任何一條，兩條產線都要重跑重驗。

// 辨讀稿把全形標點讀成半形，原書排的是全形。判準是這個標點的左右鄰居——鄰居是漢字、
// 假名或全形標點就轉回全形。句號與逗號要求兩邊都是，否則會動到拉丁文裡的
// 「F.J.M.Bourdrez」與「Bologna, Padua, Pisa」。
const CJK_CTX = /[　-〿぀-ヿ一-鿿豈-﫿＀-￯]/
const WIDE = { ',': '，', '.': '。', ':': '：', ';': '；', '?': '？', '!': '！', '(': '（', ')': '）' }
const BOTH_SIDES = new Set([',', '.'])
export const widen = (t) => {
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
      // 段末的標點沒有右鄰居（歌德那首譯詩每行收在一個逗號上，原書排的是全形）。
      // 只認左鄰是漢字的，拉丁詩行的「Thränen ass,」左鄰是字母，照原書的半形留著。
      const lineEnd = i === out.length - 1 && HAN.test(out[i - 1] ?? '')
      if (BOTH_SIDES.has(out[i]) ? (left && right) || (right && !digitLeft) || lineEnd : left || right) out[i] = w
    }
  }
  // 半形的左括號配著全形的右括號（「Galilei(1564-1642）」「(1）抗戰勝利」）：括號裡是
  // 數字或拉丁字母，左右鄰居都不是漢字，上面的鄰居判斷看不到它。原書排的是全形，右括號
  // 已經認出全形就是證據。整段裡另有半形右括號時不動——那一對可能真的是半形。
  if (!out.includes(')')) {
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] !== '(') continue
      if (out.indexOf('）', i) > i) out[i] = '（'
    }
  }
  return out.join('')
}

// 原書直排的引號是「」與『』，Google Cloud Vision 把它們讀成西文彎引號。方向照彎引號
// 自己的開合對應，鄰居有漢字才轉——拉丁文裡的「d'Alembert」那種撇號左右都是字母，不動。
// 成對與否照辨讀稿原樣：原書的引文本來就會跨段（一段只有半邊），未校稿不猜補。
const CURLY = { '‘': '「', '’': '」', '“': '『', '”': '』' }
export const cornerQuotes = (t) => {
  const out = [...t]
  for (let i = 0; i < out.length; i += 1) {
    const w = CURLY[out[i]]
    if (!w) continue
    if (CJK_CTX.test(out[i - 1] ?? '') || CJK_CTX.test(out[i + 1] ?? '')) out[i] = w
  }
  return out.join('')
}

// 原書的刪節號排六個點，辨讀稿把它讀成一串句號與半形點（「十分進步..。。。。」，原書
// 是「十分進步……」，已回原頁圖核過三處）。連著兩個句號則是重出——直排鉛印不會連排兩個
// 句號，來源是掃描的墨點或被排到別處的段末句號補了第二次（原書 32 頁「七十噸以上者。」
// 旁邊那一團墨點被讀成句號）。
//
// 六個點是刪節號自己的長度：超過六個的，多出來的是它前面真正的句號（原書 324 頁
// 「猶未廢止或修改者。……」）。左右鄰居都不是漢字的整串不動——拉丁書目裡的
// 「V.I...Gromov」是省略點不是刪節號。
const HAN = /[一-鿿㐀-䶿豈-﫿]/
const DOT_RUN = /[.。]{2,}|，{2,}|、{2,}/g
const dotRunFix = (run, left, right) => {
  if (!HAN.test(left) && !HAN.test(right)) return run
  // 逗號與頓號同樣不連排，重出的只留一個（原書 78 頁「畬民宗譜之研究，浙南畬民⋯」）。
  if (run[0] === '，' || run[0] === '、') return run[0]
  if (run.length === 2) return '。'
  return '。'.repeat(Math.max(0, run.length - 6)) + '⋯⋯'
}
// 回傳改好的字，以及舊字元位置對新位置的對照——頁碼記的是字元位置，改動點左邊的位置
// 不動，右邊的要整批移。
export const dots = (t) => {
  let out = ''
  let cut = 0
  const shifts = []
  for (const m of t.matchAll(DOT_RUN)) {
    const fixed = dotRunFix(m[0], t[m.index - 1] ?? '', t[m.index + m[0].length] ?? '')
    if (fixed === m[0]) continue
    out += t.slice(cut, m.index) + fixed
    cut = m.index + m[0].length
    shifts.push({ from: cut, delta: fixed.length - m[0].length })
  }
  out += t.slice(cut)
  const at = (offset) => offset + shifts.reduce((d, s) => (offset >= s.from ? d + s.delta : d), 0)
  return { text: out, at, changed: shifts.length }
}
