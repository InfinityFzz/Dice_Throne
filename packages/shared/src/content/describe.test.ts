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

  test('floorDiv 渲染（官方 MoonElf Missed Me L1「每 2 支箭 1 伤害」的 ⌊ ⌋ 语义）', () => {
    const zh = describeClause({
      kind: 'bind', name: 'mm', value: { e: 'floorDiv', a: { e: 'countSymbol', symbol: 'arrow' }, b: 2 },
    }, 'zh');
    assert.ok(zh.includes('⌊') && zh.includes('⌋'), `floorDiv 语义丢失 → ${zh}`);
    const en = describeClause({
      kind: 'bind', name: 'mm', value: { e: 'floorDiv', a: { e: 'countSymbol', symbol: 'arrow' }, b: 2 },
    }, 'en');
    assert.ok(en.includes('floor('), `floorDiv 英文渲染丢失 → ${en}`);
    // 与 ceilDiv 措辞必须区分（一个向下一个向上，混用会让玩家算错伤害）
    assert.ok(!zh.includes('⌈'), `floorDiv 不得渲染成 ceilDiv → ${zh}`);
  });
});

// ════════════════════════════════════════════════════════════════
// describe: Gunslinger 实装新增模板（boundCompare / incomingDamage / owner / onAttacked）
// ════════════════════════════════════════════════════════════════
describe('describe: Gunslinger 新增模板', () => {
  test('Duel：双 roll 比较（boundCompare）+ 防止一半来袭（incomingDamage）+ 按对手骰面掷', () => {
    const t = describeAbility(abilityOf('gunslinger', 'gunslinger:duel'), 1);
    assert.ok(t.includes('掷 1 颗骰'), `双 roll 丢失 → ${t}`);
    assert.ok(t.includes('duelSelf') && t.includes('duelOpp'), `boundCompare 绑定名丢失 → ${t}`);
    assert.ok(t.includes('来袭伤害'), `incomingDamage 语义丢失 → ${t}`);
    assert.ok(t.includes('英雄骰面'), `rollDicePool.owner 语义丢失 → ${t}`);
  });

  test('Showdown：7/5 双分支数值都在', () => {
    const t = describeAbility(abilityOf('gunslinger', 'gunslinger:showdown'), 1);
    assert.ok(t.includes('7') && t.includes('5'), `Showdown L1 7/5 丢失 → ${t}`);
  });

  test('悬赏状态：onAttacked 契约渲染（攻击者伤害 +1 且获得 CP）', () => {
    const bounty = createDefaultRegistry().getStatus('gunslinger:bounty');
    assert.ok(bounty, '悬赏状态应已注册');
    const t = describeStatus(bounty as StatusDef, 'zh');
    assert.ok(t.includes('悬赏'), `状态名丢失 → ${t}`);
    assert.ok(t.includes('+1'), `bonusDamage 丢失 → ${t}`);
    assert.ok(t.includes('CP'), `attackerGainsCp 丢失 → ${t}`);
  });

  test('装填状态：spendEffect 的掷骰 + 半价向上取整都在', () => {
    const reload = createDefaultRegistry().getStatus('gunslinger:reload');
    assert.ok(reload, '装填状态应已注册');
    const t = describeStatus(reload as StatusDef, 'zh');
    assert.ok(t.includes('装填'), `状态名丢失 → ${t}`);
    assert.ok(t.includes('⌈'), `ceilDiv 语义丢失 → ${t}`);
  });

  test('Eat Lead!：perDie 每颗子弹 +1 与「≥4 击倒」条件都在', () => {
    const card = createDefaultRegistry().getCard('gunslinger:eatLead');
    const t = describeCard(card, 'zh');
    assert.ok(t.includes('每颗'), `perDie 丢失 → ${t}`);
    assert.ok(t.includes('子弹'), `bullet 符号名丢失 → ${t}`);
  });
});

