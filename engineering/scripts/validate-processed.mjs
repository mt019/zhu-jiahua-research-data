import { readFile, readdir } from 'node:fs/promises';
import { checkDrafts } from '@phenomcanvas/prose-rules/ocr';

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
  // 卷首的獻詞與緣起不在目次的 198 篇裡，各自一份讀稿，用 frontMatter 一欄標出來。
  const drafts = [];
  for (const file of draftFiles) {
    drafts.push([file, JSON.parse(await readFile(new URL(file, DRAFT_DIR), 'utf8'))]);
  }
  // 嚴重度「擋」的形狀是機器判得出對錯的，命中就中止；「待核」要回原頁圖看，
  // 由 audit-drafts.mjs 列出來，不在這裡擋。
  const { results } = checkDrafts(drafts.map(([file, d]) => ({ path: file, paragraphs: d.paragraphs })));
  for (const r of results) {
    for (const f of r.findings) {
      if (f.severity !== '擋') continue;
      throw new Error(`${r.path} 第 ${f.paragraph} 段是辨讀稿殘留（${f.rule}）：「${f.sample}」`);
    }
  }
  const front = drafts.filter(([, d]) => d.frontMatter);
  if (drafts.length - front.length !== ids.size) {
    throw new Error(`讀稿 ${drafts.length - front.length} 篇，篇目 ${ids.size} 篇，兩者應一致`);
  }
  if (front.length !== 2) {
    throw new Error(`卷首讀稿應為獻詞與緣起兩篇，實得 ${front.length} 篇`);
  }
  for (const [file, draft] of front) {
    if (!draft.author) throw new Error(`${file} 是卷首的文字，要寫明作者是誰`);
    if (draft.part !== null) throw new Error(`${file} 不屬於原書的十四個部次，part 應為 null`);
  }
  for (const [file, draft] of drafts) {
    if (!draft.frontMatter && !ids.has(draft.id)) throw new Error(`讀稿 ${file} 的 id 不在篇目索引裡`);
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
    // 辨讀稿的殘留形狀在共用層判（~/.claude/skills/cjk-print-ocr/ocr_shapes.py，經
    // @phenomcanvas/prose-rules/ocr 呼叫），本檔不再抄一份 regex：陳寅恪、德川、iias、
    // court 幾個倉讀的是同一份，共用層加一條形狀，各倉下一次執行就吃得到。
    // 書眉那一條留在這裡，它要拿本書的目次才判得出來。
    for (const [i, para] of draft.paragraphs.entries()) {
      const t = para.trim();
      if (t.length <= 16 && HEAD_NAMES.has(headKey(t))) {
        throw new Error(`${file} 第 ${i} 段是書眉殘留：「${t}」`);
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

// ── 年表 ────────────────────────────────────────────────────────────────────
// 底本是胡頌平的年譜，著作權存續至 2038 年底，公開的條件是標明出處；材料性質（口述紀錄
// 為主、成書倉促）與尚未校訂的五十頁也要寫在資料裡，前端才印得出來。
let chronology = null;
try {
  chronology = JSON.parse(
    await readFile(new URL('../../data/processed/chronology.json', import.meta.url), 'utf8'),
  );
} catch {
  chronology = null;
}
if (chronology) {
  for (const key of ['source', 'rights', 'materialNature', 'transcription', 'unreviewedOcr', 'errata', 'years']) {
    if (!(key in chronology)) throw new Error(`chronology.json 缺少必要欄位：${key}`);
  }
  if (!chronology.source.url) throw new Error('chronology.json 沒有官方全文連結');
  if (!chronology.rights.includes('胡頌平')) throw new Error('chronology.json 的著作權說明沒有指名作者');
  if (chronology.years.length !== chronology.stats.yearCount) {
    throw new Error('chronology.json 的 stats.yearCount 與實際年目數不符');
  }
  // 71 個年目全部存在，且每一個都有正文（無來源缺口）
  if (chronology.years.length !== 71) throw new Error(`chronology.json 應有 71 個年目，實得 ${chronology.years.length}`);
  for (const y of chronology.years) {
    if (!y.text) throw new Error(`${y.ce} 年沒有正文，也沒有明確的來源缺口說明`);
  }
  // 1893 與 1963 兩端年目要看得到正文
  const first = chronology.years.find((y) => y.ce === 1893);
  const last = chronology.years.find((y) => y.ce === 1963);
  if (!first?.text?.charCount) throw new Error('1893 年沒有正文');
  if (!last?.text?.charCount) throw new Error('1963 年沒有正文');
  // 1937 不得再以跨頁殘句開頭：第一段須以年目抬頭語（歲數）或日期起頭，不是承接前頁的半句
  const y1937 = chronology.years.find((y) => y.ce === 1937);
  if (y1937?.text && /^的/.test(y1937.text.paragraphs[0])) {
    throw new Error('1937 年正文第一段疑似跨頁殘句（以「的」開頭）');
  }
  // 377–393 頁（人工逐頁校訂範圍）落在的年目，transcriptionStatus 必須是 verified 或 mixed，不能被 gcv 蓋掉
  for (const y of chronology.years) {
    if (!y.text) continue;
    const touchesVerifiedRange = y.text.pageBreaks.some((b) => b.bookPage >= 377 && b.bookPage <= 393);
    if (touchesVerifiedRange && !['verified', 'mixed'].includes(y.text.transcriptionStatus)) {
      throw new Error(`${y.ce} 年的內容落在原書 377–393 頁，transcriptionStatus 卻是 ${y.text.transcriptionStatus}`);
    }
    if (!['verified', 'gcv', 'mixed'].includes(y.text.transcriptionStatus)) {
      throw new Error(`${y.ce} 年的 transcriptionStatus 不是已知值：${y.text.transcriptionStatus}`);
    }
    for (const b of y.text.pageBreaks) {
      if (b.bookPage >= 377 && b.bookPage <= 393 && b.source !== 'verified') {
        throw new Error(`${y.ce} 年原書第 ${b.bookPage} 頁落在人工校訂範圍，pageBreak 的 source 卻是 ${b.source}`);
      }
      if ((b.bookPage < 377 || b.bookPage > 393) && b.source !== 'gcv') {
        throw new Error(`${y.ce} 年原書第 ${b.bookPage} 頁在人工校訂範圍外，pageBreak 的 source 卻是 ${b.source}`);
      }
    }
  }
  const pieceIds = new Set(tocIndex.items.map((it) => it.id));
  for (let i = 0; i < chronology.years.length; i += 1) {
    const y = chronology.years[i];
    const prev = chronology.years[i - 1];
    if (prev && y.ce <= prev.ce) throw new Error(`年目未依年遞增：${y.ce}`);
    if (prev && y.bookPage < prev.bookPage) throw new Error(`年目起頁未依原書遞增：${y.ce}`);
    // 民國紀年與西元必須相差 1911；原書誤植的兩處已在建置時以民國紀年為準改正
    const roc = /民國 (\d+) 年/.exec(y.rocLabel);
    const before = /民前 (\d+) 年/.exec(y.rocLabel);
    const implied = y.rocLabel === '民國元年' ? 1912
      : roc ? Number(roc[1]) + 1911
        : before ? 1912 - Number(before[1]) : null;
    if (implied === null) throw new Error(`年目的民國紀年寫法認不出來：${y.rocLabel}`);
    if (implied !== y.ce) throw new Error(`${y.rocLabel} 換算應為 ${implied}，年目寫的是 ${y.ce}`);
    for (const piece of y.pieces ?? []) {
      if (!pieceIds.has(piece.id)) throw new Error(`${y.ce} 年掛的篇目 ${piece.id} 不在篇目索引裡`);
      if (Number(piece.dateIso.slice(0, 4)) !== y.ce) {
        throw new Error(`${piece.id} 的日期是 ${piece.dateIso}，卻掛在 ${y.ce} 年`);
      }
    }
    if (!y.text) continue;
    const joined = y.text.paragraphs.join('');
    if (joined.length !== y.text.charCount) throw new Error(`${y.ce} 年的字數與正文不符`);
    if (!joined.length) throw new Error(`${y.ce} 年有 text 卻沒有正文`);
    for (const brk of y.text.pageBreaks) {
      const para = y.text.paragraphs[brk.para];
      if (typeof para !== 'string' || brk.offset > para.length) {
        throw new Error(`${y.ce} 年的頁碼位置 ${JSON.stringify(brk)} 指不到正文`);
      }
    }
    // 只有一截在已校訂範圍內的年，要寫明缺的是哪一段；不寫就等於把半年當成全年
    if (y.text.coverage === '部分' && !y.text.coverageNote) {
      throw new Error(`${y.ce} 年的正文只有一部分，卻沒有寫明缺哪一段`);
    }
    if (y.text.printedHeading && !y.text.printedHeadingNote) {
      throw new Error(`${y.ce} 年的原書抬頭有誤植，卻沒有寫明錯在哪裡`);
    }
  }
  const chronText = JSON.stringify(chronology);
  for (const forbidden of ['/Users/', 'Documents/NTU', 'z-library']) {
    if (chronText.includes(forbidden)) throw new Error(`chronology.json 含禁止字串：${forbidden}`);
  }
}

const serialized = JSON.stringify(data);
for (const forbidden of ['/Users/', 'Documents/NTU', 'z-library', '1lib.sk', 'z-lib.sk']) {
  if (serialized.includes(forbidden)) throw new Error(`公開資料含禁止字串：${forbidden}`);
}

console.log('公開資料驗證通過。');
