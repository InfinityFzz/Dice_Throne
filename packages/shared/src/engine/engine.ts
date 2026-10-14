/**
 * 规则引擎：阶段状态机 + 结算阶梯 P1–P8 + reduce。
 *
 * 对外是纯函数：reduce(state, envelope) → { ok, state, events }，输入不被修改。
 * 内部使用 Draft（克隆后可变）实现，便于效果序列的递归结算。
 */
import type {
  DiceView, EntityId, HeroId, LadderStep, Seat, Sym,
} from '../types/core.js';
import type { CardInstance, GameState, PendingRequest, PlayerState } from '../types/state.js';
import type { ActionEnvelope, GameEvent, ReduceResult, RuleError } from '../types/action.js';
import { EMPTY_BUCKET, EMPTY_WINDOWS } from '../types/state.js';
import { createRng, nextInt, shuffle } from './rng.js';
import { evaluate } from './matcher.js';
import { flushForSeat } from './bucket.js';
import { Draft, runEffects, evalExpr, evalCondition } from './effects.js';
import type { ContentRegistry } from '../content/registry.js';

export interface MatchOptions {
  readonly seed: string;
  readonly heroes: readonly [HeroId, HeroId];
}

export interface ReduceOptions {
  /** 脚本对战 / 单测用：遇到挂起点自动用 autoResolve 推进 */
  readonly autoResolve?: boolean;
  readonly maxAutoSteps?: number;
}

const HAND_LIMIT = 6;
const START_CP = 2;
const START_HAND = 4;
const DICE_COUNT = 5;
const MAX_ROLL_ATTEMPTS = 3;

// ── 建局 ─────────────────────────────────────────────
export function createMatch(content: ContentRegistry, opts: MatchOptions): GameState {
  let rng = createRng(opts.seed);
  const players: PlayerState[] = [];

  for (const seat of [0, 1] as Seat[]) {
    const hero = content.getHero(opts.heroes[seat]);
    // 构建牌库（按 count 展开）
    const deck: CardInstance[] = [];
    let uid = 0;
    for (const card of hero.deck) {
      for (let i = 0; i < card.count; i++) {
        deck.push({ uid: `${seat}-${uid++}`, defId: card.defId });
      }
    }
    const sh = shuffle(rng, `shuffle:${seat}`, deck);
    rng = sh.rng;
    const pile = sh.items;
    const hand = pile.splice(0, START_HAND);

    players.push({
      seat,
      heroId: hero.id,
      hp: hero.startHp,
      startHp: hero.startHp,
      cp: START_CP,
      hand,
      deck: pile,
      discard: [],
      upgrades: {},
      statuses: [],
      statusCapOverrides: {},
      rollAttemptsLeft: MAX_ROLL_ATTEMPTS,
      diceValues: [],
      diceLocked: [],
      defenseUsed: false,
      permissionTokens: [],
      turnDamageDealt: 0,
      turnIndexAtLastReset: 0,
    });
  }

  // 先手：服务端随机指定（design Q10 建议）
  const first = nextInt(rng, 'setup', 2);
  rng = first.rng;
  const startSeat = first.value as Seat;

  const base: GameState = {
    rng,
    turn: 0,
    phase: 'upkeep',
    ladderStep: null,
    activeSeat: startSeat,
    startSeat,
    players: [players[0] as PlayerState, players[1] as PlayerState],
    pending: null,
    bucket: EMPTY_BUCKET,
    windows: EMPTY_WINDOWS,
    tempDice: [],
    bindings: {},
    extraRollPhaseUsed: false,
    seq: 0,
    winner: null,
    finished: false,
  };

  // 自动推进无输入的阶段（upkeep → income → main1），直到第一个挂起点
  const d = new Draft(base, content);
  advance(d);
  return d.toState();
}

// ── 内部工具 ─────────────────────────────────────────
function diceViewOf(d: Draft, seat: Seat): { view: DiceView; mapBack: number[] } {
  const p = d.player(seat);
  const hero = d.content.getHero(p.heroId);
  const symbols: Sym[] = [];
  const mapBack: number[] = [];
  p.diceValues.forEach((v, i) => {
    const face = hero.dieFaces.find((f) => f.value === v);
    if (face) {
      face.symbols.forEach((s) => { symbols.push(s); mapBack.push(i); });
    } else {
      mapBack.push(i);
    }
  });
  return { view: { values: p.diceValues, symbols, locked: p.diceLocked }, mapBack };
}

