/**
 * Shadow Thief 实装取证（集成级 / 行为级）—— M3 第二位新英雄的引擎扩展验证。
 *
 * 覆盖的引擎扩展（2026-10-14，均为官方 Shadow Thief 机制倒逼）：
 *  1. StatusDef.onAttacked.avoid      —— Shadows「被普通攻击时全部避开」（Ultimate 豁免）
 *  2. StatusDef.discardAtTurnEnd      —— Shadows「带着它完整结束一个自己回合后弃置」
 *  3. defensiveRoll.abilityId         —— 官方「多个防御能力须在掷骰前二选一」
 *  4. AbilityTier.defenseDiceCount    —— 暗影防御 L1 掷 4 骰 / L2 掷 5 骰
 *  5. common:poison 官方化            —— limit 3 / Persistent（此前 limit 5 非持续为早期未记录值）
 *
 * 引擎中立哨兵（架构硬约束「引擎不得对具体内容 id 特判」）：
 *  用一个与 shadowthief:shadows 毫无关系的自造状态注册进 registry，avoid 契约必须同样触发，
 *  且与 gunslinger:bounty 共存时互不干扰（避伤 + CP 照发）。
 *
 * 断言消息里一律不写行号（按标识符引用，行号会漂移）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Action, GameState, Seat, StatusInstance } from '../index.js';
import {
  ContentRegistry, createDefaultRegistry, createMatch, reduce, getLegalActions,
  BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF, COMMON_CARDS, COMMON_STATUSES,
} from '../index.js';

const content = createDefaultRegistry();

// ── 场景构造（与 gunslinger.test.ts 同构） ──────────────────
function mkState(opts: {
  readonly seed?: string;
  readonly heroes?: readonly [string, string];
  readonly phase?: 'main1' | 'offensiveRoll';
  readonly dice?: readonly number[];
  readonly defenderStatuses?: readonly StatusInstance[];
  readonly attackerStatuses?: readonly StatusInstance[];
}): GameState {
  const heroes = opts.heroes ?? ['pyromancer', 'shadowthief'];
  const base = createMatch(content, { seed: opts.seed ?? 'qa-st', heroes: heroes as ['pyromancer', 'shadowthief'] });
  const p0 = {
    ...base.players[0],
    diceValues: [...(opts.dice ?? [1, 1, 1, 4, 5])],
    diceLocked: [false, false, false, false, false],
    statuses: [...(opts.attackerStatuses ?? [])],
  };
  const p1 = {
    ...base.players[1],
    statuses: [...(opts.defenderStatuses ?? [])],
  };
  return {
    ...base,
    phase: opts.phase ?? 'offensiveRoll',
    activeSeat: 0 as Seat,
    pending: null,
    players: [p0, p1],
  } as unknown as GameState;
}

/** 用指定 registry 推进（哨兵用例的自造状态只在其自建 registry 里可见） */
function stepWith(
  reg: ContentRegistry, state: GameState, seat: Seat, action: Action,
): { state: GameState; events: readonly import('../index.js').GameEvent[] } {
  const r = reduce(state, { seat, action, clientSeq: 1 }, reg);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** 走完整条防御阶梯：announce → 防御掷骰 → 防御窗口 pass → 结算完毕 */
function resolveAttackWith(reg: ContentRegistry, s0: GameState, abilityId: string, defender: Seat = 1): GameState {
  let s = stepWith(reg, s0, 0, { t: 'announceAbility', abilityId }).state;
  if (s.pending?.kind === 'defensiveRoll') s = stepWith(reg, s, defender, { t: 'defensiveRoll' }).state;
  if (s.pending?.kind === 'defenseWindow') s = stepWith(reg, s, defender, { t: 'respondPass' }).state;
  return s;
}

function step(state: GameState, seat: Seat, action: Action): { state: GameState; events: readonly import('../index.js').GameEvent[] } {
  const r = reduce(state, { seat, action, clientSeq: 1 }, content);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** 防御事件里的骰数（doDefensiveRoll 的 defenseRolled 事件） */
function defenseDiceCount(events: readonly import('../index.js').GameEvent[]): number | undefined {
  const e = events.find((x) => x.type === 'defenseRolled');
  return e ? (e.payload as { values?: number[] }).values?.length : undefined;
}

// ════════════════════════════════════════════════════════════════
// C4-1 Shadows：onAttacked.avoid 契约
// ════════════════════════════════════════════════════════════════
describe('C4-1 Shadows：被普通攻击时全部避开（onAttacked.avoid 契约）', () => {
  // 焰术士火球 L1：3 焰（面值 1-3）→ 4 点 attack（可防御）
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  test('正例：守方在暗影中 → 普通攻击伤害全避，HP 不变（攻击仍成功、其他效果照常）', () => {
    const s0 = mkState({
      dice: FIREBALL_4,
      defenderStatuses: [{ id: 'shadowthief:shadows', stacks: 1, sinceTurn: -1 }],
    });
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[1].hp, 50, '暗影必须全避普通攻击伤害');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'shadowthief:shadows'), '避伤不消耗阴影（persistent）');
  });

  test('豁免：Ultimate（undefendable）不被阴影避让 → 守方吃满 10', () => {
    const s0 = mkState({
      heroes: ['gunslinger', 'shadowthief'],
      dice: [6, 6, 6, 6, 6],
      defenderStatuses: [{ id: 'shadowthief:shadows', stacks: 1, sinceTurn: -1 }],
    });
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'gunslinger:fillEmWithLead' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[1].hp, 40, '官方细则：阴影不防 Ultimate 伤害（50-10=40）');
  });

  test('引擎中立哨兵：自造 avoid 状态同样避伤，且与悬赏共存时 CP 照发、伤害被避', () => {
    const reg = new ContentRegistry();
    reg.registerStatus({
      id: 'test:notShadows', name: '自造避伤状态', polarity: 'positive',
      stackLimit: 1, persistent: true, spendable: false, onAttacked: { avoid: true },
    });
    for (const h of [BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF]) reg.registerHero(h);
    COMMON_CARDS.forEach((c) => reg.registerCard(c));
    COMMON_STATUSES.forEach((st) => reg.registerStatus(st));
    assert.equal(reg.validate().length, 0, '自造状态必须通过注册表校验');

    // 守方选神枪手：其防御能力不带治疗（狂战士防御骰含生命面会回血，会污染 HP 断言）
    const base = createMatch(reg, { seed: 'qa-st-neutral', heroes: ['pyromancer', 'gunslinger'] });
    const s0 = {
      ...base,
      phase: 'offensiveRoll',
      activeSeat: 0 as Seat,
      pending: null,
      players: [
        { ...base.players[0], diceValues: [1, 1, 1, 4, 5], diceLocked: [false, false, false, false, false] },
        { ...base.players[1], statuses: [
          { id: 'test:notShadows', stacks: 1, sinceTurn: -1 },
          { id: 'gunslinger:bounty', stacks: 1 },
        ] },
      ],
    } as unknown as GameState;
    const cpBefore = s0.players[0].cp;
    const s = resolveAttackWith(reg, s0, 'pyromancer:fireball');
    assert.equal(s.players[1].hp, 50, '自造 avoid 状态必须与 shadows 同等避伤');
    assert.equal(s.players[0].cp, cpBefore + 1, '共存的悬赏 CP 照发（官方：攻击仍「成功」、其他效果照常）');
  });
});

