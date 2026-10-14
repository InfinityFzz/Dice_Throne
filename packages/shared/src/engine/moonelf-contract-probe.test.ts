/**
 * QA 独立探针 · MoonElf 引擎契约层（质量门 M3-MOONELF-Q1）—— 行为级独立取证。
 *
 * 与实装方的 moonelf.test.ts 分工：那一份证明「实装覆盖了契约」；本文件证明
 * 「契约真的按官方原文工作」——用例、种子、场景构造全部由 QA 独立搭建，
 * 不 import 任何实装方测试的辅助函数，避免同源偏差互相背书。
 *
 * 覆盖的 4 条引擎契约（官方 MoonElf 面板机制倒逼，全部通用、零英雄特判）：
 *  1. StatusDef.onAttacked 逐字段独立求值   —— TARGETED「+2 incoming Attack damage」只有 bonusDamage
 *  2. StatusDef.onRollPhaseStart             —— ENTANGLE「next Offensive Roll Phase 少 N 次掷骰」
 *  3. StatusDef.onConcludeRollPhase.failDie  —— BLIND「收场时移除并掷骰，1-2 则整个阶段失败、无任何效果」
 *  4. StatusDef.expiresAtRollPhaseEnd        —— ENTANGLE「At the conclusion of the Roll Phase, remove this token」
 *
 * 独立取证手段：
 *  - 自建 ContentRegistry（四位既有英雄仅作对局 fixture，被测对象一律 test: 前缀自造状态），
 *    且全部走该 registry 自己的 reduce（模块级全局 content 查不到 test: 前缀状态）；
 *  - 自造攻击方英雄 test:striker（const matcher + 0 伤/纯伤/不可防御/终极/多效果能力），
 *    用来打既有英雄打不出来的契约边界（amount=0 门、ultimate 豁免、反伤触发链）；
 *  - BLIND 命中/未命中种子由 QA 独立穷举发现（qa-probe-7 = 掷出 1 命中；qa-probe-1 = 掷出 6 未命中），
 *    与实装方用例的种子无关；
 *  - 失败路径状态卫生用「作废态 ≡ 放弃态」逐字段差分 + 显式零残骸断言双重证明；
 *  - 源码级架构守门：引擎目录不得出现任何英雄命名空间 id 字面量。
 *
 * 标注「现状记录」的用例钉的是引擎当前行为（官方口径灰区或预存在语义），
 * 供规则评审决策；它们不是对本契约新增缺陷的指控。
 *
 * 守方 HP 断言一律用无生命面英雄（神枪手/影贼/自造英雄）；狂战士防御骰含生命面会回血。
 * 断言消息一律不写行号（按标识符引用，行号会漂移）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Action, GameState, Seat, StatusInstance, GameEvent } from '../index.js';
import type { StatusDef, HeroDef, CardDef } from '../index.js';
import {
  ContentRegistry, createMatch, reduce, getLegalActions, describeStatus,
  BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF, COMMON_CARDS, COMMON_STATUSES,
} from '../index.js';

// ── 自造攻击方英雄（const matcher：骰面不影响激活，专打契约边界） ──────────
const STRIKER: HeroDef = {
  id: 'test:striker',
  name: '自造攻击手',
  startHp: 40,
  diceCount: 5,
  dieFaces: [
    { value: 1, symbols: ['sword'] }, { value: 2, symbols: ['sword'] }, { value: 3, symbols: ['sword'] },
    { value: 4, symbols: ['guard'] }, { value: 5, symbols: ['guard'] }, { value: 6, symbols: ['guard'] },
  ],
  abilities: [
    { id: 'test:strike4', kind: 'offensive', name: '自造打击', tiers: [
      { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
        effects: [{ clause: { kind: 'dealDamage', amount: 4, damageType: 'attack', to: { r: 'opponent' } } }] },
    ] },
    { id: 'test:strikeUnd', kind: 'offensive', name: '自造不可防御打击', tiers: [
      { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
        effects: [{ clause: { kind: 'dealDamage', amount: 4, damageType: 'undefendable', to: { r: 'opponent' } } }] },
    ] },
    { id: 'test:strikePure', kind: 'offensive', name: '自造纯伤打击', tiers: [
      { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
        effects: [{ clause: { kind: 'dealDamage', amount: 4, damageType: 'pure', to: { r: 'opponent' } } }] },
    ] },
    { id: 'test:strike0', kind: 'offensive', name: '自造零伤打击', tiers: [
      { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
        effects: [
          { clause: { kind: 'dealDamage', amount: 0, damageType: 'attack', to: { r: 'opponent' } } },
          { clause: { kind: 'inflictStatus', status: 'test:marker', stacks: 1, to: { r: 'opponent' } } },
        ] },
    ] },
    { id: 'test:strikeUlt', kind: 'ultimate', name: '自造终极打击', tiers: [
      { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
        effects: [{ clause: { kind: 'dealDamage', amount: 5, damageType: 'attack', to: { r: 'opponent' }, sourceKind: 'ultimate' } }] },
    ] },
  ],
  statuses: [],
  deck: [
    { defId: 'test:selfEntangle', name: '自造缠藤', kind: 'mainPhase', costCp: 0,
      timing: ['main1', 'main2'], count: 1,
      effects: [{ clause: { kind: 'inflictStatus', status: 'test:notEntangle', stacks: 1, to: { r: 'self' } } }] },
  ] as readonly CardDef[],
};

// ── 自建 registry（被测对象一律 test: 前缀，与任何英雄面板 token 无关） ────
function buildRegistry(extra: readonly StatusDef[] = []): ContentRegistry {
  const reg = new ContentRegistry();
  for (const h of [BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF, STRIKER]) reg.registerHero(h);
  COMMON_CARDS.forEach((c) => reg.registerCard(c));
  COMMON_STATUSES.forEach((st) => reg.registerStatus(st));
  for (const st of BASE_STATUSES) reg.registerStatus(st);
  for (const st of extra) reg.registerStatus(st);
  assert.equal(reg.validate().length, 0, '自建 registry 必须通过注册表校验');
  return reg;
}

/** 自造状态默认值（negative / limit 1 / persistent，与官方 TARGETED·ENTANGLE·BLIND 同规格） */
function mkStatus(id: string, over: Partial<StatusDef>): StatusDef {
  return { id, name: id, polarity: 'negative', stackLimit: 1, persistent: true, spendable: false, ...over };
}

/** 契约状态集：本文件全部探针共用的自造状态（按需取用） */
const STATUSES = {
  bonusOnly: mkStatus('test:bonusOnly', { onAttacked: { bonusDamage: 2 } }),
  cpOnly: mkStatus('test:cpOnly', { onAttacked: { attackerGainsCp: 2 } }),
  bothFields: mkStatus('test:bothFields', { onAttacked: { bonusDamage: 1, attackerGainsCp: 1 } }),
  stackBonus: mkStatus('test:stackBonus', {
    onAttacked: { bonusDamage: { e: 'statusStacks', status: 'test:stackBonus', target: { r: 'defender' } } },
  }),
  avoidOnly: mkStatus('test:avoidOnly', { onAttacked: { avoid: true } }),
  plain: mkStatus('test:plain', {}),
  marker: mkStatus('test:marker', {}),
  entangle: mkStatus('test:notEntangle', {
    onRollPhaseStart: { rollAttemptsDelta: -1 }, expiresAtRollPhaseEnd: true,
  }),
  entangleOnlyDelta: mkStatus('test:deltaOnly', { onRollPhaseStart: { rollAttemptsDelta: -1 } }),
  blind: mkStatus('test:notBlind', { onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } } }),
  shadowsLike: mkStatus('test:notShadows', { discardAtTurnEnd: true }),
};