function currentTier(d: Draft, seat: Seat, abilityId: EntityId): number {
  return d.player(seat).upgrades[abilityId] ?? 1;
}

/** 计算可选能力（P1 ACTIVATE）。导出供 UI 高亮与脚本 AI 使用。 */
export function computeCandidates(d: Draft, seat: Seat) {
  const hero = d.content.getHero(d.player(seat).heroId);
  const { view, mapBack } = diceViewOf(d, seat);
  const out: { abilityId: EntityId; matchedIndices: number[]; tier?: number }[] = [];
  for (const slot of hero.abilities) {
    if (slot.kind !== 'offensive' && slot.kind !== 'ultimate') continue;
    const tier = currentTier(d, seat, slot.id);
    const t = slot.tiers.find((x) => x.level === tier) ?? slot.tiers[0];
    if (!t) continue;
    const r = evaluate(t.matcher, view);
    if (r.matched) {
      const indices = [...new Set(r.indices.map((i) => mapBack[i] ?? i))].sort((a, b) => a - b);
      out.push({ abilityId: slot.id, matchedIndices: indices, tier: r.tier });
    }
  }
  return out;
}

function makePending(d: Draft, seat: Seat, kind: PendingRequest['kind'], options: PendingRequest['options'], autoResolve: string): void {
  const p: PendingRequest = {
    id: `p-${d.s.seq}`,
    seat,
    kind,
    options,
    deadlineAt: null, // 回合制：不限时（用户拍板 Q12）
    autoResolve,
  };
  d.pending = p;
  d.s.pending = p;
  d.emit('pendingRequested', { seat, kind, options }, { v: 'seat', seat });
}

// ── 阶段处理 ─────────────────────────────────────────
function doUpkeep(d: Draft): void {
  d.emit('phaseChanged', { phase: 'upkeep' });
  const active = d.s.activeSeat;
  const p = d.player(active);
  // 重置本回合伤害统计（按 turnIndex）
  p.turnDamageDealt = 0;
  p.turnIndexAtLastReset = d.s.turn;

  // 两段式（design C6 修正）：damage 段全写 bucket → 一次 flush + 死亡判定 → decay 段
  for (const st of [...p.statuses]) {
    const def = d.content.getStatus(st.id);
    if (def?.upkeep?.order === 'damage') {
      runEffects(d, def.upkeep.effects, active);
    }
  }
  if (d.s.bucket.entries.length > 0 || d.s.bucket.heals.length > 0) {
    flushNow(d);
    if (d.s.finished) return;
  }
  for (const st of [...p.statuses]) {
    const def = d.content.getStatus(st.id);
    if (def?.upkeep?.order === 'decay') {
      runEffects(d, def.upkeep.effects, active);
    }
  }
}

function doIncome(d: Draft): void {
  // 先手玩家跳过第一个 Income（A4）
  if (d.s.turn === 0 && d.s.activeSeat === d.s.startSeat) {
    d.emit('note', { kind: 'incomeSkipped', seat: d.s.activeSeat });
    return;
  }
  const p = d.player(d.s.activeSeat);
  p.cp = Math.min(15, p.cp + 1);
  runEffects(d, [{ clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } }], d.s.activeSeat);
  d.emit('note', { kind: 'income', seat: d.s.activeSeat, cp: p.cp });
}

function openMainPhase(d: Draft): void {
  d.s.phase = d.s.phase === 'main1' ? 'main1' : 'main2';
  makePending(d, d.s.activeSeat, 'cardWindow', [{ id: 'endPhase', label: '结束阶段' }], 'endPhase');
}

/** 进攻掷骰阶段的挂起选项：掷骰 + 所有可激活能力 + 放弃 */
function rollPendingOptions(d: Draft, seat: Seat): PendingRequest['options'] {
  const p = d.player(seat);
  const cands = computeCandidates(d, seat);
  const opts: { id: string; label: string; isDefault?: boolean }[] = [];
  if (p.rollAttemptsLeft > 0) {
    opts.push({ id: 'roll', label: `掷骰（剩 ${p.rollAttemptsLeft} 次）` });
  }
  for (const c of cands) {
    const hero = d.content.getHero(p.heroId);
    const slot = hero.abilities.find((a) => a.id === c.abilityId);
    opts.push({ id: c.abilityId, label: slot?.name ?? c.abilityId });
  }
  opts.push({ id: 'pass', label: '放弃激活', isDefault: true });
  return opts;
}

