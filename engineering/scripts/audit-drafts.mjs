// 讀稿殘留的批量糾察。198 篇一次掃完，按類別印出篇號、段號與原字，供逐條回原頁圖判讀。
//
// validate-processed.mjs 是閘，命中就中止，用來擋壞資料進版控；這一支只列不擋，用來
// 盤點還剩多少、集中在哪幾篇。兩者查的是同一批類別，判準寫在這裡的 CLASSES。
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('../../data/processed/reading-drafts/', import.meta.url);
const toc = JSON.parse(await readFile(new URL('../../data/derived/toc_index.json', import.meta.url), 'utf8'));

const HEAD_NAMES = new Set(
  ['朱家驊先生言論集', ...toc.items.flatMap((it) => [it.part, it.section, it.subsection])]
    .filter(Boolean)
    .map((raw) => (raw.includes('、') ? raw.split('、').slice(1).join('、') : raw))
    .map((n) => n.replace(/敎/g, '教')),
);
const headKey = (t) =>
  t
    .replace(/[敎]/g, '教')
    .replace(/[叄参]/g, '叁')
    .replace(/[（(][一二三四五六七八九十]+[）)]/g, '')
    .replace(/^[壹貳叁肆伍陸柒捌玖拾臺壺粜一二三四五六七八九十]{1,3}/, '')
    .replace(/[〇一二三四五六七八九十百]+$/, '')
    .replace(/[、,.．・\s【】\-—]/g, '');

const CJK = /[一-鿿豈-﫿]/;
const CN_DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const CLASSES = [
  ['書眉整段', (t) => t.length <= 16 && HEAD_NAMES.has(headKey(t))],
  ['單字碎段', (t) => CJK.test(t) && [...t].length === 1],
  ['髒點碎段', (t) => !CJK.test(t) && t.length < 12 && !/^[　-〿＀-￯]+$/.test(t)],
  ['段末殘字', (t) => t.length > 20 && /[。！？][^。！？，、；：「『（）」』\s]{1,2}$/.test(t)],
  ['黏住的拉丁詞', (t) => /[a-z]{3}[A-Z][a-z]{2}/.test(t)],
];

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
const counts = new Map(CLASSES.map(([name]) => [name, 0]));
let pageFoot = 0;

for (const file of files.sort()) {
  const draft = JSON.parse(await readFile(new URL(file, DIR), 'utf8'));
  for (const [i, para] of draft.paragraphs.entries()) {
    const t = para.trim();
    for (const [name, hit] of CLASSES) {
      if (!hit(t)) continue;
      counts.set(name, counts.get(name) + 1);
      console.log(`${name}\t${draft.id}\t第 ${i} 段\t${t.slice(0, 40)}`);
    }
  }
  // 書根黏在該頁正文的起頭：只在頁碼的位置查，與該頁頁碼一字不差才算
  for (const brk of draft.pageBreaks ?? []) {
    if (!(brk.bookPage >= 10)) continue;
    const cn = String(brk.bookPage).split('').map((d) => CN_DIGIT[Number(d)]).join('');
    const para = draft.paragraphs[brk.para] ?? '';
    if (para.slice(brk.offset, brk.offset + cn.length) === cn) {
      pageFoot += 1;
      console.log(`書根黏在頁首\t${draft.id}\t原書第 ${brk.bookPage} 頁\t${para.slice(brk.offset, brk.offset + 20)}`);
    }
  }
}

console.log('---');
for (const [name, n] of counts) console.log(`${name}：${n}`);
console.log(`書根黏在頁首：${pageFoot}`);
console.log(`掃過 ${files.length} 篇`);
