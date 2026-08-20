// 讀稿殘留的批量糾察。200 篇一次掃完，按類別印出篇號、段號與原字，供逐條回原頁圖判讀。
//
// 判準不寫在這裡：辨讀稿的殘留形狀是共用層的
// ~/.claude/skills/cjk-print-ocr/ocr_shapes.py，經 @phenomcanvas/prose-rules/ocr 呼叫。
// 陳寅恪、德川、iias、court 幾個倉讀的是同一份，共用層加一條形狀，各倉下一次執行就吃得到。
//
// 本倉自己的兩條留在這裡，因為它們要用本書的目次與頁碼才判得出來：
// 書眉整段（比對目次裡的部次與節名）、書根黏在頁首（比對該頁自己的頁碼）。
//
// validate-processed.mjs 是閘，命中就中止；本程式只列不擋，用來盤點還剩多少、集中在哪幾篇。
import { readdir, readFile } from 'node:fs/promises';
import { checkDrafts } from '@phenomcanvas/prose-rules/ocr';

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

const CN_DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
const drafts = [];
for (const file of files.sort()) {
  drafts.push(JSON.parse(await readFile(new URL(file, DIR), 'utf8')));
}

const { results, catalog } = checkDrafts(
  drafts.map((d) => ({ path: d.id, paragraphs: d.paragraphs })),
);
const severityOf = new Map(catalog.map(([name, sev]) => [name, sev]));
const counts = new Map(catalog.map(([name]) => [name, 0]));
counts.set('書眉整段', 0);
let pageFoot = 0;

for (const [i, draft] of drafts.entries()) {
  for (const f of results[i].findings) {
    counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
    const para = draft.paragraphs[f.paragraph] ?? '';
    console.log(`${f.severity}\t${f.rule}\t${draft.id}\t第 ${f.paragraph} 段\t${para.trim().slice(0, 40)}`);
  }
  // 本書專屬的兩條。
  for (const [k, para] of draft.paragraphs.entries()) {
    const t = para.trim();
    if (t.length <= 16 && HEAD_NAMES.has(headKey(t))) {
      counts.set('書眉整段', counts.get('書眉整段') + 1);
      console.log(`擋\t書眉整段\t${draft.id}\t第 ${k} 段\t${t.slice(0, 40)}`);
    }
  }
  for (const brk of draft.pageBreaks ?? []) {
    if (!(brk.bookPage >= 10)) continue;
    const cn = String(brk.bookPage).split('').map((d) => CN_DIGIT[Number(d)]).join('');
    const para = draft.paragraphs[brk.para] ?? '';
    if (para.slice(brk.offset, brk.offset + cn.length) === cn) {
      pageFoot += 1;
      console.log(`擋\t書根黏在頁首\t${draft.id}\t原書第 ${brk.bookPage} 頁\t${para.slice(brk.offset, brk.offset + 20)}`);
    }
  }
}

console.log('---');
for (const [name, n] of counts) console.log(`${severityOf.get(name) ?? '擋'}　${name}：${n}`);
console.log(`擋　書根黏在頁首：${pageFoot}`);
console.log(`掃過 ${drafts.length} 篇`);
