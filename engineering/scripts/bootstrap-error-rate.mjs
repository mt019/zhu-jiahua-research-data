#!/usr/bin/env node
// 字錯率的區間：抽樣單位是頁不是處。22 處與原書不符叢集在頁上（一頁佔 8 處、兩頁 0 處），
// Poisson 假設每一處各自獨立，用在這裡會把區間收得太窄。這支改以頁為單位做重抽：
// 十頁有放回抽十頁，每次算「總處數 ÷ 總字數」，取兩側 2.5% 分位。
//
// 只數不改：讀 engineering/error-rate/2026-08-27-sample.json，把結果印出來（給 --write
// 才寫回同一份 JSON 的 pageBootstrap95 欄）。固定種子，重跑同一批數字。
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'engineering/error-rate/2026-08-27-sample.json'
const DRAWS = Number(process.env.ZJH_DRAWS ?? 20000)
const SEED = Number(process.env.ZJH_SEED ?? 20260827)

const data = JSON.parse(readFileSync(FILE, 'utf8'))
const pages = data.sample
// population 那句話裡有兩個帶「字」的數（每頁的 300 字門檻、母體總字數），取大的那個
const poolChars = Math.max(...[...String(data.population).matchAll(/([\d,]+)\s*字/g)]
  .map((m) => Number(m[1].replace(/,/g, ''))))

let seed = SEED
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const rates = []
for (let d = 0; d < DRAWS; d += 1) {
  let chars = 0
  let found = 0
  for (let i = 0; i < pages.length; i += 1) {
    const p = pages[Math.floor(rand() * pages.length)]
    chars += p.chars
    found += p.found
  }
  rates.push(found / chars)
}
rates.sort((a, b) => a - b)
const lo = rates[Math.floor(0.025 * DRAWS)]
const hi = rates[Math.ceil(0.975 * DRAWS) - 1]

const totalChars = pages.reduce((a, p) => a + p.chars, 0)
const totalFound = pages.reduce((a, p) => a + p.found, 0)
if (data.result.chars !== totalChars) {
  console.error(`逐頁字數合計 ${totalChars}，而 result.chars 記著 ${data.result.chars}；以逐頁的為準`)
}
const point = totalFound / totalChars

// Poisson 的精確區間（把每一處當獨立事件；本書的處數叢集在頁上，這一項只留著對照）
const poisCdf = (k, lam) => {
  let term = Math.exp(-lam)
  let acc = term
  for (let i = 1; i <= k; i += 1) { term *= lam / i; acc += term }
  return acc
}
const solve = (f) => {
  let lo = 0
  let hi = 10 * (totalFound + 10)
  const rising = f(hi) > f(lo)
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if ((f(mid) > 0) === rising) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}
const poisLo = totalFound === 0 ? 0 : solve((lam) => 1 - poisCdf(totalFound - 1, lam) - 0.025)
const poisHi = solve((lam) => poisCdf(totalFound, lam) - 0.025)
const pct = (x) => `${(x * 100).toFixed(3)}%`
console.log(`${totalFound} 處 ÷ ${totalChars} 字；Poisson 區間 ${(poisLo / totalChars * 100).toFixed(3)}%–${(poisHi / totalChars * 100).toFixed(3)}%`)
console.log(`以頁重抽 ${DRAWS} 次（種子 ${SEED}）：${pct(lo)}–${pct(hi)}，點估計 ${pct(point)}`)
console.log(`未校 ${poolChars.toLocaleString('en-US')} 字推估 ${Math.round(lo * poolChars)}–${Math.round(hi * poolChars)} 處，點估計 ${Math.round(point * poolChars)} 處`)

if (process.argv.includes('--write')) {
  data.result.chars = totalChars
  data.result.found = totalFound
  data.result.rate = Number(point.toFixed(5))
  data.result.poisson95 = [Number((poisLo / totalChars).toFixed(5)), Number((poisHi / totalChars).toFixed(5))]
  data.result.pageBootstrap95 = [Number(lo.toFixed(5)), Number(hi.toFixed(5))]
  data.result.pageBootstrapNote = `以頁為單位有放回重抽 ${DRAWS} 次（種子 ${SEED}）；Poisson 區間 ${JSON.stringify(data.result.poisson95)} 以處為獨立單位，低估了頁內的叢集`
  data.result.projectedToPool = {
    poolChars,
    point: Math.round(point * poolChars),
    range: [Math.round(lo * poolChars), Math.round(hi * poolChars)],
  }
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`寫回 ${FILE}`)
}