function openOffensiveRoll(d: Draft): void {
  d.s.phase = 'offensiveRoll';
  const p = d.player(d.s.activeSeat);
  p.rollAttemptsLeft = MAX_ROLL_ATTEMPTS;
  p.defenseUsed = false;
  p.diceValues = [];
  p.diceLocked = [];
  makePending(d, d.s.activeSeat, 'abilityAnnounce', rollPendingOptions(d, d.s.activeSeat), 'pass');
}

/** 对局外查询候选（UI / 脚本用） */
export function getCandidates(state: GameState, content: ContentRegistry, seat: Seat) {
  const d = new Draft(state, content);
  return computeCandidates(d, seat);
}

/** P1→P8 结算：执行能力效果，之后进入防御或 flush */
function resolveAbility(d: Draft, abilityId: EntityId): void {
  d.s.ladderStep = 'activate';
  const seat = d.s.activeSeat;
  const hero = d.content.getHero(d.player(seat).heroId);
  const slot = hero.abilities.find((a) => a.id === abilityId);
  if (!slot) return;

  // P2 ULTIMATE GATE：对手被剥夺行动权（令牌在 cleanup 释放）
  d.s.ladderStep = 'ultimateGate';
  if (slot.kind === 'ultimate') {
    const opp = d.other(seat);
    d.player(opp).permissionTokens.push({
      id: `tok-${d.s.seq}`, seat: opp, reason: 'ultimate', releaseAt: 'cleanup',
    });
    d.emit('note', { kind: 'ultimateGate', seat: opp });
  }

  // P3 EFFECT WALK
  d.s.ladderStep = 'effectWalk';
  const tier = currentTier(d, seat, slot.id);
  const t = slot.tiers.find((x) => x.level === tier) ?? slot.tiers[0];
  if (t) {
    d.emit('abilityActivated', { seat, abilityId, tier });
    runEffects(d, t.effects, seat);
  }

  // P5 DEFENSIVE ROLL：仅当存在可防御伤害
  const hasDefendable = d.s.bucket.entries.some(
    (e) => e.bucketKind === 'defendable' && e.toSeat === d.other(seat),
  );
  if (hasDefendable && !d.player(d.other(seat)).defenseUsed) {
    d.s.ladderStep = 'defensiveRoll';
    d.s.phase = 'defensiveRoll';
    makePending(d, d.other(seat), 'defensiveRoll', [{ id: 'roll', label: '防御掷骰' }], 'roll');
    return;
  }
  finishResolution(d);
}

function doDefensiveRoll(d: Draft, abilityId?: string): void {
  const seat = d.s.activeSeat;
  const defender = d.other(seat);
  const dp = d.player(defender);
  dp.defenseUsed = true; // 不变量：一次 Roll Phase 内防御掷骰 ≤ 1
  const hero = d.content.getHero(dp.heroId);
  // 官方：多个防御能力须在掷骰前二选一（有效性已在 reduce 层校验）；
  // 缺省 = 第一个（向后兼容，单防御能力英雄行为不变）。
  const defensives = hero.abilities.filter((a) => a.kind === 'defensive');
  const slot = abilityId ? defensives.find((a) => a.id === abilityId) : defensives[0];
  if (!slot?.defenseDiceCount) { finishResolution(d); return; }
  d.s.activeDefenseAbilityId = slot.id;
  // 骰数按等级取（官方暗影防御 L1=4 / L2=5）：tier 覆盖优先，缺省回落槽位值
  const tierObj = slot.tiers.find((x) => x.level === currentTier(d, defender, slot.id)) ?? slot.tiers[0];
  const diceCount = tierObj?.defenseDiceCount ?? slot.defenseDiceCount;

  const values: number[] = [];
  for (let i = 0; i < diceCount; i++) {
    const r = nextInt(d.s.rng, `dice:def:${defender}`, 6);
    d.s.rng = r.rng;
    values.push(r.value + 1);
  }
  // ★ 防御骰池的创建点（owner）：此后直到 resolveDefense 销毁前，
  //   任何 runEffects 调用都不得清空它 —— 防御窗口打出的卡要能改写这批骰（DEFECT-03）。
  d.s.tempDice = values;
  d.emit('defenseRolled', { seat: defender, values });

  // 防御重掷窗口（官方 Better D! 语义）：掷骰后、结算前，防守方可用防御时机卡。
  // 无可用卡时直接结算，不引入多余等待。
  if (hasDefenseWindowCards(d, defender)) {
    makeDefenseWindow(d, defender);
    return;
  }
  resolveDefense(d);
}

