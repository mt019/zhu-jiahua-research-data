import { readFile, readdir } from 'node:fs/promises';

const target = new URL('../../data/processed/zhu-jiahua-app.json', import.meta.url);
const data = JSON.parse(await readFile(target, 'utf8'));
const required = [
  'schemaVersion',
  'generatedAt',
  'source',
  'project',
  'materialCoverage',
  'researchQuestions',
  'tableOfContents',
  'verifiedTexts',
];

for (const key of required) {
  if (!(key in data)) throw new Error(`缺少必要欄位：${key}`);
}

// 研究流程紀錄留在資料倉（engineering/LOG.md 與 data/derived），不進公開快照。
// 這條是使用者的全局規則：canvas 公開面連未渲染的 JSON 欄位都不放工程作業語言。
const internalOnly = ['methodPlan', 'riskRegister', 'immediateNextWork', 'contentProgress', 'materialSegments'];
for (const key of internalOnly) {
  if (key in data) throw new Error(`公開快照不得含工程作業欄位：${key}`);
}

// 篇目索引：數量、頁碼單調、全文連結指得到實際存在的校訂全文
const toc = data.tableOfContents;
if (toc.items.length !== toc.itemCount) throw new Error('tableOfContents.itemCount 與實際筆數不符');
const readable = toc.items.filter((item) => item.textPath);
if (readable.length !== toc.readableCount) throw new Error('tableOfContents.readableCount 與帶 textPath 的筆數不符');
if (readable.length !== data.verifiedTexts.length) {
  throw new Error(`帶 textPath 的篇目 ${readable.length} 筆，校訂全文 ${data.verifiedTexts.length} 篇，兩者應一致`);
}
for (let i = 1; i < toc.items.length; i += 1) {
  if (toc.items[i].bookStartPage < toc.items[i - 1].bookStartPage) {
    throw new Error(`篇目起頁未依原書遞增：${toc.items[i].id}`);
  }
}

// 篇目索引的單一事實來源是 data/derived/toc_index.json，公開快照只是它的投影。
// 先前兩邊各存一份，起頁更正之後快照沒有跟著動，前端讀到的還是舊頁碼。
const tocIndex = JSON.parse(
  await readFile(new URL('../../data/derived/toc_index.json', import.meta.url), 'utf8'),
);
if (tocIndex.items.length !== toc.items.length) {
  throw new Error(`快照篇目 ${toc.items.length} 筆，toc_index.json ${tocIndex.items.length} 筆`);
}
for (let i = 0; i < tocIndex.items.length; i += 1) {
  const src = tocIndex.items[i];
  const out = toc.items[i];
  for (const [key, value] of [
    ['id', src.id],
    ['title', src.title],
    ['part', src.part],
    ['bookStartPage', src.bookStartPage],
  ]) {
    if (out[key] !== value) {
      throw new Error(`${src.id} 的 ${key} 與 toc_index.json 不符：快照 ${out[key]}，索引 ${value}。跑 build-app-toc.mjs 重建`);
    }
  }
}

// 校訂稿要宣告字形政策；沒有這一欄的視為未定，不得當成已經處理過（~/.claude/rules/轉錄體例.md）。
const GLYPH_KEYS = ['glyph_policy', 'glyphPolicy'];
const GLYPH_VALUES = ['原書字形', '通用字形', '未定'];
for (const dir of ['../../data/derived/transcriptions', '../../data/derived/chronology/transcriptions']) {
  const base = new URL(`${dir}/`, import.meta.url);
  let files;
  try {
    files = (await readdir(base)).filter((f) => f.endsWith('.md'));
  } catch {
    continue;
  }
  for (const file of files) {
    const text = await readFile(new URL(file, base), 'utf8');
    const line = text.split('\n').find((l) => GLYPH_KEYS.some((k) => l.startsWith(`${k}:`)));
    if (!line) throw new Error(`${dir}/${file} 沒有宣告字形政策`);
    const value = line.split(':').slice(1).join(':').trim();
    if (!GLYPH_VALUES.includes(value)) {
      throw new Error(`${dir}/${file} 的字形政策「${value}」不在 ${GLYPH_VALUES.join('、')} 之內`);
    }
  }
}

const serialized = JSON.stringify(data);
for (const forbidden of ['/Users/', 'Documents/NTU', 'z-library', '1lib.sk', 'z-lib.sk']) {
  if (serialized.includes(forbidden)) throw new Error(`公開資料含禁止字串：${forbidden}`);
}

console.log('公開資料驗證通過。');