// ════════════════════════════════════════════════════════════════
// describe: ShadowThief 实装新增模板（onAttacked.avoid / discardAtTurnEnd / 骰面符号）
// ════════════════════════════════════════════════════════════════
describe('describe: ShadowThief 新增模板', () => {
  test('阴影状态：avoid 契约 + 回合末弃置两条都渲染出来', () => {
    const shadows = createDefaultRegistry().getStatus('shadowthief:shadows');
    assert.ok(shadows, '阴影状态应已注册');
    const t = describeStatus(shadows as StatusDef, 'zh');
    assert.ok(t.includes('隐入暗影'), `状态名丢失 → ${t}`);
    assert.ok(t.includes('避开'), `onAttacked.avoid 语义丢失 → ${t}`);
    assert.ok(t.includes('弃置'), `discardAtTurnEnd 语义丢失 → ${t}`);
  });

  test('偷袭状态：可消耗 + 掷骰加伤的 spendEffect 渲染出来', () => {
    const sneak = createDefaultRegistry().getStatus('shadowthief:sneakAttack');
    assert.ok(sneak, '偷袭状态应已注册');
    const t = describeStatus(sneak as StatusDef, 'zh');
    assert.ok(t.includes('偷袭'), `状态名丢失 → ${t}`);
    assert.ok(t.includes('可消耗'), `spendable 丢失 → ${t}`);
    assert.ok(t.includes('掷 1 颗骰'), `spendEffect 掷骰丢失 → ${t}`);
  });

  test('暗影防御：匕首/钱袋/阴影三个符号名与毒/偷袭状态名都在', () => {
    const t = describeAbility(abilityOf('shadowthief', 'shadowthief:shadowDefense'), 1);
    for (const w of ['匕首', '钱袋', '阴影', '中毒', '偷袭']) {
      assert.ok(t.includes(w), `${w} 丢失 → ${t}`);
    }
  });

  test('暗影刺击（Ultimate）：CP+5 伤害与阴影状态都在', () => {
    const t = describeAbility(abilityOf('shadowthief', 'shadowthief:shadowShank'), 1);
    assert.ok(t.includes('5'), `Ultimate 伤害基数丢失 → ${t}`);
    assert.ok(t.includes('CP'), `CP 表达式丢失 → ${t}`);
    assert.ok(t.includes('隐入暗影'), `Ultimate 附赠阴影丢失 → ${t}`);
  });

  test('狂野暗影：playIf 恒不满足 → 描述带「无法打出」门槛前缀（诚实灰显，不做虚假自动改骰）', () => {
    const card = createDefaultRegistry().getCard('shadowthief:wildShadow');
    assert.ok(card, '狂野暗影应已注册');
    const t = describeCard(card, 'zh');
    assert.ok(t.includes('才可打出'), `playIf 门槛前缀丢失 → ${t}`);
  });
});