/** 防守方是否持有可在防御窗口打出的卡（timing 含 preDefense 且 CP 足够） */
function hasDefenseWindowCards(d: Draft, seat: Seat): boolean {
  const p = d.player(seat);
  return p.hand.some((c) => {
    const def = d.content.getCard(c.defId);
    // 只认 preDefense：窗口开在 flush 之前，「防御结算后才可知」的卡（headBash，
    // timing postDefense-only）属于攻方 main2 行动窗口，不在此列（O-1）。
    return def.timing.includes('preDefense') && p.cp >= def.costCp;
  });
}

function makeDefenseWindow(d: Draft, seat: Seat): void {
  makePending(d, seat, 'defenseWindow', [{ id: 'resolve', label: '结算防御' }], 'resolve');
}

/** 防御结算：按（可能已被重掷的）防御骰求值 matcher 并执行能力效果，随后 P6–P8 */
function resolveDefense(d: Draft): void {
  const defender = d.other(d.s.activeSeat);
  const dp = d.player(defender);
  const values = [...d.s.tempDice];
  // 用 doDefensiveRoll 选定的防御能力（官方多防御能力二选一）；缺省 = 第一个
  const chosenId = d.s.activeDefenseAbilityId;
  d.s.activeDefenseAbilityId = undefined;
  const heroAb = d.content.getHero(dp.heroId).abilities.filter((a) => a.kind === 'defensive');
  const slot = chosenId ? heroAb.find((a) => a.id === chosenId) : heroAb[0];
  const t = slot ? (slot.tiers.find((x) => x.level === currentTier(d, defender, slot.id)) ?? slot.tiers[0]) : undefined;
  if (t && slot) {
    // 防御 matcher 以防御骰为作用域
    const hero = d.content.getHero(dp.heroId);
    const symbols: Sym[] = values.flatMap((v) => {
      const face = hero.dieFaces.find((f) => f.value === v);
      return face ? [...face.symbols] : [];
    });
    const view: DiceView = { values, symbols, locked: values.map(() => true) };
    if (evaluate(t.matcher, view).matched) runEffects(d, t.effects, defender);
  }
  // ★ 防御骰池的销毁点（owner）：防御能力已按这批骰求值完毕，此后 tempDice 必须清空。
  d.s.tempDice = [];
  finishResolution(d);
}

/** P6 flush → P7 post → P8 cleanup */
function finishResolution(d: Draft): void {
  d.s.ladderStep = 'simultaneous';
  flushNow(d);
  if (d.s.finished) return;
  d.s.ladderStep = 'postThen';
  d.s.ladderStep = 'cleanup';
  // 只释放 releaseAt==='cleanup' 的令牌（Stun 的 turnEnd 保留）
  for (const seat of [0, 1] as Seat[]) {
    const p = d.player(seat);
    p.permissionTokens = p.permissionTokens.filter((t) => t.releaseAt !== 'cleanup');
  }
  d.emit('note', { kind: 'resolutionCleanup' });
  d.s.phase = 'main2';
}

