/**
 * 特技系统：消耗校验、施放、效果结算（PVE 本地 / PVP 收发两套）
 */
import { SKILLS } from './data.js';
import { projectile, burst, floatAtEl, posOf, sfx } from './fx.js';

/** 检查某方第 idx 个特技是否可施放 */
export function canCast(b, side, idx) {
  const s = b.S[side];
  const sk = SKILLS[s.card.skills[idx]];
  if (b.over) return { ok: false, why: 'over' };
  // 净化类技能无视沉默，否则沉默无法被解除
  const canCleanse = !!(sk.eff && sk.eff.cleanse);
  if (b.t < s.silencedUntil && !canCleanse) return { ok: false, why: 'silenced' };
  if (s.cds[idx] > 0) return { ok: false, why: 'cd' };
  if (sk.cost.ap && s.ap < sk.cost.ap) return { ok: false, why: 'ap' };
  if (sk.cost.mp && s.mp < sk.cost.mp) return { ok: false, why: 'mp' };
  return { ok: true, sk };
}

/**
 * 施放特技（含资源扣除/冷却/特效/网络广播）
 * PVE：双方都在本地完整结算
 * PVP：仅本地玩家可调用；对己方增益立即生效，
 *      对敌方效果以"预测伤害"呈现并通过事件由对方权威结算
 */
export function castSkill(b, side, idx) {
  const chk = canCast(b, side, idx);
  if (!chk.ok) {
    if (side === 'me' && chk.why === 'silenced') {
      floatAtEl(b.ui.portrait.me, '🔇 被沉默！', 'f-mute');
    }
    return false;
  }
  const sk = chk.sk;
  const s = b.S[side];

  // 扣除资源、进冷却
  if (sk.cost.ap) s.ap -= sk.cost.ap;
  if (sk.cost.mp) s.mp -= sk.cost.mp;
  const cdMult = (side === 'foe' && b.mode === 'pve') ? b.foeCdMult : 1;
  s.cds[idx] = sk.cd * cdMult;

  const eff = { ...sk.eff };
  const isPvpMe = b.mode === 'pvp' && side === 'me';

  if (isPvpMe) {
    // 自身增益立即生效；伤害做预测展示；干扰类由对方结算
    applyEffectLocal(b, side, eff, { predicted: true });
    b.netSend({ t: 'evt', data: { kind: 'skill', id: sk.id, eff } });
  } else {
    applyEffectLocal(b, side, eff, {});
  }

  fxSkill(b, side, sk, eff);
  sfx.skill();
  return true;
}

/** 本地完整结算一套效果 */
export function applyEffectLocal(b, side, eff, { predicted = false } = {}) {
  const other = side === 'me' ? 'foe' : 'me';
  let dealt = 0;

  if (eff.dmg) dealt += b.damage(other, eff.dmg, { src: side, predicted });
  if (eff.multi) {
    for (let i = 1; i <= eff.multi.hits; i++) {
      b.after(eff.multi.gap * i, () => {
        if (b.over) return;
        b.damage(other, eff.multi.each, { src: side, predicted });
      });
    }
    dealt += eff.multi.each * eff.multi.hits; // 吸血按全额估算
  }
  if (eff.vamp && dealt > 0) b.heal(side, dealt);
  if (eff.heal) b.heal(side, eff.heal);
  if (eff.buff) b.setBuff(side, eff.buff);
  if (eff.shield) b.addShield(side, eff.shield.n, eff.shield.dur);

  if (!predicted) {
    if (eff.cleanse) b.applyCleanse(side);
    if (eff.slow) b.applySlow(other, eff.slow);
    if (eff.silence) b.applySilence(other, eff.silence);
    if (eff.dot) b.applyDot(other, eff.dot, side);
    if (eff.steal) b.applySteal(other, side, eff.steal);
    if (eff.chaos) b.applyChaos(other, eff.chaos);
  }
  return dealt;
}

/** PVP 受害方结算收到的效果（作用于"我"） */
export function applyReceivedEffect(b, eff) {
  let dealt = 0;
  if (eff.dmg) dealt += b.damage('me', eff.dmg, { src: 'foe' });
  if (eff.multi) {
    for (let i = 1; i <= eff.multi.hits; i++) {
      b.after(eff.multi.gap * i, () => {
        if (b.over) return;
        b.damage('me', eff.multi.each, { src: 'foe' });
      });
    }
  }
  if (eff.slow) b.applySlow('me', eff.slow);
  if (eff.silence) b.applySilence('me', eff.silence);
  if (eff.dot) b.applyDot('me', eff.dot, 'foe');
  if (eff.steal) b.applySteal('me', 'foe', eff.steal);
  if (eff.chaos) b.applyChaos('me', eff.chaos);
  return dealt;
}

/* ---------------- 特技视觉 ---------------- */
function fxSkill(b, side, sk, eff) {
  const me = side === 'me' ? 'me' : 'foe';
  const foe = me === 'me' ? 'foe' : 'me';
  // 优先锚定中央舞台上的角色，退化时才用状态栏头像
  const elMe = (b.ui.fighter && b.ui.fighter[me]) || b.ui.portrait[me];
  const elFoe = (b.ui.fighter && b.ui.fighter[foe]) || b.ui.portrait[foe];
  const from = posOf(elMe);
  const to = posOf(elFoe);

  // 施法者：举身 + 光环爆开
  if (b.animateFighter) b.animateFighter(me, 'casting', 720);

  floatAtEl(elMe, `${sk.icon} ${sk.name}`, 'f-skill');

  const hasFoeTarget = eff.dmg || eff.multi || eff.slow || eff.silence || eff.steal || eff.dot;
  if (hasFoeTarget) {
    // 稍等一拍，让施法动作先出来
    setTimeout(() => {
      if (b.over) return;
      projectile(from.x, from.y, to.x, to.y, {
        color: sk.color, dur: 0.42, size: 10, arc: 26,
        onHit: () => {
          if (b.animateFighter) b.animateFighter(foe, 'hurt', 380);
          if (b.clashFlash) b.clashFlash();
        },
      });
    }, 140);
  }
  if (eff.chaos) {
    const laneR = b.ui.laneEl[foe].getBoundingClientRect();
    const cx = laneR.left + laneR.width / 2, cy = laneR.top + laneR.height / 2;
    const cv = b.ui.canvas.getBoundingClientRect();
    burst(cx - cv.left, cy - cv.top, { color: sk.color, count: 40, speed: 220, size: 3, life: 0.9 });
    floatAtEl(b.ui.laneEl[foe], '🌀 词流被污染！', 'f-debuff');
  }
  if (eff.slow) floatAtEl(elFoe, '❄️ 词流减速！', 'f-debuff');
  if (eff.silence) floatAtEl(elFoe, '🔇 沉默！', 'f-debuff');
  if (eff.dot) floatAtEl(elFoe, eff.dot.kind === 'poison' ? '☠️ 中毒！' : '🌑 暗蚀！', 'f-debuff');
  if (eff.steal) floatAtEl(elMe, `🔮 窃取 ${eff.steal} MP`, 'f-mp');
  if (eff.buff) floatAtEl(elMe, eff.buff.kind === 'dmg' ? '💥 伤害提升！' : '⚡ 资源加速！', 'f-buff');
  if (eff.shield) { burst(from.x, from.y, { color: '#4dd8ff', count: 26, speed: 150, size: 3, life: 0.7 }); floatAtEl(elMe, `🛡️ 护盾 +${eff.shield.n}`, 'f-shield'); }
  if (eff.heal) floatAtEl(elMe, `+${eff.heal}`, 'f-heal');
}
