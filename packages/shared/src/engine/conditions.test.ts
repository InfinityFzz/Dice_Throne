/**
 * 引擎条件语义复核（集成级 / 行为级）—— QA 任务 C2。
 *
 * 与 engine.test.ts 的分工：
 *  - engine.test.ts 只验证「求值函数返回 true / 内容层声明存在」（单元级）；
 *  - 本文件走**真实动作序列**（reduce → 挂起 → 再 reduce），验证**最终结果**：
 *    能不能防御、伤害有没有被减免、状态有没有被移除、骰子有没有真的重掷。
 *
 * 三项受验机制：
 *  1. barbarian:smack      —— undefendableIf { c:'nOfAKind', n:4 }（4 同点不可防御）
 *  2. barbarian:fortitude  —— conditional { c:'nOfAKind', n:3 }（3 同点移除自身 1 状态）
 *  3. common:betterD       —— rerollDice scope:'defense'（防御窗口重掷防御骰）
 *
 * 每组都含正例 + 反例（反例用于排除「条件恒真」的假阳性）。
 *
 * 跑法：node --import tsx --test packages/shared/src/engine/conditions.test.ts
 *
 * 缺陷状态：本文件**已无** characterization（缺陷固化）断言，全部为官方语义的期望断言。
 *  · 「防御窗口打出卡会清空防御骰」已于本轮修复 —— 改的是 tempDice 池归属，
 *    见 effects.ts 的 runEffects 文档注释；相关断言已翻正，并加了双路径差分回归哨兵
 *    与「自带临时骰池的卡不得顶掉防御骰」一条。
 *  · 「Fortitude 的 optional 效果不可达」已于本轮修复 —— 官方原文是 may（**可选**），
 *    MVP 按**必发**处理：heroes.ts 解开 optional 包裹改为 conditional + removeStatus，
 *    官方 may 以**已知偏差**记在该能力注释里（含回滚锚点）；effects.ts 的 optional handler
 *    **保持 no-op 桩不变**，诚实表达"引擎不支持玩家选择"。
 *    为什么不做成"自动行使"：那会让卡面继续宣称「可选」而引擎偷偷强制执行，
 *    守护"卡面保留玩家选择权"的断言会变成**假绿**——假绿比一条诚实的红测试危险得多。
 *    相关断言已翻正为正例 + 反例两条。
 *
 * 断言消息里一律**不写行号**：行号会随内容层增删漂移，上一轮就是这么过期的，改按标识符引用。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type {
  Action, EffectDef, GameEvent, GameState, Seat, StatusInstance,
} from '../index.js';
import {
  createDefaultRegistry, createMatch, reduce, getLegalActions,
  Draft, runEffects, evalCondition,
} from '../index.js';

const content = createDefaultRegistry();

/** 固定 seed：本文件所有骰值断言都依赖它（含防御骰与重掷骰） */
const SEED = 'qa-c2';

// ── 场景构造 ─────────────────────────────────────────
/**
 * 从 createMatch 的合法状态出发，只覆写「进入进攻掷骰阶段」所需的最小字段：
 * 直接把骰面写进 players[0].diceValues（等价于玩家已经掷完一次骰）。
 *
 * 取证局限说明：引擎没有从外部注入骰面的官方入口，这里绕过 performRoll 直接写状态。
 * 这意味着「掷骰动作本身」未被覆盖，但「骰面 → 能力匹配 → 条件判定 → 结算」全链路是被真实执行的。
 */
function mkState(opts: {
  readonly dice: readonly number[];
  readonly defenderHand?: readonly string[];
  readonly attackerStatuses?: readonly StatusInstance[];
}): GameState {
  const base = createMatch(content, { seed: SEED, heroes: ['barbarian', 'pyromancer'] });
  const p0 = {
    ...base.players[0],
    diceValues: [...opts.dice],
    diceLocked: [false, false, false, false, false],
    statuses: [...(opts.attackerStatuses ?? [])],
  };
  const p1 = {
    ...base.players[1],
    hand: (opts.defenderHand ?? []).map((defId, i) => ({ uid: `hand-${i}`, defId })),
  };
  return {
    ...base,
    phase: 'offensiveRoll',
    activeSeat: 0 as Seat,
    pending: null,
    players: [p0, p1],
  } as unknown as GameState;
}