function flushNow(d: Draft): void {
  d.s.ladderStep = 'simultaneous';
  // 条件反噬在清桶前摘取（官方 Reckless 语义：仅当至少 1 点伤害成功造成）
  const recoils = [...d.s.bucket.pendingRecoils];
  const results = new Map<Seat, ReturnType<typeof flushForSeat>>();
  for (const seat of [0, 1] as Seat[]) {
    const p = d.player(seat);
    const r = flushForSeat(d.s.bucket, seat, p.hp, p.startHp);
    results.set(seat, r);
    if (r.net === 0 && !d.s.bucket.heals.some((h) => h.toSeat === seat)) continue;
    p.hp = r.hpAfter;
    // 「成功造成」的归账：seat 承受的净伤（net 已扣 avoid/prevention）记到**对手**头上。
    // 旧实现把 r.damageDealt（seat 承受的量）加给 seat 自己 —— 方向反了（O-1 附带发现）：
    //   实测攻方造成 8 点却记 0、承受 2 点反伤却记 2。
    // 边界：bucket 条目的 fromSeat 在 1v1 下恒为对手（self-damage 不入桶、recoil 直扣
    //   HP 不经 flush），按 net 全额归给对手成立；将来引入入桶的 self-damage 时需按 entry 归账。
    d.player(d.other(seat)).turnDamageDealt += r.net;
    d.emit('damageApplied', { seat, net: r.net, hpAfter: r.hpAfter, defeated: r.defeated });
  }
  d.s.bucket = EMPTY_BUCKET;

  for (const rc of recoils) {
    const trigger = results.get(rc.triggerToSeat);
    if (!trigger || trigger.net < 1) continue;
    const p = d.player(rc.toSeat);
    p.hp = p.hp - rc.amount;
    d.emit('damageApplied', { seat: rc.toSeat, net: rc.amount, hpAfter: p.hp, defeated: p.hp <= 0, recoil: true });
  }

  checkDefeat(d);
}

function checkDefeat(d: Draft): void {
  const dead = ([0, 1] as Seat[]).filter((s) => d.player(s).hp <= 0);
  if (dead.length === 2) {
    d.s.winner = 'draw'; d.s.finished = true;
    d.emit('matchEnded', { winner: 'draw' });
  } else if (dead.length === 1) {
    const w = dead[0] === 0 ? 1 : 0;
    d.s.winner = w as Seat; d.s.finished = true;
    d.emit('matchEnded', { winner: w });
  }
}

function endTurn(d: Draft): void {
  // 释放 turnEnd 令牌（Stun）
  for (const seat of [0, 1] as Seat[]) {
    const p = d.player(seat);
    p.permissionTokens = p.permissionTokens.filter((t) => t.releaseAt !== 'turnEnd');
  }
  // 官方 Shadows 类（StatusDef.discardAtTurnEnd 通用契约）：从回合开始就在身上的
  // 该类状态随本回合结束弃置（sinceTurn < 当前 turn = 已历经完整的自己回合开场）。
  // 本回合内获得的（Shadow Dance 等）不弃，官方「a turn in which you started with the token」。
  {
    const concluding = d.player(d.s.activeSeat);
    const kept: typeof concluding.statuses = [];
    for (const st of concluding.statuses) {
      const def = d.content.getStatus(st.id);
      const stamped = (st as { sinceTurn?: number }).sinceTurn;
      if (def?.discardAtTurnEnd && stamped !== undefined && stamped < d.s.turn) {
        d.emit('statusChanged', { seat: d.s.activeSeat, statusId: st.id, delta: -st.stacks });
        continue;
      }
      kept.push(st);
    }
    concluding.statuses = kept;
  }
  d.s.activeSeat = d.other(d.s.activeSeat);
  d.s.turn += 1;
  d.s.phase = 'upkeep';
  d.s.ladderStep = null;
}

/** 自动推进无需玩家输入的阶段，直到遇到挂起点 */
function advance(d: Draft): void {
  let guard = 0;
  while (!d.s.finished && guard++ < 64) {
    switch (d.s.phase) {
      case 'upkeep':
        doUpkeep(d);
        if (d.s.finished) return;
        d.s.phase = 'income';
        continue;
      case 'income':
        doIncome(d);
        d.s.phase = 'main1';
        continue;
      case 'main1':
      case 'main2':
        openMainPhase(d);
        return;
      case 'offensiveRoll':
        if (d.player(d.s.activeSeat).diceValues.length === 0) {
          // 首次进入：等玩家掷骰
          openOffensiveRoll(d);
          return;
        }
        return;
      case 'defensiveRoll':
        return; // 等防守方
      case 'discard': {
        const p = d.player(d.s.activeSeat);
        if (p.hand.length > HAND_LIMIT) {
          makePending(d, d.s.activeSeat, 'discard', [{ id: 'auto', label: '自动弃牌' }], 'auto');
          return;
        }
        endTurn(d);
        continue;
      }
      case 'gameOver':
        return;
      default:
        return;
    }
  }
}

function autoDiscard(d: Draft): void {
  const p = d.player(d.s.activeSeat);
  while (p.hand.length > HAND_LIMIT) {
    const card = p.hand.pop();
    if (!card) break;
    p.discard.push(card);
    p.cp = Math.min(15, p.cp + 1); // 每张 +1 CP
  }
  d.emit('note', { kind: 'autoDiscard', seat: p.seat });
}

