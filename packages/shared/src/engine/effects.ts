/**
 * 效果执行器 —— 架构 ADR-003。
 *
 * 硬约束：EffectDef 中禁止闭包；所有行为通过 EFFECT_HANDLERS 注册表查找。
 * next 用 pushFront 保序（"本效果的后续"，不是"排到全局队尾"）。
 */
import type {
  Condition, EffectClause, EffectDef, Expr, Seat, Sym, TargetRef,
} from '../types/core.js';
import type { CardInstance, PendingRequest, PlayerState, StatusInstance, DamageBucket } from '../types/state.js';
import type { GameEvent } from '../types/action.js';
import type { ContentRegistry } from '../content/registry.js';
import { addDamage, addHeal, addAvoid, addPrevention, addPendingRecoil } from './bucket.js';
import { nextInt } from './rng.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface DraftPlayer extends Mutable<Omit<PlayerState,
  'hand' | 'deck' | 'discard' | 'statuses' | 'diceValues' | 'diceLocked' | 'permissionTokens' | 'upgrades'>> {
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];
  statuses: StatusInstance[];
  diceValues: number[];
  diceLocked: boolean[];
  permissionTokens: { id: string; seat: Seat; reason: 'ultimate' | 'stun' | 'system'; releaseAt: 'cleanup' | 'turnEnd' }[];
  upgrades: Record<string, number>;
}

export interface DraftState extends Mutable<Omit<import('../types/state.js').GameState,
  'players' | 'bucket' | 'windows' | 'bindings' | 'tempDice'>> {
  players: [DraftPlayer, DraftPlayer];
  bucket: DamageBucket;
  windows: { stack: import('../types/state.js').ResponseWindow[]; nextSeq: number };
  bindings: Record<string, number>;
  tempDice: number[];
}

export const MAX_FRAMES_PER_RESOLUTION = 512;

export class Draft {
  readonly s: DraftState;
  readonly events: GameEvent[] = [];
  pending: PendingRequest | null = null;

  constructor(state: import('../types/state.js').GameState, readonly content: ContentRegistry) {
    this.s = structuredClone(state) as unknown as DraftState;
  }

  player(seat: Seat): DraftPlayer { return this.s.players[seat]; }
  other(seat: Seat): Seat { return seat === 0 ? 1 : 0; }

  emit(type: GameEvent['type'], payload: Record<string, unknown>, visibility: GameEvent['visibility'] = { v: 'public' }): void {
    this.events.push({
      seq: this.s.seq++,
      type,
      turn: this.s.turn,
      phase: this.s.phase,
      visibility,
      payload,
    });
  }

  /** 骰值 → 符号（一颗骰可能有多符号） */
  diceSymbols(seat: Seat): Sym[] {
    const p = this.player(seat);
    const hero = this.content.getHero(p.heroId);
    return p.diceValues.flatMap((v) => {
      const face = hero.dieFaces.find((f) => f.value === v);
      return face ? [...face.symbols] : [];
    });
  }

  tempSymbols(seat: Seat = this.s.activeSeat): Sym[] {
    const hero = this.content.getHero(this.player(seat).heroId);
    return this.s.tempDice.flatMap((v) => {
      const face = hero.dieFaces.find((f) => f.value === v);
      return face ? [...face.symbols] : [];
    });
  }

  toState(): import('../types/state.js').GameState {
    return this.s as unknown as import('../types/state.js').GameState;
  }
}

export function resolveTarget(d: Draft, ref: TargetRef, seat: Seat): Seat {
  switch (ref.r) {
    case 'self': return seat;
    case 'opponent': return d.other(seat);
    case 'active': return d.s.activeSeat;
    case 'attacker': return d.s.activeSeat;
    case 'defender': return d.other(d.s.activeSeat);
  }
}

