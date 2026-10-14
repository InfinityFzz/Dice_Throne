/**
 * MoonElf 取证（集成级 / 行为级）—— 第八轮引擎契约扩展 + 第九轮内容层实装。
 *
 * 【C5 段 · 第八轮引擎契约】覆盖的引擎契约（2026-10-14，均由官方 MoonElf 面板机制倒逼，全部通用、零英雄特判）：
 *  1. StatusDef.onAttacked 逐字段独立求值    —— TARGETED「+2 incoming Attack damage」只有 bonusDamage
 *  2. StatusDef.onRollPhaseStart              —— ENTANGLE「next Offensive Roll Phase 少 N 次掷骰」
 *  3. StatusDef.onConcludeRollPhase.failDie   —— BLIND「收场时移除并掷骰，1-2 则整个阶段失败、无任何效果」
 *  4. StatusDef.expiresAtRollPhaseEnd         —— ENTANGLE「At the conclusion of the Roll Phase, remove this token」
 *
 * 引擎中立守门（架构硬约束「引擎不得对具体内容 id 特判」）：
 * C5 段全部用例用**自建 registry + 自造状态**（test: 前缀，与任何英雄面板 token 无关），
 * 且必须走该 registry 自己的 reduce —— 用模块级全局 content 会查不到自造状态，
 * 那正是守门要防的反例。
 * 【M5 段 · 第九轮内容层】相反：被测对象就是 moonelf: 前缀的真实内容
 * （13 能力 / 3 状态 / 15 专属卡），统一走默认 registry（createDefaultRegistry）
 * 自己的 reduce —— 两段的 registry 分工不得混用。
 *
 * 已知取证局限（与 Gunslinger / ShadowThief 两轮相同）：骰面/防御流程依赖 seed 固化；
 * 守方统一用神枪手（狂战士防御骰含生命面会回血，会污染守方 HP 断言）。
 *
 * 断言消息里一律不写行号（按标识符引用，行号会漂移）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Action, GameState, Seat, StatusInstance } from '../index.js';
import type { CardDef, StatusDef } from '../types/content.js';
import {
  ContentRegistry, createDefaultRegistry, createMatch, reduce, getLegalActions,
  BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF, MOONELF, COMMON_CARDS, COMMON_STATUSES,
} from '../index.js';

// ── 场景构造 ─────────────────────────────────────────
/** 自建 registry：四位既有英雄仅作对局 fixture，被测对象一律是 test: 前缀自造状态 */
function buildRegistry(extra: readonly StatusDef[]): ContentRegistry {
  const reg = new ContentRegistry();
  for (const h of [BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF]) reg.registerHero(h);
  COMMON_CARDS.forEach((c) => reg.registerCard(c));
  COMMON_STATUSES.forEach((st) => reg.registerStatus(st));
  for (const st of extra) reg.registerStatus(st);
  assert.equal(reg.validate().length, 0, '自建 registry 必须通过注册表校验');
  return reg;
}

/** 自造状态默认值（negative / limit 1 / persistent，与官方 TARGETED·ENTANGLE·BLIND 同规格） */
function mkStatus(id: string, over: Partial<StatusDef>): StatusDef {
  return { id, name: id, polarity: 'negative', stackLimit: 1, persistent: true, spendable: false, ...over };
}

