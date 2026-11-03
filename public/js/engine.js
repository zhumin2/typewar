/**
 * 打字引擎：词流 Lane（生成/移动/键入匹配/击破/撞线）
 */
import { makeChaosWord } from './words.js';

let WORD_ID = 1;

/** 构建单词的 DOM 元素（每个字母一个 span） */
export function buildWordEl(w) {
  const el = document.createElement('div');
  el.className = 'word'
    + (w.magic ? ' magic' : '')
    + (w.chaos ? ' chaos' : '')
    + (w.py ? ' py' : '');
  el.dataset.id = w.id;
  for (const ch of w.text) {
    const s = document.createElement('span');
    s.textContent = ch;
    el.appendChild(s);
  }
  return el;
}

/** 按已输入进度渲染字母高亮 */
export function renderWord(w) {
  const spans = w.el.children;
  for (let i = 0; i < spans.length; i++) {
    spans[i].className = i < w.typed ? 'done' : (i === w.typed ? 'next' : '');
  }
}

export class Lane {
  /**
   * @param opts.root    .lane 容器（含 .words 子容器与 .line 防线）
   * @param opts.dir     -1: 我方（右→左，防线在左）  +1: 敌方（左→右，防线在右）
   * @param opts.stream  WordStream
   * @param opts.onDone    (word) => void      整词击破
   * @param opts.onEscape  (word) => void      词撞防线
   * @param opts.onLetter  (word|null, 'hit'|'miss') => void
   */
  constructor(opts) {
    this.root = opts.root;
    this.wordsEl = opts.root.querySelector('.words');
    this.lineEl = opts.root.querySelector('.line');
    this.dir = opts.dir;
    this.stream = opts.stream;
    this.onDone = opts.onDone;
    this.onEscape = opts.onEscape;
    this.onLetter = opts.onLetter;
    this.words = [];
    this.locked = null;
    this.time = 0;
    this.spawnT = 0.8;
    this._getSlow = null;
    this.rng = Math.random;
  }

  /** 词速减速系数由战斗层注入 */
  setSlowProvider(fn) { this._getSlow = fn; }
  getSlow() { return this._getSlow ? this._getSlow() : 1; }

  /** 该词距防线的接近度 0~100（越大越近） */
  prog(w) { return this.dir < 0 ? 100 - w.x : w.x; }

  nextInterval() {
    return Math.max(1.5, 2.6 - this.time / 120) * (0.85 + this.rng() * 0.3);
  }
  wordSpeed() {
    return Math.min(8.5, 5.8 + (this.time / 45) * 0.35) * (0.88 + this.rng() * 0.24);
  }

  trySpawn() {
    // 出词口附近有词未离开时稍等
    const edge = this.dir < 0 ? 92 : 8;
    for (const w of this.words) {
      if (this.dir < 0 ? w.x > edge : w.x < edge) { this.spawnT = 0.25; return; }
    }
    const item = this.stream.next(this.time);
    this.spawnWord(item);
    this.spawnT = this.nextInterval();
  }

  spawnWord({ text, magic, chaos, py, x, speed }) {
    const w = {
      id: WORD_ID++, text, typed: 0,
      magic: !!magic, chaos: !!chaos, py: !!py,
      x: x !== undefined ? x : (this.dir < 0 ? 100 : 0),
      speed: speed || this.wordSpeed(),
      alive: true,
    };
    w.el = buildWordEl(w);
    this.wordsEl.appendChild(w.el);
    w.el.style.left = w.x + '%';
    renderWord(w);
    this.words.push(w);
    return w;
  }

  /** 注入 n 个乱序干扰词（混乱咒） */
  injectChaos(n, rng) {
    const r = rng || this.rng;
    for (let i = 0; i < n; i++) {
      const text = makeChaosWord(r);
      this.spawnWord({ text, chaos: true, x: this.dir < 0 ? 88 - i * 11 : 12 + i * 11, speed: this.wordSpeed() * 1.1 });
    }
  }