export function evalExpr(d: Draft, expr: Expr, seat: Seat): number {
  if (typeof expr === 'number') return expr;
  switch (expr.e) {
    case 'statusStacks': {
      const s = resolveTarget(d, expr.target, seat);
      return d.player(s).statuses.find((st) => st.id === expr.status)?.stacks ?? 0;
    }
    case 'countSymbol': {
      // tempDice 存在时属于「当前骰池」，池骰归属由调用方 seat 决定（防御掷骰时 seat=防守方）
      const syms = d.s.tempDice.length > 0 ? d.tempSymbols(seat) : d.diceSymbols(seat);
      return syms.filter((s) => s === expr.symbol).length;
    }
    case 'sumFaces':
      return d.s.tempDice.reduce((a, b) => a + b, 0);
    case 'cp': return d.player(resolveTarget(d, expr.target, seat)).cp;
    case 'hp': return d.player(resolveTarget(d, expr.target, seat)).hp;
    case 'var': return d.s.bindings[expr.name] ?? 0;
    case 'incomingDamage': {
      // 防御窗口语义：bucket 中 target 的待结算可防御伤害（与 prevention 的作用口径一致）
      const to = resolveTarget(d, expr.target, seat);
      return d.s.bucket.entries
        .filter((e) => e.toSeat === to && e.bucketKind === 'defendable')
        .reduce((acc, e) => acc + e.amount, 0);
    }
    case 'add': return evalExpr(d, expr.a, seat) + evalExpr(d, expr.b, seat);
    case 'sub': return evalExpr(d, expr.a, seat) - evalExpr(d, expr.b, seat);
    case 'mul': return evalExpr(d, expr.a, seat) * evalExpr(d, expr.b, seat);
    case 'min': return Math.min(evalExpr(d, expr.a, seat), evalExpr(d, expr.b, seat));
    case 'max': return Math.max(evalExpr(d, expr.a, seat), evalExpr(d, expr.b, seat));
    case 'ceilDiv': {
      const b = evalExpr(d, expr.b, seat);
      return b === 0 ? 0 : Math.ceil(evalExpr(d, expr.a, seat) / b);
    }
    case 'floorDiv': {
      // 官方 MoonElf Missed Me L1「每 2 支箭 → 1 点伤害」：⌊箭数/2⌋（与 ceilDiv 同口径，b=0 归 0）
      const b = evalExpr(d, expr.b, seat);
      return b === 0 ? 0 : Math.floor(evalExpr(d, expr.a, seat) / b);
    }
  }
}

export function evalCondition(d: Draft, cond: Condition, seat: Seat): boolean {
  switch (cond.c) {
    case 'always': return true;
    case 'statusPresent': {
      const s = resolveTarget(d, cond.target, seat);
      const stacks = d.player(s).statuses.find((st) => st.id === cond.status)?.stacks ?? 0;
      const need = cond.minStacks ? evalExpr(d, cond.minStacks, seat) : 1;
      return stacks >= need;
    }
    case 'hpCompare': {
      const hp = d.player(resolveTarget(d, cond.target, seat)).hp;
      const v = evalExpr(d, cond.value, seat);
      switch (cond.op) {
        case '<': return hp < v;
        case '<=': return hp <= v;
        case '>': return hp > v;
        case '>=': return hp >= v;
      }
      return false;
    }
    case 'damageDealtAtLeast':
      return d.player(seat).turnDamageDealt >= evalExpr(d, cond.value, seat);
    case 'diceSymbolAtLeast': {
      const syms = d.s.tempDice.length > 0 ? d.tempSymbols(seat) : d.diceSymbols(seat);
      return syms.filter((s) => s === cond.symbol).length >= cond.min;
    }
    case 'nOfAKind': {
      // 骰值轴：防御上下文（tempDice 在场）看防御骰，否则看行动方主骰池
      const target = cond.target ? resolveTarget(d, cond.target, seat) : seat;
      const values = d.s.tempDice.length > 0 ? d.s.tempDice : d.player(target).diceValues;
      const counts = new Map<number, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const n of counts.values()) if (n >= cond.n) return true;
      return false;
    }
    case 'boundAtLeast': return (d.s.bindings[cond.name] ?? 0) >= cond.min;
    case 'boundCompare': {
      const a = d.s.bindings[cond.a] ?? 0;
      const b = d.s.bindings[cond.b] ?? 0;
      switch (cond.op) {
        case '>=': return a >= b;
        case '>': return a > b;
        case '<=': return a <= b;
        case '<': return a < b;
      }
      return false;
    }
    case 'and': return cond.of.every((c) => evalCondition(d, c, seat));
    case 'not': return !evalCondition(d, cond.of, seat);
  }
}

