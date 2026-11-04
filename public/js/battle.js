/**
 * 战斗控制器：双方面板/资源/连击/普攻/特技/DoT/护盾/干扰
 * PVE 本地全模拟；PVP 本机权威模拟己方 + 快照/事件同步
 */
import { CARDS, SKILLS, CFG } from './data.js';
import { WordStream } from './words.js';
import { Lane, RemoteLane } from './engine.js';
import { initFX, resizeFX, updateFX, clearFX, posOf, burst, projectile, floatAtEl, sparkAt, shake, sfx } from './fx.js';
import { canCast, castSkill, applyEffectLocal, applyReceivedEffect } from './skills.js';
import { AIController } from './ai.js';

function sideState(cardId) {
  return {
    card: CARDS[cardId],
    hp: CARDS[cardId].hp, maxHp: CARDS[cardId].hp,
    ap: 30, mp: 20, maxAp: CFG.maxAp, maxMp: CFG.maxMp,
    combo: 0, maxCombo: 0,
    shield: 0, shieldUntil: 0,
    dotAcc: 0, dotT: 0,
    buffs: { dmgUntil: 0, gainUntil: 0, dmgMult: 1, gainMult: 1, slowUntil: 0, slowMult: 1 },
    dots: [],           // {dps, left, kind}
    silencedUntil: 0,
    cds: [0, 0, 0],
    stats: { correct: 0, wrong: 0, words: 0, dmgDealt: 0, escaped: 0 },
  };
}

export class Battle {
  /**
   * @param cfg { mode:'pve'|'pvp', myCard, foeCard, difficulty?, seed, net?, onEnd }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.seed = cfg.seed || (Math.random() * 2 ** 31) | 0;
    this.difficulty = cfg.difficulty || null;
    this.net = cfg.net || null;
    this.foeCdMult = this.difficulty ? this.difficulty.cdMult : 1;

    this.S = { me: sideState(cfg.myCard), foe: sideState(cfg.foeCard) };
    this.lanes = {};
    this.t = 0;              // 战斗时间（秒，进入 running 后累计）
    this.phase = 'idle';     // idle | countdown | running | over
    this.over = false;
    this._cd = CFG.countdown;
    this._raf = 0;
    this._last = 0;
    this._timers = [];
    this._snapT = 0;
    this._uiT = 0;
    this._countNum = -1;

    this.ui = {};            // DOM refs
    this.onKey = this.onKey.bind(this);
    this._frame = this._frame.bind(this);
  }

  /* ============ 挂载与启动 ============ */
  mount(container) {
    container.innerHTML = this.buildDOM();
    this.grabRefs(container);

    initFX(this.ui.root, this.ui.canvas);
    window.addEventListener('resize', resizeFX);

    // 词流：双方都是「左 → 右」，防线在右端
    this.lanes.me = new Lane({
      root: this.ui.laneEl.me, dir: +1,
      stream: new WordStream(this.seed, { vocab: this.cfg.vocab }),
      onDone: w => this.onWordDone('me', w),
      onEscape: w => this.onWordEscape('me', w),
      onExplode: w => this.onWordExplode('me', w),
      onLetter: (w, type) => this.onLetter('me', w, type),
    });
    this.lanes.me.setSlowProvider(() => this.S.me.buffs.slowMult && this.t < this.S.me.buffs.slowUntil ? this.S.me.buffs.slowMult : 1);

    if (this.mode === 'pve') {
      this.lanes.foe = new Lane({
        root: this.ui.laneEl.foe, dir: +1,
        stream: new WordStream((this.seed ^ 0x9E3779B9) >>> 0, { vocab: this.cfg.vocab }),
        onDone: w => this.onWordDone('foe', w),
        onEscape: w => this.onWordEscape('foe', w),
        onExplode: w => this.onWordExplode('foe', w),
        onLetter: (w, type) => this.onLetter('foe', w, type),
      });
      this.lanes.foe.setSlowProvider(() => this.S.foe.buffs.slowMult && this.t < this.S.foe.buffs.slowUntil ? this.S.foe.buffs.slowMult : 1);
      this.ai = new AIController(this, this.difficulty);
    } else {
      this.lanes.foe = new RemoteLane(this.ui.laneEl.foe, +1);
    }

    // 技能按钮
    this.bindSkillButtons();
    window.addEventListener('keydown', this.onKey);
    this.refreshUI(true);
  }

