/**
 * 界面渲染层（纯渲染，无业务状态）：
 * 主菜单 / PVE 配置 / PVP 加入 / PVP 大厅 / 战斗壳 / 结算
 * 状态与回调由 main.js 注入
 */
import { CARDS, SKILLS, DIFFICULTIES, VOCAB_MODES } from './data.js';

const app = () => document.getElementById('app');

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- 卡片网格 ---------------- */
function cardGridHTML(selectedId) {
  return Object.values(CARDS).map(c => {
    const skills = c.skills.map(id => {
      const sk = SKILLS[id];
      const cost = sk.cost.ap ? `${sk.cost.ap} AP` : `${sk.cost.mp} MP`;
      return `<div class="cs-row"><span class="cs-icon">${sk.icon}</span><span class="cs-name">${sk.name}</span><span class="cs-cost ${sk.cost.ap ? 'c-ap' : 'c-mp'}">${cost}</span></div>`;
    }).join('');
    return `
    <div class="card ${selectedId === c.id ? 'picked' : ''}" data-card="${c.id}" style="--pc:${c.color}">
      <div class="card-head"><span class="card-icon">${c.icon}</span>
        <div><div class="card-name">${c.name}</div><div class="card-title">${c.title}</div></div>
        <div class="card-hp">❤️ ${c.hp}</div>
      </div>
      <div class="card-desc">${esc(c.desc)}</div>
      <div class="card-skills">${skills}</div>
    </div>`;
  }).join('');
}

function bindCardGrid(root, onPick) {
  root.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => {
      root.querySelectorAll('.card').forEach(x => x.classList.remove('picked'));
      el.classList.add('picked');
      onPick(el.dataset.card);
    });
  });
}

/* ---------------- 主菜单 ---------------- */
export function showMenu({ onPve, onCreate, onJoin }) {
  app().innerHTML = `
  <div class="screen menu">
    <div class="logo">
      <div class="logo-main"><span class="t1">TYPE</span><span class="t2">WAR</span></div>
      <div class="logo-sub">打字聚气 · 特技碾压 · 击败对手</div>
    </div>
    <div class="menu-btns">
      <button class="mbtn primary" data-act="pve"><span class="mb-ico">🤖</span><span>单人挑战<small>PVE · 四档难度 AI</small></span></button>
      <button class="mbtn" data-act="create"><span class="mb-ico">🛰️</span><span>创建对战<small>PVP · 生成房间码邀请好友</small></span></button>
      <button class="mbtn" data-act="join"><span class="mb-ico">🔗</span><span>加入房间<small>PVP · 输入好友的房间码</small></span></button>
      <button class="mbtn ghost" data-act="help"><span class="mb-ico">📜</span><span>玩法说明<small>两分钟上手</small></span></button>
    </div>
    <div class="cards-strip">
      ${Object.values(CARDS).map(c => `<div class="strip-card" style="--pc:${c.color}"><span>${c.icon}</span><b>${c.name}</b></div>`).join('')}
    </div>
    <div class="menu-foot">需要实体键盘 · 建议使用 Chrome / Edge · 本机联机请开两个标签页</div>
  </div>
  ${helpModalHTML()}`;

  app().querySelector('[data-act="pve"]').addEventListener('click', onPve);
  app().querySelector('[data-act="create"]').addEventListener('click', onCreate);
  app().querySelector('[data-act="join"]').addEventListener('click', onJoin);
  app().querySelector('[data-act="help"]').addEventListener('click', () => toggleHelp(true));
  app().querySelector('.help-modal').addEventListener('click', e => {
    if (e.target.classList.contains('help-modal')) toggleHelp(false);
  });
  app().querySelector('.help-close').addEventListener('click', () => toggleHelp(false));
}

function helpModalHTML() {
  return `
  <div class="help-modal" hidden>
    <div class="help-panel">
      <h2>📜 玩法说明</h2>
      <div class="help-body">
        <p><b>⌨️ 打字 = 一切资源来源</b><br>你的词流防线会出现英文单词，直接敲字母击碎它们：</p>
        <ul>
          <li>每敲对一个字母 → <b class="ap">+行动力(AP)</b>，连击 +1</li>
          <li>敲完整个单词 → 自动发起<b>普攻</b>（伤害随词长和连击提升）</li>
          <li><b class="mp">紫色魔法词 ✦</b> → 击破后额外奖励大量<b class="mp">魔法力(MP)</b></li>
          <li><b style="color:#51ff9e">绿色代码词 &gt;</b> → Python 关键字/内置函数，打字不区分大小写（<code>True</code> 敲 <code>true</code> 即可）</li>
          <li>敲错字母 → 连击清零</li>
          <li>词漂到防线没打掉 → 你自己掉血！</li>
        </ul>
        <p><b>✨ 特技</b><br>按 <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 或点击技能按钮释放。不同人物卡拥有不同特技：爆发伤害、增益 buff、护盾、中毒、偷蓝，甚至向对手词流注入乱序干扰词！</p>
        <p><b>🤖 PVE</b>：选择难度与人物卡，击败 AI。<br><b>🛰️ PVP</b>：创建房间把房间码告诉好友，双方选卡就绪后开战。</p>
      </div>
      <button class="btn primary help-close">明白了</button>
    </div>
  </div>`;
}
function toggleHelp(show) {
  const m = app().querySelector('.help-modal');
  if (m) m.hidden = !show;
}

