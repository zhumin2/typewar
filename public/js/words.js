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

  // Python 词池：独立去重（不与英文池互斥，避免缩小英文词量），
  // 保留原始大小写（True/False/None），只收纯字母
  const pySeen = new Set();
  const python = [];
  for (const w of WORDS.python) {
    if (!/^[A-Za-z]+$/.test(w)) continue;
    if (w.length < 2 || w.length > 12) continue;
    const k = w.toLowerCase();
    if (pySeen.has(k)) continue;
    pySeen.add(k);
    python.push(w);
  }

  return { short, mid, long, magic, python };
}

const POOLS = buildPools();

/** 词库模式 → Python 词出现概率 */
const PY_RATE = { english: 0, mixed: 0.22, python: 1 };

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
 * 词条流：根据战斗时长提高词长分布，有几率产出魔法词与 Python 词
 */
export class WordStream {
  /**
   * @param seed    RNG 种子
   * @param opts.vocab  'english' | 'mixed' | 'python'（默认 mixed）
   */
  constructor(seed, opts = {}) {
    this.rng = mulberry32(seed);
    this.recent = [];
    this.vocab = opts.vocab || 'mixed';
    this.pyRate = PY_RATE[this.vocab] ?? PY_RATE.mixed;
  }

  /** 取一个词，尽量避开最近出现过的 */
  pick(pool) {
    let text = pool[0];
    for (let guard = 0; guard < 8; guard++) {
      text = pool[Math.floor(this.rng() * pool.length)];
      if (!this.recent.includes(text)) break;
    }
    this.recent.push(text);
    if (this.recent.length > 5) this.recent.shift();
    return text;
  }

  next(t) {
    // 魔法词优先（紫色，击破奖励 MP）
    if (this.rng() < 0.12) return { text: this.pick(POOLS.magic), magic: true };

    // Python 词库（绿色 > 标记）
    if (this.pyRate > 0 && this.rng() < this.pyRate) {
      return { text: this.pick(POOLS.python), py: true };
    }

    let pShort, pMid;
    if (t < 25)      { pShort = 0.70; pMid = 0.30; }
    else if (t < 60) { pShort = 0.35; pMid = 0.50; }
    else             { pShort = 0.15; pMid = 0.50; }

    const roll = this.rng();
    let pool = POOLS.short;
    if (roll > pShort + pMid) pool = POOLS.long;
    else if (roll > pShort) pool = POOLS.mid;

    return { text: this.pick(pool), magic: false };
  }
}

/** 供调试/统计用 */
export function poolSizes() {
  return Object.fromEntries(Object.entries(POOLS).map(([k, v]) => [k, v.length]));
}
