/**
 * 特效系统：Canvas 粒子 / 浮动数字 / 弹道 / 屏震 / WebAudio 音效
 * 由战斗层的 rAF 循环驱动 FX.update(dt)
 */

const state = {
  canvas: null, ctx: null,
  parts: [],      // 粒子
  projs: [],      // 弹道
  root: null,     // 战斗根元素（浮动数字挂载点 & 屏震目标）
  dpr: 1,
  audio: null,
  muted: false,
};

/* ---------------- 音效 ---------------- */
function ac() {
  if (!state.audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.audio = new AC();
  }
  if (state.audio.state === 'suspended') state.audio.resume();
  return state.audio;
}

function tone(freq, dur, { type = 'sine', vol = 0.12, slide = 0, delay = 0 } = {}) {
  const ctx = ac();
  if (!ctx || state.muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  letter(combo) { tone(500 + Math.min(combo, 40) * 12, 0.06, { type: 'sine', vol: 0.07 }); },
  miss() { tone(130, 0.14, { type: 'square', vol: 0.09, slide: -50 }); },
  word() { tone(620, 0.1, { type: 'triangle', vol: 0.12, slide: 260 }); },
  magic() { tone(523, 0.1, { type: 'triangle', vol: 0.1 }); tone(659, 0.1, { type: 'triangle', vol: 0.1, delay: 0.07 }); tone(784, 0.14, { type: 'triangle', vol: 0.12, delay: 0.14 }); },
  escape() { tone(190, 0.28, { type: 'sawtooth', vol: 0.14, slide: -120 }); },
  hit() { tone(160, 0.09, { type: 'square', vol: 0.1, slide: -60 }); },
  skill() { tone(300, 0.22, { type: 'sawtooth', vol: 0.12, slide: 320 }); },
  deny() { tone(220, 0.09, { type: 'square', vol: 0.08, slide: -80 }); },
  tick() { tone(880, 0.05, { type: 'sine', vol: 0.06 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.13 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'sawtooth', vol: 0.1, delay: i * 0.16 })); },
};

/* ---------------- 初始化 ---------------- */
export function initFX(root, canvas) {
  state.root = root;
  state.canvas = canvas;
  state.ctx = canvas.getContext('2d');
  state.parts = [];
  state.projs = [];
  resizeFX();
}

export function resizeFX() {
  if (!state.canvas || !state.root) return;
  const r = state.root.getBoundingClientRect();
  state.dpr = Math.min(2, window.devicePixelRatio || 1);
  state.canvas.width = Math.max(1, r.width * state.dpr);
  state.canvas.height = Math.max(1, r.height * state.dpr);
  state.canvas.style.width = r.width + 'px';
  state.canvas.style.height = r.height + 'px';
}

/** 元素中心 → FX 画布坐标 */
export function posOf(el) {
  const c = state.canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top };
}

/* ---------------- 粒子 ---------------- */
export function burst(x, y, { color = '#0ff', count = 16, speed = 130, size = 3, life = 0.6, spread = Math.PI * 2, dir = 0 } = {}) {
  for (let i = 0; i < count; i++) {
    const a = dir + (Math.random() - 0.5) * spread;
    const v = speed * (0.4 + Math.random() * 0.8);
    state.parts.push({
      x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: life * (0.6 + Math.random() * 0.6), max: life,
      color, size: size * (0.5 + Math.random()),
    });
  }
}

export function sparkAt(el, color) {
  const p = posOf(el);
  burst(p.x, p.y, { color, count: 4, speed: 70, size: 2, life: 0.3 });
}

/* ---------------- 弹道 ---------------- */
/**
 * 从 (x1,y1) 飞到 (x2,y2)，到达时回调 onHit 并爆裂
 */
export function projectile(x1, y1, x2, y2, { color = '#0ff', dur = 0.45, size = 6, onHit = null, arc = 40 } = {}) {
  state.projs.push({ x1, y1, x2, y2, t: 0, dur, color, size, onHit, arc });
}

/* ---------------- 浮动数字 ---------------- */
export function float(text, x, y, cls = '') {
  if (!state.root) return;
  const c = state.canvas.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'float ' + cls;
  d.textContent = text;
  d.style.left = (x !== undefined ? x : c.width / 2) + 'px';
  d.style.top = (y !== undefined ? y : c.height / 2) + 'px';
  state.root.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
  setTimeout(() => d.remove(), 1400);
}

export function floatAtEl(el, text, cls) {
  const p = posOf(el);
  float(text, p.x, p.y, cls);
}

/* ---------------- 屏震 ---------------- */
let shakeT = 0;
export function shake(power = 1) {
  if (!state.root) return;
  shakeT = Math.max(shakeT, 0.22);
  state.root.classList.remove('shake');
  void state.root.offsetWidth;
  state.root.style.setProperty('--shake-px', (2 + power * 3) + 'px');
  state.root.classList.add('shake');
}

/* ---------------- 主循环 ---------------- */
export function updateFX(dt) {
  const { ctx, canvas, dpr } = state;
  if (!ctx) return;

  // 屏震计时
  if (shakeT > 0) {
    shakeT -= dt;
    if (shakeT <= 0 && state.root) state.root.classList.remove('shake');
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  ctx.globalCompositeOperation = 'lighter';

  // 粒子
  for (let i = state.parts.length - 1; i >= 0; i--) {
    const p = state.parts[i];
    p.life -= dt;
    if (p.life <= 0) { state.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 220 * dt;
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  // 弹道
  for (let i = state.projs.length - 1; i >= 0; i--) {
    const p = state.projs[i];
    p.t += dt / p.dur;
    if (p.t >= 1) {
      state.projs.splice(i, 1);
      burst(p.x2, p.y2, { color: p.color, count: 22, speed: 190, size: 3.5, life: 0.55 });
      if (p.onHit) p.onHit();
      continue;
    }
    const u = p.t;
    const x = p.x1 + (p.x2 - p.x1) * u;
    const y = p.y1 + (p.y2 - p.y1) * u - Math.sin(u * Math.PI) * p.arc;
    // 拖尾
    state.parts.push({
      x, y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
      life: 0.25, max: 0.25, color: p.color, size: p.size * 0.5,
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, p.size * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function clearFX() {
  state.parts = [];
  state.projs = [];
  if (state.canvas && state.ctx) {
    state.ctx.setTransform(1, 0, 0, 1, 0, 0);
    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }
  if (state.root) {
    state.root.querySelectorAll('.float').forEach(f => f.remove());
    state.root.classList.remove('shake');
  }
  state.root = null;
  state.canvas = null;
  state.ctx = null;
}
