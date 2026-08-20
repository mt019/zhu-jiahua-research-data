#!/usr/bin/env node
// 讀稿裡疑似辨讀錯字的候選清單（原型，2026-08-20，尚未收進固定檢查）。
//
// 判準：拿全書自己當語料算三字組頻率，找「這三個字全書只出現一次、而把中間那個字換成
// 形近字之後的組合出現過兩次以上」的位置。異體字先套 ~/.claude/skills/cjk-print-ocr/
// variants.tsv 折過，淸／清、卽／即 這種不是錯字。
//
// 已知的精確度：三字組這一版報 25 處，其中 20 處是 于／於（原書兩形都排，不是錯字，
// 該從形近字表拿掉），真的錯字抓到「自已的→自己的」。放寬成二字組報 117 處，抓得到
// 「此孫→此系」與「己經→已經」，噪音是跨詞邊界的組合（若夫地質、如入無人之境、
// 不特其他、楊光先）。門檻與形近字表都還要調。
//
// 決定性的方法是雙引擎對照（見 ~/.claude/rules/harness診斷 2026-08-19 那條），
// 本書 786 頁還沒跑過第二個引擎；這一支是它的補充，不是替代。
// ——「這三個字的組合全書只出現一次，換掉中間那個形近字之後的組合出現過」才報。
import { readdirSync, readFileSync } from 'node:fs';
const DIR = 'data/processed/reading-drafts';
const fold = new Map();
for (const line of readFileSync(`${process.env.HOME}/.claude/skills/cjk-print-ocr/variants.tsv`, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [canon, ...rest] = line.trim().split(/\s+/);
  for (const v of rest) fold.set(v, canon);
}
const nf = (s) => [...s].map((c) => fold.get(c) ?? c).join('');
const texts = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  const d = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  for (const [i, p] of d.paragraphs.entries()) texts.push([d.id, i, p, nf(p)]);
}
const HAN = /[一-鿿㐀-䶿豈-﫿]/;
const tri = new Map();
for (const [, , , p] of texts) for (let i = 0; i + 2 < p.length; i += 1) {
  const k = p.slice(i, i + 3);
  if (![...k].every((c) => HAN.test(c))) continue;
  tri.set(k, (tri.get(k) ?? 0) + 1);
}
// 形近字組：去掉異體字那幾對（對照表已經折過），只留真的會認錯的
const CONF = '系孫 末未 己已巳 戌戍戊 土士 日曰 人入 千干 天夫 部郡 陳陣 傳傅 侍待 特持 徑經 淮准 折析 買賣 冑胄 汪注 岡崗 幣弊 微徵 撤徹 藉籍 戈弋 刺剌 惑感 揚楊 婦歸 蓆席 專博 學覺 名各 大太 免兔 拆折 抵低 衷哀 冠寇 廠敞 攻政 於于'.split(' ');
const near = new Map();
for (const g of CONF) for (const c of g) near.set(c, [...(near.get(c) ?? []), ...[...g].filter((x) => x !== c)]);

const hits = [];
for (const [id, para, raw, p] of texts) {
  for (let i = 1; i + 1 < p.length; i += 1) {
    const k = p.slice(i - 1, i + 2);
    if (![...k].every((c) => HAN.test(c))) continue;
    if ((tri.get(k) ?? 0) !== 1) continue;
    for (const alt of near.get(p[i]) ?? []) {
      const cand = p[i - 1] + alt + p[i + 1];
      const n = tri.get(cand) ?? 0;
      if (n >= 2) hits.push({ id, para, was: p[i], should: alt, tri: k, cand, n, ctx: raw.slice(Math.max(0, i - 12), i + 13) });
    }
  }
}
console.log(`三字組 ${tri.size} 種，疑似 ${hits.length} 處`);
for (const h of hits) console.log(`${h.id} p${h.para}  ${h.tri} → ${h.cand}（後者全書 ${h.n} 次）  …${h.ctx}…`);
