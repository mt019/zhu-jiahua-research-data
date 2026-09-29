// 全站印給讀者看的日期只有一種寫法，由這支產生（站主 2026-09-29：「年月日系統標示混亂」）。
//
// 先前書內篇印目次原文（民國三十一年七月二十八日）、書外件印 ISO（1942-07-31）、主題頁兩種混在一張表。
// 現在一律寫西元、精度照資料：1942 年 7 月 28 日、1944 年 2 月、1947 年。原文的紀年另存 dateOriginal，
// 前端只在篇頭照錄一行並標明出處；排序照舊用 dateIso。
//
// 驗證器 import DATE_LABEL_SHAPE 與兩句未署的寫法，全站的 dateLabel 只准這幾種形狀。

export const UNDATED_BOOK = '原書未載日期'
export const UNDATED_PRINT = '原刊未署日期'

export const DATE_LABEL_SHAPE = /^[12]\d{3} 年(?: (?:[1-9]|1[0-2]) 月(?: (?:[1-9]|[12]\d|3[01]) 日)?)?$/

const ISO_SHAPE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

/** dateIso（1942、1942-07、1942-07-28）轉成讀者看的標示；沒有日期時回 undated。 */
export function dateLabel(iso, undated) {
  if (iso == null || iso === '') {
    if (!undated) throw new Error('dateLabel：沒有 dateIso 時要指定未署的寫法')
    return undated
  }
  const m = ISO_SHAPE.exec(iso)
  if (!m) throw new Error(`dateLabel：dateIso「${iso}」不是 YYYY、YYYY-MM 或 YYYY-MM-DD`)
  const [, y, mo, d] = m
  let out = `${y} 年`
  if (mo) out += ` ${Number(mo)} 月`
  if (d) out += ` ${Number(d)} 日`
  if (!DATE_LABEL_SHAPE.test(out)) throw new Error(`dateLabel：${iso} 轉出「${out}」，月或日超出範圍`)
  return out
}

/** 驗證器用：dateLabel 與 dateIso 是否一致。 */
export function dateLabelMatches(label, iso, undated) {
  try {
    return label === dateLabel(iso, undated)
  } catch {
    return false
  }
}
