/**
 * AI 对手：模拟打字（WPM/准确率） + 特技策略（4 档难度）
 * AI 通过与玩家完全相同的 Lane.input / tryCastFoe 接口操作
 */
import { AI_SKILL_POLICY, SKILLS } from './data.js';

export class AIController {
  constructor(battle, difficulty) {
    this.b = battle;
    this.p = difficulty;        // DIFFICULTIES[...]
    this.nextLetterAt = 1.6 + Math.random() * 0.8;  // 战斗时间轴（秒）
    this.nextSkillCheckAt = 2.5 + Math.random();
    this._target = null;
  }

  update(dt) {
    const b = this.b;
    if (b.over) return;
    // battle.t 已在 step 中推进；直接与 b.t 比较
    while (b.t >= this.nextLetterAt) {
      this.typeOne();
      const base = 60 / (this.p.wpm * 5);          // 每个字母的间隔
      this.nextLetterAt += base * (0.8 + Math.random() * 0.5);
    }
    if (b.t >= this.nextSkillCheckAt) {
      this.nextSkillCheckAt = b.t + 0.9 + Math.random() * 1.4;
      this.trySkill();
    }
  }

  /** 敲一个字母：优先打最接近防线的词 */
  typeOne() {
    const b = this.b;
    const lane = b.lanes.foe;
    if (!lane || lane.words.length === 0) {
      this.nextLetterAt = b.t + 0.35;   // 没词可打，稍等
      return;
    }
    // 目标：已锁定的词，否则最接近防线的词
    let target = lane.locked;
    if (!target || !target.alive) {
      target = null;
      for (const w of lane.words) {
        if (!target || lane.prog(w) > lane.prog(target)) target = w;
      }
    }
    if (!target) return;
    const want = target.text[target.typed];
    // 按准确率决定是否出错
    if (Math.random() > this.p.acc) {
      const wrong = 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
      lane.input(wrong === want ? (wrong === 'q' ? 'z' : 'q') : wrong);
    } else {
      lane.input(want);
    }
  }

  /** 技能策略：按卡片优先级 + 难度智商决定 */
  trySkill() {
    const b = this.b;
    if (Math.random() > this.p.skillIQ) return;
    const cardId = b.S.foe.card.id;
    const priority = AI_SKILL_POLICY[cardId] || [];
    const s = b.S.foe;
    const foeHpRatio = b.S.me.hp / b.S.me.maxHp;   // 对面（玩家）血量
    const myHpRatio = s.hp / s.maxHp;

    for (let i = 0; i < priority.length; i++) {
      const id = priority[i];
      const idx = b.S.foe.card.skills.indexOf(id);
      if (idx === -1) continue;
      const cdOk = s.cds[idx] <= 0 && b.t >= s.silencedUntil;
      if (!cdOk) continue;
      const sk = SKILLS[id];
      const affordable = !!sk && !(sk.cost.ap && s.ap < sk.cost.ap) && !(sk.cost.mp && s.mp < sk.cost.mp);
      if (!affordable) continue;

      // 情境判断
      let use = false;
      if (id === 'kai_wall' || id === 'ying_leech') use = myHpRatio < 0.5;
      else if (id === 'kai_shout' || id === 'feng_wind') use = Math.random() < 0.7;
      else if (id === 'li_drain') use = b.S.me.mp > 30 || s.mp < 25;
      else if (id === 'ying_chaos') use = b.lanes.me.words.length >= 3 || Math.random() < 0.4;
      else use = true;   // 纯输出技

      if (use) { b.tryCastFoe(idx); return; }
    }
  }
}
