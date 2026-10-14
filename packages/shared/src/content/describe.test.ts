/**
 * describe.test.ts —— 卡面描述层的三层守门：
 *  ① 全量内容渲染无渲染残渣（undefined / [object Object] / JSON 花括号…）
 *  ② lint 守门：每种 clause kind 都必须有模板（与 EFFECT_HANDLERS 的 key 集合比对）
 *  ③ 关键数值不丢失（防止模板把伤害数字算丢）
 *
 * ⚠️ 本文件不含任何官方卡面文本；断言用的关键字均为机制词。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { EffectClause, EffectDef } from '../types/core.js';
import type { CardDef, StatusDef, AbilitySlotDef } from '../types/content.js';
import { EFFECT_HANDLERS } from '../engine/effects.js';
import { createDefaultRegistry } from './registry.js';
import { COMMON_STATUSES } from './statuses.js';
import {
  CLAUSE_TEMPLATES, UNKNOWN_CLAUSE_MARK, describeAbility, describeCard, describeClause,
  describeEffect, describeStatus,
} from './describe.js';
import type { Lang } from './describe.js';

const content = createDefaultRegistry();

// ── 渲染残渣黑名单 ────────────────────────────────────
/** 玩家若在 UI 上看到这些，说明模板漏了字段或把对象直接插值了 */
const RESIDUE: readonly string[] = [
  'undefined', 'null', 'NaN', '[object Object]', '{}',
  '{', '}', '"', "'", '`', '[', ']',
];

function assertClean(text: string, label: string): void {
  assert.equal(typeof text, 'string', `${label}: 产出不是字符串`);
  assert.ok(text.trim().length > 0, `${label}: 描述为空`);
  for (const bad of RESIDUE) {
    assert.ok(!text.includes(bad), `${label}: 含渲染残渣 ${JSON.stringify(bad)} → ${text}`);
  }
  assert.ok(!text.includes(UNKNOWN_CLAUSE_MARK), `${label}: 含未登记效果占位 → ${text}`);
}

// ── ① 全量内容渲染 ────────────────────────────────────
describe('describe: 全部英雄能力（每个 tier）', () => {
  for (const hero of content.listHeroes()) {
    for (const slot of hero.abilities) {
      for (const t of slot.tiers) {
        test(`${slot.id} L${t.level} 渲染无残渣`, () => {
          assertClean(describeAbility(slot, t.level), `${slot.id} L${t.level}`);
          // 不指定 tier 时输出全等级，同样要干净
          assertClean(describeAbility(slot), `${slot.id} 全等级`);
        });
      }
      test(`${slot.id} 英文版不为空`, () => {
        const en = describeAbility(slot, slot.tiers[0]?.level, 'en');
        assert.ok(en.trim().length > 0, `${slot.id} 英文描述为空`);
        for (const bad of ['undefined', 'NaN', '[object Object]', '{', '}']) {
          assert.ok(!en.includes(bad), `${slot.id} 英文含残渣 ${bad} → ${en}`);
        }
      });
    }
  }
});

describe('describe: 全部卡牌', () => {
  const seen = new Set<string>();
  const cards: readonly CardDef[] = content.listHeroes().flatMap((h) => h.deck);
  for (const card of cards) {
    if (seen.has(card.defId)) continue;
    seen.add(card.defId);
    test(`${card.defId} 渲染无残渣`, () => {
      assertClean(describeCard(card), card.defId);
      assert.ok(describeCard(card, 'en').trim().length > 0, `${card.defId} 英文描述为空`);
    });
  }
  test('卡牌覆盖数 ≥ 20（两位英雄的公共 + 专属牌库）', () => {
    assert.ok(seen.size >= 20, `实际卡牌种类 ${seen.size}`);
  });
});

describe('describe: 全部状态', () => {
  const statuses: readonly StatusDef[] = [
    ...COMMON_STATUSES,
    ...content.listHeroes().flatMap((h) => h.statuses),
  ];
  for (const s of statuses) {
    test(`${s.id} 渲染无残渣`, () => {
      assertClean(describeStatus(s), s.id);
      assert.ok(describeStatus(s, 'en').trim().length > 0, `${s.id} 英文描述为空`);
    });
  }
});