// ════════════════════════════════════════════════════════════════
// describe: MoonElf 前置契约新增模板（onAttacked 逐字段 / onRollPhaseStart /
//           onConcludeRollPhase / expiresAtRollPhaseEnd）
// ════════════════════════════════════════════════════════════════
describe('describe: MoonElf 前置契约新增模板', () => {
  /** 自造状态（不注册）：只验 describeStatus 的渲染，与引擎行为取证（moonelf.test.ts）分工 */
  const mk = (over: Partial<StatusDef>): StatusDef => ({
    id: 'test:render', name: '自造渲染状态', polarity: 'negative',
    stackLimit: 1, persistent: true, spendable: false, ...over,
  });

  test('TARGETED 契约：只有 bonusDamage 时只渲染加伤、不出现 CP（逐字段同口径）', () => {
    const t = describeStatus(mk({ onAttacked: { bonusDamage: 2 } }), 'zh');
    assert.ok(t.includes('+2'), `bonusDamage 丢失 → ${t}`);
    assert.ok(!t.includes('CP'), `只有 bonusDamage 时不得渲染 CP → ${t}`);
  });

  test('纯 CP 状态：只渲染 CP、不出现加伤', () => {
    const t = describeStatus(mk({ onAttacked: { attackerGainsCp: 2 } }), 'zh');
    assert.ok(t.includes('2') && t.includes('CP'), `attackerGainsCp 丢失 → ${t}`);
    assert.ok(!t.includes('伤害 +'), `只有 CP 时不得渲染加伤 → ${t}`);
  });

  test('ENTANGLE 契约：onRollPhaseStart 渲染「少 N 次掷骰机会」（负数）与「多 N 次」（正数）', () => {
    const less = describeStatus(mk({ onRollPhaseStart: { rollAttemptsDelta: -1 } }), 'zh');
    assert.ok(less.includes('少 1 次掷骰机会'), `负 delta 渲染丢失 → ${less}`);
    const more = describeStatus(mk({ onRollPhaseStart: { rollAttemptsDelta: 1 } }), 'zh');
    assert.ok(more.includes('多 1 次掷骰机会'), `正 delta 渲染丢失 → ${more}`);
  });

  test('BLIND 契约：onConcludeRollPhase.failDie 的骰数、失败面与「整个阶段作废」都在', () => {
    const t = describeStatus(mk({ onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } } }), 'zh');
    assert.ok(t.includes('掷 1 颗骰'), `failDie.count 丢失 → ${t}`);
    assert.ok(t.includes('1/2'), `failValues 丢失 → ${t}`);
    assert.ok(t.includes('作废'), `阶段作废语义丢失 → ${t}`);
    assert.ok(t.includes('移除'), `收场移除语义丢失 → ${t}`);
  });

  test('ENTANGLE 弃置契约：expiresAtRollPhaseEnd 渲染「结论时弃置」，与回合末弃置措辞区分', () => {
    const t = describeStatus(mk({ expiresAtRollPhaseEnd: true }), 'zh');
    assert.ok(t.includes('进攻掷骰阶段结论时弃置'), `expiresAtRollPhaseEnd 渲染丢失 → ${t}`);
    const turnEnd = describeStatus(mk({ discardAtTurnEnd: true }), 'zh');
    assert.ok(!turnEnd.includes('结论时弃置'), `两个弃置时机不得共用措辞 → ${turnEnd}`);
  });

  test('全契约状态渲染无残渣且英文版非空（守门意图：新增字段不得漏模板）', () => {
    const full = mk({
      onAttacked: { bonusDamage: 2, attackerGainsCp: 1 },
      onRollPhaseStart: { rollAttemptsDelta: -1 },
      onConcludeRollPhase: { failDie: { count: 1, failValues: [1, 2] } },
      expiresAtRollPhaseEnd: true,
    });
    assertClean(describeStatus(full), '全契约状态');
    assert.ok(describeStatus(full, 'en').trim().length > 0, '全契约状态英文描述为空');
  });
});