// ════════════════════════════════════════════════════════════════
// C4-2 Shadows：discardAtTurnEnd 弃置时序
// ════════════════════════════════════════════════════════════════
describe('C4-2 Shadows：带着它完整结束一个自己回合后弃置', () => {
  /**
   * 影贼走完自己整回合：main1 →（endMainPhase）→ 进攻掷骰（放弃激活）→ main2 →（endMainPhase）→ discard → endTurn。
   * 官方弃置时序挂在 endTurn 上，故必须真正走到回合切换才断言。
   */
  function concludeTurn(s0: GameState): GameState {
    let s = step(s0, 0, { t: 'endMainPhase' }).state;          // main1 → offensiveRoll
    s = step(s, 0, { t: 'passAbility' }).state;                 // 放弃激活 → main2
    s = step(s, 0, { t: 'endMainPhase' }).state;                // main2 → discard
    // 手牌未超上限时 discard 自动 endTurn；超上限则先自动弃（mkState 手牌为发牌默认）
    if (s.pending?.kind === 'discard') s = step(s, 0, { t: 'discardCards', uids: [] }).state;
    return s;
  }

  /** 在影贼自己身上挂阴影（sinceTurn 相对当前回合偏移），避免构造时的自引用 */
  function withShadows(sRaw: GameState, sinceTurnOffset: number): GameState {
    const cur = sRaw.turn;
    const p0 = { ...sRaw.players[0], statuses: [{ id: 'shadowthief:shadows', stacks: 1, sinceTurn: cur + sinceTurnOffset } as StatusInstance] };
    return { ...sRaw, players: [p0, sRaw.players[1]] } as unknown as GameState;
  }

  test('本回合内获得的（Shadow Dance 场景）→ 回合结束不弃', () => {
    const s0 = withShadows(
      mkState({ heroes: ['shadowthief', 'pyromancer'], phase: 'main1' }), 0,
    );
    const s = concludeTurn(s0);
    assert.ok(s.players[0].statuses.some((st) => st.id === 'shadowthief:shadows'),
      '官方「a turn in which you started with the token」：本回合内获得的不随本回合结束弃置');
  });

  test('从回合开始就带着（如对手回合经暗影防御获得）→ 结束自己回合即弃', () => {
    const s0 = withShadows(
      mkState({ heroes: ['shadowthief', 'pyromancer'], phase: 'main1' }), -1,
    );
    const s = concludeTurn(s0);
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'shadowthief:shadows'),
      '已历经完整自己回合开场 → 回合结束必须弃置');
  });
});