// ── reduce ───────────────────────────────────────────
function err(code: RuleError['code'], message: string): ReduceResult {
  return { ok: false, error: { code, message }, events: [] };
}

export function reduce(
  state: GameState,
  env: ActionEnvelope,
  content: ContentRegistry,
): ReduceResult {
  if (state.finished) return err('matchFinished', '对局已结束');
  const d = new Draft(state, content);
  const { seat, action } = env;

  // 防御动作（defensiveRoll / respondPass）按设计不受「当前行动方」限制（见 isDefensiveAction），
  // 因此它被拒的唯一可能原因就是阶段不对。把它排在 pending 守卫之前，避免把
  // 「防御窗口已结束（如 4-of-a-kind 不可防御已直接结算）」误报成「不是你的回合」（DEFECT-01）。
  // ⚠️ 只改变**已被拒绝**动作的拒绝码：defensiveRoll + 非 defensiveRoll 阶段在当前守卫下
  //    必然被拒（pending 守卫或 case 内守卫），不存在由拒变收的情况。
  if (action.t === 'defensiveRoll' && state.phase !== 'defensiveRoll') {
    return err('wrongPhase', '不在防御掷骰阶段');
  }
  if (state.pending && state.pending.seat !== seat) {
    return err('notYourTurn', `当前等待 seat ${state.pending.seat} 响应`);
  }
  if (seat !== state.activeSeat && !isDefensiveAction(action)
      && !(state.pending?.kind === 'defenseWindow' && action.t === 'playCard')) {
    return err('notYourTurn', `当前行动方是 seat ${state.activeSeat}`);
  }

  d.pending = null;
  d.s.pending = null;

  switch (action.t) {
    case 'performRoll': {
      if (state.phase !== 'offensiveRoll') return err('wrongPhase', '不在进攻掷骰阶段');
      const p = d.player(seat);
      if (p.rollAttemptsLeft <= 0) return err('illegalAction', '掷骰次数已用尽');
      p.rollAttemptsLeft -= 1;
      const values: number[] = [];
      for (let i = 0; i < DICE_COUNT; i++) {
        if (p.diceLocked[i]) { values.push(p.diceValues[i] as number); continue; }
        const r = nextInt(d.s.rng, `dice:${seat}`, 6);
        d.s.rng = r.rng;
        values.push(r.value + 1);
      }
      p.diceValues = values;
      if (p.diceLocked.length !== DICE_COUNT) p.diceLocked = new Array(DICE_COUNT).fill(false);
      d.emit('diceRolled', { seat, values, locked: p.diceLocked });
      // 掷骰后重新等待玩家决策
      makePending(d, seat, 'abilityAnnounce', rollPendingOptions(d, seat), 'pass');
      break;
    }

    case 'toggleLock': {
      const p = d.player(seat);
      if (state.phase !== 'offensiveRoll') return err('wrongPhase', '不在进攻掷骰阶段');
      if (action.index < 0 || action.index >= p.diceValues.length) return err('illegalAction', '骰子下标越界');
      p.diceLocked[action.index] = !p.diceLocked[action.index];
      makePending(d, seat, 'abilityAnnounce', rollPendingOptions(d, seat), 'pass');
      break;
    }

    case 'announceAbility': {
      if (state.phase !== 'offensiveRoll') return err('wrongPhase', '不在进攻掷骰阶段');
      const cands = computeCandidates(d, seat);
      if (!cands.some((c) => c.abilityId === action.abilityId)) {
        return err('abilityNotAvailable', '当前骰型不满足该能力');
      }
      resolveAbility(d, action.abilityId);
      break;
    }

    case 'passAbility': {
      if (state.phase !== 'offensiveRoll') return err('wrongPhase', '不在进攻掷骰阶段');
      d.emit('note', { kind: 'abilityPassed', seat });
      d.s.phase = 'main2';
      break;
    }

    case 'defensiveRoll': {
      if (state.phase !== 'defensiveRoll') return err('wrongPhase', '不在防御掷骰阶段');
      // 官方：多个防御能力二选一——指定的 abilityId 必须是防守方英雄的防御能力
      if (action.abilityId) {
        const hero = d.content.getHero(d.player(d.other(state.activeSeat)).heroId);
        const ok = hero.abilities.some((a) => a.kind === 'defensive' && a.id === action.abilityId);
        if (!ok) return err('illegalAction', `不是有效的防御能力：${action.abilityId}`);
      }
      doDefensiveRoll(d, action.abilityId);
      break;
    }

    case 'playCard': {
      // 防御重掷窗口：防守方打出防御时机卡（Better D! 等）
      if (state.pending?.kind === 'defenseWindow') {
        if (state.pending.seat !== seat) return err('notYourTurn', '当前等待防守方响应');
        const dwSeat = d.player(seat);
        const idx0 = dwSeat.hand.findIndex((c) => c.uid === action.uid);
        if (idx0 < 0) return err('cardNotFound', '手牌中没有该卡');
        const def0 = d.content.getCard((dwSeat.hand[idx0] as CardInstance).defId);
        if (!def0.timing.includes('preDefense')) {
          return err('wrongPhase', '该卡不能在防御掷骰阶段打出（仅 preDefense 时机卡）');
        }
        if (dwSeat.cp < def0.costCp) return err('notEnoughCp', `CP 不足（需要 ${def0.costCp}）`);
        dwSeat.cp -= def0.costCp;
        const [card0] = dwSeat.hand.splice(idx0, 1);
        if (card0) dwSeat.discard.push(card0);
        d.emit('cardPlayed', { seat, defId: card0!.defId, name: def0.name });
        // ★ tempDice 归防御阶梯所有，runEffects 不得销毁：卡效果可以改写它
        //   （rerollDice scope:'defense' = Better D!），改写结果必须活到 resolveDefense。
        runEffects(d, def0.effects, seat);
        // 窗口保持可重入：还有可打的卡就继续等，否则直接结算
        if (hasDefenseWindowCards(d, seat)) makeDefenseWindow(d, seat);
        else resolveDefense(d);
        break;
      }
      if (state.phase !== 'main1' && state.phase !== 'main2') return err('wrongPhase', '不在主要阶段');
      const p = d.player(seat);
      const idx = p.hand.findIndex((c) => c.uid === action.uid);
      if (idx < 0) return err('cardNotFound', '手牌中没有该卡');
      const card = p.hand[idx] as CardInstance;
      const def = d.content.getCard(card.defId);
      if (p.cp < def.costCp) return err('notEnoughCp', `CP 不足（需要 ${def.costCp}）`);
      // 打出门槛（如 Head Bash!「若已对对手造成 ≥8 伤害」）：不满足则整卡不可打出，
      // 不消耗卡也不进入结算 —— 官方语义是「门槛通过才能 play this card to …」。
      if (def.playIf && !evalCondition(d, def.playIf, seat)) {
        return err('illegalAction', '该卡的打出门槛未满足');
      }
      p.cp -= def.costCp;
      p.hand.splice(idx, 1);
      p.discard.push(card);
      d.emit('cardPlayed', { seat, defId: card.defId, name: def.name });
      runEffects(d, def.effects, seat);
      openMainPhase(d);
      break;
    }

    case 'buyUpgrade': {
      if (state.phase !== 'main1' && state.phase !== 'main2') return err('wrongPhase', '不在主要阶段');
      const p = d.player(seat);
      const hero = d.content.getHero(p.heroId);
      const slot = hero.abilities.find((a) => a.id === action.abilityId);
      if (!slot) return err('cardNotFound', '能力不存在');
      const cur = currentTier(d, seat, action.abilityId);
      if (action.tier <= cur) return err('illegalAction', '不能降级或重复升级');
      const target = slot.tiers.find((t) => t.level === action.tier);
      if (!target) return err('illegalAction', '该 tier 不存在');
      // 累计总价口径：已升到 2 级再升 3 级只付差额
      const curTier = slot.tiers.find((t) => t.level === cur);
      const cost = target.upgradeCostCP - (curTier?.upgradeCostCP ?? 0);
      if (p.cp < cost) return err('notEnoughCp', `CP 不足（需要 ${cost}）`);
      p.cp -= cost;
      p.upgrades[action.abilityId] = action.tier;
      d.emit('upgradeBought', { seat, abilityId: action.abilityId, tier: action.tier, cost });
      openMainPhase(d);
      break;
    }

    case 'sellCard': {
      if (state.phase !== 'main1' && state.phase !== 'main2') return err('wrongPhase', '不在主要阶段');
      const p = d.player(seat);
      const idx = p.hand.findIndex((c) => c.uid === action.uid);
      if (idx < 0) return err('cardNotFound', '手牌中没有该卡');
      const [card] = p.hand.splice(idx, 1);
      if (card) p.discard.push(card);
      p.cp = Math.min(15, p.cp + 1);
      openMainPhase(d);
      break;
    }

    case 'endMainPhase': {
      if (state.phase === 'main1') { d.s.phase = 'offensiveRoll'; openOffensiveRoll(d); break; }
      if (state.phase === 'main2') { d.s.phase = 'discard'; break; }
      return err('wrongPhase', '不在主要阶段');
    }

    case 'discardCards': {
      if (state.phase !== 'discard') return err('wrongPhase', '不在弃牌阶段');
      const p = d.player(seat);
      if (action.uids.length !== p.hand.length - HAND_LIMIT) {
        return err('illegalAction', `需弃 ${p.hand.length - HAND_LIMIT} 张`);
      }
      for (const uid of action.uids) {
        const idx = p.hand.findIndex((c) => c.uid === uid);
        if (idx < 0) return err('cardNotFound', '手牌中没有该卡');
        const [card] = p.hand.splice(idx, 1);
        if (card) p.discard.push(card);
        p.cp = Math.min(15, p.cp + 1);
      }
      break;
    }

    case 'chooseOption': {
      if (!state.pending) return err('noPending', '当前没有待响应项');
      break;
    }

    case 'respondPass': {
      // 防御重掷窗口：pass = 不再打卡，按当前防御骰结算
      if (state.pending?.kind === 'defenseWindow') {
        resolveDefense(d);
        break;
      }
      break;
    }

    case 'concede': {
      d.s.winner = d.other(seat) as Seat;
      d.s.finished = true;
      d.emit('matchEnded', { winner: d.s.winner, reason: 'concede' });
      break;
    }

    case 'selectHero':
    case 'ready':
      break;
  }

  if (!d.s.finished) advance(d);
  return { ok: true, state: d.toState(), events: d.events };
}