  start() {
    this.phase = 'countdown';
    this._cd = CFG.countdown;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
    // 看门狗：rAF 停摆（无头/后台节流环境）时以 60ms 间隔驱动帧
    this._watchdog = setInterval(() => {
      if (this.phase === 'over') return;
      const now = performance.now();
      if (now - this._last >= 55) this._frame(now);
    }, 60);
  }

  /* ============ DOM 构建 ============ */
  buildDOM() {
    const foeName = this.difficulty
      ? `${this.S.foe.card.name} · AI`
      : this.S.foe.card.name;
    const foeTag = this.difficulty ? this.difficulty.name : '对手';
    return `
    <div class="battle" id="battleRoot">
      <canvas class="fx-canvas"></canvas>
      <div class="battle-grid">
        <section class="side foe">
          <div class="status" id="st-foe">
            <div class="portrait" id="pf-foe" style="--pc:${this.S.foe.card.color}">${this.S.foe.card.icon}</div>
            <div class="info">
              <div class="name-row"><span class="pname">${foeName}</span><span class="tag">${foeTag}</span><span class="hp-num" id="hp-foe"></span></div>
              <div class="bar hp foe"><div class="fill" id="hpbar-foe"></div></div>
              <div class="res-row">
                <div class="bar res ap"><i>AP</i><div class="fill" id="apbar-foe"></div></div>
                <div class="bar res mp"><i>MP</i><div class="fill" id="mpbar-foe"></div></div>
              </div>
              <div class="buffs" id="buffs-foe"></div>
            </div>
            <div class="mini-skills" id="miniskill-foe"></div>
          </div>
          <div class="lane foe-lane" id="lane-foe"><div class="line"></div><div class="words"></div></div>
        </section>
        <div class="mid">
          <div class="stage" id="stage">
            <div class="stage-grid"></div>
            <div class="stage-hud">
              <span class="vs-badge">VS</span>
              <span class="timer" id="timer">00:00</span>
            </div>
            <div class="fighter foe" id="fighter-foe" style="--pc:${this.S.foe.card.color}">
              <div class="f-hp"><i id="fhp-foe"></i></div>
              <div class="sprite"><span class="aura"></span><span class="icon">${this.S.foe.card.icon}</span></div>
              <div class="ftag">${foeName}</div>
            </div>
            <div class="clash" id="clash"></div>
            <div class="fighter me" id="fighter-me" style="--pc:${this.S.me.card.color}">
              <div class="f-hp"><i id="fhp-me"></i></div>
              <div class="sprite"><span class="aura"></span><span class="icon">${this.S.me.card.icon}</span></div>
              <div class="ftag">${this.S.me.card.name}</div>
            </div>
          </div>
        </div>
        <section class="side me">
          <div class="lane me-lane" id="lane-me"><div class="line"></div><div class="words"></div></div>
          <div class="status mine" id="st-me">
            <div class="portrait" id="pf-me" style="--pc:${this.S.me.card.color}">${this.S.me.card.icon}</div>
            <div class="info">
              <div class="name-row"><span class="pname">${this.S.me.card.name}</span><span class="tag">你</span><span class="hp-num" id="hp-me"></span></div>
              <div class="bar hp me"><div class="fill" id="hpbar-me"></div></div>
              <div class="res-row">
                <div class="bar res ap"><i>AP</i><div class="fill" id="apbar-me"></div></div>
                <div class="bar res mp"><i>MP</i><div class="fill" id="mpbar-me"></div></div>
              </div>
              <div class="buffs" id="buffs-me"></div>
            </div>
            <div class="combo-box" id="combo-box"><span class="combo-num" id="combo-num">0</span><span class="combo-label">COMBO</span></div>
            <div class="skills" id="skills-me"></div>
          </div>
        </section>
      </div>
      <div class="countdown" id="countdown"></div>
      <div class="pause-layer" id="pause-layer" hidden>
        <div class="pause-panel">
          <div class="pause-title">⏸ 已暂停</div>
          <div class="pause-tip">按 <kbd>Esc</kbd> 继续 · 计时与词流已冻结</div>
        </div>
      </div>
      <div class="result-layer" id="result-layer"></div>
    </div>`;
  }

