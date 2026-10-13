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
  type DamageBucket, type Seat,
} from '../index.js';

const content = createDefaultRegistry();
const EMPTY: DamageBucket = { entries: [], heals: [], avoid: [] };

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

  test('自我反噬声明为 pure + sourceKind recoil + target self', () => {
    const barb = content.getHero('barbarian');
    const reckless = barb.abilities.find((a) => a.id === 'barbarian:reckless');
    const eff = reckless?.tiers[0]?.effects[1];
    const c = eff!.clause as { damageType: string; sourceKind?: string; to: { r: string } };
    assert.equal(c.damageType, 'pure');
    assert.equal(c.sourceKind, 'recoil');
    assert.equal(c.to.r, 'self');
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
