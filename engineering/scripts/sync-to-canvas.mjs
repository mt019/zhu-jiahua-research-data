import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../data/processed/zhu-jiahua-app.json');
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, '../../../my-canvas-lab/src/data/zhuJiahua.json');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`已同步公開快照：${target}`);

// 198 篇未校讀稿一篇一檔，前端按需載入。整份塞進快照會讓 /zhujiahua 一開就拉五十幾萬字。
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
