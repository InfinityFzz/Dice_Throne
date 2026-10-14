/**
 * 合法动作集 —— 架构 §2.2.3：「`legalActions` 由服务端下发」。
 *
 * 为什么要单独算一份而不是让 UI 猜：UI 只有 PlayerView（看不到 phase 的内部约束、
 * 看不到 CP 与 tier 差价的真实口径），靠 `pendingKind` 猜按钮必然出现「按钮点了被拒」。
 * 这里按与 `reduce()` **完全相同的守卫**推导集合，因此「UI 上可见」⇔「引擎会接受」。
 *
 * 输出带 `enabled` 与 `reason`：不可执行的动作（如 CP 不足）仍然下发，但灰显并给出原因，
 * 让玩家知道「为什么现在不能点」，而不是按钮凭空消失。
 */
import type { EntityId, Seat } from '../types/core.js';
import type { Action } from '../types/action.js';
import type { GameState } from '../types/state.js';
import type { ContentRegistry } from '../content/registry.js';
import type { LegalActionView } from '../types/view.js';
import { computeCandidates } from './engine.js';
import { Draft, evalCondition } from './effects.js';

type Drafted = Draft;

function push(out: LegalActionView[], a: LegalActionView): void {
  out.push(a);
}

/** 防御掷骰动作：多个防御能力时按官方「掷骰前二选一」逐能力下发（单能力保持原样） */
function defensiveRollActions(d: Drafted, defender: Seat, out: LegalActionView[]): void {
  const defs = d.content.getHero(d.player(defender).heroId).abilities.filter((a) => a.kind === 'defensive');
  if (defs.length > 1) {
    for (const a of defs) {
      push(out, { t: 'defensiveRoll', abilityId: a.id, label: `防御掷骰 · ${a.name}`, enabled: true });
    }
  } else {
    push(out, { t: 'defensiveRoll', label: '防御掷骰', enabled: true });
  }
}

/** 掷骰阶段可用动作（pending=abilityAnnounce 或 phase=offensiveRoll） */
function rollActions(d: Drafted, seat: Seat, out: LegalActionView[]): void {
  const p = d.player(seat);
  if (p.rollAttemptsLeft > 0) {
    push(out, { t: 'performRoll', label: `掷骰（剩 ${p.rollAttemptsLeft} 次）`, enabled: true });
  } else {
    push(out, { t: 'performRoll', label: '掷骰', enabled: false, reason: '掷骰次数已用尽' });
  }
  // 锁定/解锁：仅在已掷出骰子时有意义
  p.diceValues.forEach((v, i) => {
    push(out, {
      t: 'toggleLock', index: i,
      label: `${p.diceLocked[i] ? '解锁' : '锁定'}骰 ${i + 1}（${v}）`,
      enabled: true,
    });
  });
  for (const c of computeCandidates(d, seat)) {
    const slot = d.content.getHero(p.heroId).abilities.find((a) => a.id === c.abilityId);
    push(out, {
      t: 'announceAbility', abilityId: c.abilityId,
      label: `激活 ${slot?.name ?? c.abilityId}（L${c.tier ?? 1}）`,
      enabled: true,
    });
  }
  push(out, { t: 'passAbility', label: '放弃激活', enabled: true });
}

/** 主要阶段可用动作（main1 / main2） */
function mainActions(d: Drafted, seat: Seat, out: LegalActionView[]): void {
  const p = d.player(seat);
  const hero = d.content.getHero(p.heroId);

  for (const c of p.hand) {
    const def = d.content.getCard(c.defId);
    const afford = p.cp >= def.costCp;
    // 打出门槛（CardDef.playIf，如 headBash 的「已对对手造成 ≥8」）：
    // 与 reduce 的守卫同口径 —— 不满足则灰显并给原因，点击会被引擎拒绝。
    const gated = def.playIf ? evalCondition(d, def.playIf, seat) : true;
    push(out, {
      t: 'playCard', uid: c.uid, label: `打出 ${def.name}（${def.costCp} CP）`,
      enabled: afford && gated,
      ...(afford ? {} : { reason: `CP 不足（需 ${def.costCp}）` }),
      ...(gated ? {} : { reason: '打出门槛未满足' }),
    });
    push(out, { t: 'sellCard', uid: c.uid, label: `卖掉 ${def.name}（+1 CP）`, enabled: true });
  }

  for (const slot of hero.abilities) {
    const cur = p.upgrades[slot.id] ?? 1;
    const curTier = slot.tiers.find((t) => t.level === cur);
    for (const t of slot.tiers) {
      if (t.level <= cur) continue;
      const cost = t.upgradeCostCP - (curTier?.upgradeCostCP ?? 0);
      const afford = p.cp >= cost;
      push(out, {
        t: 'buyUpgrade', abilityId: slot.id, tier: t.level as 1 | 2 | 3,
        label: `升级 ${slot.name} → L${t.level}（${cost} CP）`,
        enabled: afford, ...(afford ? {} : { reason: `CP 不足（需 ${cost}）` }),
      });
    }
  }

  push(out, { t: 'endMainPhase', label: d.s.phase === 'main1' ? '结束阶段（进入掷骰）' : '结束回合', enabled: true });
}