function addStatus(d: Draft, seat: Seat, statusId: string, stacks: number): void {
  if (stacks <= 0) return;
  const p = d.player(seat);
  const def = d.content.getStatus(statusId);
  const cap = p.statusCapOverrides[statusId] ?? def?.stackLimit ?? 99;
  const idx = p.statuses.findIndex((s) => s.id === statusId);
  if (idx >= 0) {
    const cur = p.statuses[idx] as StatusInstance;
    // sinceTurn 不重置：官方 FAQ「第二个实例无法获得，原实例弃置时序不变」
    p.statuses[idx] = { id: statusId, stacks: Math.min(cap, cur.stacks + stacks), sinceTurn: cur.sinceTurn };
  } else {
    p.statuses.push({ id: statusId, stacks: Math.min(cap, stacks), sinceTurn: d.s.turn });
  }
  d.emit('statusChanged', { seat, statusId, delta: stacks });
}

function removeStatus(d: Draft, seat: Seat, statusId: string | 'any', stacks: number): number {
  const p = d.player(seat);
  let removed = 0;
  if (statusId === 'any') {
    // 优先移除负面状态，其次按字典序（确定性）
    const order = [...p.statuses].sort((a, b) => {
      const da = d.content.getStatus(a.id);
      const db = d.content.getStatus(b.id);
      const na = da?.polarity === 'negative' ? 0 : 1;
      const nb = db?.polarity === 'negative' ? 0 : 1;
      return na !== nb ? na - nb : a.id.localeCompare(b.id);
    });
    for (const target of order) {
      if (removed >= stacks) break;
      const idx = p.statuses.findIndex((s) => s.id === target.id);
      if (idx < 0) continue;
      const cur = p.statuses[idx] as StatusInstance;
      const take = Math.min(cur.stacks, stacks - removed);
      removed += take;
      if (cur.stacks - take <= 0) p.statuses.splice(idx, 1);
      else p.statuses[idx] = { id: cur.id, stacks: cur.stacks - take };
    }
  } else {
    const idx = p.statuses.findIndex((s) => s.id === statusId);
    if (idx >= 0) {
      const cur = p.statuses[idx] as StatusInstance;
      const take = Math.min(cur.stacks, stacks);
      removed = take;
      if (cur.stacks - take <= 0) p.statuses.splice(idx, 1);
      else p.statuses[idx] = { id: cur.id, stacks: cur.stacks - take };
    }
  }
  if (removed > 0) d.emit('statusChanged', { seat, statusId, delta: -removed });
  return removed;
}

/**
 * 在目标状态列表里找第一个携带指定 onAttacked 字段的状态（引擎只认契约、不认具体 id）。
 * 逐字段查找是有意的：bonusDamage 与 attackerGainsCp 独立求值，不能因「另一个字段缺失」
 * 而漏发（官方 TARGETED 只有 bonusDamage；反向的纯 CP 状态同样可能）。
 */
function findOnAttackedHook(d: Draft, seat: Seat, field: 'bonusDamage' | 'attackerGainsCp') {
  return d.player(seat).statuses
    .map((st) => ({ st, onAttacked: d.content.getStatus(st.id)?.onAttacked }))
    .find((x) => x.onAttacked?.[field] !== undefined);
}

export type Handler = (d: Draft, clause: never, seat: Seat) => readonly EffectDef[] | void;