/** 全部自造契约状态常驻注册（test:striker 的牌库引用 test:notEntangle，注册表校验要求先注册） */
const BASE_STATUSES: readonly StatusDef[] = Object.values(STATUSES);

function mkState(reg: ContentRegistry, opts: {
  readonly seed?: string;
  readonly heroes?: readonly [string, string];
  readonly phase?: 'main1' | 'offensiveRoll';
  readonly dice?: readonly number[];
  readonly activeStatuses?: readonly StatusInstance[];
  readonly defenderStatuses?: readonly StatusInstance[];
  readonly attackerHand?: readonly string[];
  readonly defenderHand?: readonly string[];
  readonly bucket?: GameState['bucket'];
}): GameState {
  const heroes = opts.heroes ?? ['pyromancer', 'gunslinger'];
  const base = createMatch(reg, { seed: opts.seed ?? 'qa-probe-base', heroes: heroes as ['pyromancer', 'gunslinger'] });
  const p0 = {
    ...base.players[0],
    diceValues: [...(opts.dice ?? [1, 1, 1, 4, 5])],
    diceLocked: [false, false, false, false, false],
    hand: (opts.attackerHand ?? []).map((defId, i) => ({ uid: `hand-${i}`, defId })),
    statuses: [...(opts.activeStatuses ?? [])],
  };
  const p1 = {
    ...base.players[1],
    hand: (opts.defenderHand ?? []).map((defId, i) => ({ uid: `dhand-${i}`, defId })),
    statuses: [...(opts.defenderStatuses ?? [])],
  };
  return {
    ...base,
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
    phase: opts.phase ?? 'offensiveRoll',
    activeSeat: 0 as Seat,
    pending: null,
    players: [p0, p1],
  } as unknown as GameState;
}