  grabRefs(container) {
    const $ = id => container.querySelector('#' + id);
    this.ui.root = $('battleRoot');
    this.ui.canvas = container.querySelector('.fx-canvas');
    this.ui.laneEl = { me: $('lane-me'), foe: $('lane-foe') };
    this.ui.portrait = { me: $('pf-me'), foe: $('pf-foe') };
    this.ui.hpbar = { me: $('hpbar-me'), foe: $('hpbar-foe') };
    this.ui.hpNum = { me: $('hp-me'), foe: $('hp-foe') };
    this.ui.apbar = { me: $('apbar-me'), foe: $('apbar-foe') };
    this.ui.mpbar = { me: $('mpbar-me'), foe: $('mpbar-foe') };
    this.ui.buffs = { me: $('buffs-me'), foe: $('buffs-foe') };
    this.ui.skills = $('skills-me');
    this.ui.miniSkills = $('miniskill-foe');
    this.ui.comboBox = $('combo-box');
    this.ui.comboNum = $('combo-num');
    this.ui.timer = $('timer');
    this.ui.countdown = $('countdown');
    this.ui.resultLayer = $('result-layer');
    // 中央舞台
    this.ui.stage = $('stage');
    this.ui.fighter = { me: $('fighter-me'), foe: $('fighter-foe') };
    this.ui.fighterHp = { me: $('fhp-me'), foe: $('fhp-foe') };
    this.ui.clash = $('clash');
    this.ui.pauseLayer = $('pause-layer');
  }

  /* ============ 暂停 ============ */
  togglePause(force) {
    if (this.over || this.phase === 'countdown') return;
    const next = force === undefined ? !this.paused : force;
    if (next === this.paused) return;
    this.paused = next;
    this.ui.pauseLayer.hidden = !next;
    if (next) sfx.deny(); else sfx.tick();
  }

  /* ============ 舞台角色动画 ============ */
  /** 给某一方角色加一次性动画类 */
  animateFighter(side, cls, ms = 420) {
    const el = this.ui.fighter && this.ui.fighter[side];
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // 重触发动画
    el.classList.add(cls);
    if (ms > 0) setTimeout(() => el.classList.remove(cls), ms);
  }

