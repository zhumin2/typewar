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
  // 两只手用 SVG 画在键盘上，指尖落在基准键；当前要按的键对应的手指高亮
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let handSvg = null;
  const fingerEls = new Map();
  const baseD = new Map();   // 手指默认姿态
  const altD = new Map();    // 小指伸向 Shift 的姿态

  /** 上宽下窄的锥形手指路径（带轻微弯曲） */
  function fingerPath(id, from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;           // 法向
    const thumb = id.endsWith('0');
    const w0 = thumb ? 15 : 19;
    const w1 = thumb ? 11 : 13;
    const cx = (from.x + to.x) / 2 + dx * 0.18;
    const cy = (from.y + to.y) / 2;
    const p = (px, py) => `${px.toFixed(1)} ${py.toFixed(1)}`;
    return [
      `M ${p(from.x + nx * w0 / 2, from.y + ny * w0 / 2)}`,
      `Q ${p(cx + nx * w1 / 2, cy + ny * w1 / 2)} ${p(to.x + nx * w1 / 2, to.y + ny * w1 / 2)}`,
      `A ${(w1 / 2).toFixed(1)} ${(w1 / 2).toFixed(1)} 0 0 1 ${p(to.x - nx * w1 / 2, to.y - ny * w1 / 2)}`,
      `Q ${p(cx - nx * w0 / 2, cy - ny * w0 / 2)} ${p(from.x - nx * w0 / 2, from.y - ny * w0 / 2)}`,
      'Z',
    ].join(' ');
  }

  function buildHands() {
    if (handSvg) { handSvg.remove(); handSvg = null; }
    fingerEls.clear();
    baseD.clear();
    altD.clear();
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

    const palmY = H - 42;               // 手掌位于键盘下方留白区
    const leftKeys = ['a', 's', 'd', 'f'].map(centerOf);
    const rightKeys = ['j', 'k', 'l', ';'].map(centerOf);
    if (leftKeys.some(k => !k) || rightKeys.some(k => !k)) return;

    const leftPalm = { x: (leftKeys[0].x + leftKeys[3].x) / 2, y: palmY };
    const rightPalm = { x: (rightKeys[0].x + rightKeys[3].x) / 2, y: palmY };

    const addPalm = (p) => {
      const wrist = document.createElementNS(SVG_NS, 'rect');
      wrist.setAttribute('x', (p.x - 25).toFixed(1));
      wrist.setAttribute('y', (p.y + 12).toFixed(1));
      wrist.setAttribute('width', '50');
      wrist.setAttribute('height', '30');
      wrist.setAttribute('rx', '13');
      wrist.setAttribute('class', 'hand-palm');
      svg.appendChild(wrist);

      const e = document.createElementNS(SVG_NS, 'ellipse');
      e.setAttribute('cx', p.x.toFixed(1));
      e.setAttribute('cy', p.y.toFixed(1));
      e.setAttribute('rx', '52');
      e.setAttribute('ry', '26');
      e.setAttribute('class', 'hand-palm');
      svg.appendChild(e);
    };
    addPalm(leftPalm);
    addPalm(rightPalm);

    const addFinger = (id, from, to) => {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', fingerPath(id, from, to));
      el.setAttribute('class', 'hand-finger');
      el.dataset.finger = id;
      svg.appendChild(el);
      fingerEls.set(id, el);
      baseD.set(id, el.getAttribute('d'));
    };

    // 四指：从左/右依次铺开，指尖指向各自基准键
    const spread = (palm) => [-30, -10, 10, 30].map(dx => ({ x: palm.x + dx, y: palm.y - 22 }));
    const lStart = spread(leftPalm);
    const rStart = spread(rightPalm);
    ['L1', 'L2', 'L3', 'L4'].forEach((id, i) => addFinger(id, lStart[i], leftKeys[i]));
    ['R4', 'R3', 'R2', 'R1'].forEach((id, i) => addFinger(id, rStart[i], rightKeys[i]));

    // 拇指：搭在空格键
    const space = centerOf(' ');
    if (space) {
      addFinger('L0', { x: leftPalm.x + 30, y: palmY - 16 }, { x: space.x - 70, y: space.y });
      addFinger('R0', { x: rightPalm.x - 30, y: palmY - 16 }, { x: space.x + 70, y: space.y });
    }

    // 小指伸向 Shift 的姿态（仅用于大写字母时的提示）
    const shiftR = centerOf('shift-r');
    const shiftL = centerOf('shift-l');
    if (shiftR) altD.set('R1', fingerPath('R1', rStart[3], shiftR));
    if (shiftL) altD.set('L1', fingerPath('L1', lStart[0], shiftL));

    elKeyboard.appendChild(svg);
    handSvg = svg;
    // 手型建好后重绘一次，把「当前该用哪根手指」的高亮补上
    render();
  }

  /** 高亮指定手指；shiftFinger 为按 Shift 的那根小指，会伸向 Shift 键 */
  function updateHands(activeIds, shiftFinger) {
    fingerEls.forEach((el, id) => {
      const active = activeIds.includes(id);
      el.classList.toggle('is-active', active);
      const useAlt = active && id === shiftFinger && altD.has(id);
      el.setAttribute('d', useAlt ? altD.get(id) : (baseD.get(id) || el.getAttribute('d')));
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
    const activeFingers = [];
    let shiftFinger = null;
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
        shiftFinger = side === 'shift-r' ? 'R1' : 'L1';
        activeFingers.push(shiftFinger);
      }

      const f = FINGER_OF[keyName];
      if (f) activeFingers.push(f);
      const info = f ? FINGER_INFO[f] : null;
      const fingerTxt = info ? `<span class="pr-finger" style="color:${info.color}">${info.name}</span> · ` : '';
      elTip.innerHTML = `${fingerTxt}${shiftHint}按 <b>${esc(keyLabel(nextCh))}</b>`;
    } else if (state.done) {
      elTip.textContent = '练习完成';
    }
    updateHands(activeFingers, shiftFinger);

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
