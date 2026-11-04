/**
 * 指法练习：脱离对战，专注练键位与手速
 * - 逐字高亮、正确/错误即时反馈
 * - 虚拟键盘标注每个键该用哪根手指，并高亮下一个要按的键（含 Shift 提示）
 * - 实时 WPM / 准确率 / 连击 / 用时，完成后出成绩单
 */
import { WORDS } from './data.js';
import { sfx } from './fx.js';

/* ---------------- 键位 → 手指 ---------------- */
// L/R + 1..4 = 小指/无名指/中指/食指
const FINGER_OF = {
  q: 'L1', a: 'L1', z: 'L1',
  w: 'L2', s: 'L2', x: 'L2',
  e: 'L3', d: 'L3', c: 'L3',
  r: 'L4', f: 'L4', v: 'L4', t: 'L4', g: 'L4', b: 'L4',
  y: 'R4', h: 'R4', n: 'R4', u: 'R4', j: 'R4', m: 'R4',
  ',': 'R3',
  i: 'R3', k: 'R3',
  '.': 'R2',
  o: 'R2', l: 'R2',
  ';': 'R1',
  p: 'R1',
};

const FINGER_INFO = {
  L1: { name: '左手小指', color: '#ff6b9d' },
  L2: { name: '左手无名指', color: '#ffb020' },
  L3: { name: '左手中指', color: '#51ff9e' },
  L4: { name: '左手食指', color: '#4dd8ff' },
  R4: { name: '右手食指', color: '#4dd8ff' },
  R3: { name: '右手中指', color: '#51ff9e' },
  R2: { name: '右手无名指', color: '#ffb020' },
  R1: { name: '右手小指', color: '#ff6b9d' },
};

// 键盘布局：shift-l / shift-r 是左右两个 Shift 键
const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['shift-l', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', 'shift-r'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
];

// 各手指的基准键（手部示意图的手掌与指尖锚点）
const HOME_KEY = { L1: 'a', L2: 's', L3: 'd', L4: 'f', R4: 'j', R3: 'k', R2: 'l', R1: ';' };

// 基础键位：以基准键（asdfghjkl）为主的真实单词
const HOME_WORDS = [
  'add', 'dad', 'fad', 'gas', 'had', 'has', 'lag', 'lad', 'sad', 'sag',
  'ash', 'ask', 'dash', 'flag', 'flash', 'glad', 'glass', 'half', 'hall',
  'hash', 'jade', 'lash', 'salad', 'shall', 'slash', 'gala', 'fall', 'gall',
  'flask', 'gash', 'shad', 'slag', 'hag', 'jag', 'jags', 'halls', 'falls',
];

// 词组 / 句子：含空格、逗号、句点与大小写（只使用 a-z , . 和空格）
const PHRASES = [
  'The quick brown fox jumps.',
  'Practice makes perfect.',
  'Type fast, type well.',
  'Keep your fingers on the home row.',
  'A journey of a thousand miles.',
  'Better late than never.',
  'Time flies when you are typing.',
  'Good things come to those who wait.',
  'Learning to type is a skill.',
  'Stay hungry, stay foolish.',
  'The early bird catches the worm.',
  'Practice every day, and you will improve.',
  'Small steps lead to big changes.',
  'Focus on accuracy first, then speed.',
  'Do not look at the keyboard.',
  'Every expert was once a beginner.',
  'Push yourself, because no one else will.',
  'Slow and steady wins the race.',
  'Type with all ten fingers.',
  'Mistakes are proof that you are trying.',
];

