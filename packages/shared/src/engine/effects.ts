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
import { addDamage, addHeal, addAvoid, addPrevention } from './bucket.js';
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

  tempSymbols(): Sym[] {
    const hero = this.content.getHero(this.player(this.s.activeSeat).heroId);
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
      const syms = d.s.tempDice.length > 0 ? d.tempSymbols() : d.diceSymbols(seat);
      return syms.filter((s) => s === expr.symbol).length;
    }
    case 'sumFaces':
      return d.s.tempDice.reduce((a, b) => a + b, 0);
    case 'cp': return d.player(resolveTarget(d, expr.target, seat)).cp;
    case 'hp': return d.player(resolveTarget(d, expr.target, seat)).hp;
    case 'var': return d.s.bindings[expr.name] ?? 0;
    case 'add': return evalExpr(d, expr.a, seat) + evalExpr(d, expr.b, seat);
    case 'sub': return evalExpr(d, expr.a, seat) - evalExpr(d, expr.b, seat);
    case 'mul': return evalExpr(d, expr.a, seat) * evalExpr(d, expr.b, seat);
    case 'min': return Math.min(evalExpr(d, expr.a, seat), evalExpr(d, expr.b, seat));
    case 'max': return Math.max(evalExpr(d, expr.a, seat), evalExpr(d, expr.b, seat));
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
      const syms = d.s.tempDice.length > 0 ? d.tempSymbols() : d.diceSymbols(seat);
      return syms.filter((s) => s === cond.symbol).length >= cond.min;
    }
    case 'boundAtLeast': return (d.s.bindings[cond.name] ?? 0) >= cond.min;
    case 'and': return cond.of.every((c) => evalCondition(d, c, seat));
    case 'not': return !evalCondition(d, cond.of, seat);
  }
}

function addStatus(d: Draft, seat: Seat, statusId: string, stacks: number): void {
  if (stacks <= 0) return;
  const p = d.player(seat);
  const def = d.content.getStatus(statusId);
  const cap = def?.stackLimit ?? 99;
  const idx = p.statuses.findIndex((s) => s.id === statusId);
  if (idx >= 0) {
    const cur = p.statuses[idx] as StatusInstance;
    p.statuses[idx] = { id: statusId, stacks: Math.min(cap, cur.stacks + stacks) };
  } else {
    p.statuses.push({ id: statusId, stacks: Math.min(cap, stacks) });
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

export type Handler = (d: Draft, clause: never, seat: Seat) => readonly EffectDef[] | void;

export const EFFECT_HANDLERS: Record<EffectClause['kind'], (d: Draft, clause: EffectClause, seat: Seat) => readonly EffectDef[] | void> = {
  dealDamage(d, c, seat) {
    if (c.kind !== 'dealDamage') return;
    const to = resolveTarget(d, c.to, seat);
    const amount = evalExpr(d, c.amount, seat);
    d.s.bucket = addDamage(d.s.bucket, amount, c.damageType, to, seat, c.sourceKind ?? 'ability');
    d.emit('note', { kind: 'damageQueued', to, amount, damageType: c.damageType, sourceKind: c.sourceKind ?? 'ability' });
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
    const removed = removeStatus(d, from, c.status, 99);
    if (removed > 0) addStatus(d, to, c.status, removed);
  },
  increaseStackLimit(d, _c, _seat) {
    // MVP 未使用；预留（per-player 覆盖表）
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
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const { value, rng } = nextInt(d.s.rng, `dice:pool:${seat}`, 6);
      d.s.rng = rng;
      values.push(value + 1);
    }
    d.s.tempDice = values;
    if (c.bindSumTo) d.s.bindings[c.bindSumTo] = values.reduce((a, b) => a + b, 0);
    d.emit('note', { kind: 'tempDiceRolled', seat, values });
    // cases 按符号去重，每符号至多结算一次
    const seen = new Set<string>();
    const out: EffectDef[] = [];
    const syms = d.tempSymbols();
    for (const cs of c.cases) {
      if (seen.has(cs.on)) continue;
      seen.add(cs.on);
      if (syms.includes(cs.on)) out.push(...cs.effects);
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
  rerollDice(d, c, seat) {
    if (c.kind !== 'rerollDice') return;
    const p = d.player(seat);
    let left = evalExpr(d, c.count, seat);
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
  optional(_d, _c, _seat) {
    // 兜底：不行使（永不替玩家消耗资源）
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

/** 执行效果序列。next 用 pushFront 保序。 */
export function runEffects(d: Draft, effects: readonly EffectDef[], seat: Seat): void {
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
    const produced = handler(d, frame.def.clause, frame.seat);
    if (frame.def.next?.length) {
      queue.unshift(...frame.def.next.map((def) => ({ def, seat: frame.seat })));
    }
    if (produced?.length) {
      queue.unshift(...produced.map((def) => ({ def, seat: frame.seat })));
    }
  }
  // 临时骰池判定后销毁
  d.s.tempDice = [];
}