  /** 舞台中央的撞击闪光 */
  clashFlash() {
    const el = this.ui.clash;
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  bindSkillButtons() {
    const skills = this.S.me.card.skills;
    this.ui.skills.innerHTML = skills.map((id, i) => {
      const sk = SKILLS[id];
      const cost = sk.cost.ap ? `${sk.cost.ap} AP` : `${sk.cost.mp} MP`;
      const cls = sk.cost.ap ? 'c-ap' : 'c-mp';
      return `
      <button class="skill" data-idx="${i}" title="${sk.desc}">
        <span class="s-icon">${sk.icon}</span>
        <span class="s-name">${sk.name}</span>
        <span class="s-cost ${cls}">${cost}</span>
        <span class="s-key">${i + 1}</span>
        <span class="s-cd" style="display:none"></span>
      </button>`;
    }).join('');

    const foeSkills = this.S.foe.card.skills;
    this.ui.miniSkills.innerHTML = foeSkills.map(id => {
      const sk = SKILLS[id];
      return `<span class="mini-skill" data-sid="${id}" title="${sk.name}">${sk.icon}</span>`;
    }).join('');

    this.ui.skills.querySelectorAll('.skill').forEach(btn => {
      btn.addEventListener('click', () => this.tryCastMe(+btn.dataset.idx));
    });
  }

  /* ============ 主循环 ============ */
  _frame(ts) {
    if (this.phase === 'over') return;
    const dt = Math.min(0.1, Math.max(0, (ts - this._last) / 1000));
    this._last = ts;

    if (this.phase === 'countdown') {
      this._cd -= dt;
      const n = Math.ceil(this._cd - 0.2);
      if (n !== this._countNum) {
        this._countNum = n;
        this.ui.countdown.textContent = n > 0 ? n : '开打！';
        this.ui.countdown.classList.remove('pop');
        void this.ui.countdown.offsetWidth;
        this.ui.countdown.classList.add('pop');
        sfx.tick();
      }
      if (this._cd <= 0) {
        this.phase = 'running';
        this.ui.countdown.textContent = '';
      }
    } else if (this.phase === 'running' && !this.paused) {
      this.t += dt;
      this.lanes.me.update(dt);
      this.lanes.foe.update(dt);
      if (this.ai) this.ai.update(dt);
      this.tickSide('me', dt);
      this.tickSide('foe', dt);
      this.netTick(dt);
    }

    updateFX(this.paused ? 0 : dt);
    this._uiT -= dt;
    if (this._uiT <= 0) { this._uiT = 0.12; this.refreshUI(); }
    this._raf = requestAnimationFrame(this._frame);
  }

  tickSide(side, dt) {
    const s = this.S[side];
    for (let i = 0; i < 3; i++) s.cds[i] = Math.max(0, s.cds[i] - dt);

    // 护盾到期
    if (s.shield > 0 && this.t >= s.shieldUntil) s.shield = 0;

    // 被动资源
    const g = this.gainMult(side);
    s.ap = Math.min(s.maxAp, s.ap + CFG.apPassive * g * dt);
    s.mp = Math.min(s.maxMp, s.mp + CFG.mpPassive * g * dt);

    // DoT：按 0.4 秒聚合结算，避免每帧飘字刷屏
    if (s.dots.length) {
      let sum = 0;
      s.dots = s.dots.filter(d => {
        const step = Math.min(dt, Math.max(0, d.left));
        sum += d.dps * step;
        d.left -= dt;
        return d.left > 0;
      });
      s.dotAcc += sum;
      s.dotT -= dt;
      // 到点结算；DoT 结束时把残留尾数一次性补上，避免吞伤害
      const expiring = s.dots.length === 0;
      if ((s.dotT <= 0 && s.dotAcc >= 0.5) || (expiring && s.dotAcc > 0.1)) {
        const amt = s.dotAcc;
        s.dotAcc = 0;
        s.dotT = 0.4;
        this.damage(side, amt, { src: null, dot: true });
      }
    }
  }

  gainMult(side) {
    const s = this.S[side];
    return (this.t < s.buffs.gainUntil) ? s.buffs.gainMult : 1;
  }
  dmgMult(side) {
    const s = this.S[side];
    return (this.t < s.buffs.dmgUntil) ? s.buffs.dmgMult : 1;
  }

  /* ============ 打字回调 ============ */
  onLetter(side, word, type) {
    const s = this.S[side];
    if (type === 'hit') {
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.stats.correct++;
      const g = this.gainMult(side);
      s.ap = Math.min(s.maxAp, s.ap + CFG.apPerLetter * g);
      if (side === 'me') {
        sparkAt(word.el, word.magic ? '#b26bff' : word.gold ? '#ffd166' : word.bomb ? '#ff7a2f' : '#4dd8ff');
        sfx.letter(s.combo);
        this.popCombo();
      }
      // 连击里程碑：每累计 N 连击放一道冲击波
      if (s.combo > 0 && s.combo % CFG.comboMilestone === 0) {
        this.comboShockwave(side);
      }
    } else {
      s.combo = 0;
      s.stats.wrong++;
      if (side === 'me') sfx.miss();
    }
  }

  /** 连击里程碑冲击波 */
  comboShockwave(side) {
    const s = this.S[side];
    const foe = side === 'me' ? 'foe' : 'me';
    if (this.over || s.hp <= 0) return;
    const dmg = Math.round(6 + s.combo / 10);
    floatAtEl((this.ui.fighter && this.ui.fighter[side]) || this.ui.portrait[side],
      `🔥 ${s.combo} 连击冲击`, 'f-buff');
    this.strikeFoe(side, dmg, '#ffd166', true);
    sfx.magic();
  }

  /** 对敌方造成一次"自动"伤害（普攻/冲击波共用，含 PVP 预测与事件） */
  strikeFoe(side, dmg, color, isWave = false) {
    const foe = side === 'me' ? 'foe' : 'me';
    if (this.mode === 'pvp' && side === 'me') {
      this.netSend({ t: 'evt', data: { kind: 'atk', dmg } });
      this.S.foe.hp = Math.max(0, this.S.foe.hp - dmg);   // 预测值，快照会校正
    } else {
      this.damage(foe, dmg, { src: side });
    }
    const from = posOf(this.ui.fighter[side]);
    const to = posOf(this.ui.fighter[foe]);
    projectile(from.x, from.y, to.x, to.y, {
      color, dur: isWave ? 0.3 : 0.34, size: isWave ? 13 : 8,
      onHit: () => {
        this.animateFighter(foe, 'hurt', 380);
        this.clashFlash();
        const pt = posOf(this.ui.fighter[foe]);
        burst(pt.x, pt.y, { color, count: isWave ? 34 : 20, speed: isWave ? 340 : 260, size: 3.5, life: 0.5 });
        floatAtEl(this.ui.fighter[foe], `-${dmg}`, side === 'me' ? 'f-dmg' : 'f-dmg-to-me');
      },
    });
  }

  onWordDone(side, word) {
    const s = this.S[side];
    const foe = side === 'me' ? 'foe' : 'me';
    s.stats.words++;

    // 魔法词奖励 MP
    if (word.magic) {
      const g = this.gainMult(side);
      s.mp = Math.min(s.maxMp, s.mp + CFG.magicWordMp * g);
      if (side === 'me') { sfx.magic(); floatAtEl(word.el, `+${Math.round(CFG.magicWordMp * g)} MP`, 'f-mp'); }
    } else if (word.gold) {
      // 金词：直接把行动力顶上去
      const g = this.gainMult(side);
      const gain = Math.round(CFG.goldAp * g);
      s.ap = Math.min(s.maxAp, s.ap + gain);
      if (side === 'me') { sfx.magic(); floatAtEl(word.el, `+${gain} AP`, 'f-gold'); }
    } else if (side === 'me') sfx.word();

    // 普攻伤害
    const comboBonus = Math.min(s.combo, CFG.comboDamageCap) * 0.12;
    let dmg = Math.round((3 + word.text.length * 1.1 + comboBonus) * this.dmgMult(side) * (word.magic ? 1.25 : 1));

    if (this.mode === 'pvp' && side === 'me') {
      // 预测展示 + 发事件
      this.showAttack('me', word, dmg);
      this.netSend({ t: 'evt', data: { kind: 'atk', dmg } });
      const foeState = this.S.foe;
      foeState.hp = Math.max(0, foeState.hp - dmg); // 预测值，快照会校正
    } else {
      this.showAttack(side, word, dmg);
      // 伤害与统计由 damage() 内部统一处理，这里不要再累加
      this.damage(foe, dmg, { src: side });
    }
  }

  /** 炸弹词引信烧完：自伤 + 爆裂特效 */
  onWordExplode(side, word) {
    if (this.over) return;
    const target = (this.ui.fighter && this.ui.fighter[side]) || this.ui.portrait[side];
    const pt = posOf(target);
    burst(pt.x, pt.y, { color: '#ff7a2f', count: 40, speed: 320, size: 4, life: 0.7 });
    floatAtEl(target, '💥 爆炸！', 'f-dmg-to-me');
    if (side === 'me') { shake(1.6); sfx.escape(); }
    this.damage(side, CFG.bombDamage, { src: null, escape: true });
    void word;
  }

  showAttack(side, word, dmg) {
    const foe = side === 'me' ? 'foe' : 'me';
    const color = word.magic ? '#b26bff' : (side === 'me' ? '#4dd8ff' : '#ff5470');

    // 攻击方突进 + 光环爆闪
    this.animateFighter(side, 'attacking', 420);
    // 略微延迟，让突进先出来再飞弹
    setTimeout(() => {
      if (this.over) return;
      const from = posOf(this.ui.fighter[side]);
      const to = posOf(this.ui.fighter[foe]);
      // 挥砍：朝目标方向的扇形粒子
      const dir = Math.atan2(to.y - from.y, to.x - from.x);
      burst(from.x + Math.cos(dir) * 26, from.y + Math.sin(dir) * 26, {
        color, count: 16, speed: 210, size: 3, life: 0.34, spread: 1.1, dir,
      });
      projectile(from.x, from.y, to.x, to.y, {
        color, dur: 0.32, size: word.magic ? 10 : 8,
        onHit: () => {
          this.animateFighter(foe, 'hurt', 380);
          this.clashFlash();
          const pt = posOf(this.ui.fighter[foe]);
          burst(pt.x, pt.y, { color, count: 20, speed: 260, size: 3.5, life: 0.5 });
          floatAtEl(this.ui.fighter[foe], `-${dmg}`, side === 'me' ? 'f-dmg' : 'f-dmg-to-me');
        },
      });
    }, 80);
  }

  onWordEscape(side, word) {
    const s = this.S[side];
    s.stats.escaped++;
    this.damage(side, CFG.escapeDamage, { src: null, escape: true });
    if (side === 'me') sfx.escape();
  }

  popCombo() {
    const s = this.S.me;
    this.ui.comboNum.textContent = s.combo;
    this.ui.comboBox.classList.toggle('hot', s.combo >= 10);
    this.ui.comboBox.classList.remove('pop');
    void this.ui.comboBox.offsetWidth;
    this.ui.comboBox.classList.add('pop');
  }

  /* ============ 伤害 / 治疗 / 效果 ============ */
  damage(side, amount, { src = null, predicted = false, dot = false, escape = false } = {}) {
    if (amount <= 0) return 0;
    const s = this.S[side];
    // DoT 保留小数，避免每次结算取整反复丢伤害；普通伤害取整
    const amt = dot ? amount : Math.round(amount);
    const target = (this.ui.fighter && this.ui.fighter[side]) || this.ui.portrait[side];

    let remaining = amt;

    // 护盾吸收
    if (s.shield > 0) {
      const ab = Math.min(s.shield, remaining);
      s.shield -= ab;
      remaining -= ab;
      if (ab > 0 && !predicted) floatAtEl(target, `🛡️ -${Math.round(ab)}`, 'f-shield');
    }

    if (remaining > 0) {
      s.hp = Math.max(0, s.hp - remaining);
      if (!predicted) {
        this.animateFighter(side, 'hurt', 380);
        floatAtEl(target, `-${Math.max(1, Math.round(remaining))}`, side === 'me' ? 'f-dmg-to-me' : 'f-dmg');
        if (dot) sparkAt(target, '#7ddf64');
        if (side === 'me') { shake(escape ? 1.4 : 1); sfx.hit(); }
        else if (this.mode === 'pve') { sparkAt(target, '#ff5470'); this.clashFlash(); }
        if (src && this.S[src]) this.S[src].stats.dmgDealt += Math.round(remaining);
      }
    }

    // 死亡判定：仅权威状态（本地自己 / PVE 双方）
    if (!predicted && s.hp <= 0) this.handleDeath(side);
    return amt;
  }

  heal(side, n) {
    const s = this.S[side];
    const real = Math.min(s.maxHp - s.hp, Math.round(n));
    if (real > 0) {
      s.hp += real;
      const target = (this.ui.fighter && this.ui.fighter[side]) || this.ui.portrait[side];
      floatAtEl(target, `+${real}`, 'f-heal');
      const pt = posOf(target);
      burst(pt.x, pt.y, { color: '#51ff9e', count: 14, speed: 90, size: 2.5, life: 0.6 });
    }
  }

  setBuff(side, buff) {
    const s = this.S[side];
    if (buff.kind === 'dmg') { s.buffs.dmgMult = buff.mult; s.buffs.dmgUntil = this.t + buff.dur; }
    else { s.buffs.gainMult = buff.mult; s.buffs.gainUntil = this.t + buff.dur; }
  }

  addShield(side, n, dur) {
    const s = this.S[side];
    s.shield = Math.min(CFG.shieldCap, Math.max(s.shield, 0) + n);
    s.shieldUntil = this.t + dur;
  }

  applySlow(side, slow) {
    const s = this.S[side];
    s.buffs.slowMult = slow.mult;
    s.buffs.slowUntil = this.t + slow.dur;
    if (side === 'me' && this.mode === 'pvp') sfx.miss();
  }

  applySilence(side, dur) {
    const s = this.S[side];
    s.silencedUntil = this.t + dur;
  }

  /** 净化：清除减益（中毒/减速/沉默） */
  applyCleanse(side) {
    const s = this.S[side];
    const had = s.dots.length > 0 || this.t < s.buffs.slowUntil || this.t < s.silencedUntil;
    s.dots = [];
    s.dotAcc = 0;
    s.buffs.slowUntil = 0;
    s.buffs.slowMult = 1;
    s.silencedUntil = 0;
    if (had) {
      const target = (this.ui.fighter && this.ui.fighter[side]) || this.ui.portrait[side];
      floatAtEl(target, '✨ 已净化', 'f-buff');
    }
  }

  applyDot(side, dot, srcSide) {
    this.S[side].dots.push({ dps: dot.dps, left: dot.dur, kind: dot.kind });
  }

  applySteal(victim, thief, n) {
    const v = this.S[victim];
    const take = Math.min(n, v.mp);
    v.mp -= take;
    const t = this.S[thief];
    t.mp = Math.min(t.maxMp, t.mp + take);
    floatAtEl(this.ui.portrait[victim], `-${take} MP`, 'f-mp');
  }

  applyChaos(side, n) {
    const lane = this.lanes[side];
    if (lane && lane.injectChaos) lane.injectChaos(n);
    if (side === 'me') shake(1);
  }

  /* ============ 特技 ============ */
  tryCastMe(idx) {
    if (this.phase !== 'running' || this.over) return;
    castSkill(this, 'me', idx);
    this.refreshUI(true);
  }
  tryCastFoe(idx) {
    if (this.phase !== 'running' || this.over) return;
    castSkill(this, 'foe', idx);
  }

  /* ============ 网络（PVP） ============ */
  netSend(msg) {
    if (this.mode === 'pvp' && this.net) this.net.send(msg);
  }

  netTick(dt) {
    if (this.mode !== 'pvp') return;
    this._snapT -= dt;
    if (this._snapT <= 0) {
      this._snapT = 0.12;
      const s = this.S.me;
      this.netSend({ t: 'snap', data: {
        hp: s.hp, ap: Math.round(s.ap), mp: Math.round(s.mp),
        combo: s.combo, shield: Math.round(s.shield),
        cds: s.cds.map(c => Math.round(c * 10) / 10),
        silenced: Math.max(0, s.silencedUntil - this.t) > 0,
        words: this.lanes.me.serialize(),
      } });
    }
  }

  /** 收到对方快照 */
  remoteSnap(d) {
    if (this.over) return;
    const f = this.S.foe;
    f.hp = d.hp; f.ap = d.ap; f.mp = d.mp; f.combo = d.combo; f.shield = d.shield;
    if (d.cds) f.cds = d.cds;
    if (d.words && this.lanes.foe.sync) this.lanes.foe.sync(d.words);
    if (f.hp <= 0) this.handleDeath('foe');
  }

  /** 收到对方事件 */
  receive(evt) {
    if (this.over || !evt) return;
    if (evt.kind === 'atk') {
      this.damage('me', evt.dmg, { src: 'foe' });
      // 从对方词流区域打一发弹道到我方面板
      const foeLaneR = this.ui.laneEl.foe.getBoundingClientRect();
      const cv = this.ui.canvas.getBoundingClientRect();
      const from = { x: foeLaneR.left + foeLaneR.width * 0.8 - cv.left, y: foeLaneR.top + foeLaneR.height / 2 - cv.top };
      const to = posOf(this.ui.portrait.me);
      projectile(from.x, from.y, to.x, to.y, { color: '#ff5470', dur: 0.35, size: 6, onHit: () => {
        floatAtEl(this.ui.portrait.me, `-${evt.dmg}`, 'f-dmg-to-me');
      } });
    } else if (evt.kind === 'skill') {
      applyReceivedEffect(this, evt.eff);
      const sk = SKILLS[evt.id];
      if (sk) {
        const { floatAtEl: f2 } = { floatAtEl };
        f2(this.ui.portrait.foe, `${sk.icon} ${sk.name}`, 'f-skill');
        sfx.skill();
      }
    } else if (evt.kind === 'dead') {
      this.handleDeath('foe');
    }
  }

  handleDeath(side) {
    if (this.over) return;
    if (this.mode === 'pvp') {
      if (side === 'me') {
        this.netSend({ t: 'evt', data: { kind: 'dead' } });
        this.end('foe');
      } else {
        this.end('me');
      }
    } else {
      this.end(side === 'me' ? 'foe' : 'me');
    }
  }

  end(winner) {
    if (this.over) return;
    this.over = true;
    this.phase = 'over';
    this.winner = winner;
    // 舞台：败者倒地
    this.animateFighter(winner === 'me' ? 'foe' : 'me', 'ko', 0);
    if (winner === 'me') sfx.win(); else sfx.lose();
    cancelAnimationFrame(this._raf);
    clearInterval(this._watchdog);
    this._timers.forEach(clearTimeout);
    window.removeEventListener('keydown', this.onKey);
    // 结算数据
    const s = this.S.me;
    const mins = Math.max(this.t / 60, 1 / 60);
    const result = {
      winner,
      time: this.t,
      stats: {
        dmgDealt: s.stats.dmgDealt,
        wpm: Math.round(s.stats.correct / 5 / mins),
        acc: s.stats.correct + s.stats.wrong > 0 ? Math.round(s.stats.correct * 100 / (s.stats.correct + s.stats.wrong)) : 100,
        maxCombo: s.maxCombo,
        words: s.stats.words,
        escaped: s.stats.escaped,
      },
      foeHp: this.S.foe.hp, foeMaxHp: this.S.foe.maxHp,
      myHp: this.S.me.hp, myMaxHp: this.S.me.maxHp,
      foeStats: this.mode === 'pve' ? {
        wpm: Math.round(this.S.foe.stats.correct / 5 / mins),
        acc: this.S.foe.stats.correct + this.S.foe.stats.wrong > 0 ? Math.round(this.S.foe.stats.correct * 100 / (this.S.foe.stats.correct + this.S.foe.stats.wrong)) : 100,
        dmgDealt: this.S.foe.stats.dmgDealt,
      } : null,
    };
    setTimeout(() => this.cfg.onEnd && this.cfg.onEnd(result), 900);
  }

  /* ============ 输入 ============ */
  onKey(e) {
    if (this.over) return;
    // Esc 暂停/继续（倒计时阶段无效）
    if (e.key === 'Escape') { e.preventDefault(); this.togglePause(); return; }
    if (this.phase !== 'running' || this.paused) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key >= '1' && e.key <= '3') {
      e.preventDefault();
      this.tryCastMe(+e.key - 1);
      return;
    }
    const k = e.key.toLowerCase();
    if (k.length === 1 && k >= 'a' && k <= 'z') {
      e.preventDefault();
      this.lanes.me.input(k);
    }
  }