export const EFFECT_HANDLERS: Record<EffectClause['kind'], (d: Draft, clause: EffectClause, seat: Seat) => readonly EffectDef[] | void> = {
  dealDamage(d, c, seat) {
    if (c.kind !== 'dealDamage') return;
    const to = resolveTarget(d, c.to, seat);
    const amount = evalExpr(d, c.amount, seat);
    // 官方 Bounty 类挂钩（StatusDef.onAttacked 通用契约，引擎不认具体状态 id）：
    // attack 类型伤害瞄准带此状态的目标 → 按契约逐字段独立生效（官方 FAQ：
    // 对手防御中 prevent/avoid 多少都不影响，入桶即触发）。直接 addDamage，不走
    // dealDamage clause，避免自递归。amount>0 才触发（「必须激活造成至少 1 点伤害的攻击」）。
    if (c.damageType === 'attack' && amount > 0 && c.sourceKind !== 'ultimate') {
      // 官方 Shadows 类（StatusDef.onAttacked.avoid 通用契约）：被普通攻击瞄准 →
      // 全避 defendable（bucket avoid 只清 defendable+collateral，天然不碰 undefendable/pure；
      // Ultimate 经 sourceKind:'ultimate' 豁免）。与 Bounty 加成可共存——
      // 官方：攻击仍「成功」、其他效果照常发生（加伤入桶后被 avoid 清掉，CP 照发）。
      const avoider = d.player(to).statuses
        .find((s) => d.content.getStatus(s.id)?.onAttacked?.avoid === true);
      if (avoider) {
        d.s.bucket = addAvoid(d.s.bucket, to);
        d.emit('note', { kind: 'log', text: `${d.content.getStatus(avoider.id)?.name ?? avoider.id}：避开本次攻击伤害` });
      }
      // ★ bonusDamage 与 attackerGainsCp **逐字段独立定位、独立生效**（有哪个字段就生效哪个）：
      //   历史上两者总是一起出现（Bounty），但官方 TARGETED 只有 bonusDamage、将来也可能
      //   出现只有 CP 的状态。若只用 bonusDamage 定位状态，纯 CP 状态会被漏发。
      //   每字段各取状态数组顺序中第一个携带它的状态（官方均为 limit 1，不叠加）。
      const withBonus = findOnAttackedHook(d, to, 'bonusDamage');
      const withCp = findOnAttackedHook(d, to, 'attackerGainsCp');
      const parts: string[] = [];
      if (withBonus?.onAttacked?.bonusDamage !== undefined) {
        const bonus = evalExpr(d, withBonus.onAttacked.bonusDamage, seat);
        d.s.bucket = addDamage(d.s.bucket, bonus, 'attack', to, seat, 'ability');
        parts.push(`${d.content.getStatus(withBonus.st.id)?.name ?? withBonus.st.id}：攻击者伤害增加 ${bonus}`);
      }
      if (withCp?.onAttacked?.attackerGainsCp !== undefined) {
        const cpGain = evalExpr(d, withCp.onAttacked.attackerGainsCp, seat);
        const attacker = d.player(seat);
        attacker.cp = Math.min(15, attacker.cp + cpGain);
        parts.push(`${d.content.getStatus(withCp.st.id)?.name ?? withCp.st.id}：攻击者获得 ${cpGain} CP`);
      }
      if (parts.length > 0) {
        d.emit('note', { kind: 'log', text: parts.join('；') });
      }
    }
    // 条件不可防御（官方 Smack 4-of-a-kind）：effectWalk 时按当前骰池判定
    const damageType = c.undefendableIf && evalCondition(d, c.undefendableIf, seat)
      ? 'undefendable' as const
      : c.damageType;
    d.s.bucket = addDamage(d.s.bucket, amount, damageType, to, seat, c.sourceKind ?? 'ability');
    d.emit('note', { kind: 'damageQueued', to, amount, damageType, sourceKind: c.sourceKind ?? 'ability' });
    // 条件反噬（官方 Reckless）：flush 时按 triggerToSeat 的 net ≥ 1 决定是否生效
    if (c.recoilOnHit) {
      const recoilTo = resolveTarget(d, c.recoilOnHit.to, seat);
      d.s.bucket = addPendingRecoil(d.s.bucket, {
        fromSeat: seat, toSeat: recoilTo, triggerToSeat: to, amount: evalExpr(d, c.recoilOnHit.amount, seat),
      });
    }
  },
  heal(d, c, seat) {
    if (c.kind !== 'heal') return;
    const to = resolveTarget(d, c.to, seat);
    d.s.bucket = addHeal(d.s.bucket, to, evalExpr(d, c.amount, seat));
  },
  preventDamage(d, c, seat) {
    if (c.kind !== 'preventDamage') return;
    const to = resolveTarget(d, c.to, seat);
    d.s.bucket = addPrevention(d.s.bucket, to, evalExpr(d, c.amount, seat));
  },
  avoidDamage(d, c, seat) {
    if (c.kind !== 'avoidDamage') return;
    d.s.bucket = addAvoid(d.s.bucket, resolveTarget(d, c.to, seat));
  },
  gainCp(d, c, seat) {
    if (c.kind !== 'gainCp') return;
    const p = d.player(resolveTarget(d, c.to, seat));
    p.cp = Math.min(15, p.cp + evalExpr(d, c.amount, seat)); // CP 上限 15
  },
  loseCp(d, c, seat) {
    if (c.kind !== 'loseCp') return;
    const p = d.player(resolveTarget(d, c.to, seat));
    p.cp = Math.max(0, p.cp - evalExpr(d, c.amount, seat));
  },
  drawCards(d, c, seat) {
    if (c.kind !== 'drawCards') return;
    const p = d.player(resolveTarget(d, c.to, seat));
    const n = evalExpr(d, c.amount, seat);
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        // 牌库空 → 洗弃牌堆重开
        const { items, rng } = shuffleFromDraft(d, `shuffle:${seat}`, p.discard);
        d.s.rng = rng;
        p.deck = items;
        p.discard = [];
        if (p.deck.length === 0) break;
      }
      const card = p.deck.shift();
      if (card) p.hand.push(card);
    }
  },
  discardCards(d, c, seat) {
    if (c.kind !== 'discardCards') return;
    const p = d.player(resolveTarget(d, c.to, seat));
    const n = Math.min(evalExpr(d, c.amount, seat), p.hand.length);
    for (let i = 0; i < n; i++) {
      const idx = c.mode === 'random'
        ? (nextInt(d.s.rng, 'misc', p.hand.length).value)
        : 0;
      const [card] = p.hand.splice(idx, 1);
      if (card) p.discard.push(card);
    }
  },
  inflictStatus(d, c, seat) {
    if (c.kind !== 'inflictStatus') return;
    addStatus(d, resolveTarget(d, c.to, seat), c.status, evalExpr(d, c.stacks, seat));
  },
  removeStatus(d, c, seat) {
    if (c.kind !== 'removeStatus') return;
    const to = resolveTarget(d, c.to, seat);
    const removed = removeStatus(d, to, c.status, evalExpr(d, c.stacks, seat));
    // ★ 必须返回实际移除数，不能预先计算（受 Stack Limit 与目标选择影响）
    if (c.bindRemovedTo) d.s.bindings[c.bindRemovedTo] = removed;
  },
  transferStatus(d, c, seat) {
    if (c.kind !== 'transferStatus') return;
    const from = resolveTarget(d, c.from, seat);
    const to = resolveTarget(d, c.to, seat);
    if (c.status === 'any') {
      // 'any'：与 removeStatus 同序（负面优先，其次字典序）取第一个有库存的状态转移 1 层
      const fp = d.player(from);
      const order = [...fp.statuses].sort((a, b) => {
        const da = d.content.getStatus(a.id);
        const db = d.content.getStatus(b.id);
        return (da?.polarity === db?.polarity) ? a.id.localeCompare(b.id)
          : (da?.polarity === 'negative' ? -1 : 1);
      });
      const target = order[0];
      if (!target) return;
      const removed = removeStatus(d, from, target.id, 1);
      if (removed > 0) addStatus(d, to, target.id, removed);
      return;
    }
    const removed = removeStatus(d, from, c.status, 99);
    if (removed > 0) addStatus(d, to, c.status, removed);
  },
  increaseStackLimit(d, c, seat) {
    if (c.kind !== 'increaseStackLimit') return;
    const to = resolveTarget(d, c.to, seat);
    const p = d.player(to);
    const base = d.content.getStatus(c.status)?.stackLimit ?? 99;
    const cur = p.statusCapOverrides[c.status] ?? base;
    p.statusCapOverrides = { ...p.statusCapOverrides, [c.status]: cur + c.by };
    d.emit('note', { kind: 'log', text: `statusCap ${c.status} → ${cur + c.by}（基础 ${base}）` });
  },
  spendStatus(d, c, seat) {
    if (c.kind !== 'spendStatus') return;
    const to = resolveTarget(d, c.to, seat);
    const def = d.content.getStatus(c.status);
    if (def?.spendEffect && removeStatus(d, to, c.status, 1) > 0) {
      return [...def.spendEffect];
    }
  },
  rollDicePool(d, c, seat) {
    if (c.kind !== 'rollDicePool') return;
    const count = evalExpr(d, c.count, seat);
    // owner：掷谁的英雄骰面（官方 Gunslinger Duel/Showdown「你与攻击者各掷 1 骰」）。
    // 缺省 = 执行者自己；掷出的值照常进 tempDice（池归属契约不变）。
    const ownerSeat = c.owner ? resolveTarget(d, c.owner, seat) : seat;
    const ownerHero = d.content.getHero(d.player(ownerSeat).heroId);
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const { value, rng } = nextInt(d.s.rng, `dice:pool:${seat}`, 6);
      d.s.rng = rng;
      values.push(value + 1);
    }
    d.s.tempDice = values;
    if (c.bindSumTo) d.s.bindings[c.bindSumTo] = values.reduce((a, b) => a + b, 0);
    d.emit('note', { kind: 'tempDiceRolled', seat, values });
    // cases：缺省按符号去重（每符号至多结算一次）；perDie 时每颗命中骰各结算一次。
    // 符号映射按 owner 的英雄骰面（不是执行者的）。
    const cases = c.cases ?? [];
    const out: EffectDef[] = [];
    if (c.perDie) {
      for (const v of values) {
        const face = ownerHero.dieFaces.find((f) => f.value === v);
        const syms = face ? [...face.symbols] : [];
        for (const cs of cases) {
          if (syms.includes(cs.on)) out.push(...cs.effects);
        }
      }
    } else {
      const seen = new Set<string>();
      const syms = values.flatMap((v) => ownerHero.dieFaces.find((f) => f.value === v)?.symbols ?? []);
      for (const cs of cases) {
        if (seen.has(cs.on)) continue;
        seen.add(cs.on);
        if (syms.includes(cs.on)) out.push(...cs.effects);
      }
    }
    return out;
  },
  setDieFace(d, c, seat) {
    if (c.kind !== 'setDieFace') return;
    const p = d.player(seat);
    let left = evalExpr(d, c.count, seat);
    for (let i = 0; i < p.diceValues.length && left > 0; i++) {
      if (!p.diceLocked[i]) { p.diceValues[i] = c.toFace; left--; }
    }
  },
  adjustDie(d, c, seat) {
    // 官方 Tip It!：任意骰 ±1（1 不能减、6 不能加）。自动模式取第一颗未锁定骰。
    if (c.kind !== 'adjustDie') return;
    const p = d.player(seat);
    const delta = evalExpr(d, c.delta, seat);
    const i = p.diceLocked.findIndex((locked) => !locked);
    if (i >= 0) {
      p.diceValues[i] = Math.min(6, Math.max(1, (p.diceValues[i] ?? 1) + delta));
    }
  },
  copyDieFace(d, c, seat) {
    // 官方 Samesies!：让一颗骰变成另一颗的值。自动模式：第一颗未锁定 ← 第二颗未锁定。
    if (c.kind !== 'copyDieFace') return;
    const p = d.player(seat);
    const free = p.diceLocked.map((l, i) => (l ? -1 : i)).filter((i) => i >= 0);
    if (free.length >= 2) {
      p.diceValues[free[0] as number] = p.diceValues[free[1] as number] ?? 1;
    }
  },
  rerollDice(d, c, seat) {
    if (c.kind !== 'rerollDice') return;
    let left = evalExpr(d, c.count, seat);
    if (c.scope === 'defense') {
      // 重掷防御骰（tempDice；官方 Better D!）。tempDice 全部视为未锁定。
      const values = d.s.tempDice.map((v) => v);
      for (let i = 0; i < values.length && left > 0; i++) {
        const r = nextInt(d.s.rng, `dice:def:${seat}`, 6);
        d.s.rng = r.rng;
        values[i] = r.value + 1;
        left--;
      }
      d.s.tempDice = values;
      d.emit('note', { kind: 'defenseRerolled', seat, values: d.s.tempDice });
      return;
    }
    const p = d.player(resolveTarget(d, c.to ?? { r: 'self' }, seat));
    for (let i = 0; i < p.diceValues.length && left > 0; i++) {
      if (!p.diceLocked[i]) {
        const { value, rng } = nextInt(d.s.rng, `dice:${seat}`, 6);
        d.s.rng = rng;
        p.diceValues[i] = value + 1;
        left--;
      }
    }
  },
  grantExtraRollAttempt(d, c, _seat) {
    if (c.kind !== 'grantExtraRollAttempt') return;
    d.player(d.s.activeSeat).rollAttemptsLeft += c.amount;
  },
  performRollAttempt(_d, _c, _seat) {
    // 由 action 'performRoll' 在阶段机中处理，不作为 effect
  },
  openWindowThen(d, c, _seat) {
    if (c.kind !== 'openWindowThen') return;
    return [...c.steps];
  },
  additionally(d, c, _seat) {
    if (c.kind !== 'additionally') return;
    return [...c.steps];
  },
  conditional(d, c, seat) {
    if (c.kind !== 'conditional') return;
    return evalCondition(d, c.cond, seat) ? [...c.then] : [...(c.else ?? [])];
  },
  bind(d, c, seat) {
    if (c.kind !== 'bind') return;
    d.s.bindings[c.name] = evalExpr(d, c.value, seat);
  },
  choose(d, c, seat) {
    if (c.kind !== 'choose') return;
    // 回合制下不超时；若无人可选则取 default
    const def = c.options.find((o) => o.isDefault) ?? c.options[0];
    return def ? [...def.effects] : [];
  },
  /**
   * 诚实桩：引擎当前**不支持玩家选择**，optional 恒不行使。
   *
   * 为什么不做成"自动行使"：自动行使会让卡面继续宣称「可选」而引擎偷偷强制执行 ——
   * 那是系统撒谎，且会让守护「卡面保留玩家选择权」的断言变成**假绿**
   * （测试为一个已经不存在的属性继续背书）。假绿比一条诚实的红测试危险得多。
   * 官方 may 语义改在**内容层以已知偏差显式记账**（见 heroes.ts 的 barbarian:fortitude），
   * 不在引擎层用自动行使静默替代。
   *
   * ⚠️ 内容层约束：**不得**依赖 optional 产生任何效果（当前恒为 no-op）。
   *    需要「玩家二选一」语义时请用 `choose`（有 isDefault 兜底），不要用 optional。
   *
   * ★ 回滚锚点：将来实现 optionalPrompt 挂起时需**同时**做两件事（缺一不可）
   *   ① 本 handler：改为产出 optionalPrompt 挂起，并在 reduce 的 chooseOption 分支兑现。
   *      依赖的骨架已存在：PendingKind 枚举、legal.ts 的 optionalPrompt 下发分支、
   *      Action.chooseOption；**缺的是** reduce 里 chooseOption 的空实现
   *      （engine.ts 的 case 只 break）与 UI 渲染入口。
   *      ⚠️ UI 入口未就绪就挂起，会让本地热座与联机**卡死在 pending 上无法推进**。
   *   ② heroes.ts：把 barbarian:fortitude 的 removeStatus 重新包回 optional 子句，
   *      还原官方「可移除」语义（该处注释已记好这一步）。
   */
  optional(_d, _c, _seat) {
    return [];
  },
  promptNumber(d, c, _seat) {
    if (c.kind !== 'promptNumber') return;
    d.s.bindings[c.bindTo] = 0; // 兜底：一个都不移除
  },
  grantExtraOffensiveRollPhase(d, _c, _seat) {
    d.s.extraRollPhaseUsed = false;
  },
  skipPhase(d, c, _seat) {
    if (c.kind !== 'skipPhase') return;
    d.emit('note', { kind: 'skipPhase', phase: c.phase });
  },
  log(d, c, _seat) {
    if (c.kind !== 'log') return;
    d.emit('note', { kind: 'log', text: c.text });
  },
};