const MODES = {
  home:    { id: 'home',    name: '基础键位', icon: '🎯', desc: '围绕基准键位 asdf jkl', items: HOME_WORDS, round: 20 },
  english: { id: 'english', name: '常用单词', icon: '🔤', desc: '3-6 字母高频词', items: [...WORDS.short, ...WORDS.mid], round: 20 },
  python:  { id: 'python',  name: 'Python',  icon: '🐍', desc: 'Python 关键字与内置', items: [...WORDS.python], round: 20 },
  phrase:  { id: 'phrase',  name: '词组句子', icon: '✍️', desc: '空格 · 逗号 · 句点 · 大小写', items: PHRASES, round: 10 },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 大写字母该按哪只手的小指（Opposite Shift） */
function shiftSideFor(ch) {
  const f = FINGER_OF[ch.toLowerCase()];
  return f && f.startsWith('L') ? 'shift-r' : 'shift-l';
}

/** 目标字符的按键标签（空格 / 逗号 / 句点等） */
function keyLabel(ch) {
  if (ch === ' ') return '空格';
  if (ch === ',') return '逗号';
  if (ch === '.') return '句点';
  return ch.toUpperCase();
}

export function showPractice({ onBack }) {
  const app = document.getElementById('app');

  const state = {
    mode: 'home',
    items: [],
    idx: 0,
    typed: 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    maxCombo: 0,
    startAt: 0,
    running: false,
    done: false,
  };

  app.innerHTML = `
  <div class="screen practice">
    <div class="screen-head">
      <button class="btn back" id="pr-back">← 返回</button>
      <h1>⌨️ 指法练习</h1>
      <div class="pr-modes" id="pr-modes">
        ${Object.values(MODES).map(m => `<button class="pr-mode ${m.id === state.mode ? 'picked' : ''}" data-mode="${m.id}" title="${m.desc}">${m.icon} ${m.name}</button>`).join('')}
      </div>
    </div>

    <div class="pr-stats" id="pr-stats">
      <div class="pr-stat"><b id="pr-wpm">0</b><span>WPM</span></div>
      <div class="pr-stat"><b id="pr-acc">100%</b><span>准确率</span></div>
      <div class="pr-stat"><b id="pr-combo">0</b><span>连击</span></div>
      <div class="pr-stat"><b id="pr-time">0.0s</b><span>用时</span></div>
      <div class="pr-stat"><b id="pr-progress">0/20</b><span>进度</span></div>
    </div>

    <div class="pr-arena">
      <div class="pr-word" id="pr-word"></div>
      <div class="pr-next" id="pr-next"></div>
      <div class="pr-caret-tip" id="pr-tip">开始输入即可计时</div>
    </div>

    <div class="pr-keyboard" id="pr-keyboard"></div>

    <div class="pr-result" id="pr-result" hidden></div>
  </div>`;

  const $ = id => app.querySelector('#' + id);
  const elWord = $('pr-word');
  const elNext = $('pr-next');
  const elTip = $('pr-tip');
  const elResult = $('pr-result');
  const elKeyboard = $('pr-keyboard');

  /* ---------------- 键盘 ---------------- */
  const renderKey = (k) => {
    if (k === 'shift-l' || k === 'shift-r') {
      return `<div class="pr-key pr-key-shift" data-key="${k}" style="--fc:#8a7dff"><span>⇧</span></div>`;
    }
    if (k === ' ') {
      return `<div class="pr-key pr-key-space" data-key=" " style="--fc:#b26bff"><span>SPACE</span></div>`;
    }
    const f = FINGER_OF[k];
    const c = f ? FINGER_INFO[f].color : '#7d93c0';
    const home = (k === 'f' || k === 'j') ? ' home-key' : '';
    const label = k === ',' ? ',' : k === '.' ? '.' : k === ';' ? ';' : k.toUpperCase();
    return `<div class="pr-key${home}" data-key="${k}" style="--fc:${c}"><span>${label}</span></div>`;
  };

  elKeyboard.innerHTML = KEY_ROWS.map(row => `
    <div class="pr-krow">${row.map(renderKey).join('')}</div>`).join('') + `
    <div class="pr-krow pr-krow-space">${renderKey(' ')}</div>`;

  const keyEls = new Map();
  elKeyboard.querySelectorAll('.pr-key').forEach(el => keyEls.set(el.dataset.key, el));

  /* ---------------- 手部指法示意图 ---------------- */
  // 线稿风双手铺在键盘上；当前手指会弯向真正要按的那个键并高亮
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let handSvg = null;
  let geom = null;                 // { starts, centerOf }
  const fingerEls = new Map();
  const detailEls = new Map();     // 每根手指的指节线/指甲，挖掉手指时一起隐藏

  /** 单根手指的轮廓关键点（按 x 排序，便于左右手统一拼接） */
  function fingerOutline(id, from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;        // 指向指尖
    const nx = -uy, ny = ux;                   // 法向
    const thumb = id.endsWith('0');
    const w0 = thumb ? 34 : 42;                // 指根
    const w1 = thumb ? 27 : 33;                // 指尖
    const pair = (x, y, w) => [
      [x - nx * w / 2, y - ny * w / 2],
      [x + nx * w / 2, y + ny * w / 2],
    ].sort((a, b) => a[0] - b[0]);
    const [bL, bR] = pair(from.x, from.y, w0);
    const [tL, tR] = pair(to.x, to.y, w1);
    // 指缝点：从指根朝指尖走 42% 处（真实手指下半段是连着的）
    const wk = 0.42;
    const wx = from.x + dx * wk, wy = from.y + dy * wk;
    const ww = w0 + (w1 - w0) * wk;
    const [wL, wR] = pair(wx, wy, ww);
    // 两个指节位置，用来画关节折痕
    const joints = [0.36, 0.66].map((k) => {
      const jx = from.x + dx * k, jy = from.y + dy * k;
      const jw = (w0 + (w1 - w0) * k) * 0.76;
      const [jl, jr] = pair(jx, jy, jw);
      return { l: jl, r: jr };
    });
    return { bL, bR, tL, tR, wL, wR, joints, tipExt: [to.x + ux * w1 * 0.55, to.y + uy * w1 * 0.55] };
  }

  const P = (pt) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;

  /**
   * 整只手的轮廓：四指 + 拇指 + 掌背 + 手腕，一笔画成
   * fingers 按「外侧 → 内侧」排序；skip 里的手指挖掉（当前要动的那个）
   */
  function handPath(fingers, side, palm, skip) {
    const list = fingers.filter(f => f.id !== skip);
    const y = palm.y;
    const q = (x, yy) => `${x.toFixed(1)} ${yy.toFixed(1)}`;
    const inner = (dx) => palm.x - side * dx;   // 拇指一侧
    const outer = (dx) => palm.x + side * dx;   // 小指一侧

    const d = [];
    let startPt = null;
    let prevWeb = null;
    list.forEach((f, i) => {
      const o = fingerOutline(f.id, f.from, f.to);
      // 左手自左向右走，右手自右向左走
      const webIn = side < 0 ? o.wL : o.wR;
      const webOut = side < 0 ? o.wR : o.wL;
      const tipIn = side < 0 ? o.tL : o.tR;
      const tipOut = side < 0 ? o.tR : o.tL;

      if (i === 0) {
        startPt = webIn;
        d.push(`M ${P(webIn)}`);
      } else {
        // 指缝：两指之间浅弧相连
        const cx = (prevWeb[0] + webIn[0]) / 2;
        const cy = Math.max(prevWeb[1], webIn[1]) + 14;
        d.push(`Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${P(webIn)}`);
      }
      d.push(`L ${P(tipIn)}`);
      d.push(`Q ${P(o.tipExt)} ${P(tipOut)}`);
      d.push(`L ${P(webOut)}`);
      prevWeb = webOut;
    });

    if (skip !== (side < 0 ? 'L0' : 'R0')) {
      // 拇指：从掌内侧斜伸出去
      d.push(`L ${q(inner(58), y - 12)}`);
      d.push(`Q ${q(inner(90), y - 6)} ${q(inner(86), y + 20)}`);
      d.push(`Q ${q(inner(64), y + 30)} ${q(inner(42), y + 22)}`);
    }
    // 内侧 → 手腕 → 外侧回到第一根手指
    d.push(`L ${q(inner(36), y + 34)}`);
    d.push(`L ${q(inner(36), y + 76)}`);
    d.push(`L ${q(outer(36), y + 76)}`);
    d.push(`L ${q(outer(36), y + 40)}`);
    d.push(`Q ${q(outer(78), y + 14)} ${P(startPt)}`);
    d.push('Z');
    return d.join(' ');
  }

  /** 单独一根手指的闭合轮廓（用于高亮的那根） */
  function fingerShape(id, from, to) {
    const o = fingerOutline(id, from, to);
    return `M ${P(o.bL)} L ${P(o.tL)} Q ${P(o.tipExt)} ${P(o.tR)} L ${P(o.bR)} Z`;
  }

  function buildHands() {
    if (handSvg) { handSvg.remove(); handSvg = null; }
    fingerEls.clear();
    const kb = elKeyboard.getBoundingClientRect();
    if (!kb.width || !kb.height || !keyEls.size) return;

    const W = kb.width, H = kb.height;
    const centerOf = (k) => {
      const el = keyEls.get(k);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - kb.left + r.width / 2, y: r.top - kb.top + r.height / 2 };
    };

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'hand-layer');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    const palmY = H - 74;
    const home = {
      L1: 'a', L2: 's', L3: 'd', L4: 'f',
      R4: 'j', R3: 'k', R2: 'l', R1: ';',
    };
    const leftPalm = { x: Math.round((centerOf('a').x + centerOf('f').x) / 2), y: palmY };
    const rightPalm = { x: Math.round((centerOf('j').x + centerOf(';').x) / 2), y: palmY };

    const starts = {};
    const hands = [];

    const addHand = (side, palm, order) => {
      // 左手自左向右排，右手自右向左排（外侧先）
      const offsets = side < 0 ? [-66, -22, 22, 66] : [66, 22, -22, -66];
      const fingers = order.map((id, i) => {
        const from = { x: palm.x + offsets[i], y: palm.y - 46 };
        const to = centerOf(home[id]);
        starts[id] = from;
        return { id, from, to };
      });
      // 拇指起点
      const thumbId = side < 0 ? 'L0' : 'R0';
      const space = centerOf(' ');
      starts[thumbId] = { x: palm.x + side * 62, y: palm.y - 6 };

      const palmEl = document.createElementNS(SVG_NS, 'path');
      palmEl.setAttribute('class', 'hand-palm');
      palmEl.setAttribute('d', handPath(fingers, side, palm, null));
      svg.appendChild(palmEl);

      // 指节折痕 + 指甲，让手更像手
      fingers.forEach(f => {
        const o = fingerOutline(f.id, f.from, f.to);
        const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;
        const parts = [];

        o.joints.forEach(j => {
          const cx = (j.l[0] + j.r[0]) / 2 + ux * 5;
          const cy = (j.l[1] + j.r[1]) / 2 + uy * 5;
          const cr = document.createElementNS(SVG_NS, 'path');
          cr.setAttribute('d', `M ${P(j.l)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${P(j.r)}`);
          cr.setAttribute('class', 'hand-detail');
          svg.appendChild(cr);
          parts.push(cr);
        });

        // 指甲：靠近指尖的小椭圆，沿手指方向
        const nailCx = f.from.x + dx * 0.9;
        const nailCy = f.from.y + dy * 0.9;
        const nail = document.createElementNS(SVG_NS, 'ellipse');
        nail.setAttribute('cx', nailCx.toFixed(1));
        nail.setAttribute('cy', nailCy.toFixed(1));
        nail.setAttribute('rx', (33 * 0.22).toFixed(1));
        nail.setAttribute('ry', (len * 0.06).toFixed(1));
        nail.setAttribute('transform', `rotate(${(Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(1)} ${nailCx.toFixed(1)} ${nailCy.toFixed(1)})`);
        nail.setAttribute('class', 'hand-nail');
        svg.appendChild(nail);
        parts.push(nail);

        detailEls.set(f.id, parts);
      });

      // 指节线：掌背顶部的一道浅弧
      const knuckle = document.createElementNS(SVG_NS, 'path');
      const ky = palm.y - 34;
      knuckle.setAttribute('d',
        `M ${(palm.x - side * 60).toFixed(1)} ${ky.toFixed(1)} Q ${palm.x.toFixed(1)} ${(ky + 12).toFixed(1)} ${(palm.x + side * 60).toFixed(1)} ${ky.toFixed(1)}`);
      knuckle.setAttribute('class', 'hand-detail');
      svg.appendChild(knuckle);

      hands.push({ side, palm, fingers, palmEl, thumbId });

      // 每根手指一个可叠加的高亮元素（默认隐藏）
      [...fingers.map(f => f.id), thumbId].forEach(id => {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('class', 'hand-finger');
        el.dataset.finger = id;
        el.style.display = 'none';
        svg.appendChild(el);
        fingerEls.set(id, el);
      });
    };

    // 左手：小指 → 食指；右手：小指 → 食指（外侧先行）
    addHand(-1, leftPalm, ['L1', 'L2', 'L3', 'L4']);
    addHand(1, rightPalm, ['R1', 'R2', 'R3', 'R4']);

    elKeyboard.appendChild(svg);
    handSvg = svg;
    geom = { starts, centerOf, hands };
    render();
  }

  /**
   * 高亮指定手指，并让它们伸向各自的目标键
   * @param activeIds 手指 id 数组
   * @param targets   Map<fingerId, key>
   */
  function updateHands(activeIds, targets) {
    if (!geom) return;
    // 把当前要动的手指从轮廓里挖掉，下面再用同样的几何画成蓝色补上，
    // 否则会出现「灰色的原位手指 + 蓝色的目标手指」双指重影
    geom.hands.forEach(h => {
      let skip = null;
      const hit = h.fingers.find(f => activeIds.includes(f.id));
      if (hit) skip = hit.id;
      else if (activeIds.includes(h.thumbId)) skip = h.thumbId;
      h.palmEl.setAttribute('d', handPath(h.fingers, h.side, h.palm, skip));
      // 被挖掉那根手指的指节线/指甲也要一起隐藏
      detailEls.forEach((parts, id) => {
        parts.forEach(el => { el.style.display = id === skip ? 'none' : ''; });
      });
    });

    // 2) 叠加高亮的那根手指，伸到真正要按的键
    fingerEls.forEach((el, id) => {
      const active = activeIds.includes(id);
      el.classList.toggle('is-active', active);
      if (!active) { el.style.display = 'none'; return; }
      el.style.display = '';
      const key = targets ? targets.get(id) : null;
      let to = key ? geom.centerOf(key) : null;
      if (key === ' ') to = to ? { x: to.x + (id === 'R0' ? 40 : -40), y: to.y } : null;
      if (to) el.setAttribute('d', fingerShape(id, geom.starts[id], to));
    });
  }

  /* ---------------- 流程 ---------------- */
  function newRound() {
    const mode = MODES[state.mode];
    state.items = shuffle(mode.items).slice(0, mode.round);
    state.idx = 0;
    state.typed = 0;
    state.correct = 0;
    state.wrong = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.startAt = 0;
    state.running = false;
    state.done = false;
    elResult.hidden = true;
    elResult.innerHTML = '';
    elTip.textContent = '开始输入即可计时';
    render();
    renderStats();
  }

  const currentItem = () => state.items[state.idx] || '';

  function render() {
    const item = currentItem();
    elWord.innerHTML = [...item].map((ch, i) => {
      const cls = i < state.typed ? 'done' : (i === state.typed ? 'cur' : 'rest');
      if (ch === ' ') return `<span class="sp ${cls}"> </span>`;
      const up = /[A-Z]/.test(ch) ? ' up' : '';
      return `<span class="${cls}${up}">${esc(ch)}</span>`;
    }).join('');
    elWord.classList.toggle('long', item.length > 14 && item.length <= 24);
    elWord.classList.toggle('xlong', item.length > 24);

    // 预览：句子模式只预览下一个
    const previewCount = state.mode === 'phrase' ? 1 : 3;
    elNext.innerHTML = state.items.slice(state.idx + 1, state.idx + 1 + previewCount)
      .map(w => `<span class="pr-preview">${esc(w)}</span>`).join('');

    // 下一个键 + 手指提示
    const nextCh = item[state.typed];
    keyEls.forEach(el => el.classList.remove('next-key'));
    const fingerTargets = new Map();
    if (nextCh) {
      const isUpper = /[A-Z]/.test(nextCh);
      const keyName = nextCh === ' ' ? ' ' : nextCh.toLowerCase();
      const keyEl = keyEls.get(keyName);
      if (keyEl) keyEl.classList.add('next-key');

      let shiftHint = '';
      if (isUpper) {
        const side = shiftSideFor(nextCh);
        const sEl = keyEls.get(side);
        if (sEl) sEl.classList.add('next-key');
        const sName = side === 'shift-r' ? '右手小指' : '左手小指';
        shiftHint = `<span class="pr-shift" style="color:#8a7dff">${sName} Shift</span> + `;
        fingerTargets.set(side === 'shift-r' ? 'R1' : 'L1', side);
      }

      // 空格交给右手拇指
      if (keyName === ' ') fingerTargets.set('R0', ' ');
      else {
        const f = FINGER_OF[keyName];
        if (f) fingerTargets.set(f, keyName);
      }

      const f = keyName === ' ' ? 'R0' : FINGER_OF[keyName];
      const info = f ? FINGER_INFO[f] : null;
      const fingerTxt = info ? `<span class="pr-finger" style="color:${info.color}">${info.name}</span> · ` : '';
      elTip.innerHTML = `${fingerTxt}${shiftHint}按 <b>${esc(keyLabel(nextCh))}</b>`;
    } else if (state.done) {
      elTip.textContent = '练习完成';
    }
    updateHands([...fingerTargets.keys()], fingerTargets);

    renderStats();
  }

  function renderStats() {
    const elapsed = state.startAt ? (performance.now() - state.startAt) / 1000 : 0;
    const mins = Math.max(elapsed / 60, 1 / 6000);
    const wpm = state.startAt ? Math.round((state.correct / 5) / mins) : 0;
    const total = state.correct + state.wrong;
    const acc = total ? Math.round((state.correct / total) * 100) : 100;
    const done = state.idx + (state.typed ? 1 : 0);
    $('pr-wpm').textContent = wpm;
    $('pr-acc').textContent = acc + '%';
    $('pr-combo').textContent = state.combo;
    $('pr-time').textContent = elapsed.toFixed(1) + 's';
    $('pr-progress').textContent = `${Math.min(done, state.items.length)}/${state.items.length}`;
  }

  function flashWrong() {
    elWord.classList.remove('wrong');
    void elWord.offsetWidth;
    elWord.classList.add('wrong');
    setTimeout(() => elWord.classList.remove('wrong'), 260);
  }

  function finish() {
    state.done = true;
    state.running = false;
    const elapsed = (performance.now() - state.startAt) / 1000;
    const mins = Math.max(elapsed / 60, 1 / 6000);
    const wpm = Math.round((state.correct / 5) / mins);
    const total = state.correct + state.wrong;
    const acc = total ? Math.round((state.correct / total) * 100) : 100;
    elResult.hidden = false;
    elResult.innerHTML = `
      <div class="pr-result-panel">
        <div class="pr-result-title">🎉 练习完成</div>
        <div class="pr-result-grid">
          <div class="rg"><b>${wpm}</b><span>WPM</span></div>
          <div class="rg"><b>${acc}%</b><span>准确率</span></div>
          <div class="rg"><b>${elapsed.toFixed(1)}s</b><span>用时</span></div>
          <div class="rg"><b>${state.maxCombo}</b><span>最高连击</span></div>
          <div class="rg"><b>${state.items.length}</b><span>完成数量</span></div>
          <div class="rg"><b>${state.wrong}</b><span>错误次数</span></div>
        </div>
        <div class="pr-result-btns">
          <button class="btn primary big" id="pr-again">🔁 再来一局</button>
          <button class="btn big" id="pr-menu">🏠 主菜单</button>
        </div>
      </div>`;
    elResult.querySelector('#pr-again').addEventListener('click', newRound);
    elResult.querySelector('#pr-menu').addEventListener('click', () => { cleanup(); onBack(); });
    sfx.win();
  }

  /* ---------------- 输入 ---------------- */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { cleanup(); onBack(); return; }
    // 保留原始大小写：词组模式要求大写必须按 Shift
    const ch = e.key;
    if ([...ch].length !== 1) return;
    e.preventDefault();
    if (state.done) return;

    const item = currentItem();
    if (!item) return;

    if (!state.running) { state.running = true; state.startAt = performance.now(); }

    if (item[state.typed] === ch) {
      state.typed++;
      state.correct++;
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      sfx.letter(state.combo);
      if (state.typed >= item.length) {
        state.idx++;
        state.typed = 0;
        if (state.idx >= state.items.length) { render(); finish(); return; }
        sfx.word();
      }
      render();
    } else {
      state.wrong++;
      state.combo = 0;
      sfx.miss();
      flashWrong();
      renderStats();
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  let timer = null;
  const onResize = () => buildHands();
  const cleanup = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (timer) clearInterval(timer);
  };

  app.querySelector('#pr-back').addEventListener('click', () => { cleanup(); onBack(); });

  app.querySelectorAll('.pr-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      app.querySelectorAll('.pr-mode').forEach(b => b.classList.toggle('picked', b === btn));
      newRound();
    });
  });

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  newRound();
  // 首帧布局完成后再画手（此时键位才有真实尺寸）
  requestAnimationFrame(() => buildHands());
  timer = setInterval(() => {
    if (state.done || !app.querySelector('#pr-wpm')) { clearInterval(timer); return; }
    renderStats();
  }, 200);
}