// ════════════════════════════════════════════════════════════════
// C4-3 防御能力二选一（defensiveRoll.abilityId）
// ════════════════════════════════════════════════════════════════
describe('C4-3 双防御能力：官方「掷骰前二选一」', () => {
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  function attackDefensePending(): GameState {
    const s0 = mkState({ dice: FIREBALL_4 });
    return step(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
  }

  test('legalActions 对守方下发两条防御掷骰（暗影防御 / 反击），且带各自 abilityId', () => {
    const s = attackDefensePending();
    assert.equal(s.pending?.kind, 'defensiveRoll');
    const acts = getLegalActions(s, content, 1).filter((a) => a.t === 'defensiveRoll');
    assert.equal(acts.length, 2, `应有两条防御选项，实际 ${JSON.stringify(acts)}`);
    const ids = acts.map((a) => (a as { abilityId?: string }).abilityId).sort();
    assert.deepEqual(ids, ['shadowthief:counterStrike', 'shadowthief:shadowDefense']);
  });

  test('缺省（不带 abilityId）→ 第一个防御能力（暗影防御 L1 = 掷 4 骰）', () => {
    let s = attackDefensePending();
    const r = step(s, 1, { t: 'defensiveRoll' });
    assert.equal(defenseDiceCount(r.events), 4, '暗影防御 L1 官方掷 4 骰');
  });

  test('指定 counterStrike → 反击 L1（掷 5 骰）；指定无效 id 被拒', () => {
    let s = attackDefensePending();
    const r = step(s, 1, { t: 'defensiveRoll', abilityId: 'shadowthief:counterStrike' });
    assert.equal(defenseDiceCount(r.events), 5, '反击 L1 官方掷 5 骰');

    const s2 = attackDefensePending();
    const bad = reduce(s2, { seat: 1, action: { t: 'defensiveRoll', abilityId: 'test:nope' }, clientSeq: 1 }, content);
    assert.equal(bad.ok, false, '无效防御能力 id 必须被拒');
  });
});

// ════════════════════════════════════════════════════════════════
// C4-4 专属能力取证
// ════════════════════════════════════════════════════════════════
describe('C4-4 影贼专属能力', () => {
  test('Pickpocket L1：3 钱袋 → +2 CP；出阴影的偷取分支 choose 自动取 default（不偷）', () => {
    const s0 = mkState({ heroes: ['shadowthief', 'pyromancer'], dice: [3, 3, 3, 1, 1] });
    const cpBefore = s0.players[0].cp;
    const oppCpBefore = s0.players[1].cp;
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'shadowthief:pickpocket' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[0].cp, cpBefore + 2, '3 钱袋 = 2 CP');
    assert.equal(s.players[1].cp, oppCpBefore, 'choose 自动取保守 default：不偷对手 CP（显式记账偏差）');
  });

  test('Shadow Dance L1：3 阴影 → 掷 1 骰纯伤 ⌈roll/2⌉ + 获得阴影与偷袭', () => {
    const s0 = mkState({ heroes: ['shadowthief', 'pyromancer'], dice: [6, 6, 6, 1, 2] });
    const s = step(s0, 0, { t: 'announceAbility', abilityId: 'shadowthief:shadowDance' }).state;
    // 纯粹伤害不进可防御桶 → 不开防御窗口，直接结算
    const pureDmg = 50 - s.players[1].hp;
    assert.ok(pureDmg >= 1 && pureDmg <= 3, `纯伤应为 ⌈1..6/2⌉ ∈ [1,3]，实际 ${pureDmg}`);
    assert.ok(s.players[0].statuses.some((st) => st.id === 'shadowthief:shadows'), '必须获得阴影');
    assert.ok(s.players[0].statuses.some((st) => st.id === 'shadowthief:sneakAttack'), '必须获得偷袭');
  });

  test('Dagger Strike L1：3 匕首 → 4 伤害 + 出钱袋得 1 CP + 出阴影给对手上毒', () => {
    // 影贼骰面：1-2 匕首，3-4 钱袋，5 卡牌，6 阴影 → [1,1,2,3,6] = 3 匕首+1 钱袋+1 阴影
    const s0 = mkState({ heroes: ['shadowthief', 'pyromancer'], dice: [1, 1, 2, 3, 6] });
    const cpBefore = s0.players[0].cp;
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'shadowthief:daggerStrike' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.ok(s.players[0].cp > cpBefore, '出钱袋必须得 1 CP');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'common:poison'), '出阴影必须给对手施加毒');
  });
});