function isDefensiveAction(action: ActionEnvelope['action']): boolean {
  return action.t === 'defensiveRoll' || action.t === 'respondPass';
}

/** 脚本对战入口：自动用 autoResolve 推进挂起点 */
export function reduceAuto(
  state: GameState,
  env: ActionEnvelope,
  content: ContentRegistry,
  opts: ReduceOptions = {},
): ReduceResult {
  const first = reduce(state, env, content);
  if (!first.ok || !opts.autoResolve) return first;

  let cur = first.state;
  const events: GameEvent[] = [...first.events];
  let steps = 0;
  const limit = opts.maxAutoSteps ?? 200;

  while (!cur.finished && cur.pending && steps++ < limit) {
    const p = cur.pending;
    const next = autoActionFor(cur, p);
    if (!next) break;
    const r = reduce(cur, { seat: p.seat, action: next, clientSeq: steps }, content);
    if (!r.ok) {
      return { ok: false, error: r.error, events: [] };
    }
    events.push(...r.events);
    cur = r.state;
  }
  return { ok: true, state: cur, events };
}

/** 根据挂起点类型给出自动动作（脚本对战 / 异常兜底共用） */
function autoActionFor(state: GameState, p: PendingRequest) {
  const seat = p.seat;
  switch (p.kind) {
    case 'abilityAnnounce': {
      // 兜底：PASS（不激活）——零副作用
      return { t: 'passAbility' as const };
    }
    case 'defensiveRoll':
      return { t: 'defensiveRoll' as const };
    case 'cardWindow':
      return { t: 'endMainPhase' as const };
    case 'defenseWindow':
      // 兜底：不打卡直接结算（不替玩家消耗资源）
      return { t: 'respondPass' as const };
    case 'discard': {
      const player = state.players[seat];
      const need = player.hand.length - HAND_LIMIT;
      // 确定性排序键：先弃行动卡，升级卡最后弃
      const sorted = [...player.hand].sort((a, b) => {
        const ca = state.players[seat].hand.indexOf(a);
        const cb = state.players[seat].hand.indexOf(b);
        return ca - cb;
      });
      return { t: 'discardCards' as const, uids: sorted.slice(0, need).map((c) => c.uid) };
    }
    default:
      return null;
  }
}
