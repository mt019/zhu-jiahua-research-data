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
  const reviewedById = new Map(
    JSON.parse(
      await readFile(new URL('../../data/materials/speeches/reviewed.json', import.meta.url), 'utf8'),
    ).items.map((r) => [r.pieceId, r]),
  );
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
    // 讀稿的狀態只有兩種：未校，或全篇逐頁核過。核過的要在 reviewed.json 有一條，
    // 而且那一條記的起訖頁要與該篇的頁範圍相同——「改了幾個字」與「每一頁都比對過」
    // 是兩件事，光看校訂表的條數分不出來。
    const review = reviewedById.get(draft.id) ?? null;
    if (draft.status === '逐頁核過的辨讀稿') {
      if (!review) throw new Error(`${file} 標成逐頁核過，而 reviewed.json 裡沒有這一篇`);
      const want = `${review.bookFrom}–${review.bookTo}`;
      if (draft.bookPages !== want) {
        throw new Error(`${file} 的頁範圍是 ${draft.bookPages}，reviewed.json 記的是 ${want}，核過的不是整篇`);
      }
      if (!draft.statusNote || !draft.statusNote.includes('逐欄回原頁圖核過')) {
        throw new Error(`${file} 沒有寫明怎麼核的`);
      }
    } else if (draft.status !== '未校辨讀稿') {
      throw new Error(`${file} 的 status 是「${draft.status}」，讀稿只有未校辨讀稿與逐頁核過的辨讀稿兩種`);
    } else {
      if (review) throw new Error(`${file} 在 reviewed.json 裡有一條，而讀稿還標著未校`);
      if (!draft.statusNote || !draft.statusNote.includes('未經逐字人工校訂')) {
        throw new Error(`${file} 沒有寫明未經逐字人工校訂`);
      }
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

  // ── 全書對帳 ──────────────────────────────────────────────────────────────
  // 上面各條看的是單篇內部。三道對帳跨篇看整本書：2026-08-24 那次，末篇的訖頁是空的，
  // ZJH-198 原書 745–750 只收到 745 那一頁、少掉 3,674 字，而每一道既有檢查都是綠的。
  // 例外寫在 data/materials/speeches/coverage-exceptions.json，不寫死在這裡。
  const pageMap = JSON.parse(
    await readFile(new URL('../../data/derived/page_map.json', import.meta.url), 'utf8'),
  );
  const pieceHeads = JSON.parse(
    await readFile(new URL('../../data/derived/piece_heads.json', import.meta.url), 'utf8'),
  );
  const exceptions = JSON.parse(
    await readFile(new URL('../../data/materials/speeches/coverage-exceptions.json', import.meta.url), 'utf8'),
  );
  const skipPdf = exceptions.items.filter((e) => e.check === '篇目涵蓋');
  const skipPage = exceptions.items.filter((e) => e.check === '逐頁字數');

  // 一、正文頁全被篇目涵蓋。這一道不靠 endPdfPage 算得對，反過來查它。
  const covered = new Set();
  for (const h of pieceHeads.items) {
    const to = h.endPdfPage ?? h.pdfPage;
    for (let p = h.pdfPage; p <= to; p += 1) covered.add(p);
  }
  const orphans = pageMap.items
    .filter((it) => it.bookPage !== null || it.bookPageInferred !== null)
    .map((it) => it.pdfPage)
    .filter((p) => !covered.has(p))
    .filter((p) => !skipPdf.some((e) => p >= e.pdfFrom && p <= e.pdfTo));
  if (orphans.length) {
    throw new Error(
      `PDF 第 ${orphans.join('、')} 頁有正文卻不屬於任何一篇：某一篇的起訖頁算錯了，`
      + '或例外清單少登記一段（data/materials/speeches/coverage-exceptions.json）',
    );
  }

  // 二、篇中間頁的字數對帳。首頁與末頁不算，篇從頁中起、末頁讓給下一篇，本來只佔半頁。
  // 差額的底是書眉八字加部次名：實測 395 個中間頁，中位數 10、平均 9.4，門檻取 20。
  // 讀稿的頁碼與 page_map 由相鄰頁推得的頁碼在六處差一（page_map.json 的 caveats 有記），
  // 所以哪一頁對哪一張辨讀稿不按頁碼配，按內容配：拿該頁正文開頭的字去該篇的頁區間裡找。
  const PAGE_CHAR_GAP = 20;
  const CJK_ALL = /[\u4e00-\u9fff\uf900-\ufaff]/g;
  const cjkCount = (t) => (t.match(CJK_ALL) ?? []).length;
  const cjkOnly = (t) => (t.match(CJK_ALL) ?? []).join('');
  const GCV_TXT = new URL('../../data/materials/speeches/gcv/txt/', import.meta.url);
  const gcvPrefix = '朱家驊先生言論集 (王聿均,孫斌合编)-';
  const pageText = new Map();
  const readPage = async (pdfPage) => {
    if (pageText.has(pdfPage)) return pageText.get(pdfPage);
    const name = `${gcvPrefix}${String(pdfPage).padStart(3, '0')}.txt`;
    let raw;
    try {
      raw = await readFile(new URL(encodeURIComponent(name), GCV_TXT), 'utf8');
    } catch {
      throw new Error(
        `讀不到辨讀稿 ${name}：逐頁字數對帳跑不了。辨讀稿不進版控，`
        + '要先把 data/materials/speeches/gcv/txt/ 補齊再驗',
      );
    }
    pageText.set(pdfPage, raw);
    return raw;
  };
  const headById = new Map(pieceHeads.items.map((h) => [h.id, h]));
  const thin = [];
  const unaligned = [];
  let reconciled = 0;
  for (const [file, draft] of drafts) {
    if (draft.frontMatter) continue;
    const h = headById.get(draft.id);
    if (!h) continue;
    const brks = draft.pageBreaks;
    if (brks.length < 3) continue;
    const at = (b) => draft.paragraphs.slice(0, b.para).reduce((n, t) => n + t.length, 0) + b.offset;
    const marks = brks.map(at).concat(draft.paragraphs.reduce((n, t) => n + t.length, 0));
    const whole = draft.paragraphs.join('');
    const lastPdf = h.endPdfPage ?? h.pdfPage;
    let cursor = h.pdfPage;
    for (let i = 1; i < brks.length - 1; i += 1) {
      const bookPage = brks[i].bookPage;
      const segment = cjkOnly(whole.slice(marks[i], marks[i + 1]));
      // 該頁開頭的字去辨讀稿裡找；GCV 在換欄處偶爾掉頭一兩個字，所以備三個位置的鑰匙
      const keys = [segment.slice(0, 8), segment.slice(16, 24), segment.slice(40, 48)]
        .filter((k) => k.length === 8);
      let pdfPage = null;
      for (let p = cursor; p <= lastPdf && pdfPage === null; p += 1) {
        const raw = cjkOnly(await readPage(p));
        if (keys.some((k) => raw.includes(k))) pdfPage = p;
      }
      if (pdfPage === null) {
        if (draft.missingBookPages?.includes(bookPage)) continue;
        unaligned.push(`${draft.id} 原書第 ${bookPage} 頁：正文開頭在 PDF ${cursor}–${lastPdf} 都找不到`);
        continue;
      }
      cursor = pdfPage + 1;
      if (skipPage.some((e) => e.pieceId === draft.id && bookPage >= e.bookFrom && bookPage <= e.bookTo)) continue;
      reconciled += 1;
      const drafted = segment.length;
      const recognised = cjkCount(await readPage(pdfPage));
      if (recognised - drafted > PAGE_CHAR_GAP) {
        thin.push(`${draft.id} 原書第 ${bookPage} 頁（PDF ${pdfPage}）讀稿 ${drafted} 字、辨讀稿 ${recognised} 字，差 ${recognised - drafted}`);
      }
    }
  }
  if (unaligned.length) {
    throw new Error(`有 ${unaligned.length} 頁對不到辨讀稿，逐頁字數無從核起：\n  ${unaligned.join('\n  ')}`);
  }
  if (thin.length) {
    throw new Error(`逐頁字數對不上，${thin.length} 頁：\n  ${thin.join('\n  ')}`);
  }

  // 三、篇的頁數與 pageBreaks 數對得上。共用起頁（該頁只排得下標題行）與共用訖頁
  // （末頁讓給下一篇）各准少一個。
  for (const [file, draft] of drafts) {
    if (draft.frontMatter) continue;
    const h = headById.get(draft.id);
    if (!h) continue;
    const span = (h.endPdfPage ?? h.pdfPage) - h.pdfPage + 1;
    const allowed = span - (h.sharesStartPage ? 1 : 0) - (h.sharesEndPage ? 1 : 0);
    if (draft.pageBreaks.length < allowed) {
      throw new Error(
        `${file} 佔 ${span} 個 PDF 頁，讀稿只記到 ${draft.pageBreaks.length} 頁`
        + `（共用起頁 ${Boolean(h.sharesStartPage)}、共用訖頁 ${Boolean(h.sharesEndPage)}，至少該有 ${allowed} 頁）`,
      );
    }
  }
  console.log(`全書對帳：正文頁 0 孤兒、逐頁字數核過 ${reconciled} 頁、篇的頁數 ${drafts.length - 2} 篇對得上。`);
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
  const punctIssues = [];
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
    // 標點糾察（站主 2026-08-24 令，起因是「首都革命」缺閉引號、「地質學概論'」的半形撇、
    // 「各地旅行」段末無句讀）。年目是完整的敘事單位，引號括號在年內不成對就是辨讀錯——
    // 原書跨段引文的兩半各在同一年的兩段裡，join 起來仍然成對。一次收齊全部再報，
    // 修正走 corrections/pg-NN.tsv，逐處回原頁圖。
    for (const [open, close] of [['「', '」'], ['『', '』'], ['（', '）']]) {
      const no = joined.split(open).length - 1;
      const nc = joined.split(close).length - 1;
      if (no !== nc) punctIssues.push(`${y.ce} 年的 ${open}${close} 不成對：${no} 對 ${nc}`);
    }
    // 貼著漢字的半形撇、引號、角括號與半形括號——中西成對符號各取一半（「巴達帕斯特
    // （Budapest)」）就在這裡現形。拉丁文自己的半形括號（「(Zeche Hollandine)」）與
    // d'Alembert 的撇號兩側都不是漢字，原書就那樣排，不報。成對且括號裡沒有漢字的
    // 半形括號即使貼著漢字也不報——括號的寬度照這一對的內容定（lib/punctuation.mjs 的
    // 定寬規則），原書拉丁人名的括號就排半形（「將軍 (General Faupel)，」，19、50 頁核過）。
    const latinParen = new Set();
    {
      const stack = [];
      for (let i = 0; i < joined.length; i += 1) {
        if (joined[i] === '(') stack.push(i);
        else if (joined[i] === ')' && stack.length) {
          const j = stack.pop();
          if (!/[一-鿿]/.test(joined.slice(j + 1, i))) { latinParen.add(j); latinParen.add(i); }
        }
      }
    }
    for (const m of joined.matchAll(/(?<=[一-鿿。，「」（）])['"<>()]|['"<>()](?=[一-鿿。，「」（）])/g)) {
      if (latinParen.has(m.index)) continue;
      punctIssues.push(`${y.ce} 年正文有散的半形字元「${m[0]}」：…${joined.slice(Math.max(0, m.index - 8), m.index + 9)}…`);
    }
    // 夾在漢字或全形標點之間的半形標點（widen 的鄰居判斷漏掉的）
    for (const m of joined.matchAll(/[一-鿿。，；：」』）][,.;:!?][一-鿿「『（]/g)) {
      punctIssues.push(`${y.ce} 年正文夾著半形標點：…${joined.slice(Math.max(0, m.index - 6), m.index + 9)}…`);
    }
    // 段末要有句讀（GCV 會掉段末句號：「⋯各地旅行」）。收在冒號上的段是引起下段的引文，
    // 照留；碑文落款（1963 年墓表的「陸翰芹敬書」）原書就沒有句讀，也照留。
    for (const para of y.text.paragraphs) {
      const t = para.trim();
      if (t && !/[。！？：，；」』）…⋯]$/.test(t) && !/敬書$|敬立$|拜撰$/.test(t)) {
        punctIssues.push(`${y.ce} 年有一段收在「${t.slice(-8)}」，段末無句讀`);
      }
    }
  }
  if (punctIssues.length) {
    throw new Error(`年譜標點糾察 ${punctIssues.length} 處：\n  ${punctIssues.join('\n  ')}`);
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