  update(dt) {
    this.time += dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) this.trySpawn();
    const slow = this.getSlow();
    for (const w of [...this.words]) {
      w.x += this.dir * w.speed * slow * dt;
      if (this.dir < 0 ? w.x <= 0 : w.x >= 100) { this.escapeWord(w); continue; }
      w.el.style.left = w.x + '%';
    }
  }

  /** 键入一个字母；返回 'hit' | 'miss'。大小写不敏感，以支持 True/False/None */
  input(ch) {
    const c = String(ch).toLowerCase();
    const w = this.locked;
    if (w && w.alive) {
      if (w.text[w.typed].toLowerCase() === c) { this.hitLetter(w); return 'hit'; }
      this.onLetter(null, 'miss');
      return 'miss';
    }
    // 未锁定：找以该字母开头的词，选最接近防线的
    let best = null;
    for (const cand of this.words) {
      if (cand.alive && cand.text[0].toLowerCase() === c) {
        if (!best || this.prog(cand) > this.prog(best)) best = cand;
      }
    }
    if (best) { this.locked = best; this.hitLetter(best); return 'hit'; }
    this.onLetter(null, 'miss');
    return 'miss';
  }

  hitLetter(w) {
    w.typed++;
    this.onLetter(w, 'hit');
    if (w.typed >= w.text.length) this.completeWord(w);
    else renderWord(w);
  }

  completeWord(w) {
    if (!w.alive) return;
    w.alive = false;
    this.words = this.words.filter(x => x !== w);
    if (this.locked === w) this.locked = null;
    w.el.remove();
    this.onDone(w);
  }

  escapeWord(w) {
    if (!w.alive) return;
    w.alive = false;
    this.words = this.words.filter(x => x !== w);
    if (this.locked === w) this.locked = null;
    w.el.classList.add('escaped');
    setTimeout(() => w.el.remove(), 320);
    if (this.lineEl) {
      this.lineEl.classList.remove('hit-flash');
      void this.lineEl.offsetWidth; // 重触发动画
      this.lineEl.classList.add('hit-flash');
    }
    this.onEscape(w);
  }

  /** 获取词元素中心点相对视口坐标（供特效使用） */
  wordPos(w) {
    const r = w.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  serialize() {
    return this.words.map(w => ({ id: w.id, text: w.text, typed: w.typed, x: Math.round(w.x * 10) / 10, magic: w.magic, chaos: w.chaos, py: w.py }));
  }

  destroy() {
    for (const w of this.words) w.el.remove();
    this.words = [];
    this.locked = null;
  }
}

/**
 * 远端词流（PVP 对面）：不由本地模拟，
 * 通过快照同步词列表，本地做位置插值渲染。
 */
export class RemoteLane {
  constructor(root, dir) {
    this.root = root;
    this.wordsEl = root.querySelector('.words');
    this.dir = dir; // 敌方在本地渲染：左→右
    this.map = new Map(); // id -> word
    this._getSlow = null;
  }

  sync(list) {
    const alive = new Set();
    for (const d of list) {
      alive.add(d.id);
      let w = this.map.get(d.id);
      if (!w) {
        w = { id: d.id, text: d.text, typed: d.typed, magic: d.magic, chaos: d.chaos, py: d.py, x: d.x, tx: d.x, alive: true };
        w.el = buildWordEl(w);
        this.wordsEl.appendChild(w.el);
        w.el.style.left = w.x + '%';
        renderWord(w);
        this.map.set(d.id, w);
      } else {
        if (d.typed !== w.typed) { w.typed = d.typed; renderWord(w); }
        w.tx = d.x;
      }
    }
    // 移除已消失的词
    for (const [id, w] of this.map) {
      if (!alive.has(id)) {
        w.el.remove();
        this.map.delete(id);
      }
    }
  }

  update(dt) {
    // 位置快速趋近目标（快照 8Hz，插值让移动平滑）
    const k = Math.min(1, dt * 10);
    for (const w of this.map.values()) {
      w.x += (w.tx - w.x) * k;
      w.el.style.left = w.x + '%';
    }
  }

  /** 找出最接近我方防线的词的位置（特效锚点） */
  nearestPos() {
    let best = null;
    for (const w of this.map.values()) {
      if (!best || w.x > best.x) best = w;
    }
    if (!best) return null;
    const r = best.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  destroy() {
    for (const w of this.map.values()) w.el.remove();
    this.map.clear();
  }
}