function shuffleFromDraft(d: Draft, stream: string, items: readonly CardInstance[]) {
  // 复用 rng.shuffle 但保持不可变风格
  const arr = items.slice();
  let r = d.s.rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const a = nextInt(r, stream, i + 1);
    r = a.rng;
    const j = a.value;
    const tmp = arr[i] as CardInstance;
    arr[i] = arr[j] as CardInstance;
    arr[j] = tmp;
  }
  return { items: arr, rng: r };
}

/**
 * 执行效果序列。next 用 pushFront 保序。
 *
 * ── 池归属（谁把骰池放进 tempDice，谁负责把它取出来）────────────────
 * tempDice 是「当前骰池」，有两种截然不同的生命周期，此前被混为一谈（DEFECT-03）：
 *
 *  1. 防御骰池：由 doDefensiveRoll(engine.ts:297) 创建，由 resolveDefense(engine.ts:340)
 *     在求值完防御能力后销毁。它必须**跨多次 runEffects 调用存活** —— 防御窗口里打出的卡
 *     （如 Better D! 的 rerollDice scope:'defense'）要能就地改写它，且改写结果必须传到
 *     resolveDefense。因此 runEffects **无权**销毁进入时就存在的骰池。
 *
 *  2. 临时骰池（rollDicePool）：生命周期 = 本次效果序列（如 Pyroblast「Roll 5，每 🔥 +3」）。
 *     rollDicePool 只是 handler，无法知道自己的 cases 何时跑完，所以由 runEffects 代管销毁。
 *
 * 判据：本次序列是否**自己**掷过 rollDicePool。
 *   - 掷过 → 序列结束时回滚到进入时的骰池（通常为空；若当时正处防御窗口则恢复防御骰池，
 *     避免一张 scratch-pool 卡把防御骰顶掉）。
 *   - 没掷过 → 一个字都不动，把（可能被 rerollDice 改写过的）骰池原样交还给调用方。
 */
