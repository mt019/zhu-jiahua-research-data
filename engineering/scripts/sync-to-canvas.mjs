import { copyFile, mkdir } from 'node:fs/promises';
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