/** 必须用自建 registry 自己的 reduce（全局 content 查不到 test: 前缀自造状态） */
function step(reg: ContentRegistry, state: GameState, seat: Seat, action: Action): {
  state: GameState; events: readonly GameEvent[];
} {
  const r = reduce(state, { seat, action, clientSeq: 1 }, reg);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

function findNote(events: readonly GameEvent[], kind: string): Record<string, unknown> | undefined {
  return events.find((e) => e.type === 'note' && e.payload['kind'] === kind)?.payload;
}

/** 进攻方（seat 0）宣告能力后、防御结算前的入桶可防御伤害总量 */
function queuedDefendable(s: GameState, to: Seat = 1): number {
  return s.bucket.entries
    .filter((e) => e.toSeat === to && e.bucketKind === 'defendable')
    .reduce((acc, e) => acc + e.amount, 0);
}

/** 状态卫生快照：作废路径「什么都不发生」的逐字段证据 */
function hygieneSnapshot(s: GameState): Record<string, unknown> {
  return {
    phase: s.phase,
    pendingKind: s.pending?.kind ?? null,
    pendingSeat: s.pending?.seat ?? null,
    bucketEntries: s.bucket.entries.map((e) => [e.toSeat, e.bucketKind, e.amount, e.fromSeat]),
    bucketAvoid: s.bucket.avoid.map((a) => a.toSeat),
    bucketHeals: s.bucket.heals.map((h) => [h.toSeat, h.amount]),
    bucketRecoils: s.bucket.pendingRecoils.length,
    windowsStack: s.windows.stack.length,
    windowsNextSeq: s.windows.nextSeq,
    bindings: s.bindings,
    tempDice: s.tempDice,
    ladderStep: s.ladderStep,
    activeDefenseAbilityId: s.activeDefenseAbilityId,
    defenseUsed: [s.players[0].defenseUsed, s.players[1].defenseUsed],
    hp: [s.players[0].hp, s.players[1].hp],
    cp: [s.players[0].cp, s.players[1].cp],
    handLen: [s.players[0].hand.length, s.players[1].hand.length],
    diceValues: s.players[0].diceValues,
    diceLocked: s.players[0].diceLocked,
    rollAttemptsLeft: s.players[0].rollAttemptsLeft,
    turnDamageDealt: [s.players[0].turnDamageDealt, s.players[1].turnDamageDealt],
    permissionTokens: [s.players[0].permissionTokens.length, s.players[1].permissionTokens.length],
    winner: s.winner,
    finished: s.finished,
    turn: s.turn,
    activeSeat: s.activeSeat,
    extraRollPhaseUsed: s.extraRollPhaseUsed,
  };
}

/** 行动方走完自己整回合：main1 →endMainPhase→ offensiveRoll →passAbility→ main2 →endMainPhase→ discard →endTurn */
function concludeOwnTurn(reg: ContentRegistry, s0: GameState): GameState {
  const seatOf = (st: GameState): Seat => (st.pending?.seat ?? st.activeSeat) as Seat;
  let s = step(reg, s0, seatOf(s0), { t: 'endMainPhase' }).state;   // main1 → offensiveRoll
  s = step(reg, s, seatOf(s), { t: 'passAbility' }).state;           // 放弃激活 → main2
  s = step(reg, s, seatOf(s), { t: 'endMainPhase' }).state;          // main2 → discard → endTurn → 对手 main1
  if (s.pending?.kind === 'discard') {
    s = step(reg, s, s.pending.seat, { t: 'discardCards', uids: [] }).state;
  }
  return s;
}

// BLIND 种子（QA 独立穷举发现，与实装方用例无关）：
// pyromancer/gunslinger 对局：qa-probe-7 = 掷出 1（命中）；qa-probe-1 = 掷出 6（未命中）
const SEED_BLIND_HIT = 'qa-probe-7';
const SEED_BLIND_MISS = 'qa-probe-1';
// test:striker/gunslinger 对局（const matcher：清骰后仍可宣布，供跨回合探针使用）：
// qa-probe-sg-11 = 掷出 1（命中）；qa-probe-sg-1 = 掷出 6（未命中）
const SEED_STRIKER_HIT = 'qa-probe-sg-11';
const SEED_STRIKER_MISS = 'qa-probe-sg-1';

// ════════════════════════════════════════════════════════════════
// P1 onAttacked：bonusDamage 与 attackerGainsCp 逐字段独立生效（TARGETED）
// ════════════════════════════════════════════════════════════════
describe('P1 onAttacked 逐字段独立求值（官方 TARGETED 只有 bonusDamage）', () => {
  // 焰术士火球 L1：3 焰（面值 1-3）→ 4 点 attack（可防御）
  const FIREBALL_4 = [1, 1, 1, 4, 5];

  test('纯 bonusDamage 状态：入桶 +2 且不给 CP（TARGETED 官方形态）', () => {
    const reg = buildRegistry([STATUSES.bonusOnly, STATUSES.plain]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:bonusOnly', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(queuedDefendable(r.state), 6, '纯 bonusDamage 必须追加 +2 入桶（4+2）');
    assert.equal(r.state.players[0].cp, cpBefore, '没有 attackerGainsCp 字段不得发放 CP');
  });

  test('纯 attackerGainsCp 状态：CP +2 且入桶不变（逐字段独立定位，不得漏发）', () => {
    const reg = buildRegistry([STATUSES.cpOnly]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:cpOnly', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(r.state.players[0].cp, cpBefore + 2, '纯 CP 字段必须独立发放');
    assert.equal(queuedDefendable(r.state), 4, '没有 bonusDamage 字段不得追加伤害');
  });

  test('两字段皆有（Bounty 同构）：入桶 +1 且 CP +1（既有行为不破）', () => {
    const reg = buildRegistry([STATUSES.bothFields]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:bothFields', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(queuedDefendable(r.state), 5, '两字段皆有时伤害加成照常');
    assert.equal(r.state.players[0].cp, cpBefore + 1, '两字段皆有时 CP 照常');
  });

  test('回归：既有 gunslinger:bounty（双字段）经默认注册表仍 +1 伤 +1 CP', () => {
    const reg = buildRegistry([]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'gunslinger:bounty', stacks: 1 }] });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(queuedDefendable(r.state), 5, '悬赏加伤不得回归');
    assert.equal(r.state.players[0].cp, cpBefore + 1, '悬赏 CP 不得回归');
  });

  test('Expr 求值管道：bonusDamage 按守方层数缩放（3 层 → +3），证明不是硬编码常量', () => {
    const reg = buildRegistry([STATUSES.stackBonus]);
    const s0 = mkState(reg, { dice: FIREBALL_4, defenderStatuses: [{ id: 'test:stackBonus', stacks: 3 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(queuedDefendable(r.state), 7, 'bonusDamage 是 Expr：3 层应加成 +3（4+3）');
  });

  test('avoid 与 bonusDamage+CP 共存：伤害全避但 CP 照发、攻击仍成功（官方：其他效果照常）', () => {
    const reg = buildRegistry([STATUSES.avoidOnly, STATUSES.plain]);
    const s0 = mkState(reg, {
      dice: FIREBALL_4,
      defenderStatuses: [
        { id: 'test:avoidOnly', stacks: 1, sinceTurn: -1 },
        { id: 'gunslinger:bounty', stacks: 1 },
      ],
    });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    // 入桶即触发：bonus 与 CP 在防御结算前已生效，与 avoid 共存
    assert.equal(queuedDefendable(r.state), 5, 'avoid 不影响加成入桶（4 + 悬赏 1）');
    assert.ok(r.state.bucket.avoid.some((a) => a.toSeat === 1), 'avoid 契约必须标记守方');
    assert.equal(r.state.players[0].cp, cpBefore + 1, '悬赏 CP 必须照发（官方：攻击仍成功）');
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '防御阶梯必须照常开启（不防御的是伤害不是攻击）');
    let s = r.state;
    if (s.pending?.kind === 'defensiveRoll') s = step(reg, s, 1, { t: 'defensiveRoll' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(reg, s, 1, { t: 'respondPass' }).state;
    assert.equal(s.players[1].hp, 50, 'avoid 必须全避可防御伤害（含 bonus 追加部分）');
    assert.ok(r.events.some((e) => e.type === 'abilityActivated'), '攻击必须照常宣布成功');
  });

  test('undefendable 伤害不触发任何 onAttacked 字段（hook 只认 attack 类型）', () => {
    const reg = buildRegistry([STATUSES.bonusOnly, STATUSES.cpOnly]);
    const s0 = mkState(reg, {
      heroes: ['test:striker', 'gunslinger'],
      defenderStatuses: [{ id: 'test:bonusOnly', stacks: 1 }, { id: 'test:cpOnly', stacks: 1 }],
    });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'test:strikeUnd' });
    assert.equal(r.state.players[1].hp, 46, '不可防御伤害必须落钉 4 点（50-4），不得追加 bonus');
    assert.equal(r.state.players[0].cp, cpBefore, '不可防御伤害不得发放 CP');
  });

  test('pure 伤害不触发（官方 FAQ：不因防御方 pure 反伤类触发）', () => {
    const reg = buildRegistry([STATUSES.bonusOnly]);
    const s0 = mkState(reg, {
      heroes: ['test:striker', 'gunslinger'],
      defenderStatuses: [{ id: 'test:bonusOnly', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'test:strikePure' });
    assert.equal(r.state.players[1].hp, 46, '纯伤必须落钉 4 点，不得追加 bonus');
  });

  test('主伤害 amount=0 不触发（官方「至少造成 1 点伤害」的已知近似记账），其他效果照常', () => {
    const reg = buildRegistry([STATUSES.bonusOnly, STATUSES.cpOnly, STATUSES.marker]);
    const s0 = mkState(reg, {
      heroes: ['test:striker', 'gunslinger'],
      defenderStatuses: [{ id: 'test:bonusOnly', stacks: 1 }, { id: 'test:cpOnly', stacks: 1 }],
    });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'test:strike0' });
    assert.equal(r.state.players[1].hp, 50, '0 伤攻击不得造成伤害');
    assert.equal(r.state.players[0].cp, cpBefore, '0 伤攻击不得触发 CP');
    assert.ok(r.state.players[1].statuses.some((st) => st.id === 'test:marker'),
      '0 伤攻击的其他效果（施加状态）必须照常发生');
  });

  test('ultimate 来源豁免：attack 类型终极伤害不触发 bonus/CP，也不被 avoid（官方细则口径）', () => {
    const reg = buildRegistry([STATUSES.bonusOnly, STATUSES.avoidOnly]);
    const s0 = mkState(reg, {
      heroes: ['test:striker', 'gunslinger'],
      defenderStatuses: [{ id: 'test:bonusOnly', stacks: 1 }, { id: 'test:avoidOnly', stacks: 1, sinceTurn: -1 }],
    });
    const cpBefore = s0.players[0].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'test:strikeUlt' });
    assert.equal(queuedDefendable(r.state), 5, '终极伤害不得追加 bonus（入桶即 5）');
    assert.equal(r.state.players[0].cp, cpBefore, '终极伤害不得触发 CP');
    assert.equal(r.state.bucket.avoid.length, 0, 'avoid 不得标记终极伤害目标（官方：不防 Ultimate）');
    assert.equal(r.state.players[1].permissionTokens.length, 1, '终极门禁令牌必须照常施加');
  });

  test('现状记录：defender 执行的 attack 类反伤（counterStrike）会触发守方…不，触发「受击者」契约，受益方是反击执行方', () => {
    // 官方 FAQ ② 只覆盖 pure 反伤（damageType!=='attack' 天然不命中）；counterStrike 是
    // attack 类型、由防守方执行、瞄准原攻击方。引擎现状：契约触发，bonus 加进反伤、
    // CP 发给反击执行方（dealDamage 的 seat = 效果执行方）。此为预存在语义
    // （bounty 同样如此），非本次解耦引入；钉住现状供官方口径评审。
    const reg = buildRegistry([STATUSES.bothFields]);
    const s0 = mkState(reg, {
      seed: 'qa-probe-cs-1', // QA 独立发现：影贼防御骰 2 匕首 → 反伤 2
      heroes: ['test:striker', 'shadowthief'],
      activeStatuses: [{ id: 'test:bothFields', stacks: 1 }],
    });
    const atkCpBefore = s0.players[0].cp;
    const defCpBefore = s0.players[1].cp;
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'test:strike4' });
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '攻击必须开防御窗口');
    let s = step(reg, r.state, 1, { t: 'defensiveRoll', abilityId: 'shadowthief:counterStrike' }).state;
    if (s.pending?.kind === 'defenseWindow') s = step(reg, s, 1, { t: 'respondPass' }).state;
    // 反伤 2 + bonus 1 = 3，全部落回原攻击方（契约持有者）
    assert.equal(s.players[0].hp, 40 - 3, '反伤 2 + bonus 1 必须合计 3 点落回契约持有者');
    assert.equal(s.players[1].cp, defCpBefore + 1, 'CP 发给反击执行方（seat = 效果执行方口径）');
    assert.equal(s.players[0].cp, atkCpBefore, '原攻击方（契约持有者）不得因此获得 CP');
  });
});