  /* ============ UI 刷新 ============ */
  refreshUI(force = false) {
    const pct = (v, m) => `${Math.max(0, Math.min(100, (v / m) * 100))}%`;
    for (const side of ['me', 'foe']) {
      const s = this.S[side];
      this.ui.hpbar[side].style.width = pct(s.hp, s.maxHp);
      this.ui.apbar[side].style.width = pct(s.ap, s.maxAp);
      this.ui.mpbar[side].style.width = pct(s.mp, s.maxMp);
      this.ui.hpNum[side].textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
      if (this.ui.fighterHp && this.ui.fighterHp[side]) {
        this.ui.fighterHp[side].style.width = pct(s.hp, s.maxHp);
      }
    }

    // 计时
    const m = Math.floor(this.t / 60), sec = Math.floor(this.t % 60);
    this.ui.timer.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    // 连击
    this.ui.comboNum.textContent = this.S.me.combo;
    this.ui.comboBox.classList.toggle('hot', this.S.me.combo >= 10);

    this.refreshSkillButtons();
    this.refreshBuffChips();
  }

  refreshSkillButtons() {
    const s = this.S.me;
    const btns = this.ui.skills.querySelectorAll('.skill');
    btns.forEach((btn, i) => {
      const chk = canCast(this, 'me', i);
      const cdEl = btn.querySelector('.s-cd');
      const cd = s.cds[i];
      if (cd > 0) {
        cdEl.style.display = '';
        const sk = SKILLS[s.card.skills[i]];
        cdEl.textContent = Math.ceil(cd);
        cdEl.style.setProperty('--cd-pct', Math.min(100, (cd / sk.cd) * 100) + '%');
      } else if (this.t < s.silencedUntil) {
        cdEl.style.display = '';
        cdEl.textContent = '🔇';
        cdEl.style.setProperty('--cd-pct', '100%');
      } else {
        cdEl.style.display = 'none';
      }
      btn.classList.toggle('ready', chk.ok);
      btn.classList.toggle('locked', !chk.ok);
    });

    // 敌方小技能冷却阴影
    const f = this.S.foe;
    const minis = this.ui.miniSkills.querySelectorAll('.mini-skill');
    minis.forEach((el, i) => {
      const onCd = f.cds[i] > 0 || this.t < f.silencedUntil;
      el.classList.toggle('on-cd', onCd);
      el.classList.toggle('usable', f.cds[i] <= 0 && this.t >= f.silencedUntil);
    });
  }