/* ---------------- PVE 配置 ---------------- */
export function showPveSetup({ onBack, onStart }) {
  let difficulty = null, card = null, vocab = 'mixed';
  app().innerHTML = `
  <div class="screen setup">
    <div class="screen-head"><button class="btn back">← 返回</button><h1>🤖 单人挑战</h1></div>
    <div class="setup-cols">
      <div class="setup-col">
        <h2>选择难度</h2>
        <div class="diff-list">
          ${Object.values(DIFFICULTIES).map(d => `
          <button class="diff" data-diff="${d.id}">
            <span class="d-ico">${d.icon}</span>
            <span class="d-txt"><b>${d.name}</b><small>${d.desc} · AI ${d.wpm} WPM</small></span>
          </button>`).join('')}
        </div>
        <h2 class="mt">选择词库</h2>
        <div class="vocab-list">
          ${Object.values(VOCAB_MODES).map(v => `
          <button class="vocab ${v.id === vocab ? 'picked' : ''}" data-vocab="${v.id}">
            <span class="v-ico">${v.icon}</span>
            <span class="v-txt"><b>${v.name}</b><small>${v.desc}</small></span>
          </button>`).join('')}
        </div>
      </div>
      <div class="setup-col">
        <h2>选择人物卡</h2>
        <div class="card-grid" id="pve-cards">${cardGridHTML(null)}</div>
      </div>
    </div>
    <div class="setup-foot">
      <button class="btn primary big" id="pve-start" disabled>选择难度与人物后开战</button>
    </div>
  </div>`;

  app().querySelector('.back').addEventListener('click', onBack);
  const diffBtns = app().querySelectorAll('.diff');
  diffBtns.forEach(b => b.addEventListener('click', () => {
    diffBtns.forEach(x => x.classList.remove('picked'));
    b.classList.add('picked');
    difficulty = b.dataset.diff;
    checkReady();
  }));
  const vocabBtns = app().querySelectorAll('.vocab');
  vocabBtns.forEach(b => b.addEventListener('click', () => {
    vocabBtns.forEach(x => x.classList.remove('picked'));
    b.classList.add('picked');
    vocab = b.dataset.vocab;
  }));
  bindCardGrid(app().querySelector('#pve-cards'), id => { card = id; checkReady(); });

  function checkReady() {
    const btn = app().querySelector('#pve-start');
    const ok = difficulty && card;
    btn.disabled = !ok;
    btn.textContent = ok ? `⚔️ 以 ${CARDS[card].name} 挑战「${DIFFICULTIES[difficulty].name}」开战！` : '选择难度与人物后开战';
  }
  app().querySelector('#pve-start').addEventListener('click', () => {
    if (difficulty && card) onStart(difficulty, card, vocab);
  });
}