// ════════════════════════════════════════════════════════════════
// P2 onRollPhaseStart：进攻掷骰阶段开场按进攻方状态汇总 delta（ENTANGLE）
// ════════════════════════════════════════════════════════════════
describe('P2 onRollPhaseStart：开场汇总掷骰次数修正（官方 ENTANGLE 少 N 次）', () => {
  /** main1 结束 → 进入进攻掷骰阶段（openOffensiveRoll 在此结算 delta） */
  function openRoll(reg: ContentRegistry, s0: GameState): GameState {
    return step(reg, s0, 0, { t: 'endMainPhase' }).state;
  }

  test('delta -1 → 剩 2 次且 legalActions「剩 N 次」标签跟随；掷骰后标签递减', () => {
    const reg = buildRegistry([STATUSES.entangleOnlyDelta]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:deltaOnly', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.phase, 'offensiveRoll');
    assert.equal(s.players[0].rollAttemptsLeft, 2, '官方「1 fewer roll attempts」：3-1=2');
    const label = getLegalActions(s, reg, 0).find((a) => a.t === 'performRoll')?.label ?? '';
    assert.ok(label.includes('剩 2 次'), `legalActions 标签必须跟随契约，实际：${label}`);
    const s2 = step(reg, s, 0, { t: 'performRoll' }).state;
    assert.equal(s2.players[0].rollAttemptsLeft, 1, '掷骰消耗 1 次');
    const label2 = getLegalActions(s2, reg, 0).find((a) => a.t === 'performRoll')?.label ?? '';
    assert.ok(label2.includes('剩 1 次'), `掷骰后标签必须递减，实际：${label2}`);
  });

  test('汇总：两个不同 -1 状态同时在场 → 剩 1 次（按状态列表逐条累加，与层数无关）', () => {
    const reg = buildRegistry([
      STATUSES.entangleOnlyDelta,
      mkStatus('test:deltaOnly2', { onRollPhaseStart: { rollAttemptsDelta: -1 } }),
    ]);
    const s0 = mkState(reg, {
      phase: 'main1',
      activeStatuses: [{ id: 'test:deltaOnly', stacks: 1 }, { id: 'test:deltaOnly2', stacks: 3 }],
    });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 1, '两个 -1 状态汇总为 -2（3-2=1）；3 层不按层数相乘');
  });

  test('下限 0：delta -5 → 0 次；performRoll 被拒且 legalActions 灰显给原因', () => {
    const reg = buildRegistry([mkStatus('test:deltaHeavy', { onRollPhaseStart: { rollAttemptsDelta: -5 } })]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:deltaHeavy', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 0, '汇总结果下限 0，不得为负');
    const bad = reduce(s, { seat: 0, action: { t: 'performRoll' }, clientSeq: 1 }, reg);
    assert.equal(bad.ok, false, '0 次时掷骰必须被拒');
    const roll = getLegalActions(s, reg, 0).find((a) => a.t === 'performRoll');
    assert.equal(roll?.enabled, false, '0 次时 legalActions 必须灰显');
    assert.ok((roll?.reason ?? '').includes('用尽'), `灰显原因应说明次数用尽，实际：${roll?.reason}`);
  });

  test('混合符号汇总：-2 与 +1 同时在场 → 剩 2 次（契约双向，汇总后下限 0）', () => {
    const reg = buildRegistry([
      mkStatus('test:deltaDown2', { onRollPhaseStart: { rollAttemptsDelta: -2 } }),
      mkStatus('test:deltaUp1', { onRollPhaseStart: { rollAttemptsDelta: 1 } }),
    ]);
    const s0 = mkState(reg, {
      phase: 'main1',
      activeStatuses: [{ id: 'test:deltaDown2', stacks: 1 }, { id: 'test:deltaUp1', stacks: 1 }],
    });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 2, '3 + (-2) + (+1) = 2');
  });

  test('只汇总当前进攻方：守方带 -1 状态不影响攻方次数（3 次）', () => {
    const reg = buildRegistry([STATUSES.entangleOnlyDelta]);
    const s0 = mkState(reg, { phase: 'main1', defenderStatuses: [{ id: 'test:deltaOnly', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 3, 'delta 只按当前进攻方身上状态汇总');
  });

  test('main1 中施加的状态计入开场汇总（钩子读开场时的状态列表，不是阶段进入时快照）', () => {
    const reg = buildRegistry([STATUSES.entangleOnlyDelta]);
    const s0 = mkState(reg, { phase: 'main1', attackerHand: ['test:selfEntangle'] });
    // 注意：selfEntangle 卡施加的是 test:notEntangle（官方 ENTANGLE 双契约形态），本用例只验 delta 半边
    const reg2 = buildRegistry([STATUSES.entangle]);
    const s1 = step(reg2, mkState(reg2, { phase: 'main1', attackerHand: ['test:selfEntangle'] }), 0,
      { t: 'playCard', uid: 'hand-0' }).state;
    assert.ok(s1.players[0].statuses.some((st) => st.id === 'test:notEntangle'), '缠藤卡必须施加自造 ENTANGLE');
    const s2 = openRoll(reg2, s1);
    assert.equal(s2.players[0].rollAttemptsLeft, 2, 'main1 中施加的 delta 必须在开场生效');
  });

  test('无效输入稳健性：未注册 id 的 status 实例不得崩溃（delta 记 0、收场跳过）', () => {
    const reg = buildRegistry([STATUSES.plain]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:ghost', stacks: 1 }] });
    const s = openRoll(reg, s0);
    assert.equal(s.players[0].rollAttemptsLeft, 3, '未注册状态不贡献 delta');
    const s2 = step(reg, s, 0, { t: 'passAbility' }).state;
    assert.equal(s2.phase, 'main2', '未注册状态不得阻断收场');
  });

  test('完整周期：ENTANGLE 当回合 3→2、收场移除，下一自己回合恢复 3（官方双契约合体）', () => {
    const reg = buildRegistry([STATUSES.entangle]);
    const s0 = mkState(reg, { phase: 'main1', activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    // 回合 0（seat 0，带 ENTANGLE）：开场 2 次
    const s1 = openRoll(reg, s0);
    assert.equal(s1.players[0].rollAttemptsLeft, 2, '受缠藤影响的进攻掷骰阶段必须只有 2 次');
    const legalRoll = getLegalActions(s1, reg, 0).filter((a) => a.t === 'performRoll');
    assert.equal(legalRoll.length, 1, '仍有 1 次时应下发掷骰动作');
    // 放弃激活 → 收场移除 ENTANGLE → main2 → endTurn → 对手回合
    let s = step(reg, s1, 0, { t: 'passAbility' }).state;
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notEntangle'), '收场必须移除 ENTANGLE');
    assert.equal(s.phase, 'main2');
    s = step(reg, s, 0, { t: 'endMainPhase' }).state;
    assert.equal(s.turn, 1, '必须推进到对手回合');
    assert.equal(s.activeSeat, 1);
    assert.equal(s.pending?.kind, 'cardWindow', '对手应进入主阶段一打牌窗口');
    // 对手完整回合（无 ENTANGLE）
    s = concludeOwnTurn(reg, s);
    assert.equal(s.turn, 2, '必须回到 seat 0 的回合');
    assert.equal(s.activeSeat, 0);
    // 回合 2（seat 0，ENTANGLE 已不在）：恢复 3 次
    const s3 = openRoll(reg, s);
    assert.equal(s3.players[0].rollAttemptsLeft, 3, 'ENTANGLE 移除后下一自己回合必须恢复 3 次');
  });
});

// ════════════════════════════════════════════════════════════════
// P3 onConcludeRollPhase.failDie：收场掷骰定阶段生死（BLIND）
// ════════════════════════════════════════════════════════════════
describe('P3 onConcludeRollPhase.failDie：收场移除并掷骰，命中失败面则整个阶段作废', () => {
  const blind = (over?: Partial<StatusDef>): StatusDef =>
    mkStatus('test:notBlind', { onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } }, ...over });

  test('命中失败面（QA 种子 qa-probe-7 掷出 1）：先移除、阶段作废直接进 main2，能力不激活且无任何效果', () => {
    const reg = buildRegistry([blind()]);
    const s0 = mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const s = r.state;
    // 官方「must remove this token and roll 1 die」——移除先于掷骰、与骰果无关
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notBlind'), '收场必须先移除该状态');
    const changed = r.events.find((e) => e.type === 'statusChanged' && e.payload['statusId'] === 'test:notBlind');
    assert.equal((changed?.payload as { delta?: number })?.delta, -1, '移除必须发 statusChanged 事件');
    // 官方「must remove this token and roll 1 die」的顺序：移除事件必须先于掷骰事件
    const changedIdx = r.events.findIndex((e) => e.type === 'statusChanged' && e.payload['statusId'] === 'test:notBlind');
    const rollIdx = r.events.findIndex((e) => e.type === 'note'
      && (e.payload as Record<string, unknown>)['kind'] === 'rollPhaseFailDie');
    assert.ok(changedIdx >= 0 && rollIdx >= 0 && changedIdx < rollIdx,
      '移除必须发生在掷骰之前（与骰果无关）');
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failValues?: number[]; failed?: boolean };
    assert.deepEqual(ev?.values, [1], 'QA 种子必须掷出 1（命中失败面）');
    assert.deepEqual(ev?.failValues, [1, 2], '收场掷骰事件必须带失败面值');
    assert.equal(ev?.failed, true, '命中失败面时 failed 必须为 true');
    assert.ok(findNote(r.events, 'rollPhaseFailed'), '必须发作废事件供 UI 呈现');
    assert.ok(findNote(r.events, 'abilityVoided'), '必须发能力作废事件供 UI 呈现');
    // 作废 = 什么都不发生
    assert.equal(s.phase, 'main2', '作废后直接进入主阶段二');
    assert.equal(s.pending?.kind, 'cardWindow', '作废后只应挂主阶段二的打牌窗口');
    assert.equal(s.bucket.entries.length, 0, '作废路径不得留下任何入桶伤害');
    assert.equal(s.players[1].hp, 50, '作废时守方 HP 不得变化');
    assert.equal(s.players[0].cp, s0.players[0].cp, '作废时攻方 CP 不得变化');
    assert.equal(s.players[0].turnDamageDealt, 0, '作废不得记「造成的伤害」');
    assert.ok(!r.events.some((e) => e.type === 'abilityActivated'), '作废时能力不得激活');
    assert.ok(!findNote(r.events, 'damageQueued'), '作废时不得有伤害入桶');
    assert.ok(!r.events.some((e) => e.type === 'damageApplied'), '作废时不得结算伤害');
    assert.ok(!r.events.some((e) => e.type === 'defenseRolled'), '作废时不得开防御');
    assert.ok(!r.events.some((e) => e.type === 'cardPlayed'), '作废时不得打牌');
  });

  test('失败路径状态卫生：作废态 ≡ 放弃态（逐字段差分），零半结算残骸', () => {
    const reg = buildRegistry([blind(), STATUSES.plain]);
    // 作废路径：BLIND 命中 → announceAbility
    const voidR = step(reg, mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] }),
      0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    // 对照路径：无契约状态 → passAbility（阶段同样「什么都不发生」的既有出口）
    const passR = step(reg, mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: [{ id: 'test:plain', stacks: 1 }] }),
      0, { t: 'passAbility' });
    const v = voidR.state;
    // 显式零残骸断言：bucket / pending / phase / defenseUsed / ladderStep / activeDefenseAbilityId
    assert.equal(v.bucket.entries.length, 0, 'bucket 不得有残骸条目');
    assert.equal(v.bucket.avoid.length, 0, 'bucket avoid 不得有残骸');
    assert.equal(v.bucket.heals.length, 0, 'bucket heals 不得有残骸');
    assert.equal(v.bucket.pendingRecoils.length, 0, 'bucket pendingRecoils 不得有残骸');
    assert.equal(v.windows.stack.length, 0, '响应窗口栈不得有残骸');
    assert.deepEqual(v.bindings, {}, '绑定变量不得有残骸');
    assert.deepEqual(v.tempDice, [], '临时骰池不得有残骸');
    assert.equal(v.ladderStep, null, '结算阶梯指针必须回到 null（未进入任何阶梯步）');
    assert.equal(v.activeDefenseAbilityId, undefined, '防御能力选择位不得留残骸');
    assert.equal(v.players[0].defenseUsed, false, '攻方 defenseUsed 不得被置位');
    assert.equal(v.players[1].defenseUsed, false, '守方 defenseUsed 不得被置位');
    assert.deepEqual(v.players[0].permissionTokens, [], '权限令牌不得有残骸');
    assert.deepEqual(v.players[1].permissionTokens, [], '权限令牌不得有残骸');
    assert.equal(v.winner, null, '对局不得被误判结束');
    assert.equal(v.finished, false, '对局不得被误判结束');
    // 逐字段差分：作废态必须与放弃态完全一致（除 rng/seq/事件流与状态列表外）
    assert.deepEqual(hygieneSnapshot(v), hygieneSnapshot(passR.state),
      '作废后的状态必须逐字段等于放弃激活后的状态——「无任何效果」的机器可判证据');
    // 差异项显式声明：状态移除、事件流、rng 消耗
    assert.ok(!v.players[0].statuses.some((st) => st.id === 'test:notBlind'), '作废路径必须移除 BLIND');
    assert.ok(passR.state.players[0].statuses.some((st) => st.id === 'test:plain'), '对照路径保留普通状态');
    assert.ok(voidR.events.some((e) => e.type === 'statusChanged'), '作废路径必须发状态变更事件');
    assert.ok(findNote(voidR.events, 'rollPhaseFailDie'), '作废路径必须发收场掷骰事件');
  });

  test('未命中失败面（QA 种子 qa-probe-1 掷出 6）：状态移除后能力照常激活（防御挂起 + 4 伤害入桶）', () => {
    const reg = buildRegistry([blind()]);
    const s0 = mkState(reg, { seed: SEED_BLIND_MISS, activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const s = r.state;
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notBlind'), '无论骰果如何都要移除');
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failed?: boolean };
    assert.deepEqual(ev?.values, [6], 'QA 种子必须掷出 6（未命中）');
    assert.equal(ev?.failed, false, '未命中时 failed 必须为 false');
    assert.ok(!findNote(r.events, 'rollPhaseFailed'), '未命中不得发作废事件');
    assert.equal(s.pending?.kind, 'defensiveRoll', '未命中时能力照常结算（开防御窗口）');
    assert.equal(queuedDefendable(s), 4, '未命中时火球 4 点伤害照常入桶');
    assert.ok(r.events.some((e) => e.type === 'abilityActivated'), '未命中时能力必须激活');
  });

  test('放弃激活出口同样触发：移除 + 掷骰事件 + 阶段进 main2（官方不区分出口）', () => {
    const reg = buildRegistry([blind()]);
    const s0 = mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'passAbility' });
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notBlind'), '放弃激活同样要移除');
    assert.ok(findNote(r.events, 'rollPhaseFailDie'), '放弃激活同样要掷骰并发事件');
    assert.equal(r.state.phase, 'main2', '放弃激活后照常进主阶段二');
  });

  test('count/failValues 泛化：count 2 掷 2 颗；failed 与失败面命中严格一致且阶段走向跟随', () => {
    const reg = buildRegistry([blind({ onConcludeRollPhase: { failDie: { count: 2, failValues: [6] } } })]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failed?: boolean };
    assert.equal(ev?.values?.length, 2, 'count 2 必须掷 2 颗');
    assert.equal(ev?.failed, (ev?.values ?? []).includes(6), 'failed 必须与失败面命中一致');
    if (ev?.failed) {
      assert.equal(r.state.phase, 'main2', '命中必须作废');
      assert.equal(r.state.bucket.entries.length, 0, '作废路径不入桶');
    } else {
      assert.equal(r.state.pending?.kind, 'defensiveRoll', '未命中必须照常开防御');
    }
  });

  test('无效输入稳健性：count 0 不掷骰、不得崩溃、阶段照常（空 some 恒 false）', () => {
    const reg = buildRegistry([blind({ onConcludeRollPhase: { failDie: { count: 0, failValues: [1, 2] } } })]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failed?: boolean };
    assert.deepEqual(ev?.values, [], 'count 0 必须掷 0 颗');
    assert.equal(ev?.failed, false, '空骰面集合不得判失败');
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notBlind'), '仍须移除');
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '阶段必须照常推进');
  });

  test('无效输入稳健性：failValues 为空数组 → 永不作废（与 count 0 正交）', () => {
    const reg = buildRegistry([blind({ onConcludeRollPhase: { failDie: { count: 1, failValues: [] } } })]);
    const s0 = mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const ev = findNote(r.events, 'rollPhaseFailDie') as { values?: number[]; failed?: boolean };
    assert.deepEqual(ev?.values, [1], '骰照掷（QA 种子 = 1）');
    assert.equal(ev?.failed, false, '失败面为空必须永不作废');
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '阶段必须照常推进');
  });

  test('两个 failDie 状态同时在场：都移除、都掷骰；任一命中即作废', () => {
    const reg = buildRegistry([
      mkStatus('test:notBlindA', { onConcludeRollPhase: { failDie: { count: 1, failValues: [1] } } }),
      mkStatus('test:notBlindB', { onConcludeRollPhase: { failDie: { count: 1, failValues: [2] } } }),
    ]);
    const s0 = mkState(reg, {
      seed: SEED_BLIND_HIT,
      activeStatuses: [{ id: 'test:notBlindA', stacks: 1 }, { id: 'test:notBlindB', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    for (const id of ['test:notBlindA', 'test:notBlindB']) {
      assert.ok(!r.state.players[0].statuses.some((st) => st.id === id), `${id} 必须被移除`);
      assert.ok(r.events.some((e) => e.type === 'statusChanged' && e.payload['statusId'] === id), `${id} 必须发移除事件`);
    }
    const rolls = r.events.filter((e) => e.type === 'note'
      && (e.payload as Record<string, unknown>)['kind'] === 'rollPhaseFailDie');
    assert.equal(rolls.length, 2, '两个 failDie 状态必须各掷一次');
    const a = rolls[0]?.payload as { values?: number[]; failed?: boolean };
    assert.deepEqual(a?.values, [1], '第一个状态的掷骰与单状态场景同源（移除不消耗 rng）');
    assert.equal(a?.failed, true, 'A 的失败面 [1] 必须命中');
    assert.equal(r.state.phase, 'main2', '任一命中即作废');
    assert.equal(r.state.bucket.entries.length, 0, '作废路径不入桶');
  });

  test('failDie 与 expiresAtRollPhaseEnd 同状态：failDie 分支优先，单次移除单次掷骰', () => {
    const reg = buildRegistry([blind({ expiresAtRollPhaseEnd: true })]);
    const s0 = mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: [{ id: 'test:notBlind', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    const changed = r.events.filter((e) => e.type === 'statusChanged' && e.payload['statusId'] === 'test:notBlind');
    assert.equal(changed.length, 1, '同一状态只许移除一次（continue 跳过 expires 分支）');
    assert.equal((changed[0]?.payload as { delta?: number })?.delta, -1, '整枚 1 层移除');
    assert.equal(r.events.filter((e) => (e.payload as Record<string, unknown>)['kind'] === 'rollPhaseFailDie').length, 1,
      '只许一次收场掷骰');
    assert.ok(!findNote(r.events, 'rollPhaseTokenExpired'), 'failDie 分支不得再发 expires 弃置事件');
    assert.equal(r.state.phase, 'main2', '命中即作废');
  });

  test('failDie 与 onRollPhaseStart 同状态：开场先减次、收场再定生死（官方 ENTANGLE×BLIND 合体形态）', () => {
    // 用自造英雄（const matcher）：openOffensiveRoll 会清空骰面，既有英雄的能力此时不可激活
    const reg = buildRegistry([mkStatus('test:hybrid', {
      onRollPhaseStart: { rollAttemptsDelta: -1 },
      onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } },
    })]);
    const s0 = mkState(reg, {
      seed: SEED_STRIKER_HIT,
      heroes: ['test:striker', 'gunslinger'],
      phase: 'main1',
      activeStatuses: [{ id: 'test:hybrid', stacks: 1 }],
    });
    const s1 = step(reg, s0, 0, { t: 'endMainPhase' }).state;
    assert.equal(s1.players[0].rollAttemptsLeft, 2, '开场钩子必须先结算（3-1=2）');
    const r = step(reg, s1, 0, { t: 'announceAbility', abilityId: 'test:strike4' });
    assert.equal(r.state.phase, 'main2', '收场命中必须作废');
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:hybrid'), '必须移除');
  });

  test('悬桶内容在作废路径下的处理：原样保留不清不结，与放弃路径完全一致（现状记录）', () => {
    // 预存在语义：主阶段打出的 thenNode 类卡伤害「悬桶」——不在打出时 flush，
    // 而由下一次 flush（对手 upkeep 或任一次 finishResolution）结算。作废路径
    // 「无任何效果」的正确行为正是不碰桶；本用例证明它不比放弃路径多制造残骸。
    const reg = buildRegistry([blind()]);
    const dangling: GameState['bucket'] = {
      entries: [{ bucketKind: 'defendable', amount: 3, damageType: 'attack', sourceKind: 'ability', toSeat: 1, fromSeat: 0 }],
      heals: [], avoid: [], pendingRecoils: [],
    };
    const withBucket = (statuses: readonly StatusInstance[]): GameState =>
      mkState(reg, { seed: SEED_BLIND_HIT, activeStatuses: statuses, bucket: dangling });
    // 作废路径
    const v = step(reg, withBucket([{ id: 'test:notBlind', stacks: 1 }]), 0,
      { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.equal(v.state.bucket.entries.length, 1, '作废路径不得清空悬桶条目');
    assert.equal(v.state.bucket.entries[0]?.amount, 3, '作废路径不得改写悬桶条目');
    assert.equal(v.state.players[1].hp, 50, '作废路径不得提前结算悬桶伤害');
    // 对照：放弃路径
    const p = step(reg, withBucket([{ id: 'test:plain', stacks: 1 }]), 0, { t: 'passAbility' });
    assert.equal(p.state.bucket.entries.length, 1, '放弃路径同样不清桶（预存在悬桶语义）');
    // 悬桶的既定落点：推进到对手回合 upkeep 时 flush（HP 推迟一回合落地）
    const s2 = step(reg, v.state, 0, { t: 'endMainPhase' }).state;
    assert.equal(s2.turn, 1, '作废后必须能正常走完回合推进');
    assert.equal(s2.players[1].hp, 47, '悬桶 3 点在对手 upkeep flush（预存在落点，非本契约引入）');
    assert.equal(s2.bucket.entries.length, 0, 'flush 后桶必须清空');
    assert.equal(s2.players[0].turnDamageDealt, 3, '悬桶伤害归账给造成者（预存在口径）');
  });

  test('作废后对局可正常继续：走完回合 → 对手回合 → 回到自己回合恢复 3 次且 BLIND 已不在', () => {
    // 用自造英雄（const matcher）：openOffensiveRoll 会清空骰面，既有英雄的能力此时不可激活
    const reg = buildRegistry([STATUSES.blind]);
    const s0 = mkState(reg, {
      seed: SEED_STRIKER_HIT,
      heroes: ['test:striker', 'gunslinger'],
      activeStatuses: [{ id: 'test:notBlind', stacks: 1 }],
    });
    let s = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'test:strike4' }).state;
    assert.equal(s.phase, 'main2', '作废后进主阶段二');
    s = step(reg, s, 0, { t: 'endMainPhase' }).state;   // main2 → discard → endTurn → 对手 main1
    assert.equal(s.activeSeat, 1, '必须交棒给对手');
    assert.equal(s.pending?.kind, 'cardWindow', '对手必须拿到打牌窗口（无卡死死挂起）');
    s = concludeOwnTurn(reg, s);                          // 对手完整回合
    assert.equal(s.activeSeat, 0, '必须回到 seat 0');
    s = step(reg, s, 0, { t: 'endMainPhase' }).state;     // 再次进入进攻掷骰
    assert.equal(s.players[0].rollAttemptsLeft, 3, 'BLIND 移除后次数恢复 3');
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notBlind'), 'BLIND 不得复发');
    s = step(reg, s, 0, { t: 'performRoll' }).state;      // 正常掷骰
    const r = step(reg, s, 0, { t: 'announceAbility', abilityId: 'test:strike4' });
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '无 BLIND 后能力必须能正常激活');
  });
});

// ════════════════════════════════════════════════════════════════
// P4 expiresAtRollPhaseEnd：掷骰阶段结论即弃置（ENTANGLE）
// ════════════════════════════════════════════════════════════════
describe('P4 expiresAtRollPhaseEnd：结论时移除（与 discardAtTurnEnd 时机分离）', () => {
  const entangle = (over?: Partial<StatusDef>): StatusDef =>
    mkStatus('test:notEntangle', { expiresAtRollPhaseEnd: true, ...over });

  test('宣布能力出口：状态在能力激活前已被移除（能力照常结算）', () => {
    const reg = buildRegistry([entangle()]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notEntangle'), '结论时必须移除');
    assert.ok(findNote(r.events, 'rollPhaseTokenExpired'), '结论弃置必须发事件供 UI 呈现');
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '弃置不影响能力照常激活');
    assert.equal(queuedDefendable(r.state), 4, '弃置不影响伤害照常入桶');
  });

  test('放弃激活出口：状态移除 + 阶段进 main2', () => {
    const reg = buildRegistry([entangle()]);
    const s0 = mkState(reg, { activeStatuses: [{ id: 'test:notEntangle', stacks: 1 }] });
    const r = step(reg, s0, 0, { t: 'passAbility' });
    assert.ok(!r.state.players[0].statuses.some((st) => st.id === 'test:notEntangle'), '放弃激活同样是结论');
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

  test('时机分离：discardAtTurnEnd 收场不弃、endTurn 才弃；本回合内获得的还须再历经一个完整自己回合', () => {
    const reg = buildRegistry([entangle(), STATUSES.shadowsLike]);
    // sinceTurn = 当前回合（本回合内获得）→ 本 endTurn 不弃；sinceTurn = 当前-1 → endTurn 即弃
    const kept = mkState(reg, {
      phase: 'main1',
      activeStatuses: [
        { id: 'test:notEntangle', stacks: 1 },
        { id: 'test:notShadows', stacks: 1, sinceTurn: 0 },
      ],
    });
    const gone = mkState(reg, {
      phase: 'main1',
      activeStatuses: [
        { id: 'test:notEntangle', stacks: 1 },
        { id: 'test:notShadows', stacks: 1, sinceTurn: -1 },
      ],
    });
    for (const [name, s0, expectKept] of [['本回合内获得', kept, true], ['从回合开始就带着', gone, false]] as const) {
      let s = step(reg, s0, 0, { t: 'endMainPhase' }).state;   // main1 → offensiveRoll
      s = step(reg, s, 0, { t: 'passAbility' }).state;          // 收场：ENTANGLE 移除、Shadows 不动
      assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notEntangle'),
        'expiresAtRollPhaseEnd 必须在掷骰阶段收场即弃，不等回合结束');
      assert.ok(s.players[0].statuses.some((st) => st.id === 'test:notShadows'),
        `discardAtTurnEnd（${name}）不得在收场被提前弃置——两个时机不得互窜`);
      s = step(reg, s, 0, { t: 'endMainPhase' }).state;         // main2 → discard → endTurn
      assert.equal(s.players[0].statuses.some((st) => st.id === 'test:notShadows'), expectKept,
        `endTurn 弃置判定必须只认 sinceTurn（${name}）`);
    }
  });

  test('时机分离反向守门：main2 中才施加的 expires 状态必须活过 endTurn，直到下次收场才弃', () => {
    const reg = buildRegistry([entangle()]);
    const s0 = mkState(reg, { phase: 'main1', attackerHand: ['test:selfEntangle'] });
    let s = step(reg, s0, 0, { t: 'endMainPhase' }).state;      // main1 → offensiveRoll
    s = step(reg, s, 0, { t: 'passAbility' }).state;             // → main2（此时尚未施加）
    s = step(reg, s, 0, { t: 'playCard', uid: 'hand-0' }).state; // main2 施加 ENTANGLE
    assert.ok(s.players[0].statuses.some((st) => st.id === 'test:notEntangle'), '缠藤卡必须施加成功');
    s = step(reg, s, 0, { t: 'endMainPhase' }).state;            // main2 → discard → endTurn
    assert.equal(s.turn, 1, '必须推进到对手回合');
    assert.ok(s.players[0].statuses.some((st) => st.id === 'test:notEntangle'),
      'endTurn 只弃 discardAtTurnEnd；expiresAtRollPhaseEnd 不得被回合末误弃（互窜守门）');
    s = concludeOwnTurn(reg, s);                                  // 对手完整回合 → 回到 seat 0
    s = step(reg, s, 0, { t: 'endMainPhase' }).state;             // 进入进攻掷骰
    s = step(reg, s, 0, { t: 'passAbility' }).state;              // 收场 → 移除
    assert.ok(!s.players[0].statuses.some((st) => st.id === 'test:notEntangle'),
      'expiresAtRollPhaseEnd 必须在自己下次掷骰阶段收场时弃置');
  });

  test('BLIND 作废 + ENTANGLE 弃置同回合：两个状态都在同一收场点被移除，阶段作废', () => {
    const reg = buildRegistry([entangle(), STATUSES.blind]);
    const s0 = mkState(reg, {
      seed: SEED_BLIND_HIT,
      activeStatuses: [{ id: 'test:notBlind', stacks: 1 }, { id: 'test:notEntangle', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    for (const id of ['test:notBlind', 'test:notEntangle']) {
      assert.ok(!r.state.players[0].statuses.some((st) => st.id === id), `${id} 必须被移除`);
    }
    assert.ok(findNote(r.events, 'rollPhaseFailDie'), 'BLIND 掷骰必须发生');
    assert.ok(findNote(r.events, 'rollPhaseTokenExpired'), 'ENTANGLE 弃置必须发生');
    assert.equal(r.state.phase, 'main2', 'BLIND 命中 → 作废');
    assert.equal(r.state.bucket.entries.length, 0, '作废路径不入桶');
  });

  test('BLIND 未命中 + ENTANGLE 弃置同回合：两个状态都移除，能力照常结算', () => {
    const reg = buildRegistry([entangle(), STATUSES.blind]);
    const s0 = mkState(reg, {
      seed: SEED_BLIND_MISS,
      activeStatuses: [{ id: 'test:notBlind', stacks: 1 }, { id: 'test:notEntangle', stacks: 1 }],
    });
    const r = step(reg, s0, 0, { t: 'announceAbility', abilityId: 'pyromancer:fireball' });
    for (const id of ['test:notBlind', 'test:notEntangle']) {
      assert.ok(!r.state.players[0].statuses.some((st) => st.id === id), `${id} 必须被移除`);
    }
    assert.equal(r.state.pending?.kind, 'defensiveRoll', '未命中 → 能力照常');
    assert.equal(queuedDefendable(r.state), 4, '伤害照常入桶');
  });
});

// ════════════════════════════════════════════════════════════════
// P5 describe 层：新契约字段模板覆盖（zh/en、无回落 id）
// ════════════════════════════════════════════════════════════════
describe('P5 describe：新契约字段模板覆盖全部新契约、zh/en 双语、无回落英文 id', () => {
  const mk = (over: Partial<StatusDef>): StatusDef => ({
    id: 'test:render', name: '自造渲染状态', polarity: 'negative',
    stackLimit: 1, persistent: true, spendable: false, ...over,
  });
  const noIdLeak = (t: string): void => { assert.ok(!t.includes('test:'), `描述不得回落内部 id：${t}`); };

  test('onAttacked 三种字段组合各自渲染（逐字段同口径）', () => {
    const bonusOnly = describeStatus(mk({ onAttacked: { bonusDamage: 2 } }), 'zh');
    assert.ok(bonusOnly.includes('+2'), `bonusDamage 丢失 → ${bonusOnly}`);
    assert.ok(!bonusOnly.includes('CP'), `只有 bonusDamage 时不得渲染 CP → ${bonusOnly}`);
    noIdLeak(bonusOnly);
    const cpOnly = describeStatus(mk({ onAttacked: { attackerGainsCp: 2 } }), 'zh');
    assert.ok(cpOnly.includes('CP'), `attackerGainsCp 丢失 → ${cpOnly}`);
    assert.ok(!cpOnly.includes('伤害 +'), `只有 CP 时不得渲染加伤 → ${cpOnly}`);
    const both = describeStatus(mk({ onAttacked: { bonusDamage: 1, attackerGainsCp: 1 } }), 'zh');
    assert.ok(both.includes('+1') && both.includes('CP'), `双字段必须都在 → ${both}`);
    const avoid = describeStatus(mk({ onAttacked: { avoid: true } }), 'zh');
    assert.ok(avoid.includes('避开'), `avoid 渲染丢失 → ${avoid}`);
  });

  test('onAttacked 英文版非空且语义在（en 不回落中文占位）', () => {
    const bonusOnly = describeStatus(mk({ onAttacked: { bonusDamage: 2 } }), 'en');
    assert.ok(bonusOnly.includes('+2') && bonusOnly.includes('dmg'), `en bonusDamage 丢失 → ${bonusOnly}`);
    const cpOnly = describeStatus(mk({ onAttacked: { attackerGainsCp: 2 } }), 'en');
    assert.ok(cpOnly.includes('CP'), `en CP 丢失 → ${cpOnly}`);
    const avoid = describeStatus(mk({ onAttacked: { avoid: true } }), 'en');
    assert.ok(avoid.includes('avoids'), `en avoid 丢失 → ${avoid}`);
  });

  test('onRollPhaseStart 双向渲染（少 N 次 / 多 N 次），zh/en 都有', () => {
    const less = describeStatus(mk({ onRollPhaseStart: { rollAttemptsDelta: -1 } }), 'zh');
    assert.ok(less.includes('少 1 次掷骰机会'), `负 delta 渲染丢失 → ${less}`);
    const more = describeStatus(mk({ onRollPhaseStart: { rollAttemptsDelta: 1 } }), 'zh');
    assert.ok(more.includes('多 1 次掷骰机会'), `正 delta 渲染丢失 → ${more}`);
    assert.ok(describeStatus(mk({ onRollPhaseStart: { rollAttemptsDelta: -1 } }), 'en').includes('fewer'),
      'en 负 delta 渲染丢失');
  });

  test('onConcludeRollPhase.failDie：骰数、失败面、作废语义、移除语义都在', () => {
    const t = describeStatus(mk({ onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } } }), 'zh');
    assert.ok(t.includes('掷 1 颗骰'), `failDie.count 丢失 → ${t}`);
    assert.ok(t.includes('1/2'), `failValues 丢失 → ${t}`);
    assert.ok(t.includes('作废'), `阶段作废语义丢失 → ${t}`);
    assert.ok(t.includes('移除'), `收场移除语义丢失 → ${t}`);
    const en = describeStatus(mk({ onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } } }), 'en');
    assert.ok(en.includes('roll 1') && en.includes('1/2') && en.includes('fails'), `en failDie 丢失 → ${en}`);
  });

  test('两个弃置时机措辞必须区分（结论时弃置 vs 带着完整结束自己回合后弃置）', () => {
    const expire = describeStatus(mk({ expiresAtRollPhaseEnd: true }), 'zh');
    assert.ok(expire.includes('进攻掷骰阶段结论时弃置'), `expiresAtRollPhaseEnd 渲染丢失 → ${expire}`);
    const turnEnd = describeStatus(mk({ discardAtTurnEnd: true }), 'zh');
    assert.ok(turnEnd.includes('完整结束一个自己回合后弃置'), `discardAtTurnEnd 渲染丢失 → ${turnEnd}`);
    assert.ok(!expire.includes('自己回合'), '两个弃置时机不得共用措辞（结论时）');
    assert.ok(!turnEnd.includes('结论时弃置'), '两个弃置时机不得共用措辞（回合末）');
    assert.ok(describeStatus(mk({ expiresAtRollPhaseEnd: true }), 'en').includes('conclusion of the roll phase'),
      'en expires 渲染丢失');
  });

  test('全契约状态一次渲染：各字段语义都在、无残渣、en 非空', () => {
    const full = mk({
      onAttacked: { bonusDamage: 2, attackerGainsCp: 1 },
      onRollPhaseStart: { rollAttemptsDelta: -1 },
      onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } },
      expiresAtRollPhaseEnd: true,
    });
    const zh = describeStatus(full, 'zh');
    assert.ok(zh.includes('+2') && zh.includes('CP'), `加伤/CP 丢失 → ${zh}`);
    assert.ok(zh.includes('少 1 次掷骰机会'), `delta 丢失 → ${zh}`);
    assert.ok(zh.includes('作废'), `failDie 丢失 → ${zh}`);
    assert.ok(zh.includes('结论时弃置'), `expires 丢失 → ${zh}`);
    noIdLeak(zh);
    const en = describeStatus(full, 'en');
    assert.ok(en.trim().length > 0, '全契约状态英文描述不得为空');
    noIdLeak(en);
  });
});

// ════════════════════════════════════════════════════════════════
// P6 架构守门：引擎源码不得对任何英雄命名空间 id 特判
// ════════════════════════════════════════════════════════════════
describe('P6 架构硬约束：引擎源码零英雄 id 特判（静态扫描）', () => {
  test('engine 目录非测试源码不得出现英雄命名空间 id 字面量', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const HERO_ID_LITERAL = /['"`](?:barbarian|pyromancer|gunslinger|shadowthief|moonelf):[a-zA-Z]/;
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = readFileSync(`${dir}${f}`, 'utf8');
      if (HERO_ID_LITERAL.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], `引擎源码发现英雄 id 特判：${offenders.join(', ')}`);
  });
});