// ── ② lint 守门 ──────────────────────────────────────
/** 合成表：每种 clause kind 各造一条（新增 kind 忘了补这里或补模板，下面的断言会红） */
const SYNTHETIC: readonly EffectDef[] = [
  { clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'opponent' },
      sourceKind: 'ultimate', undefendableIf: { c: 'nOfAKind', n: 4 },
      recoilOnHit: { amount: 2, to: { r: 'self' } } } },
  { clause: { kind: 'heal', amount: 2, to: { r: 'self' } } },
  { clause: { kind: 'preventDamage', amount: 6, to: { r: 'self' } } },
  { clause: { kind: 'avoidDamage', to: { r: 'self' } } },
  { clause: { kind: 'gainCp', amount: 2, to: { r: 'self' } } },
  { clause: { kind: 'loseCp', amount: 1, to: { r: 'opponent' } } },
  { clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } },
  { clause: { kind: 'discardCards', amount: 1, mode: 'random', to: { r: 'opponent' } } },
  { clause: { kind: 'inflictStatus', status: 'common:poison', stacks: 2, to: { r: 'opponent' } } },
  { clause: { kind: 'removeStatus', status: 'any', stacks: 1, to: { r: 'self' }, bindRemovedTo: 'removed' } },
  { clause: { kind: 'transferStatus', status: 'any', from: { r: 'self' }, to: { r: 'opponent' } } },
  { clause: { kind: 'increaseStackLimit', status: 'common:poison', by: 1, to: { r: 'self' } } },
  { clause: { kind: 'spendStatus', status: 'common:evasive', to: { r: 'self' } } },
  { clause: { kind: 'rollDicePool', count: 2, perDie: true, bindSumTo: 'sum',
      cases: [{ on: 'sword', effects: [{ clause: { kind: 'dealDamage', amount: 1, damageType: 'attack', to: { r: 'opponent' } } }] }] } },
  { clause: { kind: 'setDieFace', toFace: 6, count: 2 } },
  { clause: { kind: 'adjustDie', delta: -1 } },
  { clause: { kind: 'copyDieFace' } },
  { clause: { kind: 'rerollDice', count: 5, to: { r: 'self' }, scope: 'defense' } },
  { clause: { kind: 'grantExtraRollAttempt', amount: 1 } },
  { clause: { kind: 'performRollAttempt' } },
  { clause: { kind: 'openWindowThen', trigger: 'then',
      steps: [{ clause: { kind: 'gainCp', amount: 1, to: { r: 'self' } } }] } },
  { clause: { kind: 'additionally',
      steps: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'collateral', to: { r: 'opponent' } } }] } },
  { clause: { kind: 'conditional', cond: { c: 'hpCompare', target: { r: 'self' }, op: '<', value: 10 },
      then: [{ clause: { kind: 'heal', amount: 3, to: { r: 'self' } } }],
      else: [{ clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } }] } },
  { clause: { kind: 'bind', name: 'x', value: { e: 'ceilDiv', a: { e: 'sumFaces' }, b: 2 } } },
  { clause: { kind: 'choose', who: 'owner', options: [
      { id: 'a', label: '选项甲', isDefault: true, effects: [{ clause: { kind: 'gainCp', amount: 1, to: { r: 'self' } } }] },
      { id: 'b', label: '选项乙', effects: [{ clause: { kind: 'loseCp', amount: 1, to: { r: 'opponent' } } }] }] } },
  { clause: { kind: 'optional', prompt: '是否行使？', steps: [{ clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } }] } },
  { clause: { kind: 'promptNumber', max: 4, bindTo: 'n', prompt: '选择移除数量' } },
  { clause: { kind: 'grantExtraOffensiveRollPhase' } },
  { clause: { kind: 'skipPhase', phase: 'income' } },
  { clause: { kind: 'log', text: '这是一条机制备注' } },
];

describe('describe: lint 守门', () => {
  test('EFFECT_HANDLERS 的每种 kind 都有模板（新增 kind 忘补模板 → 红）', () => {
    const handlerKinds = Object.keys(EFFECT_HANDLERS);
    const tplKinds = Object.keys(CLAUSE_TEMPLATES);
    for (const k of handlerKinds) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CLAUSE_TEMPLATES, k),
        `clause kind "${k}" 已在引擎注册但没有描述模板，请在 CLAUSE_TEMPLATES 补一条`,
      );
    }
    assert.deepEqual(
      [...tplKinds].sort(),
      [...handlerKinds].sort(),
      `模板集合与引擎 kind 集合不一致\n模板: ${tplKinds.join(', ')}\n引擎: ${handlerKinds.join(', ')}`,
    );
  });

  test('合成表覆盖每一种 kind，且全部渲染成功', () => {
    const covered = new Set<string>(SYNTHETIC.map((e) => e.clause.kind));
    for (const k of Object.keys(EFFECT_HANDLERS)) {
      assert.ok(covered.has(k), `合成表缺少 kind "${k}"，请补一条样本`);
    }
    assert.equal(covered.size, Object.keys(EFFECT_HANDLERS).length);
    for (const e of SYNTHETIC) {
      assertClean(describeEffect(e), `合成表 ${e.clause.kind}`);
    }
  });

  test('未知 kind 不静默：默认返回显式占位标记，strict 模式抛错', () => {
    const bogus = { kind: 'brandNewKind' } as unknown as EffectClause;
    const soft = describeClause(bogus, 'zh');
    assert.ok(soft.includes(UNKNOWN_CLAUSE_MARK), `应含占位标记，实际: ${soft}`);
    assert.ok(soft.includes('brandNewKind'), `占位标记应带上 kind 名，实际: ${soft}`);
    assert.throws(
      () => describeClause(bogus, 'zh', { strict: true }),
      /brandNewKind/,
      'strict 模式应对未知 kind 抛错',
    );
    assert.throws(
      () => describeEffect({ clause: bogus }, 'zh', { strict: true }),
      /brandNewKind/,
      'strict 模式应在 describeEffect 上同样抛错',
    );
  });
});