function mkState(reg: ContentRegistry, opts: {
  readonly seed?: string;
  readonly heroes?: readonly [string, string];
  readonly phase?: 'main1' | 'offensiveRoll';
  readonly dice?: readonly number[];
  readonly activeStatuses?: readonly StatusInstance[];
  readonly defenderStatuses?: readonly StatusInstance[];
}): GameState {
  const heroes = opts.heroes ?? ['pyromancer', 'gunslinger'];
  const base = createMatch(reg, { seed: opts.seed ?? 'qa-me', heroes: heroes as ['pyromancer', 'gunslinger'] });
  const p0 = {
    ...base.players[0],
    diceValues: [...(opts.dice ?? [1, 1, 1, 4, 5])],
    diceLocked: [false, false, false, false, false],
    statuses: [...(opts.activeStatuses ?? [])],
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

/** 必须用自建 registry 自己的 reduce（全局 content 查不到 test: 前缀自造状态） */
function step(reg: ContentRegistry, state: GameState, seat: Seat, action: Action): {
  state: GameState; events: readonly import('../index.js').GameEvent[];
} {
  const r = reduce(state, { seat, action, clientSeq: 1 }, reg);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

function findNote(events: readonly import('../index.js').GameEvent[], kind: string): Record<string, unknown> | undefined {
  return events.find((e) => e.type === 'note' && e.payload['kind'] === kind)?.payload;
}

/** 进攻方（seat 0）宣告火球后、防御结算前的入桶可防御伤害总量 */
function queuedDefendable(s: GameState, to: Seat = 1): number {
  return s.bucket.entries
    .filter((e) => e.toSeat === to && e.bucketKind === 'defendable')
    .reduce((acc, e) => acc + e.amount, 0);
}

// ════════════════════════════════════════════════════════════════
// C5-1 onAttacked 逐字段独立求值（TARGETED 只有 bonusDamage）
// ════════════════════════════════════════════════════════════════
describe('C5-1 onAttacked：bonusDamage 与 attackerGainsCp 逐字段独立生效', () => {
  // 焰术士火球 L1：3 焰（面值 1-3）→ 4 点 attack（可防御）
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  test('正例：守方带 bonusDamage-only 状态 → 入桶 +2 伤害，攻方 CP 不变（TARGETED 无 CP 字段）', () => {
    const reg = buildRegistry([mkStatus('test:notTargeted', { onAttacked: { bonusDamage: 2 } })]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:notTargeted', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const s = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(queuedDefendable(s), 6, 'TARGETED 契约必须追加 +2 入桶伤害（4+2）');
    assert.equal(s.players[0].cp, cpBefore, '只有 bonusDamage 时不得发放 CP');
  });

  test('正例：守方带 attackerGainsCp-only 状态 → 攻方 CP +2，入桶伤害不变（纯 CP 不得被漏发）', () => {
    const reg = buildRegistry([mkStatus('test:notBountyCp', { onAttacked: { attackerGainsCp: 2 } })]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:notBountyCp', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const s = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(s.players[0].cp, cpBefore + 2, '只有 attackerGainsCp 时也必须发放（逐字段独立定位）');
    assert.equal(queuedDefendable(s), 4, '没有 bonusDamage 字段不得追加伤害');
  });

  test('回归：两字段皆有（Bounty 同构）→ 入桶 +1 且 CP +1（既有行为不破）', () => {
    const reg = buildRegistry([mkStatus('test:bothFields', { onAttacked: { bonusDamage: 1, attackerGainsCp: 1 } })]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:bothFields', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const s = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(queuedDefendable(s), 5, '两字段皆有时伤害加成照常');
    assert.equal(s.players[0].cp, cpBefore + 1, '两字段皆有时 CP 照常');
  });

  test('反例：守方无 onAttacked 状态 → 入桶 4、CP 不变', () => {
    const reg = buildRegistry([mkStatus('test:plain', {})]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:plain', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const s = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(queuedDefendable(s), 4, '无契约状态不得追加伤害');
    assert.equal(s.players[0].cp, cpBefore, '无契约状态不得发放 CP');
  });

  test('反例：undefendable 伤害不触发 bonusDamage（hook 只认 attack 类型）', () => {
    // 攻方神枪手赏金猎人 L1：2 子弹 + 2 靶心 → 悬赏 + 1 点 undefendable
    const reg = buildRegistry([mkStatus('test:notTargeted', { onAttacked: { bonusDamage: 2 } })]);
    const s0 = mkState(reg, {
      heroes: ['gunslinger', 'pyromancer'],
      dice: [1, 1, 6, 6, 2],
      defenderStatuses: [{ id: 'test:notTargeted', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'gunslinger:bountyHunter' });
    // 纯 undefendable 不开防御窗口，announce 当场 flush（桶已空）——按落钉结果断言
    assert.equal(r.state.players[1].hp, 49, '赏金猎人 L1 固定 1 点不可防御，bonusDamage 不得追加');
    assert.equal(r.state.players[0].turnDamageDealt, 1, '记入「造成的伤害」的必须只有那 1 点');
  });
});

// ════════════════════════════════════════════════════════════════
// C5-2 onRollPhaseStart：进攻掷骰阶段开场汇总 delta（ENTANGLE 少 N 次）
// ════════════════════════════════════════════════════════════════
describe('C5-2 onRollPhaseStart：开场按进攻方状态汇总掷骰次数修正', () => {
  /** main1 结束 → 进入进攻掷骰阶段（openOffensiveRoll 在此结算 delta） */
  function openRoll(reg: ContentRegistry, s0: GameState): GameState {
    return step(reg, s0, 0, { t: 'endMainPhase' }).state;
  }

  test('正例：delta -1 → 开场后剩 2 次，legalActions 标签跟随（ENTANGLE 官方值）', () => {
    const reg = buildRegistry([mkStatus('test:notEntangle', { onRollPhaseStart: { rollAttemptsDelta: -1 } })]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.phase, 'offensiveRoll');
    assert.equal(s.players[0].rollAttemptsLeft, 2, '官方「1 fewer roll attempts」：3-1=2');
    const roll = getLegalActions(s, reg, 0).find((a) => a.t === 'performRoll');
    assert.ok(roll?.label.includes('剩 2 次'), `legalActions 展示必须跟随契约，实际标签：${roll?.label}`);
  });

  test('汇总：两个 -1 状态同时在场 → 剩 1 次（按状态列表逐条累加）', () => {
    const reg = buildRegistry([
      mkStatus('test:notEntangle', { onRollPhaseStart: { rollAttemptsDelta: -1 } }),
      mkStatus('test:notEntangle2', { onRollPhaseStart: { rollAttemptsDelta: -1 } }),
    ]);
    const s0 = mkState(reg, {
      phase: 'main1',
      activeStatuses: [
        { id: 'test:notEntangle', stacks: 1 },
        { id: 'test:notEntangle2', stacks: 1 },
      ],
    });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 1, 'delta 必须按当前进攻方身上状态汇总');
  });

  test('契约双向：delta +1 → 剩 4 次（不正装负数，通用契约不预设方向）', () => {
    const reg = buildRegistry([mkStatus('test:notEntangle', { onRollPhaseStart: { rollAttemptsDelta: 1 } })]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 4, '正 delta 必须同样生效');
  });

  test('下限：delta -5 → 0 次且 performRoll 被拒（不得产生负数次数）', () => {
    const reg = buildRegistry([mkStatus('test:notEntangle', { onRollPhaseStart: { rollAttemptsDelta: -5 } })]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 0, '汇总结果下限 0');
    const bad = reduce(s, { seat: 0, action: { t: 'performRoll' }, clientSeq: 1 }, reg);
    assert.equal(bad.ok, false, '0 次时掷骰必须被拒');
    const roll = getLegalActions(s, reg, 0).find((a) => a.t === 'performRoll');
    assert.equal(roll?.enabled, false, '0 次时 legalActions 必须灰显');
    assert.ok(roll?.reason?.includes('用尽'), `灰显原因应说明次数用尽，实际：${roll?.reason}`);
  });

  test('反例：无该契约状态 → 3 次（既有行为不破）', () => {
    const reg = buildRegistry([mkStatus('test:plain', {})]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:plain', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 3, '没有 onRollPhaseStart 的状态必须保持基础 3 次');
  });
});

// ════════════════════════════════════════════════════════════════
// C5-3 onConcludeRollPhase.failDie：收场掷骰定阶段生死（BLIND）
// ════════════════════════════════════════════════════════════════
describe('C5-3 onConcludeRollPhase.failDie：收场移除并掷骰，命中失败面则整个阶段作废', () => {
  const blind = (over?: Partial<StatusDef>): StatusDef =>
    mkStatus('test:notBlind', {
      onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } },
      ...over,
    });

  test('命中失败面（seed 固化骰=2）：状态先移除、阶段作废直接进 main2，能力不激活且无任何效果', () => {
    // seed 说明：'qa-me-blind-hit' 仅为可复现编号；实测该 seed 下收场掷骰为 2（命中失败面）。
    const reg = buildRegistry([blind()]);
    const s0 = mkState(reg, {
      seed: 'qa-me-blind-hit',
      activeStatuses: [{ id: 'test:notBlind', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const s = r.state;
    // 状态已被移除（官方「must remove this token and roll 1 die」——移除先于掷骰、与骰果无关）
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notBlind'), '收场必须先移除该状态');
    const changed = r.events.find((e) => e.type === 'statusChanged' && e.payload['statusId'] === 'test:notBlind');
    assert.equal((changed?.payload as { delta?: number })?.delta, -1, '移除必须发 statusChanged 事件');
    // 阶段作废：不激活能力、不入桶、不开防御
    assert.equal(s.phase, 'main2', '作废后直接进入主阶段二');
    assert.equal(s.pending?.kind, 'cardWindow', '作废后只应挂主阶段二的打牌窗口');
    assert.equal(s.bucket.entries.length, 0, '作废路径不得留下任何入桶伤害');
    assert.equal(s.players[0].defenseUsed, false, '作废路径不得触发防御');
    assert.ok(!r.events.some((e) => e.type === 'abilityActivated'), '作废时能力不得激活');
    assert.ok(!findNote(r.events, 'damageQueued'), '作废时不得有伤害入桶');
    assert.equal(s.players[1].hp, 50, '作废时守方 HP 不得变化');
    // UI 可呈现：掷骰事件带骰值/失败面/作废标记
    const ev = findNote(r.events, 'rollPhaseFailDie');
    assert.deepEqual((ev as { values?: number[] })?.values, [2], '收场掷骰事件必须带骰值');
    assert.deepEqual((ev as { failValues?: number[] })?.failValues, [1, 2], '收场掷骰事件必须带失败面值');
    assert.equal((ev as { failed?: boolean })?.failed, true, '命中失败面时 failed 必须为 true');
    assert.ok(findNote(r.events, 'rollPhaseFailed'), '必须发作废事件供 UI 呈现');
  });

  test('未命中失败面（seed 固化骰=4）：状态移除后能力照常激活（防御挂起 + 4 伤害入桶）', () => {
    // seed 说明：'qa-me-blind-miss' 同为可复现编号；实测该 seed 下收场掷骰为 4（未命中）。
    const reg = buildRegistry([blind()]);
    const s0 = mkState(reg, {
      seed: 'qa-me-blind-miss',
      activeStatuses: [{ id: 'test:notBlind', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const s = r.state;
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notBlind'), '无论骰果如何都要移除');
    assert.equal((findNote(r.events, 'rollPhaseFailDie') as { failed?: boolean })?.failed, false, '未命中时 failed 必须为 false');
    assert.ok(!findNote(r.events, 'rollPhaseFailed'), '未命中不得发作废事件');
    assert.equal(s.pending?.kind, 'defensiveRoll', '未命中时能力照常结算（开防御窗口）');
    assert.equal(queuedDefendable(s), 4, '未命中时火球 4 点伤害照常入桶');
  });

  test('放弃激活出口同样触发：状态移除 + 掷骰事件 + 阶段进 main2（官方不区分出口）', () => {
    const reg = buildRegistry([blind()]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'passAbility' });
    const s = r.state;
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notBlind'), '放弃激活同样要移除该状态');
    assert.ok(findNote(r.events, 'rollPhaseFailDie'), '放弃激活同样要掷骰并发事件');
    assert.equal(s.phase, 'main2', '放弃激活后照常进主阶段二');
  });

  test('count/failValues 泛化：count 2 → 掷 2 颗；failed 与失败面命中严格一致', () => {
    const reg = buildRegistry([blind({ onConcludeRollPhase: { failDie: { count: 2, failValues: [6] } } })]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failed?: boolean };
    assert.equal(ev?.values?.length, 2, 'count 2 必须掷 2 颗');
    assert.equal(ev?.failed, (ev?.values ?? []).includes(6), 'failed 必须与失败面命中一致');
    // 阶段走向与作废标记一致（作废 → main2；未作废 → 防御挂起）
    if (ev?.failed) {
      assert.equal(r.state.phase, 'main2');
      assert.equal(r.state.bucket.entries.length, 0, '作废路径不入桶');
    } else {
      assert.equal(r.state.pending?.kind, 'defensiveRoll');
    }
  });
});

// ════════════════════════════════════════════════════════════════
// C5-4 expiresAtRollPhaseEnd：掷骰阶段结论即弃置（ENTANGLE）
// ════════════════════════════════════════════════════════════════
describe('C5-4 expiresAtRollPhaseEnd：结论时移除（与 discardAtTurnEnd 时机分离）', () => {
  const entangle = (over?: Partial<StatusDef>): StatusDef =>
    mkStatus('test:notEntangle', { expiresAtRollPhaseEnd: true, ...over });

  test('宣布能力出口：状态在能力激活前已被移除（能力照常结算）', () => {
    const reg = buildRegistry([entangle()]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notEntangle'),
      '结论时（宣布能力）必须移除该状态');
    assert.ok(findNote(r.events, 'rollPhaseTokenExpired'), '结论弃置必须发事件供 UI 呈现');
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '弃置不影响能力照常激活');
  });

  test('放弃激活出口：状态移除 + 阶段进 main2', () => {
    const reg = buildRegistry([entangle()]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'passAbility' });
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notEntangle'),
      '放弃激活同样是阶段结论，必须移除');
    assert.equal(r.state.phase, 'main2');
  });

  test('官方「remove this token」= 整枚移除：3 层一次收场全弃（不是 1 层）', () => {
    const reg = buildRegistry([entangle()]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notEntangle', stacks: 3 }] });
    const r = step(reg, s0, 0, { t: 'passAbility' });
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notEntangle'), '整枚 token 必须被移除');
    const changed = r.events.find((e) => e.type === 'statusChanged' && e.payload['statusId'] === 'test:notEntangle');
    assert.equal((changed?.payload as { delta?: number })?.delta, -3, '移除量必须是全部层数');
  });

  test('时机分离守门：expiresAtRollPhaseEnd 收场即弃；discardAtTurnEnd 收场不弃、endTurn 才弃', () => {
    const reg = buildRegistry([
      entangle(),
      mkStatus('test:notShadows', { discardAtTurnEnd: true }),
    ]);
    const s0 = mkState(reg, {
      phase: 'main1',
      activeStatuses: [
        { id: 'test:notEntangle', stacks: 1 },
        // sinceTurn 取当前回合-1：模拟「从回合开始就带着」，endTurn 时满足弃置条件
        { id: 'test:notShadows', stacks: 1, sinceTurn: -1 },
      ],
    });
    // 完整回合：main1 →endMainPhase→ offensiveRoll →passAbility→ main2 →endMainPhase→ discard →endTurn
    let s = step(reg, s0, 0, { t: 'endMainPhase' }).state;   // main1 → offensiveRoll（开场钩子）
    s = step(reg, s, 0, { t: 'passAbility' }).state;          // 收场：ENTANGLE 移除、Shadows 保留
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notEntangle'),
      'expiresAtRollPhaseEnd 必须在掷骰阶段收场即弃，不等回合结束');
    assert.ok(s.players[0].statuses.some((st) => st.id === 'test:notShadows'),
      'discardAtTurnEnd 不得在收场被提前弃置（两个时机不得混用）');
    s = step(reg, s, 0, { t: 'endMainPhase' }).state;         // main2 → discard → endTurn
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notShadows'),
      'discardAtTurnEnd 仍须在 endTurn 弃置（既有契约行为不破）');
  });
});

// ════════════════════════════════════════════════════════════════
// M5 内容层取证：MoonElf 第九轮实装（官方 moonelf: 前缀真实内容）
//
// 与 C5 段分工：C5 用 test: 自造状态证明「契约通用、引擎不特判」；
// 本段用默认 registry 里的真实 MoonElf 内容证明「实装正确接线」。
// 官方数值口径（2026-10-14 三源交叉：TTS 面板原图 + 2017 规则书 + namu）：
//  骰面 1-3 ARROW / 4-5 FOOT / 6 MOON；diceCount 5；HP 50；
//  13 能力 / 3 状态 / 15 专属卡（10 升级 + 5 行动），卡组 33 = 18 通用 + 10 + 5。
// seed 固化说明：RNG 流 dice:fail:<seat> / dice:def:<seat> / dice:pool:<seat>
// 按 seed 确定，故每个依赖掷骰的用例都在注释里钉死实测骰值。
// ════════════════════════════════════════════════════════════════

/** 内容取证 registry：默认全量内容（含第五位英雄 MoonElf 实装） */
const content = createDefaultRegistry();

/** 内容层场景构造（支持攻防双方升级槽；tier 键 = 基础能力 id，如 'moonelf:longbow'） */
function mkStateOn(reg: ContentRegistry, opts: {
  readonly seed?: string;
  readonly heroes?: readonly [string, string];
  readonly phase?: 'main1' | 'offensiveRoll';
  readonly dice?: readonly number[];
  readonly activeStatuses?: readonly StatusInstance[];
  readonly defenderStatuses?: readonly StatusInstance[];
  readonly upgrades?: Record<string, number>;
  readonly defenderUpgrades?: Record<string, number>;
}): GameState {
  const heroes = opts.heroes ?? ['moonelf', 'gunslinger'];
  const base = createMatch(reg, { seed: opts.seed ?? 'qa-me', heroes: heroes as ['moonelf', 'gunslinger'] });
  const p0 = {
    ...base.players[0],
    diceValues: [...(opts.dice ?? [1, 1, 1, 4, 5])],
    diceLocked: [false, false, false, false, false],
    statuses: [...(opts.activeStatuses ?? [])],
    upgrades: { ...(opts.upgrades ?? {}) },
  };
  const p1 = {
    ...base.players[1],
    statuses: [...(opts.defenderStatuses ?? [])],
    upgrades: { ...(opts.defenderUpgrades ?? {}) },
  };
  return {
    ...base,
    phase: opts.phase ?? 'offensiveRoll',
    activeSeat: 0 as Seat,
    pending: null,
    players: [p0, p1],
  } as unknown as GameState;
}

/** 内容层单步（必须走默认 registry，与 C5 段的自建 registry 分工） */
function stepC(state: GameState, seat: Seat, action: Action): {
  state: GameState; events: readonly import('../index.js').GameEvent[];
} {
  const r = reduce(state, { seat, action, clientSeq: 1 }, content);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** 防御掷骰事件里的骰值（doDefensiveRoll 的 defenseRolled 顶层事件，非 note） */
function defenseDice(events: readonly import('../index.js').GameEvent[]): number[] | undefined {
  const e = events.find((x) => x.type === 'defenseRolled');
  return e ? (e.payload as { values?: number[] }).values : undefined;
}

/** 进攻方宣告能力后、守方防御掷骰前，入桶到 toSeat 的可防御伤害总量 */
function queuedTo(s: GameState, toSeat: Seat): number {
  return s.bucket.entries
    .filter((e) => e.toSeat === toSeat && e.bucketKind === 'defendable')
    .reduce((acc, e) => acc + e.amount, 0);
}

// ── M5-1 注册冒烟 ─────────────────────────────────────────
describe('M5-1 MoonElf 注册冒烟：默认 registry 挂载完整、对局可建', () => {
  test('英雄本体：骰面 1-3 ARROW / 4-5 FOOT / 6 MOON、掷 5 骰、50 HP', () => {
    const hero = content.getHero('moonelf');
    assert.ok(hero, '默认 registry 必须已注册 moonelf');
    assert.equal(hero.diceCount, 5, '官方 diceCount 5');
    assert.equal(hero.startHp, 50, 'S1 全英雄 50 HP');
    assert.deepEqual(
      hero.dieFaces.map((f) => [f.value, [...f.symbols].sort()]),
      [[1, ['arrow']], [2, ['arrow']], [3, ['arrow']], [4, ['foot']], [5, ['foot']], [6, ['moon']]],
      '官方骰面：1-3 箭 / 4-5 足 / 6 月',
    );
  });

  test('内容规模：13 能力 / 3 状态 / 33 张卡组（18 通用 + 10 升级 + 5 行动）', () => {
    const hero = content.getHero('moonelf');
    assert.equal(hero?.abilities.length, 13, '官方 13 个能力槽（含 Ultimate 与防御）');
    assert.equal(hero?.statuses.length, 3, '官方 3 个专属状态（锁定/缠足/致盲）');
    assert.equal(hero?.deck.length, 33, '卡组 33 张');
    const upgrades = hero?.deck.filter((c) => c.kind === 'upgrade') ?? [];
    assert.equal(upgrades.length, 10, '10 张专属升级卡');
    const heroCards = (hero?.deck ?? []).filter((c) => c.kind !== 'upgrade'
      && !COMMON_CARDS.some((cc) => cc.defId === c.defId));
    assert.equal(heroCards.length, 5, '5 张专属行动卡（月之魔法/接招/齐射/闪避/暗月之影）');
    const commonInDeck = (hero?.deck ?? []).filter((c) => COMMON_CARDS.some((cc) => cc.defId === c.defId));
    assert.equal(commonInDeck.length, 18, '18 张通用卡原样入组');
  });

  test('三状态注册且 registry 校验通过（upgradeCostCP 非递减等注册表规则）', () => {
    for (const id of ['moonelf:targeted', 'moonelf:entangle', 'moonelf:blind']) {
      assert.ok(content.getStatus(id), `状态 ${id} 必须已注册`);
    }
    assert.equal(content.validate().length, 0, '默认 registry 必须通过注册表校验');
  });

  test('对局可建：月精灵 vs 神枪手，双方 50 HP', () => {
    const s = createMatch(content, { seed: 'qa-me-smoke', heroes: ['moonelf', 'gunslinger'] });
    assert.equal(s.players[0].heroId, 'moonelf');
    assert.equal(s.players[0].hp, 50);
    assert.equal(s.players[1].hp, 50);
  });
});

// ── M5-2 锁定（TARGETED）：+2 不给 CP（对照悬赏两字段） ────
describe('M5-2 锁定（moonelf:targeted）：被攻击 +2 伤害、攻击者不得 CP', () => {
  // 焰术士火球 L1：3 焰（面值 1-3）→ 4 点 attack（可防御）
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  test('正例：守方带锁定 → 入桶 4+2=6，攻方 CP 不变（纯 bonusDamage 不得误发 CP）', () => {
    const s0 = mkStateOn(content, {
      heroes: ['pyromancer', 'gunslinger'],
      dice: FIREBALL_4,
      defenderStatuses: [{ id: 'moonelf:targeted', stacks: 1 }],
    });
    const cpBefore = s0.players[0].cp;
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(queuedTo(s, 1), 6, '锁定必须追加 +2 入桶伤害（4+2）');
    assert.equal(s.players[0].cp, cpBefore, '锁定没有 attackerGainsCp 字段，攻方 CP 不得变化');
  });

  test('对照：守方带神枪手悬赏 → 入桶 4+1=5 且攻方 CP +1（两字段状态的既有行为）', () => {
    const s0 = mkStateOn(content, {
      heroes: ['pyromancer', 'gunslinger'],
      dice: FIREBALL_4,
      defenderStatuses: [{ id: 'gunslinger:bounty', stacks: 1 }],
    });
    const cpBefore = s0.players[0].cp;
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(queuedTo(s, 1), 5, '悬赏 +1 入桶伤害（4+1）');
    assert.equal(s.players[0].cp, cpBefore + 1, '悬赏必须给攻击者 +1 CP');
  });

  test('反例：守方无状态 → 入桶 4、CP 不变', () => {
    const s0 = mkStateOn(content, { heroes: ['pyromancer', 'gunslinger'], dice: FIREBALL_4 });
    const cpBefore = s0.players[0].cp;
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' }).state;
    assert.equal(queuedTo(s, 1), 4, '无状态不得追加伤害');
    assert.equal(s.players[0].cp, cpBefore, '无状态不得发放 CP');
  });
});

// ── M5-3 缠足（ENTANGLE）：完整回合流 3→2 且结论即弃 ──────
describe('M5-3 缠足（moonelf:entangle）：对手进攻掷骰 3→2，阶段结论整枚移除', () => {
  test('完整回合流：缠足射击上 token → 对手回合开场剩 2 次 → 对手收场即弃', () => {
    // 月精灵小顺 [1,2,3,4,5] → 缠足射击 L1：缠足 + 7 伤（守方神枪手）
    const s0 = mkStateOn(content, { heroes: ['moonelf', 'gunslinger'], dice: [1, 2, 3, 4, 5] });
    let s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:entanglingShot' }).state;
    assert.equal(s.pending?.kind, 'defensiveRoll', '缠足射击 7 点可防御伤必须开防御窗口');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'), '必须给对手上缠足');
    if (s.pending?.kind === 'defensiveRoll') s = stepC(s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = stepC(s, 1, { t: 'respondPass' }).state;
    // 月精灵回合收尾：main2 → discard → endTurn → 换对手回合
    s = stepC(s, 0, { t: 'endMainPhase' }).state;
    if (s.pending?.kind === 'discard') s = stepC(s, 0, { t: 'discardCards', uids: [] }).state;
    assert.equal(s.activeSeat, 1, 'endTurn 后必须换到对手（神枪手）回合');
    assert.equal(s.phase, 'main1');
    // 对手自己的进攻掷骰阶段开场：缠足把 3 次修正为 2 次
    s = stepC(s, 1, { t: 'endMainPhase' }).state;
    assert.equal(s.phase, 'offensiveRoll');
    assert.equal(s.players[1].rollAttemptsLeft, 2, '官方「lose 1 roll attempt」：3-1=2');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'),
      '开场时缠足仍在（弃置发生在结论，不是开场）');
    // 对手放弃激活 = 阶段结论：缠足整枚移除
    s = stepC(s, 1, { t: 'passAbility' }).state;
    assert.equal(s.phase, 'main2');
    assert.ok(!s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'),
      '官方「remove this token」：结论时整枚移除，不等回合结束');
  });

  test('直接挂载同样 3→2（契约只认状态，与进攻方英雄无关）', () => {
    const s0 = mkStateOn(content, {
      heroes: ['moonelf', 'gunslinger'],
      phase: 'main1',
      activeStatuses: [{ id: 'moonelf:entangle', stacks: 1 }],
    });
    const s = stepC(s0, 0, { t: 'endMainPhase' }).state;
    assert.equal(s.phase, 'offensiveRoll');
    assert.equal(s.players[0].rollAttemptsLeft, 2, '缠足在身：3 次 → 2 次');
  });
});

// ── M5-4 致盲（BLIND）：收场掷骰定阶段生死 ─────────────────
describe('M5-4 致盲（moonelf:blind）：收场移除并掷 1 骰，1-2 整个阶段作废', () => {
  test('命中失败面（seed qa-me-blind-hit 实测掷 2）：状态移除、长弓不激活、无任何效果', () => {
    // seed 说明：'qa-me-blind-hit' 实测 dice:fail:0 首掷为 2（命中失败面 1-2）。
    const s0 = mkStateOn(content, {
      seed: 'qa-me-blind-hit',
      dice: [1, 2, 3, 5, 6], // 3 箭 → 长弓 L1 4 伤（若未被作废）
      activeStatuses: [{ id: 'moonelf:blind', stacks: 1 }],
    });
    const r = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:longbow' });
    const s = r.state;
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'moonelf:blind'), '收场必须先移除致盲');
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failed?: boolean };
    assert.deepEqual(ev?.values, [2], '收场掷骰事件必须带实测骰值');
    assert.equal(ev?.failed, true, '掷 1-2 必须作废');
    assert.ok(findNote(r.events, 'rollPhaseFailed'), '必须发作废事件供 UI 呈现');
    assert.equal(s.phase, 'main2', '作废后直接进主阶段二');
    assert.equal(s.bucket.entries.length, 0, '作废路径不得留下任何入桶伤害');
    assert.ok(!r.events.some((e) => e.type === 'abilityActivated'), '作废时长弓不得激活');
    assert.equal(s.players[1].hp, 50, '作废时守方 HP 不得变化');
  });

  test('未命中失败面（seed qa-me-blind-miss 实测掷 4）：致盲移除后长弓照常激活', () => {
    // seed 说明：'qa-me-blind-miss' 实测 dice:fail:0 首掷为 4（未命中 1-2）。
    const s0 = mkStateOn(content, {
      seed: 'qa-me-blind-miss',
      dice: [1, 2, 3, 5, 6],
      activeStatuses: [{ id: 'moonelf:blind', stacks: 1 }],
    });
    const r = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:longbow' });
    const s = r.state;
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'moonelf:blind'), '无论骰果如何都要移除');
    assert.equal((findNote(r.events, 'rollPhaseFailDie') as { failed?: boolean })?.failed, false, '掷 4 不得作废');
    assert.ok(!findNote(r.events, 'rollPhaseFailed'), '未命中不得发作废事件');
    assert.equal(s.pending?.kind, 'defensiveRoll', '未时长弓照常结算');
    assert.equal(queuedTo(s, 1), 4, '长弓 L1 三档最低档 4 伤照常入桶');
  });
});

// ── M5-5 打偏（Missed Me）：L1 floor vs L2 每箭 ───────────
describe('M5-5 打偏（moonelf:missedMe）：2 足防半伤，L1 每 2 箭 1 伤 / L2 每箭 1 伤', () => {
  /** 攻方焰术士火球 4 伤 vs 守方月精灵；seed qa-me 实测防御骰 [1,1,5,5,1] = 3 箭 + 2 足 */
  function missedMeCase(defenderUpgrades?: Record<string, number>): { defHp: number; atkHp: number; dice: number[] } {
    const s0 = mkStateOn(content, {
      seed: 'qa-me',
      heroes: ['pyromancer', 'moonelf'],
      dice: [1, 1, 1, 4, 5],
      defenderUpgrades,
    });
    const r1 = stepC(s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(r1.state.pending?.kind, 'defensiveRoll', '火球 4 点可防御伤必须开防御窗口');
    const r2 = stepC(r1.state, 1, { t: 'defensiveRoll' });
    let s = r2.state;
    if (s.pending?.kind === 'defenseWindow') s = stepC(s, 1, { t: 'respondPass' }).state;
    return { defHp: s.players[1].hp, atkHp: s.players[0].hp, dice: defenseDice(r2.events) ?? [] };
  }

  test('L1：防御掷 5 骰 [1,1,5,5,1] → 2 足防止 ⌈4/2⌉=2，每 2 箭回击 ⌊3/2⌋=1', () => {
    const r = missedMeCase();
    assert.deepEqual(r.dice, [1, 1, 5, 5, 1], '官方防御掷 5 骰（seed 固化）');
    assert.equal(r.defHp, 48, '防止一半来袭伤害（向上取整）：50-4+2=48');
    assert.equal(r.atkHp, 49, 'L1 每 2 支箭 1 点回击：⌊3/2⌋=1 → 50-1=49');
  });

  test('L2（打偏 II）：同骰每支箭 1 伤 → 回击 3，防止部分不变', () => {
    const r = missedMeCase({ 'moonelf:missedMe': 2 });
    assert.deepEqual(r.dice, [1, 1, 5, 5, 1], '同一 seed 防御骰必须一致（对照 L1）');
    assert.equal(r.atkHp, 47, 'L2 每支箭 1 点：3 箭 → 3 伤 → 50-3=47');
    assert.equal(r.defHp, 48, 'L2 防止部分与 L1 相同（2 足防半伤不受升级影响）');
  });
});

// ── M5-6 爆裂箭：掷 5 池骰，公式按池骰求值 ─────────────────
describe('M5-6 爆裂箭（moonelf:explodingArrow）：Roll 5，伤害/CP/致盲按池骰求值', () => {
  test('seed qa-me：池 [6,5,2,1,6] → 3+2×箭+1×足=6 伤、每池月 1 CP、施加致盲', () => {
    // 进攻骰 [1,6,6,6,4] = 1 箭 + 3 月 + 1 足（满足 1 箭 + 3 月门槛）；
    // 池骰（seed qa-me 实测 dice:pool:0）= [6,5,2,1,6] = 2 箭 + 1 足 + 2 月。
    // 池骰与进攻骰的月数不同（3 vs 2）——CP 移除按池骰算，证明池归属契约。
    const s0 = mkStateOn(content, { heroes: ['moonelf', 'gunslinger'], dice: [1, 6, 6, 6, 4] });
    const cpBefore = s0.players[1].cp;
    const r = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:explodingArrow' });
    const s = r.state;
    const pool = findNote(r.events, 'tempDiceRolled') as { values?: number[] } | undefined;
    assert.deepEqual(pool?.values, [6, 5, 2, 1, 6], '官方 Roll 5 必须掷 5 颗池骰（seed 固化）');
    assert.equal(queuedTo(s, 1), 6, '官方公式 3 + 1×箭 + 1×足 = 3+2+1=6（按池骰求值）');
    assert.equal(s.players[1].cp, cpBefore - 2, '官方「opponent loses 1CP × [月]」：池内 2 月 → 扣 2 CP');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:blind'), '必须施加致盲');
    assert.equal(s.pending?.kind, 'defensiveRoll', '6 点 attack 伤害必须开防御窗口');
  });
});

// ── M5-7 长弓三档 + of-a-kind 缠足 ────────────────────────
describe('M5-7 长弓（moonelf:longbow）：三档伤害与 of-a-kind 缠足（官方卡图 #s）', () => {
  test('L1：3 箭 → 4 伤；五骰不同点不触发缠足', () => {
    const s0 = mkStateOn(content, { dice: [1, 2, 3, 4, 5] }); // 3 箭 + 2 足，无同点
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:longbow' }).state;
    assert.equal(queuedTo(s, 1), 4, 'L1 三档 4/5/7：3 箭取最低档 4');
    assert.ok(!s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'), 'L1 无缠足效果');
  });

  test('L2 正例：4 箭 + 4 同点（#s）→ 6 伤 + 缠足', () => {
    const s0 = mkStateOn(content, {
      dice: [1, 1, 1, 1, 6], // 4 箭 + 1 月；四个 1 = 4-of-a-kind
      upgrades: { 'moonelf:longbow': 2 },
    });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:longbow' }).state;
    assert.equal(queuedTo(s, 1), 6, 'L2 三档 4/6/8：4 箭取中档 6');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'),
      '官方 L2「On 4-of-a-kind (#\'s), inflict Entangle」：四个 1 同点必须缠足');
  });

  test('L2 反例：3 箭但无 4 同点 → 4 伤、不缠足（门槛不得放宽）', () => {
    const s0 = mkStateOn(content, {
      dice: [1, 2, 3, 4, 6], // 3 箭，五骰全不同点
      upgrades: { 'moonelf:longbow': 2 },
    });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:longbow' }).state;
    assert.equal(queuedTo(s, 1), 4, '3 箭在 L2 仍取最低档 4');
    assert.ok(!s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'),
      '无 4 同点不得缠足（官方 of-a-kind 按骰值同点计）');
  });

  test('L3：3 箭 + 3 同点 → 5 伤 + 缠足（门槛降到 3-of-a-kind）', () => {
    const s0 = mkStateOn(content, {
      dice: [1, 1, 1, 6, 6], // 3 箭 + 2 月；三个 1 = 3-of-a-kind
      upgrades: { 'moonelf:longbow': 3 },
    });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:longbow' }).state;
    assert.equal(queuedTo(s, 1), 5, 'L3 三档 5/7/9：3 箭取最低档 5');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'),
      '官方 L3「On 3-of-a-kind (#\'s), inflict Entangle」：三个 1 同点必须缠足');
  });
});

// ── M5-8 月蚀！（Ultimate）：5 月 → 12 不可防御 ───────────
describe('M5-8 月蚀！（moonelf:lunarEclipse）：5 月 → 12 点不可防御 + 三状态 + 己方闪避', () => {
  test('12 点直接结算不开防御窗口（守 HP 38），附赠三状态与闪避', () => {
    const s0 = mkStateOn(content, { heroes: ['moonelf', 'gunslinger'], dice: [6, 6, 6, 6, 6] });
    const r = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:lunarEclipse' });
    const s = r.state;
    assert.equal(s.players[1].hp, 38, '官方 Ultimate 12 点不可防御：50-12=38');
    assert.equal(s.players[0].turnDamageDealt, 12, '记入「造成的伤害」的必须正是那 12 点');
    assert.equal(s.pending?.kind, 'cardWindow', '不可防御伤害不开防御窗口，直接进主阶段二打牌窗口');
    assert.ok(!r.events.some((e) => e.type === 'defenseRolled'), '不可防御不得触发守方防御掷骰');
    for (const id of ['moonelf:blind', 'moonelf:entangle', 'moonelf:targeted']) {
      assert.ok(s.players[1].statuses.some((st) => st.id === id), `Ultimate 必须施加 ${id}`);
    }
    assert.ok(s.players[0].statuses.some((st) => st.id === 'common:evasive'), 'Ultimate 必须给己方闪避');
  });
});

// ── M5-9 闪避官方化：花费时掷 1 骰，1-2 避 / 3-6 不避 ────
describe('M5-9 闪避（common:evasive）官方化：花费时掷 1 骰，1-2 避伤、无论点数都消耗 1 层', () => {
  /**
   * 官方面板原文「Spend & roll 1-2 to dodge an Attack」：花费 1 层并掷 1 骰，
   * 掷出 1-2 才避开一次攻击；掷 3-6 不避但层数照扣。
   * ⚠️ 已知缺口（显式记账）：spendStatus 当前无玩家入口（卡/能力均不调用），
   *    故用自建测试卡驱动 handler —— 验证的是 common:evasive 的 spendEffect 数据本身。
   */
  const spendCard: CardDef = {
    defId: 'test:spendEvasive', name: '测试消耗闪避', kind: 'instant', costCp: 0,
    timing: ['main1', 'main2'], count: 1,
    effects: [{ clause: { kind: 'spendStatus', status: 'common:evasive', to: { r: 'self' } } }],
  };

  /** 独立 registry 实例：避免把测试卡注册进共享 content 污染其他用例 */
  function spendCase(seed: string): { roll: number | undefined; avoided: boolean; left: number } {
    const reg = createDefaultRegistry();
    reg.registerCard(spendCard);
    const base = createMatch(reg, { seed, heroes: ['moonelf', 'gunslinger'] });
    const s0 = {
      ...base,
      phase: 'main1',
      activeSeat: 0 as Seat,
      pending: null,
      players: [
        { ...base.players[0], statuses: [{ id: 'common:evasive', stacks: 3 } as StatusInstance],
          hand: [{ uid: 'h0', defId: 'test:spendEvasive' }] },
        base.players[1],
      ],
    } as unknown as GameState;
    const r = reduce(s0, { seat: 0, action: { t: 'playCard', uid: 'h0' }, clientSeq: 1 }, reg);
    if (!r.ok) throw new Error(`打测试卡被拒：${r.error.code} / ${r.error.message}`);
    const pool = r.events.find((e) => e.type === 'note' && e.payload['kind'] === 'tempDiceRolled');
    const roll = (pool?.payload as { values?: number[] } | undefined)?.values?.[0];
    const left = r.state.players[0].statuses.find((st) => st.id === 'common:evasive')?.stacks ?? 0;
    return { roll, avoided: r.state.bucket.avoid.length > 0, left };
  }

  test('掷 2（seed qa-ev1）→ 避伤且消耗 1 层（3→2）', () => {
    const r = spendCase('qa-ev1');
    assert.equal(r.roll, 2, 'seed qa-ev1 实测 dice:pool:0 首掷为 2');
    assert.equal(r.avoided, true, '掷 1-2 必须避开攻击');
    assert.equal(r.left, 2, '无论点数都消耗 1 层');
  });

  test('掷 1（seed qa-ev5）→ 避伤且消耗 1 层（下边界）', () => {
    const r = spendCase('qa-ev5');
    assert.equal(r.roll, 1, 'seed qa-ev5 实测首掷为 1');
    assert.equal(r.avoided, true, '掷 1 必须避开攻击');
    assert.equal(r.left, 2, '无论点数都消耗 1 层');
  });

  test('掷 3（seed qa-ev7）→ 不避但照常消耗 1 层（上边界外侧）', () => {
    const r = spendCase('qa-ev7');
    assert.equal(r.roll, 3, 'seed qa-ev7 实测首掷为 3');
    assert.equal(r.avoided, false, '掷 3 不得避伤（官方 1-2 才避）');
    assert.equal(r.left, 2, '未中也必须消耗 1 层');
  });

  test('掷 6（seed qa-me）→ 不避但照常消耗 1 层', () => {
    const r = spendCase('qa-me');
    assert.equal(r.roll, 6, 'seed qa-me 实测首掷为 6');
    assert.equal(r.avoided, false, '掷 6 不得避伤');
    assert.equal(r.left, 2, '未中也必须消耗 1 层');
  });
});

// ── M5-10 其余专属能力数值（官方卡面逐张读图） ────────────
describe('M5-10 其余专属能力：官方数值与状态效果', () => {
  test('致命射击 L1：3 箭 + 2 月 → 锁定 + 4 伤（同帧锁定吃 +2 → 入桶 6）', () => {
    const s0 = mkStateOn(content, { dice: [1, 1, 1, 6, 6] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:demisingShot' }).state;
    assert.equal(queuedTo(s, 1), 6, '官方先施加锁定再造成 4 伤：同帧 +2 → 4+2=6');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:targeted'), '必须施加锁定');
  });

  test('掩护射击 L1：2 箭 + 3 足 → 己方闪避 + 7 伤', () => {
    const s0 = mkStateOn(content, { dice: [1, 1, 4, 4, 5] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:coveredShot' }).state;
    assert.equal(queuedTo(s, 1), 7, '官方 L1 7 伤害');
    assert.ok(s.players[0].statuses.some((st) => st.id === 'common:evasive'), '必须获得闪避');
  });

  test('月蚀 L1：4 月 → 三状态 + 7 伤（入桶 7+2=9）', () => {
    const s0 = mkStateOn(content, { dice: [6, 6, 6, 6, 1] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:eclipse' }).state;
    assert.equal(queuedTo(s, 1), 9, '官方 L1 7 伤 + 同帧锁定 +2 = 9');
    for (const id of ['moonelf:blind', 'moonelf:entangle', 'moonelf:targeted']) {
      assert.ok(s.players[1].statuses.some((st) => st.id === id), `月蚀必须施加 ${id}`);
    }
  });

  test('缠足射击 L1：小顺 → 缠足 + 7 伤', () => {
    const s0 = mkStateOn(content, { dice: [1, 2, 3, 4, 5] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:entanglingShot' }).state;
    assert.equal(queuedTo(s, 1), 7, '官方 L1 7 伤害');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'), '必须施加缠足');
  });

  test('致盲射击 L1：大顺 → 致盲 + 己方闪避 + 8 伤', () => {
    const s0 = mkStateOn(content, { dice: [2, 3, 4, 5, 6] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:blindingShot' }).state;
    assert.equal(queuedTo(s, 1), 8, '官方 L1 8 伤害');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:blind'), '必须施加致盲');
    assert.ok(s.players[0].statuses.some((st) => st.id === 'common:evasive'), '必须获得闪避');
  });

  test('闪避行动（附赠）：3 足 → 己方闪避 + 2 点不可防御（对手 HP 48）', () => {
    const s0 = mkStateOn(content, { dice: [4, 4, 4, 1, 2] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:evasiveAction' }).state;
    assert.equal(s.players[1].hp, 48, '官方 2 点不可防御直接结算：50-2=48');
    assert.ok(s.players[0].statuses.some((st) => st.id === 'common:evasive'), '必须获得闪避');
  });

  test('月赐（附赠）：1 箭 + 2 足 + 1 月 → 3 闪避 + 对手缠足', () => {
    const s0 = mkStateOn(content, { dice: [1, 4, 5, 6, 2] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:lunarBlessing' }).state;
    const evasive = s.players[0].statuses.find((st) => st.id === 'common:evasive');
    assert.equal(evasive?.stacks, 3, '官方获得 3 闪避');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'), '必须施加缠足');
  });

  test('专注（附赠）：2 箭 + 1 月 → 对手锁定 + 缠足', () => {
    const s0 = mkStateOn(content, { dice: [1, 1, 6, 4, 5] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:focus' }).state;
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:targeted'), '必须施加锁定');
    assert.ok(s.players[1].statuses.some((st) => st.id === 'moonelf:entangle'), '必须施加缠足');
  });

  test('月影（附赠）：3 月 → 己方闪避 + 对手三状态', () => {
    const s0 = mkStateOn(content, { dice: [6, 6, 6, 1, 2] });
    const s = stepC(s0, 0, { t: 'announceAbility', abilityId: 'moonelf:moonShadow' }).state;
    assert.ok(s.players[0].statuses.some((st) => st.id === 'common:evasive'), '必须获得闪避');
    for (const id of ['moonelf:blind', 'moonelf:entangle', 'moonelf:targeted']) {
      assert.ok(s.players[1].statuses.some((st) => st.id === id), `月影必须施加 ${id}`);
    }
  });
});
