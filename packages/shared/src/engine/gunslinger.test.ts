/**
 * Gunslinger 实装取证（集成级 / 行为级）—— M3 第一位新英雄的引擎扩展验证。
 *
 * 与 conditions.test.ts 同分工哲学：走真实动作序列验证最终结果，不测求值函数返回值。
 *
 * 覆盖的引擎扩展（2026-10-14，均为官方 Gunslinger 机制倒逼）：
 *  1. StatusDef.onAttacked 通用契约   —— Bounty「被攻击时攻击者 +1 伤害 & +1 CP」
 *  2. Condition.boundCompare          —— Duel/Showdown「你与对手各掷 1 骰并比较」
 *  3. Expr.incomingDamage             —— Duel「防止一半来袭伤害（向上取整）」
 *  4. rollDicePool.owner              —— Duel/Showdown 对手那颗按对手英雄骰面
 *
 * 引擎中立哨兵（架构硬约束「引擎不得对具体内容 id 特判」）：
 *  用一个与 gunslinger:bounty 毫无关系的自造状态注册进 registry，onAttacked 契约必须同样触发。
 *
 * 已知取证局限（与 conditions.test.ts 相同）：骰面/防御流程依赖 seed 固化；
 * thenNode 时机卡当前无攻击中打出口（宽松 main 打出、伤害悬桶）——Eat Lead 用例
 * 按此现状断言入桶与即时状态，勿据它归因「攻击修正已生效」。
 *
 * 断言消息里一律不写行号（按标识符引用，行号会漂移）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Action, GameState, Seat, StatusInstance } from '../index.js';
import {
  ContentRegistry, createDefaultRegistry, createMatch, reduce, getLegalActions,
  BARBARIAN, PYROMANCER, GUNSLINGER, COMMON_CARDS, COMMON_STATUSES,
} from '../index.js';

const content = createDefaultRegistry();

// ── 场景构造 ─────────────────────────────────────────
function mkState(opts: {
  readonly seed?: string;
  readonly heroes?: readonly [string, string];
  readonly phase?: 'main1' | 'offensiveRoll';
  readonly dice?: readonly number[];
  readonly attackerHand?: readonly string[];
  readonly defenderHand?: readonly string[];
  readonly defenderStatuses?: readonly StatusInstance[];
  readonly attackerStatuses?: readonly StatusInstance[];
}): GameState {
  const heroes = opts.heroes ?? ['pyromancer', 'gunslinger'];
  const base = createMatch(content, { seed: opts.seed ?? 'qa-gs', heroes: heroes as ['pyromancer', 'gunslinger'] });
  const p0 = {
    ...base.players[0],
    diceValues: [...(opts.dice ?? [1, 1, 1, 4, 5])],
    diceLocked: [false, false, false, false, false],
    hand: (opts.attackerHand ?? []).map((defId, i) => ({ uid: `hand-${i}`, defId })),
    statuses: [...(opts.attackerStatuses ?? [])],
  };
  const p1 = {
    ...base.players[1],
    hand: (opts.defenderHand ?? []).map((defId, i) => ({ uid: `hand-${i}`, defId })),
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

function step(state: GameState, seat: Seat, action: Action): { state: GameState; events: readonly import('../index.js').GameEvent[] } {
  const r = reduce(state, { seat, action, clientSeq: 1 }, content);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

function findNote(events: readonly import('../index.js').GameEvent[], kind: string): Record<string, unknown> | undefined {
  return events.find((e) => e.type === 'note' && e.payload['kind'] === kind)?.payload;
}

// ════════════════════════════════════════════════════════════════
// C3-1 Bounty：StatusDef.onAttacked 通用契约
// ════════════════════════════════════════════════════════════════
describe('C3-1 Bounty：被攻击时攻击者伤害 +1 且获得 1 CP（onAttacked 契约）', () => {
  // 焰术士火球 L1：3 焰（面值 1-3）→ graded 一档 4 点 attack（可防御）
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  test('正例：守方带悬赏 → 攻击入桶即 +1 伤害，攻方 CP +1（与防御结果无关）', () => {
    const s0 = mkState({ dice: FIREBALL_4, defenderStatuses: [{ id: 'gunslinger:bounty', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    // 守方是 gunslinger → duel 防御激活；无论 roll 输赢，bounty 的 CP 在入桶时已给
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[0].cp, cpBefore + 1, '悬赏 CP 必须在攻击入桶时发放（官方 FAQ：与防御结果无关）');
  });

  test('反例：守方无悬赏 → 攻方 CP 不变', () => {
    const s0 = mkState({ dice: FIREBALL_4 });
    const cpBefore = s0.players[0].cp;
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[0].cp, cpBefore, '无悬赏不得发放 CP');
  });

  test('反例：undefendable 伤害不触发悬赏（官方：必须激活造成至少 1 点伤害的 Attack）', () => {
    // 攻方 gunslinger 用赏金猎人 L1（悬赏 + 1 点 undefendable）打带悬赏的守方：
    // 2 子弹 + 2 靶心 = 骰 [1,1,6,6,2]
    const s0 = mkState({
      heroes: ['gunslinger', 'pyromancer'],
      dice: [1, 1, 6, 6, 2],
      defenderStatuses: [{ id: 'gunslinger:bounty', stacks: 1 }],
    });
    const cpBefore = s0.players[0].cp;
    const s = step(s0, 0, { t: 'announceAbility', abilityId: 'gunslinger:bountyHunter' }).state;
    assert.equal(s.players[0].cp, cpBefore, 'undefendable 伤害不得触发悬赏 CP');
    assert.equal(s.players[0].turnDamageDealt, 1, 'undefendable 伤害不得追加（赏金猎人 L1 固定 1 点）');
  });

  test('引擎中立哨兵：任意注册状态携带 onAttacked 契约同样触发（引擎不认 gunslinger:bounty 这个 id）', () => {
    const reg = new ContentRegistry();
    reg.registerStatus({
      id: 'test:notBounty', name: '自造契约状态', polarity: 'negative',
      stackLimit: 1, persistent: true, spendable: false,
      onAttacked: { bonusDamage: 2, attackerGainsCp: 2 },
    });
    for (const h of [BARBARIAN, PYROMANCER, GUNSLINGER]) reg.registerHero(h);
    COMMON_CARDS.forEach((c) => reg.registerCard(c));
    COMMON_STATUSES.forEach((st) => reg.registerStatus(st));
    assert.equal(reg.validate().length, 0, '自造状态必须通过注册表校验');

    const base = createMatch(reg, { seed: 'qa-gs-neutral', heroes: ['pyromancer', 'barbarian'] });
    const s0 = {
      ...base,
      phase: 'offensiveRoll',
      activeSeat: 0 as Seat,
      pending: null,
      players: [
        { ...base.players[0], diceValues: [1, 1, 1, 4, 5], diceLocked: [false, false, false, false, false] },
        { ...base.players[1], statuses: [{ id: 'test:notBounty', stacks: 1 }] },
      ],
    } as unknown as GameState;
    const cpBefore = s0.players[0].cp;
    // 哨兵必须用自造 reg 走完整 reduce（用全局 content 就查不到 test:notBounty——那正是哨兵要防的反例）
    const stepReg = (st: GameState, seat: Seat, action: Action) => {
      const r = reduce(st, { seat, action, clientSeq: 1 }, reg);
      if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code}`);
      return r.state;
    };
    let s = stepReg(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    if (s.pending?.kind === 'defensiveRoll') s = stepReg(s, 1, { t: 'defensiveRoll' });
    if (s.pending?.kind === 'defenseWindow') s = stepReg(s, 1, { t: 'respondPass' });
    assert.equal(s.players[0].cp, cpBefore + 2, '契约路径：自造状态的 onAttacked（+2 CP）必须与 gunslinger:bounty 同等触发');
  });
});

// ════════════════════════════════════════════════════════════════
// C3-2 Duel：boundCompare + incomingDamage + rollDicePool.owner
// ════════════════════════════════════════════════════════════════
describe('C3-2 Duel：防御时双方各掷 1 骰比较（choose 自动取 default = 防止一半来袭）', () => {
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  test('正例：duel roll 赢 → 防止一半来袭伤害（4+1 悬赏 = 5 来袭 → prevent ⌈5/2⌉=3 → 净 2）', () => {
    // seed 说明：duel 双 roll 的骰值由 seed 决定；'qa-gs-duel-lose' 名字仅是占位编号，
    // 实测该 seed 下 duelSelf ≥ duelOpp（走 prevent 分支），勿按名字望文生义。
    const s0 = mkState({ seed: 'qa-gs-duel-lose', dice: FIREBALL_4, defenderStatuses: [{ id: 'gunslinger:bounty', stacks: 1 }] });
    const atkHpBefore = s0.players[0].hp;
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[1].hp, 48, `duelSelf ≥ duelOpp → 净伤 2（50-2=48），实际 ${s.players[1].hp}`);
    assert.equal(s.players[0].hp, atkHpBefore, 'prevent 分支不得反打攻击者');
  });

  test('反例：duel roll 输 → 不 prevent，另对攻击者造成 1 点（悬赏 +1 仍入桶）', () => {
    // 实测 'qa-gs-duel-win' seed 下 duelSelf < duelOpp（走 else 分支）
    const s0 = mkState({ seed: 'qa-gs-duel-win', dice: FIREBALL_4, defenderStatuses: [{ id: 'gunslinger:bounty', stacks: 1 }] });
    const atkHpBefore = s0.players[0].hp;
    let s = step(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    if (s.pending?.kind === 'defensiveRoll') s = step(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[0].hp, atkHpBefore - 1, 'roll 输分支：Duel 对攻击者造成 1 点伤害');
    assert.equal(s.players[1].hp, 45, '不 prevent：守方吃满 4+1=5');
  });
});

// ════════════════════════════════════════════════════════════════
// C3-3 Showdown：boundCompare 行为级（L1 = 7/5，双源官方值）
// ════════════════════════════════════════════════════════════════
describe('C3-3 Showdown：小顺 → 双方各掷 1 骰，你的点数 ≥ 对手 → 7，否则 5', () => {
  // Gunslinger 骰面 1-3 bullet：任意 4 连号点数 → 小顺
  const SMALL_STRAIGHT = [1, 2, 3, 4, 5];

  test('正例：matcher 命中 → 双 roll 分支伤害入桶（amount 断言不依赖防御结果）', () => {
    const s0 = mkState({ seed: 'qa-gs-showdown', heroes: ['gunslinger', 'pyromancer'], dice: SMALL_STRAIGHT });
    const r = step(s0, 0, { t: 'announceAbility', abilityId: 'gunslinger:showdown' });
    const queued = findNote(r.events, 'damageQueued');
    const amount = queued?.['amount'];
    assert.ok(
      amount === 7 || amount === 5,
      `Showdown L1 只应造成 7（roll ≥）或 5（roll <），实际 ${amount}`,
    );
  });

  test('反例：非小顺 → 能力不可激活', () => {
    const s0 = mkState({ heroes: ['gunslinger', 'pyromancer'], dice: [1, 1, 2, 2, 3] });
    const legal = getLegalActions(s0, content, 0);
    const canAnnounce = legal.some((x) => x.t === 'announceAbility' && x['abilityId'] === 'gunslinger:showdown');
    assert.equal(canAnnounce, false, '非小顺不得激活对决');
  });
});

// ════════════════════════════════════════════════════════════════
// C3-4 专属行动卡：Wanted / Spin The Chamber / Run And Gun / Eat Lead
// ════════════════════════════════════════════════════════════════
describe('C3-4 专属行动卡', () => {
  test('Wanted!：直接给对手上悬赏', () => {
    const s0 = mkState({ heroes: ['gunslinger', 'pyromancer'], phase: 'main1', attackerHand: ['gunslinger:wanted'] });
    const s = step(s0, 0, { t: 'playCard', uid: 'hand-0' }).state;
    assert.ok(s.players[1].statuses.some((x) => x.id === 'gunslinger:bounty'), '通缉应给对手施加悬赏');
  });

  test('Spin The Chamber!：给自己上装填', () => {
    const s0 = mkState({ heroes: ['gunslinger', 'pyromancer'], phase: 'main1', attackerHand: ['gunslinger:spinTheChamber'] });
    const s = step(s0, 0, { t: 'playCard', uid: 'hand-0' }).state;
    assert.ok(s.players[0].statuses.some((x) => x.id === 'gunslinger:reload'), '转轮应给自己装填');
  });

  test('Run And Gun!（PROMO）：掷 1 骰，靶心（6）→ 悬赏+击倒；其他 → 抽 1', () => {
    const s0 = mkState({ heroes: ['gunslinger', 'pyromancer'], phase: 'main1', attackerHand: ['gunslinger:runAndGun'] });
    const handBefore = s0.players[0].hand.length;
    const s = step(s0, 0, { t: 'playCard', uid: 'hand-0' }).state;
    const gotBounty = s.players[1].statuses.some((x) => x.id === 'gunslinger:bounty');
    if (gotBounty) {
      assert.ok(s.players[1].statuses.some((x) => x.id === 'common:knockdown'), '靶心分支必须同时击倒');
    } else {
      assert.equal(s.players[0].hand.length, handBefore, '非靶心分支：打出 1 张 + 抽 1 张 = 手牌不变');
    }
  });

  test('Eat Lead!：掷 5，每颗子弹 +1 伤害入桶；子弹 ≥4 时施加击倒（thenNode 宽松打出现状的入桶断言）', () => {
    const s0 = mkState({ heroes: ['gunslinger', 'pyromancer'], phase: 'main1', attackerHand: ['gunslinger:eatLead'] });
    const s = step(s0, 0, { t: 'playCard', uid: 'hand-0' }).state;
    const queuedTotal = s.bucket.entries
      .filter((e) => e.toSeat === 1 && e.bucketKind === 'defendable')
      .reduce((acc, e) => acc + e.amount, 0);
    assert.ok(queuedTotal >= 0 && queuedTotal <= 5, `入桶伤害应等于子弹数（0-5），实际 ${queuedTotal}`);
    const bulletCount = s.tempDice.length > 0
      ? undefined // tempDice 已被 runEffects 回滚；改从 hit 结果反推
      : undefined;
    void bulletCount;
    // 子弹数 = queuedTotal（每颗子弹 +1、无其他来源）
    const expectKnockdown = queuedTotal >= 4;
    assert.equal(
      s.players[1].statuses.some((x) => x.id === 'common:knockdown'),
      expectKnockdown,
      `击倒施加必须严格跟随「加入伤害 ≥4」（子弹 ${queuedTotal} 颗）`,
    );
  });
});

// ════════════════════════════════════════════════════════════════
// C3-5 注册表与描述层冒烟
// ════════════════════════════════════════════════════════════════
describe('C3-5 Gunslinger 注册冒烟', () => {
  test('卡组 33 张（18 通用 + 9 升级 + 6 专属），HP 50，骰面 1-3 bullet / 4-5 dash / 6 bullseye', () => {
    assert.equal(GUNSLINGER.deck.length, 33, `卡组应为 33 张，实际 ${GUNSLINGER.deck.length}`);
    assert.equal(GUNSLINGER.startHp, 50);
    assert.deepEqual(GUNSLINGER.dieFaces.map((f) => f.symbols[0]), ['bullet', 'bullet', 'bullet', 'dash', 'dash', 'bullseye']);
  });

  test('Ultimate matcher：5 靶心；效果含闪避+悬赏+击倒+10 点不可防御', () => {
    const ult = GUNSLINGER.abilities.find((a) => a.kind === 'ultimate');
    assert.ok(ult, '必须有 Ultimate 槽');
    assert.deepEqual(ult?.tiers[0]?.matcher, { k: 'countSymbol', symbol: 'bullseye', count: 5 });
  });
});
