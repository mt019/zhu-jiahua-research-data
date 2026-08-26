// 編輯體例頁的產物：data/materials/editorial-notes.md → data/processed/editorial-notes.json。
//
// 組裝在共用層（@phenomcanvas/prose-rules/editorial-notes），本檔只給路徑。判準的權威本文
// 在 ~/.claude/rules/轉錄體例.md 的「改與不改的三層」；這一頁是它對讀者的說法，維護用的
// 檢查規則名與建置細節留在工程紀錄，不上前端。

import { readFile, writeFile } from 'node:fs/promises';
import { buildEditorialNotes } from '@phenomcanvas/prose-rules/editorial-notes';

const source = new URL('../../data/materials/editorial-notes.md', import.meta.url);
const target = new URL('../../data/processed/editorial-notes.json', import.meta.url);

const markdown = await readFile(source, 'utf8');
const notes = buildEditorialNotes({ markdown, label: 'data/materials/editorial-notes.md' });

await writeFile(target, `${JSON.stringify(notes, null, 2)}\n`);
console.log(`編輯體例：${notes.sections.length} 節 → ${target.pathname}`);
