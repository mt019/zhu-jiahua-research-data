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

// 未校讀稿：全書辨讀底稿切成的 198 篇，2026-08-19 站主決定上站。它與校訂稿的差別要寫在
// 每一篇自己身上，讀者看得到；沒有標示的讀稿等於把未校文字當成正文，這道檢查擋的是那件事。
const DRAFT_DIR = new URL('../../data/processed/reading-drafts/', import.meta.url);
let draftFiles = [];
try {
  draftFiles = (await readdir(DRAFT_DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
} catch {
  draftFiles = [];
}
// 書眉印的是部次名或節名，兩者都在目次裡；剝掉序數、頁碼與分隔符之後拿來比對。
const HEAD_NAMES = new Set(
  ['朱家驊先生言論集', ...tocIndex.items.flatMap((it) => [it.part, it.section, it.subsection])]
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

if (draftFiles.length) {
  const ids = new Set(tocIndex.items.map((it) => it.id));
  if (draftFiles.length !== ids.size) {
    throw new Error(`讀稿 ${draftFiles.length} 篇，篇目 ${ids.size} 篇，兩者應一致`);
  }
  for (const file of draftFiles) {
    const draft = JSON.parse(await readFile(new URL(file, DRAFT_DIR), 'utf8'));
    if (!ids.has(draft.id)) throw new Error(`讀稿 ${file} 的 id 不在篇目索引裡`);
    if (draft.status !== '未校辨讀稿') {
      throw new Error(`${file} 的 status 是「${draft.status}」，讀稿一律標未校辨讀稿`);
    }
    if (!draft.statusNote || !draft.statusNote.includes('未經逐字人工校訂')) {
      throw new Error(`${file} 沒有寫明未經逐字人工校訂`);
    }
    if (!Array.isArray(draft.paragraphs) || draft.paragraphs.length === 0) {
      throw new Error(`${file} 沒有正文`);
    }
    // 頁碼改記成段落裡的字元位置（原書的分頁不是分段），指到不存在的段或超出段長就是壞的
    if (!Array.isArray(draft.pageBreaks) || draft.pageBreaks.length === 0) {
      throw new Error(`${file} 沒有原書頁碼的位置`);
    }
    for (const brk of draft.pageBreaks) {
      const para = draft.paragraphs[brk.para];
      if (typeof para !== 'string' || brk.offset > para.length) {
        throw new Error(`${file} 的頁碼位置 ${JSON.stringify(brk)} 指不到正文`);
      }
    }
    // 書眉與書根併進正文的殘留：頁碼的中文數字不該出現在該頁起頭
    const CN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    for (const brk of draft.pageBreaks) {
      if (!(brk.bookPage >= 100)) continue;
      const cn = String(brk.bookPage).split('').map((d) => CN[Number(d)]).join('');
      if (draft.paragraphs[brk.para].slice(brk.offset).startsWith(cn)) {
        throw new Error(`${file} 原書第 ${brk.bookPage} 頁的書根併進正文了`);
      }
    }
    // 這道檢查先前只看該頁起頭的中文數字頁碼，於是整段的書眉（「叄敎育言論」「臺文化學術」）、
    // 邊欄切出來的單字段（「直」「。」）與掃描髒點（110K、GDGY）一路綠燈上站。判準改成三條，
    // 名稱一律取自目次，不用手寫的字面表——序數被認錯或整個掉了，剝掉序數照樣認得出來。
    for (const [i, para] of draft.paragraphs.entries()) {
      const t = para.trim();
      if (t.length <= 16 && HEAD_NAMES.has(headKey(t))) {
        throw new Error(`${file} 第 ${i} 段是書眉殘留：「${t}」`);
      }
      const cjk = /[\u4e00-\u9fff\uf900-\ufaff]/.test(t);
      if (cjk && [...t].length === 1) {
        throw new Error(`${file} 第 ${i} 段只有一個字「${t}」，正文沒有一個字自成一段，是邊欄碎片`);
      }
      if (!cjk && t.length < 12 && !/^[\u3000-\u303f\uff00-\uffef]+$/.test(t)) {
        throw new Error(`${file} 第 ${i} 段不含漢字又短：「${t}」，是掃描髒點`);
      }
    }
    if (draft.missingBookPages?.length && !draft.missingNote) {
      throw new Error(`${file} 有缺頁卻沒有寫明是哪一頁`);
    }
    const text = JSON.stringify(draft);
    for (const forbidden of ['/Users/', 'Documents/NTU', 'z-library']) {
      if (text.includes(forbidden)) throw new Error(`${file} 含禁止字串：${forbidden}`);
    }
  }
}

const serialized = JSON.stringify(data);
for (const forbidden of ['/Users/', 'Documents/NTU', 'z-library', '1lib.sk', 'z-lib.sk']) {
  if (serialized.includes(forbidden)) throw new Error(`公開資料含禁止字串：${forbidden}`);
}

console.log('公開資料驗證通過。');
