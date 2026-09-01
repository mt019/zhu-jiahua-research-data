import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../data/processed/zhu-jiahua-app.json');
// 前端是 phenom-zhujiahua（studies.phenomcanvas.com/zhujiahua/），不是 my-canvas-lab。
// 這支腳本原本寫進 canvas，而 canvas 那份在 2026-08-16 拆站之後只是留著轉址的舊路由；
// 2026-08-19 到 08-20 的三週讀稿工作因此全部落在拆掉的那一份上，線上的站一個字都沒動。
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, '../../../phenom-zhujiahua/src/data/zhuJiahua.json');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`已同步公開快照：${target}`);

// 年表另存一份：71 個年目與其中十二年的校訂全文，只有 /zhujiahua/chronology 讀它。
const chronologySource = resolve(here, '../../data/processed/chronology.json');
const chronologyTarget = resolve(dirname(target), 'zhuJiahuaChronology.json');
await copyFile(chronologySource, chronologyTarget);
console.log(`已同步年表：${chronologyTarget}`);

// 編輯體例：凡例頁讀它。前端用靜態 import，這一份漏帶了建置就紅，不會安靜地少一頁。
const notesTarget = resolve(dirname(target), 'zhuJiahuaEditorialNotes.json');
await copyFile(resolve(here, '../../data/processed/editorial-notes.json'), notesTarget);
console.log(`已同步編輯體例：${notesTarget}`);

// 讀稿一篇一檔，前端按需載入。整份塞進快照會讓 /zhujiahua 一開就拉五十幾萬字。
const draftSource = resolve(here, '../../data/processed/reading-drafts');
const draftTarget = resolve(dirname(target), 'zhuJiahua/drafts');
let files = [];
try {
  files = (await readdir(draftSource)).filter((f) => f.endsWith('.json'));
} catch {
  files = [];
}
if (files.length) {
  await rm(draftTarget, { recursive: true, force: true });
  await mkdir(draftTarget, { recursive: true });
  for (const f of files) await copyFile(resolve(draftSource, f), resolve(draftTarget, f));
  console.log(`已同步未校讀稿 ${files.length} 檔：${draftTarget}`);
}

// 圖版的圖檔：攝影著作的權利狀態未查（見 data/materials/plates/plates.json 的 rights），
// 所以圖檔不進版控也不進線上建置，只在 ZJH_PLATES=1 時搬過去看本機的版面。
if (process.env.ZJH_PLATES === '1') {
  const plateSource = resolve(here, '../../data/derived/plates');
  const plateTarget = resolve(dirname(target), '../../public/zhujiahua-plates');
  let plateFiles = [];
  try {
    plateFiles = (await readdir(plateSource)).filter((f) => f.endsWith('.jpg'));
  } catch {
    plateFiles = [];
  }
  if (plateFiles.length) {
    await mkdir(plateTarget, { recursive: true });
    for (const f of plateFiles) await copyFile(resolve(plateSource, f), resolve(plateTarget, f));
    console.log(`已同步圖版 ${plateFiles.length} 件（本機預覽用，不進版控）：${plateTarget}`);
  }
}

// 書外文獻：快照一份、讀稿一件一檔，案頁與總覽頁讀前者、正文按需載入後者。
const relatedSource = resolve(here, '../../data/processed/related-documents.json');
const relatedTarget = resolve(dirname(target), 'zhuJiahuaRelated.json');
await copyFile(relatedSource, relatedTarget);
console.log(`已同步書外文獻快照：${relatedTarget}`);
const extSource = resolve(here, '../../data/processed/external-drafts');
const extTarget = resolve(dirname(target), 'zhuJiahua/related');
let extFiles = [];
try {
  extFiles = (await readdir(extSource)).filter((f) => f.endsWith('.json'));
} catch {
  extFiles = [];
}
if (extFiles.length) {
  await rm(extTarget, { recursive: true, force: true });
  await mkdir(extTarget, { recursive: true });
  for (const f of extFiles) await copyFile(resolve(extSource, f), resolve(extTarget, f));
  console.log(`已同步書外文獻讀稿 ${extFiles.length} 檔：${extTarget}`);
}

// 書外文獻的原頁圖：兩件來源的權利狀態都是 pending（rights 見 data/derived/sources.json），
// 圖檔不進版控也不進線上建置，只在 ZJH_SCANS=1 時搬過去看本機的版面，作法照 ZJH_PLATES。
if (process.env.ZJH_SCANS === '1') {
  const sources = JSON.parse(
    await (await import('node:fs/promises')).readFile(resolve(here, '../../data/derived/sources.json'), 'utf8'),
  ).sources.filter((s) => !s.primaryPending);
  const scanTarget = resolve(dirname(target), '../../public/zhujiahua-scans');
  let copied = 0;
  for (const s of sources) {
    const pagesDir = resolve(here, '../../data/materials/external', s.id, 'pages');
    let pageFiles = [];
    try {
      pageFiles = (await readdir(pagesDir)).filter((f) => f.endsWith('.png'));
    } catch {
      pageFiles = [];
    }
    if (!pageFiles.length) continue;
    await mkdir(resolve(scanTarget, s.id), { recursive: true });
    for (const f of pageFiles) await copyFile(resolve(pagesDir, f), resolve(scanTarget, s.id, f));
    copied += pageFiles.length;
  }
  if (copied) console.log(`已同步書外文獻頁圖 ${copied} 張（本機預覽用，不進版控）：${scanTarget}`);
}