/* ---------------- PVP：加入房间 ---------------- */
export function showJoin({ onBack, onJoinCode }) {
  app().innerHTML = `
  <div class="screen setup narrow">
    <div class="screen-head"><button class="btn back">← 返回</button><h1>🔗 加入房间</h1></div>
    <div class="join-box">
      <input id="join-code" maxlength="4" placeholder="输入 4 位房间码" autocomplete="off" spellcheck="false">
      <button class="btn primary big" id="join-go">加入</button>
    </div>
    <p class="hint">房间码由房主在「创建对战」后获得</p>
  </div>`;
  app().querySelector('.back').addEventListener('click', onBack);
  const input = app().querySelector('#join-code');
  setTimeout(() => input.focus(), 50);
  const go = () => {
    const code = input.value.trim().toUpperCase();
    if (code.length !== 4) return toast('请输入 4 位房间码');
    onJoinCode(code);
  };
  app().querySelector('#join-go').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

/* ---------------- PVP：大厅 ---------------- */
/**
 * @param p { code, self:{card,ready}, peer:{joined,card,ready}, onLeave, onCard, onReady }
 */
export function showLobby(p) {
  const foeArea = p.peer.joined
    ? (p.peer.card
      ? `<div class="peer-card picked" style="--pc:${CARDS[p.peer.card].color}">
           <span class="pc-icon">${CARDS[p.peer.card].icon}</span>
           <span>${CARDS[p.peer.card].name}</span>
           <span class="pc-state">${p.peer.ready ? '✅ 已就绪' : '⏳ 准备中'}</span>
         </div>`
      : `<div class="peer-card">对手正在选择人物…</div>`)
    : `<div class="peer-card waiting">等待玩家加入…<br><small>把房间码 <b>${p.code}</b> 告诉你的好友（本机测试：再开一个标签页）</small></div>`;

  app().innerHTML = `
  <div class="screen setup narrow">
    <div class="screen-head"><button class="btn back" id="lb-leave">← 退出房间</button><h1>🛰️ 对战大厅</h1></div>
    <div class="room-code-box"><small>房间码</small><div class="room-code">${p.code}</div></div>
    ${foeArea}
    <h2 class="mt">选择你的人物卡</h2>
    <div class="card-grid" id="lb-cards">${cardGridHTML(p.self.card)}</div>
    <div class="setup-foot">
      <button class="btn primary big" id="lb-ready" ${p.self.card ? '' : 'disabled'}>${p.self.ready ? '✅ 已就绪（点击取消）' : '✔ 就绪'}</button>
    </div>
  </div>`;

  app().querySelector('#lb-leave').addEventListener('click', p.onLeave);
  bindCardGrid(app().querySelector('#lb-cards'), id => p.onCard(id));
  app().querySelector('#lb-ready').addEventListener('click', () => p.onReady(!p.self.ready));
}

/* ---------------- 战斗壳 ---------------- */
export function showBattleScreen() {
  app().innerHTML = '';
}

/* ---------------- 结算 ---------------- */
export function showResult(result, { pvp, foeCard, onAgain, onMenu }) {
  const win = result.winner === 'me';
  const s = result.stats;
  const fmtTime = t => `${Math.floor(t / 60)} 分 ${Math.round(t % 60)} 秒`;
  const foeExtra = result.foeStats
    ? `<div class="vs-stats"><span>对手数据 · 输出 ${result.foeStats.dmgDealt} / ${result.foeStats.wpm} WPM / 准确 ${result.foeStats.acc}%${foeCard ? ' · ' + CARDS[foeCard].name : ''}</span></div>`
    : `<div class="vs-stats"><span>对手剩余血量：${result.foeHp} / ${result.foeMaxHp}${foeCard ? ' · ' + CARDS[foeCard].name : ''}</span></div>`;

  const layer = document.querySelector('#result-layer');
  if (!layer) return;
  layer.innerHTML = `
  <div class="result-panel ${win ? 'win' : 'lose'}">
    <div class="result-banner">${win ? '🏆 VICTORY' : '💀 DEFEAT'}</div>
    <div class="result-sub">${win ? '华丽的胜利！键盘就是你的武器。' : '惜败……再练练手速，胜利就在前方。'} · 战斗时长 ${fmtTime(result.time)}</div>
    <div class="result-grid">
      <div class="rg"><b>${s.dmgDealt}</b><span>总输出</span></div>
      <div class="rg"><b>${s.wpm}</b><span>WPM</span></div>
      <div class="rg"><b>${s.acc}%</b><span>准确率</span></div>
      <div class="rg"><b>${s.maxCombo}</b><span>最高连击</span></div>
      <div class="rg"><b>${s.words}</b><span>击破单词</span></div>
      <div class="rg"><b>${s.escaped}</b><span>漏词次数</span></div>
    </div>
    ${foeExtra}
    <div class="result-btns">
      <button class="btn primary big" id="rs-again">🔁 再战</button>
      <button class="btn big" id="rs-menu">🏠 主菜单</button>
    </div>
    <div class="result-wait" hidden>等待对方接受再战…</div>
  </div>`;

  layer.querySelector('#rs-menu').addEventListener('click', onMenu);
  layer.querySelector('#rs-again').addEventListener('click', () => {
    if (pvp) {
      onAgain();
      layer.querySelector('.result-wait').hidden = false;
      layer.querySelector('#rs-again').disabled = true;
    } else {
      onAgain();
    }
  });
}

/** PVP 再战等待提示（对方先点了再战） */
export function showPeerAgain() {
  const wait = document.querySelector('.result-wait');
  const btn = document.querySelector('#rs-again');
  if (wait) { wait.hidden = false; wait.textContent = '对方想要再战！点击「再战」接受'; }
  if (btn) { btn.textContent = '🔁 接受再战'; btn.disabled = false; }
}
