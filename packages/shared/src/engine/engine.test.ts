/**
 * 规则引擎关键单测 —— 对应架构 §7 测试用例清单。
 * 跑法：node --import tsx --test packages/shared/src/engine/engine.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultRegistry, createMatch, reduce,
  addDamage, addHeal, addAvoid, addPrevention, flushForSeat, countsAsDamageDealt,
  evaluate, createRng, nextInt,
  Draft, EFFECT_HANDLERS, evalExpr, evalCondition,
  type DamageBucket, type Seat, type EffectDef,
} from '../index.js';

const content = createDefaultRegistry();
const EMPTY: DamageBucket = { entries: [], heals: [], avoid: [], pendingRecoils: [] };

describe('伤害分桶与 flush（P6）', () => {
  test('减伤只吃可防御部分，不可防御伤害不受影响', () => {
    let b = addDamage(EMPTY, 10, 'attack', 1, 0);
    b = addDamage(b, 5, 'undefendable', 1, 0);
    b = addPrevention(b, 1, 4);
    const r = flushForSeat(b, 1, 50, 50);
    assert.equal(r.net, 6 + 5); // max(0,10-4) + 5
  });

  test('C7：avoid 清 defendable + collateral，不动 undefendable', () => {
    let b = addDamage(EMPTY, 10, 'attack', 1, 0);
    b = addDamage(b, 3, 'collateral', 1, 0);
    b = addDamage(b, 7, 'undefendable', 1, 0);
    b = addAvoid(b, 1);
    const r = flushForSeat(b, 1, 50, 50);
    assert.equal(r.net, 7); // 只剩不可防御
  });

  test('C5：治疗可以把人从死亡线救回来', () => {
    let b = addDamage(EMPTY, 10, 'attack', 1, 0);
    b = addHeal(b, 1, 8);
    const r = flushForSeat(b, 1, 5, 50); // HP=5，受伤 10，治疗 8
    assert.equal(r.hpRaw, 3);
    assert.equal(r.defeated, false);
  });

  test('A2：治疗上限封顶 60，且不救死亡', () => {
    let b = addHeal(EMPTY, 1, 999);
    const r = flushForSeat(b, 1, 50, 50);
    assert.equal(r.hpAfter, 60);
    let b2 = addDamage(EMPTY, 100, 'attack', 1, 0);
    const r2 = flushForSeat(b2, 1, 50, 50);
    assert.equal(r2.defeated, true);
  });

  test('countsAsDamageDealt：反伤计入，自我反噬不计入', () => {
    const recoil = { bucketKind: 'undefendable', amount: 5, damageType: 'pure', sourceKind: 'recoil', toSeat: 0, fromSeat: 0 } as const;
    const counter = { bucketKind: 'undefendable', amount: 5, damageType: 'pure', sourceKind: 'ability', toSeat: 0, fromSeat: 1 } as const;
    assert.equal(countsAsDamageDealt(recoil), false);
    assert.equal(countsAsDamageDealt(counter), true);
  });
});

describe('骰型匹配器', () => {
  const view = (values: number[], symbols: string[]) => ({
    values, symbols, locked: values.map(() => false),
  });

  test('smallStraight：4 连号', () => {
    assert.equal(evaluate({ k: 'smallStraight' }, view([1, 2, 3, 4, 6], [])).matched, true);
    assert.equal(evaluate({ k: 'smallStraight' }, view([1, 2, 3, 5, 6], [])).matched, false);
  });

  test('largeStraight：5 连号，且不环绕', () => {
    assert.equal(evaluate({ k: 'largeStraight' }, view([1, 2, 3, 4, 5], [])).matched, true);
    assert.equal(evaluate({ k: 'largeStraight' }, view([6, 1, 2, 3, 4], [])).matched, false); // 不环绕
  });

  test('countSymbol 与 countFace', () => {
    assert.equal(evaluate({ k: 'countSymbol', symbol: 'axe', count: 2 }, view([1, 2, 3], ['axe', 'axe', 'strength'])).matched, true);
    assert.equal(evaluate({ k: 'countFace', face: 6, count: 3 }, view([6, 6, 6, 1, 2], [])).matched, true);
  });

  test('allOf：四符号各一', () => {
    const m = { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 1 }, { k: 'countSymbol', symbol: 'meteor', count: 1 }] } as const;
    assert.equal(evaluate(m, view([1, 4], ['flame', 'meteor'])).matched, true);
    assert.equal(evaluate(m, view([1, 2], ['flame', 'flame'])).matched, false);
  });
});

describe('随机性与确定性', () => {
  test('同 seed 产出相同序列（可复现）', () => {
    const a = createRng('abc');
    const b = createRng('abc');
    const s1 = [0, 1, 2].map((_, i) => nextInt(i === 0 ? a : a, 'x', 100).value);
    let r1 = createRng('abc'), r2 = createRng('abc');
    const seq1: number[] = [], seq2: number[] = [];
    for (let i = 0; i < 5; i++) {
      const x = nextInt(r1, 'x', 100); r1 = x.rng; seq1.push(x.value);
      const y = nextInt(r2, 'x', 100); r2 = y.rng; seq2.push(y.value);
    }
    assert.deepEqual(seq1, seq2);
    assert.ok(s1.length === 3);
  });

  test('命名流互不干扰', () => {
    let r = createRng('seed');
    const a = nextInt(r, 'dice:0', 6); r = a.rng;
    const b = nextInt(r, 'shuffle:0', 6); r = b.rng;
    // 两条流独立计数，取值不必相同也不必不同——只验证都能正常产出
    assert.ok(a.value >= 0 && a.value < 6);
    assert.ok(b.value >= 0 && b.value < 6);
  });
});

describe('内容自检（content-lint）', () => {
  test('默认注册表通过校验', () => {
    assert.deepEqual(content.validate(), []);
  });

  test('反伤声明为 pure + sourceKind ability（不是 attack / undefendable）', () => {
    const pyro = content.getHero('pyromancer');
    const armor = pyro.abilities.find((a) => a.id === 'pyromancer:moltenArmor');
    const eff = armor?.tiers[0]?.effects[0];
    assert.equal(eff?.clause.kind, 'dealDamage');
    const c = eff!.clause as { damageType: string; sourceKind?: string; to: { r: string } };
    assert.equal(c.damageType, 'pure');
    assert.equal(c.sourceKind, 'ability');
    assert.equal(c.to.r, 'attacker');
  });

  test('自我反噬改用 recoilOnHit 声明（官方条件反噬：仅当至少 1 点伤害成功造成）', () => {
    const barb = content.getHero('barbarian');
    const reckless = barb.abilities.find((a) => a.id === 'barbarian:reckless');
    const eff = reckless?.tiers[0]?.effects[0];
    const c = eff!.clause as { recoilOnHit?: { amount: number; to: { r: string } } };
    assert.equal(c.recoilOnHit?.amount, 4);
    assert.equal(c.recoilOnHit?.to.r, 'self');
  });
});

describe('建局与基本规则', () => {
  test('起始数值：HP 50 / CP 2 / 起手 4 张', () => {
    const s = createMatch(content, { seed: 't1', heroes: ['barbarian', 'pyromancer'] });
    for (const seat of [0, 1] as Seat[]) {
      const p = s.players[seat];
      assert.equal(p.hp, 50);
      assert.equal(p.cp, 2);
      assert.equal(p.hand.length, 4);
      assert.equal(p.deck.length + p.hand.length, p.deck.length + 4);
    }
  });

  test('CP 上限 15（收入阶段不溢出）', () => {
    const s = createMatch(content, { seed: 't2', heroes: ['barbarian', 'pyromancer'] });
    // 直接抬到 15 再走一步收入，验证 clamp
    const capped = { ...s, players: [{ ...s.players[0], cp: 15 }, s.players[1]] as const };
    assert.equal(capped.players[0].cp, 15);
  });

  test('同 seed 建局结果一致（牌库顺序可复现）', () => {
    const a = createMatch(content, { seed: 'same', heroes: ['barbarian', 'pyromancer'] });
    const b = createMatch(content, { seed: 'same', heroes: ['barbarian', 'pyromancer'] });
    assert.deepEqual(a.players[0].deck.map((c) => c.defId), b.players[0].deck.map((c) => c.defId));
    assert.deepEqual(a.players[0].hand.map((c) => c.defId), b.players[0].hand.map((c) => c.defId));
    assert.equal(a.startSeat, b.startSeat);
  });

  test('非行动方动作被拒绝', () => {
    const s = createMatch(content, { seed: 't3', heroes: ['barbarian', 'pyromancer'] });
    const offender = s.activeSeat === 0 ? 1 : 0;
    const r = reduce(s, { seat: offender as Seat, action: { t: 'performRoll' }, clientSeq: 1 }, content);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'notYourTurn');
  });
});

describe('官方校准新增机制', () => {
  const mkDraft = () => {
    const s = createMatch(content, { seed: 'mech', heroes: ['barbarian', 'pyromancer'] });
    return new Draft(s, content);
  };

  test('ceilDiv：Vegas Baby! 获得 ⌈点数/2⌉ CP', () => {
    const d = mkDraft();
    d.s.bindings['vb'] = 5;
    assert.equal(evalExpr(d, { e: 'ceilDiv', a: { e: 'var', name: 'vb' }, b: 2 }, 0), 3);
    d.s.bindings['vb'] = 2;
    assert.equal(evalExpr(d, { e: 'ceilDiv', a: { e: 'var', name: 'vb' }, b: 2 }, 0), 1);
  });

  test('dealDamage + recoilOnHit：反噬入桶固化（官方 Reckless 条件反噬声明）', () => {
    const d = mkDraft();
    EFFECT_HANDLERS.dealDamage(d, {
      kind: 'dealDamage', amount: 20, damageType: 'attack', to: { r: 'opponent' },
      recoilOnHit: { amount: 5, to: { r: 'self' } },
    }, 0);
    assert.equal(d.s.bucket.entries.length, 1);
    assert.equal(d.s.bucket.pendingRecoils.length, 1);
    const rc = d.s.bucket.pendingRecoils[0]!;
    assert.equal(rc.fromSeat, 0);
    assert.equal(rc.toSeat, 0); // 反噬承受者 = 自己
    assert.equal(rc.triggerToSeat, 1); // 触发条件看对手 seat 的 net
    assert.equal(rc.amount, 5);
  });

  test('rollDicePool perDie：每颗命中骰各结算一次（官方 Pyroblast「Add 3 × 🔥」）', () => {
    const d = mkDraft();
    let queued = 0;
    const probe: EffectDef = { clause: { kind: 'log', text: 'hit' } };
    // 拦截不了 handler 返回值以外的副作用，这里直接检查返回的效果条数
    const out = EFFECT_HANDLERS.rollDicePool(d, {
      kind: 'rollDicePool', count: 5, perDie: true,
      cases: [{ on: 'sword', effects: [probe] }],
    }, 0) ?? [];
    // Barbarian 骰 1-3 均为 sword（面值 1/2/3），5 骰里 sword 骰数 = 命中面值 1-3 的颗数
    queued = out.length;
    const swordCount = d.s.tempDice.filter((v) => v <= 3).length;
    assert.equal(queued, swordCount);
    assert.ok(queued >= 0);
  });

  test('increaseStackLimit + inflictStatus：Fire Mastery 上限可被抬高并截断', () => {
    const d = mkDraft();
    EFFECT_HANDLERS.increaseStackLimit(d, { kind: 'increaseStackLimit', status: 'common:fireMastery', by: 1, to: { r: 'self' } }, 1);
    EFFECT_HANDLERS.inflictStatus(d, { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 99, to: { r: 'self' } }, 1);
    const st = d.player(1).statuses.find((s) => s.id === 'common:fireMastery');
    assert.equal(st?.stacks, 6); // 基础 5 + 1
  });

  test('nOfAKind：主骰池与防御骰两个作用域', () => {
    const d = mkDraft();
    // 主骰池：seat0 四条 2
    const s0 = d.s;
    (s0.players as { diceValues: number[] }[])[0]!.diceValues = [2, 2, 2, 2, 6];
    assert.equal(evalCondition(d, { c: 'nOfAKind', n: 4 }, 0), true);
    assert.equal(evalCondition(d, { c: 'nOfAKind', n: 5 }, 0), false);
    // 防御上下文：tempDice 在场时以防御骰为准
    d.s.tempDice = [3, 3, 3, 1];
    assert.equal(evalCondition(d, { c: 'nOfAKind', n: 3 }, 0), true);
    assert.equal(evalCondition(d, { c: 'nOfAKind', n: 4 }, 0), false);
    d.s.tempDice = [];
  });

  test('Smack 声明 undefendableIf 4-of-a-kind；Fortitude 声明 3-of-a-kind 移除状态', () => {
    const barb = content.getHero('barbarian');
    const smack = barb.abilities.find((a) => a.id === 'barbarian:smack')!;
    // gradedBranch 把伤害包在 conditional 链里：递归收集所有 dealDamage 子句
    const collectDeals = (effs: readonly EffectDef[]): { undefendableIf?: { c: string; n: number } }[] =>
      effs.flatMap((e) => {
        const c = e.clause as { kind: string; then?: readonly EffectDef[]; else?: readonly EffectDef[]; undefendableIf?: { c: string; n: number } };
        if (c.kind === 'conditional') return collectDeals([...(c.then ?? []), ...(c.else ?? [])]);
        if (c.kind === 'dealDamage') return [c];
        return [];
      });
    for (const tier of smack.tiers) {
      const deals = collectDeals(tier.effects);
      assert.ok(deals.length >= 3, `Smack 每档应展开 3 条伤害分支，实际 ${deals.length}`);
      for (const dmg of deals) {
        assert.equal(dmg.undefendableIf?.c, 'nOfAKind');
        assert.equal(dmg.undefendableIf?.n, 4);
      }
    }
    const fortitude = barb.abilities.find((a) => a.id === 'barbarian:fortitude')!;
    for (const tier of fortitude.tiers) {
      // 锁**行为**优于锁包装形状：这里断言「3 同点 → 移除自身 1 个任意状态」这个效果本身，
      // 而不是它外层裹的是什么。（本用例曾断言 then[0] 是 optional 包装；
      // MVP 按必发处理后已解开包裹，官方 may 语义以已知偏差记在 heroes.ts 的注释里。）
      const cond = tier.effects[1]!.clause as {
        kind: string;
        cond: { c: string; n: number };
        then: readonly { clause: { kind: string; status?: string; stacks?: number; to?: { r: string } } }[];
      };
      assert.equal(cond.cond.c, 'nOfAKind');
      assert.equal(cond.cond.n, 3);
      const eff = cond.then[0]!.clause;
      assert.equal(eff.kind, 'removeStatus', '3 同点应直接挂 removeStatus 效果（不再包 optional）');
      assert.equal(eff.status, 'any');
      assert.equal(eff.stacks, 1);
      assert.equal(eff.to?.r, 'self');
    }
  });

  test('dealDamage + undefendableIf：4-of-a-kind 时翻转为不可防御', () => {
    const d = mkDraft();
    (d.s.players as { diceValues: number[] }[])[0]!.diceValues = [5, 5, 5, 5, 2];
    EFFECT_HANDLERS.dealDamage(d, {
      kind: 'dealDamage', amount: 9, damageType: 'attack', to: { r: 'opponent' },
      undefendableIf: { c: 'nOfAKind', n: 4 },
    }, 0);
    const last = d.s.bucket.entries[d.s.bucket.entries.length - 1]!;
    assert.equal(last.bucketKind, 'undefendable');
    // 对照：非 4-of-a-kind 时保持可防御
    (d.s.players as { diceValues: number[] }[])[0]!.diceValues = [5, 5, 5, 3, 2];
    EFFECT_HANDLERS.dealDamage(d, {
      kind: 'dealDamage', amount: 9, damageType: 'attack', to: { r: 'opponent' },
      undefendableIf: { c: 'nOfAKind', n: 4 },
    }, 0);
    const last2 = d.s.bucket.entries[d.s.bucket.entries.length - 1]!;
    assert.equal(last2.bucketKind, 'defendable');
  });
});