/** 推进一步；动作被拒则直接抛错（测试里不应出现被拒动作） */
function step(state: GameState, seat: Seat, action: Action): { state: GameState; events: readonly GameEvent[] } {
  const r = reduce(state, { seat, action, clientSeq: 1 }, content);
  if (!r.ok) throw new Error(`动作 ${action.t} 被拒：${r.error.code} / ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** 取 note 事件（引擎内部日志）的 payload */
function findNote(events: readonly GameEvent[], kind: string): Record<string, unknown> | undefined {
  return events.find((e) => e.type === 'note' && e.payload['kind'] === kind)?.payload;
}

/** 取某类事件的 payload */
function findEvent(events: readonly GameEvent[], type: GameEvent['type']): Record<string, unknown> | undefined {
  return events.find((e) => e.type === type)?.payload;
}

/** Pyromancer 熔岩护甲 L1：对攻击者造成的反伤 = 防御骰里 flame（面值 1/2/3）的颗数 */
function flameCount(values: readonly number[]): number {
  return values.filter((v) => v <= 3).length;
}

// ── optional 展开工具（用于验证 Fortitude 的条件分支本身）────
interface MutableEffect { clause: Record<string, unknown>; next?: MutableEffect[] }

function cloneEffects(effects: readonly EffectDef[]): MutableEffect[] {
  return effects.map((e) => ({
    clause: { ...(e.clause as unknown as Record<string, unknown>) },
    ...(e.next ? { next: cloneEffects(e.next) } : {}),
  }));
}

/**
 * 把 `optional` 子句展开为其 steps —— 模拟「玩家选择行使」。
 *
 * ⚠️ 当前状态：**对 Fortitude 已无实际作用**（空转）。MVP 按必发处理后，
 * Fortitude 的 removeStatus 不再包在 optional 里（heroes.ts），这里传进来的树里没有
 * optional 可展开。保留本工具的理由：它是通用的树展开器，将来任何内容重新引入 optional
 * 时可直接用；且两条用例不因它空转而失效 —— 它们断言的是「条件命中后效果链正确」。
 * ⚠️ 反过来说也成立：引擎的 optional handler 是 **no-op 桩**（effects.ts，恒返回 []），
 * 所以一旦哪张卡真的把效果包进 optional，不展开就**不会执行**——本工具正是为此存在。
 */
function expandOptional(effects: MutableEffect[]): MutableEffect[] {
  const out: MutableEffect[] = [];
  for (const e of effects) {
    if (e.clause['kind'] === 'optional') {
      out.push(...expandOptional((e.clause['steps'] as MutableEffect[] | undefined) ?? []));
      continue;
    }
    if (e.next) e.next = expandOptional(e.next);
    for (const key of ['then', 'else', 'steps'] as const) {
      const v = e.clause[key];
      if (Array.isArray(v)) e.clause[key] = expandOptional(v as MutableEffect[]);
    }
    out.push(e);
  }
  return out;
}

/** Barbarian 骰面：1-3 sword / 4-5 life / 6 pow */
// ─────────────────────────────────────────────────────

describe('C2-1 Smack：4-of-a-kind 不可防御（undefendableIf: nOfAKind 4）', () => {
  /** 4 同点（四颗 1）+ 1 颗 4 → sword 数 4 → L1 二档 6 点 */
  const FOUR_KIND = [1, 1, 1, 1, 4] as const;
  /** 对照：3 同点（三颗 1）→ sword 数 3 → L1 一档 4 点，nOfAKind 4 不成立 */
  const THREE_KIND = [1, 1, 1, 4, 5] as const;

  test('正例：攻击骰 4 同点 → 伤害翻转为 undefendable，跳过防御掷骰直接结算', () => {
    const s0 = mkState({ dice: FOUR_KIND });
    const { state, events } = step(s0, 0, { t: 'announceAbility', abilityId: 'barbarian:smack' });

    const queued = findNote(events, 'damageQueued');
    assert.equal(queued?.['damageType'], 'undefendable', '4 同点时应翻转为不可防御');
    assert.equal(queued?.['amount'], 6, '4 sword → L1 二档 6 点');

    // 关键行为证据：没有进入防御掷骰阶段
    assert.equal(state.phase, 'main2', '不可防御伤害不应打开防御掷骰阶段');
    assert.notEqual(state.pending?.kind, 'defensiveRoll');
    assert.equal(state.players[1].defenseUsed, false, '守方不应被记为已使用防御掷骰');

    // 伤害未被减免：50 - 6 = 44；攻方未被防御能力（熔岩护甲）反伤
    assert.equal(state.players[1].hp, 44);
    assert.equal(state.players[0].hp, 50, '防御能力完全没有触发');
  });

  test('正例（续）：4 同点时守方无法执行防御掷骰，合法动作集为空', () => {
    const s0 = mkState({ dice: FOUR_KIND });
    const { state } = step(s0, 0, { t: 'announceAbility', abilityId: 'barbarian:smack' });

    const rejected = reduce(state, { seat: 1, action: { t: 'defensiveRoll' }, clientSeq: 2 }, content);
    assert.equal(rejected.ok, false, '守方不得进入防御掷骰');
    if (!rejected.ok) {
      assert.ok(
        ['notYourTurn', 'wrongPhase'].includes(rejected.error.code),
        `拒绝码应为阶段/回合类，实际 ${rejected.error.code}`,
      );
    }

    // UI 视角：守方此刻没有任何可行动作（legal.ts 与 reduce 同守卫）
    assert.deepEqual(getLegalActions(state, content, 1), []);
  });

  test('反例：攻击骰 3 同点 → 仍为 defendable，守方可以进入防御掷骰并完成防御', () => {
    const s0 = mkState({ dice: THREE_KIND });
    const a = step(s0, 0, { t: 'announceAbility', abilityId: 'barbarian:smack' });

    const queued = findNote(a.events, 'damageQueued');
    assert.equal(queued?.['damageType'], 'attack', '3 同点时不可防御标志必须关闭');
    assert.equal(queued?.['amount'], 4, '3 sword → L1 一档 4 点');

    assert.equal(a.state.phase, 'defensiveRoll');
    assert.equal(a.state.pending?.kind, 'defensiveRoll');
    assert.equal(a.state.pending?.seat, 1);
    assert.ok(
      getLegalActions(a.state, content, 1).some((x) => x.t === 'defensiveRoll'),
      '守方应看到「防御掷骰」按钮',
    );

    const b = step(a.state, 1, { t: 'defensiveRoll' });
    const rolled = findEvent(b.events, 'defenseRolled')?.['values'] as number[];
    assert.equal(rolled?.length, 5, 'Pyromancer 防御骰 5 颗');
    assert.equal(b.state.players[1].defenseUsed, true);

    // 防御能力确实按防御骰结算：对攻击者造成 flame 数点 pure 伤害
    const flame = flameCount(rolled);
    assert.ok(flame >= 1, `本 seed 的防御骰应至少 1 颗 flame，实际 ${flame}（若变更 seed 需重取）`);
    assert.equal(b.state.players[0].hp, 50 - flame, '防御能力（熔岩护甲）按防御骰结算');
    assert.equal(b.state.players[1].hp, 46, '50 - 4 点攻击伤害');
  });
});

describe('C2-2 Fortitude：3-of-a-kind 移除自身 1 状态（conditional nOfAKind 3）', () => {
  /** 3 同点（三颗 4）+ 1/2 → life 数 3（满足能力匹配），且 nOfAKind 3 成立 */
  const THREE_KIND = [4, 4, 4, 1, 2] as const;
  /** 对照：life 数同样为 3（能力仍可激活），但骰值 4/4/5/1/2 无 3 同点 */
  const NOT_THREE_KIND = [4, 4, 5, 1, 2] as const;
  const POISON_2: readonly StatusInstance[] = [{ id: 'common:poison', stacks: 2 }];

  const fortitudeTier1 = () => content.getHero('barbarian').abilities
    .find((a) => a.id === 'barbarian:fortitude')?.tiers[0]?.effects ?? [];

  test('正例：3 同点 → 条件命中，移除自身 1 个状态（conditional 命中后效果链正确）', () => {
    const d = new Draft(mkState({ dice: THREE_KIND, attackerStatuses: POISON_2 }), content);
    assert.equal(evalCondition(d, { c: 'nOfAKind', n: 3 }, 0), true, '前置：条件求值应为真');

    const tree = expandOptional(cloneEffects(fortitudeTier1()));
    runEffects(d, tree as unknown as readonly EffectDef[], 0);

    const poison = d.player(0).statuses.find((s) => s.id === 'common:poison');
    assert.equal(poison?.stacks, 1, '3 同点时应移除 1 层状态（2 → 1）');
    assert.equal(d.s.bucket.heals[0]?.amount, 3, '3 life → L1 一档治疗 3，能力确实结算了');
  });

  test('反例：非 3 同点 → 条件不命中，状态保持不动', () => {
    const d = new Draft(mkState({ dice: NOT_THREE_KIND, attackerStatuses: POISON_2 }), content);
    assert.equal(evalCondition(d, { c: 'nOfAKind', n: 3 }, 0), false, '前置：条件求值应为假');

    const tree = expandOptional(cloneEffects(fortitudeTier1()));
    runEffects(d, tree as unknown as readonly EffectDef[], 0);

    const poison = d.player(0).statuses.find((s) => s.id === 'common:poison');
    assert.equal(poison?.stacks, 2, '未满足 3 同点时移除效果必须关闭');
    assert.equal(d.s.bucket.heals[0]?.amount, 3, '治疗照常结算，证明能力本身已激活');
  });

  test('集成（正例）：走真实 announceAbility —— 3 同点治疗生效且移除自身 1 层状态', () => {
    const s0 = mkState({ dice: THREE_KIND, attackerStatuses: POISON_2 });
    const { state } = step(s0, 0, { t: 'announceAbility', abilityId: 'barbarian:fortitude' });

    assert.equal(state.players[0].hp, 53, '治疗 3 生效（50 → 53）');
    // 官方原文是「3 同点**可**移除自身 1 状态」（may），**MVP 按必发处理** ——
    // heroes.ts 已解开 optional 包裹，直接写成 conditional + removeStatus，
    // 官方 may 语义以**已知偏差**显式记在该能力的注释里（含回滚锚点）；
    // effects.ts 的 optional handler 保持 no-op 桩不变（诚实表达"引擎不支持玩家选择"）。
    // 必发的副作用可接受、但**不是零风险**：removeStatus status:'any' 走负面优先，
    // 只有当身上**一个负面状态都没有**时才会转而吃掉正面状态（实战中若经 transference
    // 选中 oppToSelf 拿到 fireMastery 一类正面状态即可能触发）。概率极低，非零。
    // 这里不写成「不损害持方利益」—— 那是过度断言，会把一条已知边界伪装成已证明的性质。
    // （此处不写行号：行号会随内容层增删漂移，上一次就是这么过期的，改按标识符引用。）
    assert.deepEqual(
      state.players[0].statuses,
      [{ id: 'common:poison', stacks: 1 }],
      '3 同点应移除自身 1 层状态（poison 2 → 1）；' +
      '若这里回到 2 层，说明移除效果再次不可达（例如被重新包回 no-op 的 optional 里）',
    );
  });

  test('集成（反例）：非 3 同点走真实 announceAbility —— 治疗生效但状态不移除', () => {
    const s0 = mkState({ dice: NOT_THREE_KIND, attackerStatuses: POISON_2 });
    const { state } = step(s0, 0, { t: 'announceAbility', abilityId: 'barbarian:fortitude' });

    assert.equal(state.players[0].hp, 53, '治疗照常结算：3 life → L1 一档 3，证明能力已激活');
    assert.deepEqual(
      state.players[0].statuses,
      POISON_2,
      '未满足 3 同点时移除效果必须关闭（poison 保持 2 层）；' +
      '若这里少于 2 层，说明 removeStatus 绕过了 nOfAKind 条件被无条件执行',
    );
  });
});

describe('C2-3 Better D!：防御窗口重掷防御骰（rerollDice scope:defense）', () => {
  /** 3 sword → 4 点可防御伤害，必然打开防御掷骰 */
  const ATTACK_DICE = [1, 1, 1, 4, 5] as const;

  /** 走到「防御窗口已打开」的挂起点 */
  function atDefenseWindow(hand: readonly string[]) {
    const a = step(mkState({ dice: ATTACK_DICE, defenderHand: hand }), 0,
      { t: 'announceAbility', abilityId: 'barbarian:smack' });
    assert.equal(a.state.pending?.kind, 'defensiveRoll');
    const b = step(a.state, 1, { t: 'defensiveRoll' });
    const rolled = findEvent(b.events, 'defenseRolled')?.['values'] as number[];
    return { before: a.state, at: b.state, events: b.events, rolled };
  }

  test('处理器级正例：rerollDice(scope=defense) 确实换了骰，后续效果读到新骰面', () => {
    const d = new Draft(mkState({ dice: ATTACK_DICE }), content);
    d.s.tempDice = [1, 1, 1, 1, 1]; // 原始防御骰，点数和 = 5

    runEffects(d, [{
      clause: { kind: 'rerollDice', count: 5, to: { r: 'self' }, scope: 'defense' },
      // next 用 pushFront 保序，会在 reroll 之后执行 —— 此时 tempDice 仍是新骰
      next: [{ clause: { kind: 'bind', name: 'afterReroll', value: { e: 'sumFaces' } } }],
    }], 1);

    const note = findNote(d.events, 'defenseRerolled');
    const rerolled = note?.['values'] as number[];
    assert.equal(rerolled?.length, 5, '应重掷 5 颗防御骰');
    assert.equal(
      d.s.bindings['afterReroll'],
      rerolled.reduce((a, b) => a + b, 0),
      '重掷后同一 runEffects 内读到的应是新骰面',
    );
    assert.notEqual(d.s.bindings['afterReroll'], 5, '与原始骰 [1,1,1,1,1]（和 5）不同 → 骰确实换了');

    // 池归属：本次序列没有 rollDicePool，tempDice 归调用方（防御阶梯）所有。
    // runEffects 必须把被 rerollDice 改写后的新骰原样交还 —— 这是新骰能传到 resolveDefense 的前提。
    assert.deepEqual(
      [...d.s.tempDice], rerolled,
      'runEffects 未掷临时骰池时不得销毁进入时的骰池：重掷后的新防御骰必须保留在 tempDice',
    );
  });

  test('集成：防御窗口打出 Better D! → 重掷发生，且防御能力按重掷后的新骰结算', () => {
    const { at, rolled } = atDefenseWindow(['common:betterD']);
    assert.equal(at.pending?.kind, 'defenseWindow', '持防御时机卡时应打开重掷窗口');
    assert.equal(at.pending?.seat, 1);
    assert.deepEqual([...at.tempDice], rolled, '窗口期间防御骰应保留在 tempDice');

    const legal = getLegalActions(at, content, 1);
    assert.ok(legal.some((x) => x.t === 'playCard' && x.uid === 'hand-0'), '应可打出 Better D!');
    assert.ok(legal.some((x) => x.t === 'respondPass'), '应可直接结算');

    const c = step(at, 1, { t: 'playCard', uid: 'hand-0' });
    const rerolled = findNote(c.events, 'defenseRerolled')?.['values'] as number[];
    assert.equal(rerolled?.length, 5, 'Better D! 重掷 5 颗防御骰');
    assert.notDeepEqual(rerolled, rolled, '重掷后骰面应与原防御骰不同 → 重掷确实发生');

    assert.equal(c.state.tempDice.length, 0, 'resolveDefense 求值完毕后由 owner 销毁防御骰池');
    const flameAfterReroll = flameCount(rerolled);
    assert.ok(flameAfterReroll >= 1, `本 seed 重掷骰应至少 1 颗 flame，实际 ${flameAfterReroll}`);

    // 官方语义：Better D! 重掷后，防御能力（熔岩护甲）按**新骰**结算
    assert.equal(
      c.state.players[0].hp, 50 - flameAfterReroll,
      `防御能力必须按重掷后的新骰结算：新骰 ${JSON.stringify(rerolled)} 含 ` +
      `${flameAfterReroll} 颗 flame → 攻方应受 ${flameAfterReroll} 点熔岩护甲反伤`,
    );
    assert.equal(c.state.players[1].hp, 46, '守方正常承受 4 点攻击伤害');

    // 回归哨兵：打出 Better D! 与直接结算（respondPass）的结果必须不同 ——
    // 若二者相同，说明重掷产生的新骰根本没被 resolveDefense 采用（清空防御骰的缺陷复活）。
    const pass = step(at, 1, { t: 'respondPass' });
    assert.notEqual(
      c.state.players[0].hp, pass.state.players[0].hp,
      `打出 Better D!（HP ${c.state.players[0].hp}）与不打牌直接结算（HP ` +
      `${pass.state.players[0].hp}）必须不同 —— 相同即代表重掷骰未被采用`,
    );
  });

  test('反例：防御窗口不打卡（respondPass）→ 不重掷，防御能力按原防御骰结算', () => {
    const { at, rolled } = atDefenseWindow(['common:betterD']);
    const c = step(at, 1, { t: 'respondPass' });

    assert.equal(findNote(c.events, 'defenseRerolled'), undefined, '不打 Better D! 就不应有重掷');
    assert.equal(c.state.tempDice.length, 0, '结算后骰池正常销毁');

    const flame = flameCount(rolled);
    assert.equal(c.state.players[0].hp, 50 - flame, '防御能力按原始防御骰结算');
    assert.equal(c.state.players[1].hp, 46);
  });

  test('反例：守方手牌无防御时机卡时不开启重掷窗口（窗口不凭空出现）', () => {
    const { at } = atDefenseWindow([]);
    assert.notEqual(at.pending?.kind, 'defenseWindow');
    assert.equal(at.phase, 'main2', '无窗口卡时防御掷骰后直接结算完毕');
    assert.equal(at.players[1].hp, 46);
  });

  test('骰池归属：防御窗口打出「自带临时骰池」的 preDefense 卡 → 临时骰池不得顶掉防御骰池', () => {
    // 取证说明：feelinGood 属 Barbarian 牌库，此处塞给 Pyromancer 守方是**合成手牌**。
    // 用意只有一个 —— 它是唯一同时具备 preDefense 时机与 rollDicePool 的卡，
    // 能命中 runEffects 中「本次序列自己掷过临时骰池 → 结束时回滚到进入时骰池」这条分支
    // （effects.ts 的 runEffects 末尾「scratchPoolRolled → 回滚 poolOnEntry」一行，当前在第 561 行；
    //  本文件约定尽量按标识符引用，行号仅供快速定位，漂移时以标识符为准）。
    //  该分支在 poolOnEntry 非空时**此前零覆盖**，一旦回退，
    // 其余用例仍会全绿而缺陷静默复活（此处不写具体条数：条数同样会漂移）。
    // 断言目标是引擎的骰池归属规则，不是牌库合法性。
    const { at, rolled } = atDefenseWindow(['barbarian:feelinGood']);
    assert.equal(at.pending?.kind, 'defenseWindow');

    const c = step(at, 1, { t: 'playCard', uid: 'hand-0' });

    // 分支命中证明：本次 runEffects 确实自己掷过临时骰池
    const scratch = findNote(c.events, 'tempDiceRolled');
    assert.ok(scratch, 'feelinGood 应掷出 3 颗临时骰（rollDicePool count 3）');
    assert.equal((scratch?.['values'] as number[])?.length, 3);
    assert.equal(findNote(c.events, 'defenseRerolled'), undefined, '这张卡不重掷防御骰');

    // 关键断言：临时骰池用完即回滚，防御能力仍按**原防御骰**结算
    const flame = flameCount(rolled);
    assert.ok(flame >= 1, `本 seed 防御骰应至少 1 颗 flame，实际 ${flame}`);
    assert.equal(
      c.state.players[0].hp, 50 - flame,
      `防御能力必须仍按原防御骰 ${JSON.stringify(rolled)} 结算（${flame} 点反伤）；` +
      '若临时骰池顶掉防御骰池，攻方反伤会变成 0 或按 3 颗临时骰计算',
    );
    assert.equal(c.state.tempDice.length, 0, 'resolveDefense 结算后由 owner 销毁防御骰池');
    // 守方：承受 4 点攻击 + feelinGood 的 1 点治疗（其 rollDicePool 的 life 分支对 Pyromancer 骰面恒不命中）
    assert.equal(c.state.players[1].hp, 47, '50 - 4 + 1');
  });
});