  refreshBuffChips() {
    for (const side of ['me', 'foe']) {
      const s = this.S[side];
      const chips = [];
      if (this.t < s.buffs.dmgUntil) chips.push(`<span class="chip buff-dmg">💥×${s.buffs.dmgMult} ${Math.ceil(s.buffs.dmgUntil - this.t)}s</span>`);
      if (this.t < s.buffs.gainUntil) chips.push(`<span class="chip buff-gain">⚡×${s.buffs.gainMult} ${Math.ceil(s.buffs.gainUntil - this.t)}s</span>`);
      if (s.shield > 0) chips.push(`<span class="chip buff-shield">🛡️${Math.ceil(s.shield)}</span>`);
      if (this.t < s.buffs.slowUntil) chips.push(`<span class="chip buff-slow">❄️减速 ${Math.ceil(s.buffs.slowUntil - this.t)}s</span>`);
      for (const d of s.dots) chips.push(`<span class="chip buff-dot">${d.kind === 'poison' ? '☠️' : '🌑'}${Math.ceil(d.left)}s</span>`);
      if (this.t < s.silencedUntil) chips.push(`<span class="chip buff-mute">🔇${Math.ceil(s.silencedUntil - this.t)}s</span>`);
      const html = chips.join('');
      if (this.ui.buffs[side].innerHTML !== html) this.ui.buffs[side].innerHTML = html;
    }
  }

  destroy() {
    this.over = true;
    this.phase = 'over';
    cancelAnimationFrame(this._raf);
    clearInterval(this._watchdog);
    this._timers.forEach(clearTimeout);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', resizeFX);
    if (this.lanes.me) this.lanes.me.destroy();
    if (this.lanes.foe) this.lanes.foe.destroy();
    clearFX();
  }
}