export function runEffects(d: Draft, effects: readonly EffectDef[], seat: Seat): void {
  const poolOnEntry = [...d.s.tempDice];
  let scratchPoolRolled = false;
  const queue: { def: EffectDef; seat: Seat }[] = effects.map((def) => ({ def, seat }));
  let frames = 0;
  while (queue.length > 0) {
    if (++frames > MAX_FRAMES_PER_RESOLUTION) {
      d.emit('note', { kind: 'engineGuardTripped', guardReason: 'frameLimit' });
      break;
    }
    const frame = queue.shift();
    if (!frame) break;
    const handler = EFFECT_HANDLERS[frame.def.clause.kind];
    if (!handler) {
      d.emit('note', { kind: 'engineGuardTripped', guardReason: 'unknownClause', kind2: frame.def.clause.kind });
      continue;
    }
    if (frame.def.clause.kind === 'rollDicePool') scratchPoolRolled = true;
    const produced = handler(d, frame.def.clause, frame.seat);
    if (frame.def.next?.length) {
      queue.unshift(...frame.def.next.map((def) => ({ def, seat: frame.seat })));
    }
    if (produced?.length) {
      queue.unshift(...produced.map((def) => ({ def, seat: frame.seat })));
    }
  }
  // 只有自己掷的临时骰池才销毁：没掷过就保留进入时的（可能被改写的）骰池
  if (scratchPoolRolled) d.s.tempDice = poolOnEntry;
}