/**
 * 计算 seat 当前可执行的动作集。与 reduce() 的守卫保持一致：
 * - 有 pending 时，只有 pending.seat 能动，且动作受 pending.kind 约束；
 * - 无 pending 时，非行动方只能做防守动作（防御掷骰 / 响应放弃）。
 */
export function computeLegalActions(d: Drafted, seat: Seat): LegalActionView[] {
  const out: LegalActionView[] = [];
  if (d.s.finished) return out;

  const pend = d.s.pending;

  if (pend) {
    if (pend.seat !== seat) return out;
    switch (pend.kind) {
      case 'abilityAnnounce':
        rollActions(d, seat, out);
        return out;
      case 'defensiveRoll':
        defensiveRollActions(d, seat, out);
        return out;
      case 'defenseWindow': {
        // 防御重掷窗口：可打出 preDefense 时机卡，或 pass 结算。
        // 只认 preDefense：postDefense 卡（headBash）依赖「伤害已落定」，属攻方 main2 窗口（O-1）。
        const p = d.player(seat);
        for (const c of p.hand) {
          const def = d.content.getCard(c.defId);
          if (!def.timing.includes('preDefense')) continue;
          const afford = p.cp >= def.costCp;
          push(out, {
            t: 'playCard', uid: c.uid, label: `打出 ${def.name}（${def.costCp} CP）`,
            enabled: afford, ...(afford ? {} : { reason: `CP 不足（需 ${def.costCp}）` }),
          });
        }
        push(out, { t: 'respondPass', label: '结算防御（不再打卡）', enabled: true });
        return out;
      }
      case 'cardWindow':
        if (d.s.phase === 'main1' || d.s.phase === 'main2') mainActions(d, seat, out);
        else push(out, { t: 'endMainPhase', label: '结束阶段', enabled: true });
        return out;
      case 'discard':
        // uids 由 UI 依据手牌选择后填；这里只声明动作可用
        push(out, { t: 'discardCards', label: '弃牌至上限', enabled: true });
        return out;
      case 'choice':
      case 'optionalPrompt':
      case 'chooseDice':
      case 'knockdownPay':
      case 'upkeepOrder':
        for (const o of pend.options) {
          push(out, { t: 'chooseOption', optionId: o.id, label: o.label, enabled: true });
        }
        return out;
    }
  }

  if (seat !== d.s.activeSeat) {
    if (d.s.phase === 'defensiveRoll') {
      defensiveRollActions(d, seat, out);
    }
    return out;
  }

  switch (d.s.phase) {
    case 'main1':
    case 'main2':
      mainActions(d, seat, out);
      break;
    case 'offensiveRoll':
      rollActions(d, seat, out);
      break;
    case 'defensiveRoll':
      defensiveRollActions(d, seat, out);
      break;
    case 'discard':
      push(out, { t: 'discardCards', label: '弃牌至上限', enabled: true });
      break;
    default:
      break; // upkeep / income / setup / gameOver：无玩家动作
  }
  return out;
}

/** 对外（投影 / 服务端 / UI）入口：从 GameState 直接算。 */
export function getLegalActions(state: GameState, content: ContentRegistry, seat: Seat): LegalActionView[] {
  return computeLegalActions(new Draft(state, content), seat);
}

/** 供 UI 把 LegalActionView 还原成真正的 Action（未填字段按引擎要求补全）。 */
export function toAction(v: LegalActionView, extra?: { uids?: readonly EntityId[]; optionId?: string }): Action | null {
  switch (v.t) {
    case 'performRoll': return { t: 'performRoll' };
    case 'toggleLock': return v.index === undefined ? null : { t: 'toggleLock', index: v.index };
    case 'announceAbility': return v.abilityId === undefined ? null : { t: 'announceAbility', abilityId: v.abilityId };
    case 'passAbility': return { t: 'passAbility' };
    case 'defensiveRoll': return { t: 'defensiveRoll', ...(v.abilityId ? { abilityId: v.abilityId } : {}) };
    case 'playCard': return v.uid === undefined ? null : { t: 'playCard', uid: v.uid };
    case 'sellCard': return v.uid === undefined ? null : { t: 'sellCard', uid: v.uid };
    case 'buyUpgrade':
      return v.abilityId === undefined || v.tier === undefined
        ? null
        : { t: 'buyUpgrade', abilityId: v.abilityId, tier: v.tier };
    case 'endMainPhase': return { t: 'endMainPhase' };
    case 'discardCards': return { t: 'discardCards', uids: extra?.uids ?? [] };
    case 'chooseOption': {
      const id = v.optionId ?? extra?.optionId;
      return id === undefined ? null : { t: 'chooseOption', optionId: id };
    }
    case 'respondPass': return { t: 'respondPass' };
    default: return null;
  }
}