// ── ③ 关键数值不丢失 ──────────────────────────────────
function abilityOf(heroId: string, abilityId: string): AbilitySlotDef {
  const slot = content.listHeroes()
    .find((h) => h.id === heroId)?.abilities
    .find((a) => a.id === abilityId);
  assert.ok(slot, `找不到能力 ${abilityId}`);
  return slot;
}

describe('describe: 关键数值与修饰语义不丢失', () => {
  test('Barbarian 重击：三档伤害与「4 同点不可防御」都在', () => {
    const t = describeAbility(abilityOf('barbarian', 'barbarian:smack'), 1);
    assert.ok(t.includes('8'), `L1 最高档 8 点伤害丢失 → ${t}`);
    assert.ok(t.includes('6') && t.includes('4'), `分档数值丢失 → ${t}`);
    assert.ok(t.includes('不可防御'), `undefendableIf 语义丢失 → ${t}`);
    assert.ok(t.includes('4 次'), `nOfAKind n=4 丢失 → ${t}`);
  });

  test('Barbarian 鲁莽挥砍：20 伤害 + 5 反噬 + 「至少 1 点」条件都在', () => {
    const t = describeAbility(abilityOf('barbarian', 'barbarian:reckless'), 2);
    assert.ok(t.includes('20'), `主伤害丢失 → ${t}`);
    assert.ok(t.includes('5'), `反噬量丢失 → ${t}`);
    assert.ok(t.includes('反噬'), `recoilOnHit 语义丢失 → ${t}`);
    assert.ok(t.includes('至少造成 1 点'), `反噬触发条件丢失 → ${t}`);
  });

  test('Barbarian 坚忍：分档治疗 + 三同点移除自身状态（MVP 必发，卡面不得标注可选）', () => {
    const t = describeAbility(abilityOf('barbarian', 'barbarian:fortitude'), 2);
    assert.ok(t.includes('7'), `L2 最高档治疗 7 丢失 → ${t}`);
    assert.ok(t.includes('3 次'), `nOfAKind n=3 丢失 → ${t}`);
    assert.ok(t.includes('任意状态') || t.includes('状态'), `removeStatus status any 丢失 → ${t}`);
    // MVP 按必发处理（官方原文是 may/可选，已知偏差记在 heroes.ts 的注释里）。
    // 守门意图不变：卡面**不得**宣称一个引擎当前给不出的玩家选择权 —— 既然没有 optional，
    // 描述里就不该出现「可选」。（若将来 optionalPrompt 挂起 + UI 入口就绪，此断言需翻回正。）
    assert.ok(!t.includes('可选'), `MVP 必发后卡面不应再标注「可选」 → ${t}`);
  });

  test('Pyromancer 火球：三档伤害数字都在', () => {
    const t = describeAbility(abilityOf('pyromancer', 'pyromancer:fireball'), 1);
    assert.ok(t.includes('8') && t.includes('6') && t.includes('4'), `分档伤害丢失 → ${t}`);
  });

  test('Pyromancer 熔岩护甲：pure 反伤打到攻击者身上', () => {
    const t = describeAbility(abilityOf('pyromancer', 'pyromancer:moltenArmor'), 2);
    assert.ok(t.includes('攻击者'), `to:attacker 丢失 → ${t}`);
    assert.ok(t.includes('直接'), `damageType pure 标注丢失 → ${t}`);
    assert.ok(t.includes('焰'), `伤害表达式的符号丢失 → ${t}`);
  });

  test('修饰字段全部被消费：damageType / sourceKind / perDie / bindSumTo / spendStatus', () => {
    const dmg = describeClause({
      kind: 'dealDamage', amount: 12, damageType: 'undefendable', to: { r: 'opponent' }, sourceKind: 'ultimate',
    }, 'zh');
    assert.ok(dmg.includes('12') && dmg.includes('不可防御') && dmg.includes('终极技能'), dmg);

    const pool = describeClause({
      kind: 'rollDicePool', count: 3, perDie: true, bindSumTo: 's',
      cases: [{ on: 'flame', effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'opponent' } } }] }],
    }, 'zh');
    assert.ok(pool.includes('3') && pool.includes('每颗') && pool.includes('s'), pool);

    const spend = describeClause({ kind: 'spendStatus', status: 'common:evasive', to: { r: 'self' } }, 'zh');
    assert.ok(spend.includes('闪避') && spend.includes('消耗'), spend);

    const anyRemove = describeClause({ kind: 'removeStatus', status: 'any', stacks: 99, to: { r: 'opponent' } }, 'zh');
    assert.ok(anyRemove.includes('99') && anyRemove.includes('负面'), anyRemove);
  });

  test('中英文双语均非空（样例）', () => {
    const langs: readonly Lang[] = ['zh', 'en'];
    for (const lang of langs) {
      const t = describeAbility(abilityOf('pyromancer', 'pyromancer:combustion'), 2, lang);
      assert.ok(t.trim().length > 0, `${lang} 描述为空`);
    }
  });
});