// ════════════════════════════════════════════════════════════════
// describe: MoonElf 内容层实装（第九轮：状态契约 / floorDiv / 池骰公式 / Ultimate）
// ════════════════════════════════════════════════════════════════
describe('describe: MoonElf 内容层实装', () => {
  test('锁定状态：+2 加伤在、CP 不在（纯 bonusDamage，同契约层口径）', () => {
    const t = describeStatus(createDefaultRegistry().getStatus('moonelf:targeted') as StatusDef, 'zh');
    assert.ok(t.includes('锁定'), `状态名丢失 → ${t}`);
    assert.ok(t.includes('+2'), `bonusDamage 丢失 → ${t}`);
    assert.ok(!t.includes('CP'), `纯加伤状态不得渲染 CP → ${t}`);
  });

  test('缠足状态：少 1 次掷骰机会 + 结论时弃置（与回合末弃置措辞区分）', () => {
    const t = describeStatus(createDefaultRegistry().getStatus('moonelf:entangle') as StatusDef, 'zh');
    assert.ok(t.includes('少 1 次掷骰机会'), `onRollPhaseStart 负 delta 丢失 → ${t}`);
    assert.ok(t.includes('进攻掷骰阶段结论时弃置'), `expiresAtRollPhaseEnd 丢失 → ${t}`);
  });

  test('致盲状态：收场移除并掷 1 骰、掷 1/2 整个阶段作废', () => {
    const t = describeStatus(createDefaultRegistry().getStatus('moonelf:blind') as StatusDef, 'zh');
    assert.ok(t.includes('移除'), `收场移除语义丢失 → ${t}`);
    assert.ok(t.includes('掷 1 颗骰'), `failDie.count 丢失 → ${t}`);
    assert.ok(t.includes('1/2'), `failValues 丢失 → ${t}`);
    assert.ok(t.includes('作废'), `阶段作废语义丢失 → ${t}`);
  });

  test('打偏 L1/L2：floorDiv「每 2 支箭」与 L2 每支箭必须区分渲染', () => {
    const l1 = describeAbility(abilityOf('moonelf', 'moonelf:missedMe'), 1, 'zh');
    assert.ok(l1.includes('⌊') && l1.includes('÷ 2'), `L1 floorDiv 渲染丢失 → ${l1}`);
    assert.ok(l1.includes('⌈'), `防止半伤 ceilDiv 丢失 → ${l1}`);
    const l2 = describeAbility(abilityOf('moonelf', 'moonelf:missedMe'), 2, 'zh');
    assert.ok(!l2.includes('⌊'), `L2 每支箭 1 伤不得渲染 floorDiv → ${l2}`);
    assert.ok(l2.includes('⌈'), `L2 防止半伤与 L1 相同 → ${l2}`);
  });

  test('长弓 L2：三档数值 4/6/8 与「4 同点缠足」条件都在', () => {
    const t = describeAbility(abilityOf('moonelf', 'moonelf:longbow'), 2, 'zh');
    for (const w of ['4', '6', '8']) {
      assert.ok(t.includes(w), `长弓 L2 分档数值 ${w} 丢失 → ${t}`);
    }
    assert.ok(t.includes('缠足'), `L2 缠足效果丢失 → ${t}`);
    assert.ok(t.includes('点数出现 ≥ 4 次'), `of-a-kind 按骰值同点的条件丢失 → ${t}`);
  });

  test('爆裂箭 L2：掷 5 池骰 + 箭/足/月三符号公式 + CP 移除 + 每足 2 倍', () => {
    const t = describeAbility(abilityOf('moonelf', 'moonelf:explodingArrow'), 2, 'zh');
    assert.ok(t.includes('掷 5 颗骰'), `Roll 5 丢失 → ${t}`);
    for (const w of ['箭', '足', '月']) {
      assert.ok(t.includes(w), `公式符号 ${w} 丢失 → ${t}`);
    }
    assert.ok(t.includes('CP'), `CP 移除丢失 → ${t}`);
    assert.ok(t.includes('× 2'), `L2 每足 2 倍丢失 → ${t}`);
  });

  test('月蚀！（Ultimate）：12 不可防御 + 终极技能标注 + 三状态与己方闪避', () => {
    const t = describeAbility(abilityOf('moonelf', 'moonelf:lunarEclipse'), 1, 'zh');
    assert.ok(t.includes('12'), `Ultimate 伤害 12 丢失 → ${t}`);
    assert.ok(t.includes('不可防御'), `不可防御标注丢失 → ${t}`);
    assert.ok(t.includes('终极技能'), `sourceKind ultimate 丢失 → ${t}`);
    for (const w of ['闪避', '致盲', '缠足', '锁定']) {
      assert.ok(t.includes(w), `Ultimate 附赠效果 ${w} 丢失 → ${t}`);
    }
  });

  test('月之魔法卡：4 CP 主阶段行动 + 闪避与三状态', () => {
    const t = describeCard(createDefaultRegistry().getCard('moonelf:moonMagic'), 'zh');
    assert.ok(t.includes('4 CP'), `费用丢失 → ${t}`);
    assert.ok(t.includes('主阶段行动'), `时机丢失 → ${t}`);
    for (const w of ['闪避', '致盲', '缠足', '锁定']) {
      assert.ok(t.includes(w), `效果 ${w} 丢失 → ${t}`);
    }
  });

  test('暗月之影（PROMO）：掷 1 骰月分支 + 非月抽 1 的双分支都在', () => {
    const t = describeCard(createDefaultRegistry().getCard('moonelf:lunarUmbra'), 'zh');
    assert.ok(t.includes('掷 1 颗骰'), `掷骰丢失 → ${t}`);
    assert.ok(t.includes('月'), `月符号分支丢失 → ${t}`);
    assert.ok(t.includes('抽 1 张牌'), `非月抽牌分支丢失 → ${t}`);
  });
});
