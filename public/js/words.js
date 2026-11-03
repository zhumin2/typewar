/**
 * 词流生成器：种子化 RNG + 按战斗时长分级的词条流
 */
import { WORDS } from './data.js';

/** mulberry32 种子随机数发生器（确定性） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— 词库规整：按长度分级 + 去重（魔法词优先保留）——
function buildPools() {
  const seen = new Set();
  const take = (list, min, max) => {
    const out = [];
    for (const w of list) {
      const k = w.toLowerCase();
      if (k.length < min || k.length > max) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  };
  const magic = take(WORDS.magic, 3, 9);
  const short = take(WORDS.short, 3, 4);
  const mid = take(WORDS.mid, 5, 6);
  const long = take(WORDS.long, 7, 9);
  return { short, mid, long, magic };
}

const POOLS = buildPools();

/** 乱序干扰词：辅音+元音交替的"伪单词" */
const CHAOS_C = 'bcdfgkmpstvwxz';
const CHAOS_V = 'aeiou';
export function makeChaosWord(rng) {
  const len = 3 + Math.floor(rng() * 3);
  let s = '';
  for (let i = 0; i < len; i++) {
    const pool = i % 2 === 0 ? CHAOS_C : CHAOS_V;
    s += pool[Math.floor(rng() * pool.length)];
  }
  return s;
}

/**
 * 词条流：根据战斗时长提高词长分布，有几率产出魔法词
 */
export class WordStream {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.recent = [];
  }

  next(t) {
    let pShort, pMid;
    if (t < 25)      { pShort = 0.70; pMid = 0.30; }
    else if (t < 60) { pShort = 0.35; pMid = 0.50; }
    else             { pShort = 0.15; pMid = 0.50; }

    const roll = this.rng();
    let pool = POOLS.short;
    if (roll > pShort + pMid) pool = POOLS.long;
    else if (roll > pShort) pool = POOLS.mid;

    let text;
    for (let guard = 0; guard < 8; guard++) {
      text = pool[Math.floor(this.rng() * pool.length)];
      if (!this.recent.includes(text)) break;
    }
    this.recent.push(text);
    if (this.recent.length > 5) this.recent.shift();

    let magic = false;
    if (this.rng() < 0.12) {
      magic = true;
      text = POOLS.magic[Math.floor(this.rng() * POOLS.magic.length)];
    }
    return { text, magic };
  }
}
