/**
 * 指法练习：脱离对战，专注练键位与手速
 * - 逐字高亮、正确/错误即时反馈
 * - 虚拟键盘标注每个键该用哪根手指，并高亮下一个要按的键
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
  i: 'R3', k: 'R3',
  o: 'R2', l: 'R2',
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

const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

// 基础键位：以基准键（asdfghjkl）为主的真实单词
const HOME_WORDS = [
  'add', 'dad', 'fad', 'gas', 'had', 'has', 'lag', 'lad', 'sad', 'sag',
  'ash', 'ask', 'dash', 'flag', 'flash', 'glad', 'glass', 'half', 'hall',
  'hash', 'jade', 'lash', 'salad', 'shall', 'slash', 'gala', 'fall', 'gall',
  'flask', 'gash', 'shad', 'slag', 'hag', 'jag', 'jags', 'halls', 'falls',
];

const MODES = {
  home:    { id: 'home',    name: '基础键位', icon: '🎯', desc: '围绕基准键位 asdf jkl', words: HOME_WORDS },
  english: { id: 'english', name: '常用单词', icon: '🔤', desc: '3-6 字母高频词', words: [...WORDS.short, ...WORDS.mid] },
  python:  { id: 'python', name: 'Python',  icon: '🐍', desc: 'Python 关键字与内置', words: [...WORDS.python] },
};

const ROUND_WORDS = 20;   // 每局词数

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showPractice({ onBack }) {
  const app = document.getElementById('app');

  const state = {
    mode: 'home',
    words: [],
    idx: 0,
    typed: 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    maxCombo: 0,
    startAt: 0,
    running: false,
    done: false,
    bad: false,
  };

  app.innerHTML = `
  <div class="screen practice">
    <div class="screen-head">
      <button class="btn back" id="pr-back">← 返回</button>
      <h1>⌨️ 指法练习</h1>
      <div class="pr-modes" id="pr-modes">
        ${Object.values(MODES).map(m => `<button class="pr-mode ${m.id === state.mode ? 'picked' : ''}" data-mode="${m.id}">${m.icon} ${m.name}</button>`).join('')}
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
  elKeyboard.innerHTML = KEY_ROWS.map(row => `
    <div class="pr-krow">
      ${row.map(k => {
        const f = FINGER_OF[k];
        const c = f ? FINGER_INFO[f].color : '#7d93c0';
        const home = (k === 'f' || k === 'j') ? ' home-key' : '';
        return `<div class="pr-key${home}" data-key="${k}" style="--fc:${c}">
          <span>${k.toUpperCase()}</span>
        </div>`;
      }).join('')}
    </div>`).join('') + `
    <div class="pr-krow pr-krow-space"><div class="pr-key pr-key-space" data-key=" " style="--fc:#b26bff"><span>SPACE</span></div></div>`;

  const keyEls = new Map();
  elKeyboard.querySelectorAll('.pr-key').forEach(el => keyEls.set(el.dataset.key, el));

  /* ---------------- 流程 ---------------- */
  function newRound() {
    const pool = MODES[state.mode].words;
    const picked = shuffle(pool).slice(0, ROUND_WORDS);
    state.words = picked;
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

  function currentWord() { return state.words[state.idx] || ''; }

  function render() {
    const word = currentWord();
    elWord.innerHTML = [...word].map((ch, i) => {
      const cls = i < state.typed ? 'done' : (i === state.typed ? 'cur' : 'rest');
      return `<span class="${cls}">${esc(ch)}</span>`;
    }).join('');

    const upcoming = state.words.slice(state.idx + 1, state.idx + 4);
    elNext.innerHTML = upcoming.map(w => `<span class="pr-preview">${esc(w)}</span>`).join('');

    // 下一个键 + 手指提示
    const nextCh = word[state.typed];
    keyEls.forEach(el => el.classList.remove('next-key'));
    if (nextCh && keyEls.has(nextCh)) {
      const el = keyEls.get(nextCh);
      el.classList.add('next-key');
      const f = FINGER_OF[nextCh];
      const info = f ? FINGER_INFO[f] : null;
      elTip.innerHTML = info
        ? `<span class="pr-finger" style="color:${info.color}">${info.name}</span> · 按 <b>${esc(nextCh.toUpperCase())}</b>`
        : `按 <b>${esc(nextCh)}</b>`;
    } else if (state.done) {
      elTip.textContent = '练习完成';
    }
  }

  function renderStats() {
    const elapsed = state.startAt ? (performance.now() - state.startAt) / 1000 : 0;
    const mins = Math.max(elapsed / 60, 1 / 6000);
    const wpm = state.startAt ? Math.round((state.correct / 5) / mins) : 0;
    const total = state.correct + state.wrong;
    const acc = total ? Math.round((state.correct / total) * 100) : 100;
    $('pr-wpm').textContent = wpm;
    $('pr-acc').textContent = acc + '%';
    $('pr-combo').textContent = state.combo;
    $('pr-time').textContent = elapsed.toFixed(1) + 's';
    $('pr-progress').textContent = `${Math.min(state.idx + (state.typed ? 1 : 0), state.words.length)}/${state.words.length}`;
  }

  function flashWrong() {
    state.bad = true;
    elWord.classList.remove('wrong');
    void elWord.offsetWidth;
    elWord.classList.add('wrong');
    setTimeout(() => { state.bad = false; elWord.classList.remove('wrong'); }, 260);
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
          <div class="rg"><b>${state.words.length}</b><span>完成词数</span></div>
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
    const k = e.key.toLowerCase();
    if (k === 'escape') { cleanup(); onBack(); return; }
    if (k.length !== 1 || k < 'a' || k > 'z') return;
    e.preventDefault();
    if (state.done) return;

    const word = currentWord();
    if (!word) return;

    if (!state.running) { state.running = true; state.startAt = performance.now(); }

    if (word[state.typed] === k) {
      state.typed++;
      state.correct++;
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      sfx.letter(state.combo);
      if (state.typed >= word.length) {
        state.idx++;
        state.typed = 0;
        if (state.idx >= state.words.length) { render(); renderStats(); finish(); return; }
        sfx.word();
      }
      render();
    } else {
      state.wrong++;
      state.combo = 0;
      sfx.miss();
      flashWrong();
    }
    renderStats();
  }

  /* ---------------- 事件绑定 ---------------- */
  const cleanup = () => window.removeEventListener('keydown', onKey);

  app.querySelector('#pr-back').addEventListener('click', () => { cleanup(); onBack(); });

  app.querySelectorAll('.pr-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      app.querySelectorAll('.pr-mode').forEach(b => b.classList.toggle('picked', b === btn));
      newRound();
    });
  });

  window.addEventListener('keydown', onKey);
  newRound();
  // 每秒刷新计时
  const timer = setInterval(() => {
    if (state.done) { clearInterval(timer); return; }
    if (!app.querySelector('#pr-wpm')) { clearInterval(timer); return; }
    renderStats();
  }, 200);
}
