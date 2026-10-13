/**
 * MVP 四位英雄中的两位（Barbarian / Pyromancer）——覆盖全部高风险 DSL 构造：
 * graded（展开为条件分支）、allOf、smallStraight、countFace、countSymbol、
 * rollDicePool、removeStatus+bindRemovedTo、防御反伤(pure/ability)、自我反噬(pure/recoil)、Ultimate。
 *
 * ⚠️ 自用学习定位：机制自洽的自制数值，**非官方数值**，不含官方卡面文本。
 * 官方数值校准需在上线前做一次 rules-lawyering pass（架构 B8）。
 */
import type { CardDef, HeroDef } from '../types/content.js';
import { COMMON_CARDS } from './cards.js';

// ── 狂战士：直球高伤，靠反噬换爆发 ──────────────────────
const barbarianUpgrades: readonly CardDef[] = [
  {
    defId: 'barbarian:heavyBlow:2', name: '重击 II', kind: 'upgrade', costCp: 4,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:heavyBlow', tier: 2, count: 2,
    effects: [],
  },
  {
    defId: 'barbarian:heavyBlow:3', name: '重击 III', kind: 'upgrade', costCp: 8,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:heavyBlow', tier: 3, count: 1,
    effects: [],
  },
  {
    defId: 'barbarian:whirlwind:2', name: '旋风斩 II', kind: 'upgrade', costCp: 4,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:whirlwind', tier: 2, count: 2,
    effects: [],
  },
  {
    defId: 'barbarian:whirlwind:3', name: '旋风斩 III', kind: 'upgrade', costCp: 8,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:whirlwind', tier: 3, count: 1,
    effects: [],
  },
  {
    defId: 'barbarian:reckless:2', name: '鲁莽 II', kind: 'upgrade', costCp: 5,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:reckless', tier: 2, count: 1,
    effects: [],
  },
  {
    defId: 'barbarian:ironWill:2', name: '钢铁意志 II', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:ironWill', tier: 2, count: 1,
    effects: [],
  },
];

export const BARBARIAN: HeroDef = {
  id: 'barbarian',
  name: '狂战士',
  dieFaces: [
    { value: 1, symbols: ['axe'] },
    { value: 2, symbols: ['axe'] },
    { value: 3, symbols: ['strength'] },
    { value: 4, symbols: ['strength'] },
    { value: 5, symbols: ['rage'] },
    { value: 6, symbols: ['rage'] },
  ],
  diceCount: 5,
  startHp: 50,
  abilities: [
    {
      id: 'barbarian:heavyBlow',
      kind: 'offensive',
      name: '重击',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'axe', count: 2 },
          effects: [{ clause: { kind: 'dealDamage', amount: 4, damageType: 'attack', to: { r: 'opponent' } } }] },
        { level: 2, upgradeCostCP: 4, matcher: { k: 'countSymbol', symbol: 'axe', count: 2 },
          effects: [{ clause: { kind: 'dealDamage', amount: 7, damageType: 'attack', to: { r: 'opponent' } } }] },
        { level: 3, upgradeCostCP: 8, matcher: { k: 'countSymbol', symbol: 'axe', count: 2 },
          effects: [{ clause: { kind: 'dealDamage', amount: 11, damageType: 'attack', to: { r: 'opponent' } } }] },
      ],
    },
    {
      id: 'barbarian:whirlwind',
      kind: 'offensive',
      name: '旋风斩',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'smallStraight' },
          effects: [{ clause: { kind: 'dealDamage', amount: 7, damageType: 'attack', to: { r: 'opponent' } } }] },
        { level: 2, upgradeCostCP: 4, matcher: { k: 'smallStraight' },
          effects: [{ clause: { kind: 'dealDamage', amount: 10, damageType: 'attack', to: { r: 'opponent' } } }] },
        { level: 3, upgradeCostCP: 8, matcher: { k: 'smallStraight' },
          effects: [
            { clause: { kind: 'dealDamage', amount: 14, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'gainCp', amount: 2, to: { r: 'self' } } },
          ] },
      ],
    },
    {
      id: 'barbarian:reckless',
      kind: 'offensive',
      name: '鲁莽挥砍',
      tiers: [
        // 高伤 + 自我反噬（pure/recoil：不可防御、不可被攻击修正增强）
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countFace', face: 6, count: 3 },
          effects: [
            { clause: { kind: 'dealDamage', amount: 14, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 5, damageType: 'pure', to: { r: 'self' }, sourceKind: 'recoil' } },
          ] },
        { level: 2, upgradeCostCP: 5, matcher: { k: 'countFace', face: 6, count: 3 },
          effects: [
            { clause: { kind: 'dealDamage', amount: 18, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 5, damageType: 'pure', to: { r: 'self' }, sourceKind: 'recoil' } },
          ] },
      ],
    },
    {
      id: 'barbarian:ironWill',
      kind: 'defensive',
      name: '钢铁意志',
      defenseDiceCount: 1,
      tiers: [
        // sumFaces 读防御掷骰结果（引擎写入 tempDice）
        { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
          effects: [{ clause: { kind: 'preventDamage', amount: { e: 'sumFaces' }, to: { r: 'self' } } }] },
        { level: 2, upgradeCostCP: 3, matcher: { k: 'const', value: true },
          effects: [
            { clause: { kind: 'preventDamage', amount: { e: 'sumFaces' }, to: { r: 'self' } } },
            { clause: { kind: 'gainCp', amount: 1, to: { r: 'self' } } },
          ] },
      ],
    },
    {
      id: 'barbarian:bloodlust',
      kind: 'ultimate',
      name: '血怒',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'rage', count: 5 },
          effects: [{ clause: { kind: 'dealDamage', amount: 22, damageType: 'attack', to: { r: 'opponent' }, sourceKind: 'ultimate' } }] },
      ],
    },
  ],
  statuses: [],
  deck: [...COMMON_CARDS, ...barbarianUpgrades],
};

// ── 焰术士：火焰分档 + 状态消耗，玻璃大炮 ────────────────
const pyromancerUpgrades: readonly CardDef[] = [
  {
    defId: 'pyromancer:fireball:2', name: '火球 II', kind: 'upgrade', costCp: 4,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:fireball', tier: 2, count: 2,
    effects: [],
  },
  {
    defId: 'pyromancer:fireball:3', name: '火球 III', kind: 'upgrade', costCp: 9,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:fireball', tier: 3, count: 1,
    effects: [],
  },
  {
    defId: 'pyromancer:ignite:2', name: '点燃 II', kind: 'upgrade', costCp: 4,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:ignite', tier: 2, count: 2,
    effects: [],
  },
  {
    defId: 'pyromancer:combustion:2', name: '燃尽 II', kind: 'upgrade', costCp: 5,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:combustion', tier: 2, count: 1,
    effects: [],
  },
  {
    defId: 'pyromancer:moltenArmor:2', name: '熔岩护甲 II', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:moltenArmor', tier: 2, count: 1,
    effects: [],
  },
];

export const PYROMANCER: HeroDef = {
  id: 'pyromancer',
  name: '焰术士',
  dieFaces: [
    { value: 1, symbols: ['flame'] },
    { value: 2, symbols: ['flame'] },
    { value: 3, symbols: ['flame'] },
    { value: 4, symbols: ['meteor'] },
    { value: 5, symbols: ['meteor'] },
    { value: 6, symbols: ['flame', 'meteor'] },
  ],
  diceCount: 5,
  startHp: 50,
  abilities: [
    {
      id: 'pyromancer:fireball',
      kind: 'offensive',
      name: '火球',
      tiers: [
        // graded 展开为条件分支：matcher 取最低档，effects 内按实际数量分支
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'flame', count: 3 },
          effects: [{
            clause: {
              kind: 'conditional',
              cond: { c: 'diceSymbolAtLeast', symbol: 'flame', min: 5 },
              then: [{ clause: { kind: 'dealDamage', amount: 16, damageType: 'attack', to: { r: 'opponent' } } }],
              else: [{
                clause: {
                  kind: 'conditional',
                  cond: { c: 'diceSymbolAtLeast', symbol: 'flame', min: 4 },
                  then: [{ clause: { kind: 'dealDamage', amount: 10, damageType: 'attack', to: { r: 'opponent' } } }],
                  else: [{ clause: { kind: 'dealDamage', amount: 6, damageType: 'attack', to: { r: 'opponent' } } }],
                },
              }],
            },
          }] },
        { level: 2, upgradeCostCP: 4, matcher: { k: 'countSymbol', symbol: 'flame', count: 3 },
          effects: [{
            clause: {
              kind: 'conditional',
              cond: { c: 'diceSymbolAtLeast', symbol: 'flame', min: 5 },
              then: [{ clause: { kind: 'dealDamage', amount: 21, damageType: 'attack', to: { r: 'opponent' } } }],
              else: [{ clause: { kind: 'dealDamage', amount: 13, damageType: 'attack', to: { r: 'opponent' } } }],
            },
          }] },
        { level: 3, upgradeCostCP: 9, matcher: { k: 'countSymbol', symbol: 'flame', count: 3 },
          effects: [{
            clause: {
              kind: 'conditional',
              cond: { c: 'diceSymbolAtLeast', symbol: 'flame', min: 5 },
              then: [{ clause: { kind: 'dealDamage', amount: 27, damageType: 'attack', to: { r: 'opponent' } } }],
              else: [{ clause: { kind: 'dealDamage', amount: 17, damageType: 'attack', to: { r: 'opponent' } } }],
            },
          }] },
      ],
    },
    {
      id: 'pyromancer:combustion',
      kind: 'offensive',
      name: '燃尽',
      tiers: [
        // 移除对手状态 → 按实际移除数造成不可防御伤害（bindRemovedTo 必须返回实际移除数）
        { level: 1, upgradeCostCP: 0,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 1 }, { k: 'countSymbol', symbol: 'meteor', count: 1 }] },
          effects: [
            { clause: { kind: 'removeStatus', status: 'any', stacks: 4, to: { r: 'opponent' }, bindRemovedTo: 'burned' } },
            {
              clause: {
                kind: 'conditional',
                cond: { c: 'boundAtLeast', name: 'burned', min: 1 },
                then: [{
                  clause: {
                    kind: 'dealDamage',
                    amount: { e: 'mul', a: { e: 'var', name: 'burned' }, b: 3 },
                    damageType: 'undefendable',
                    to: { r: 'opponent' },
                    sourceKind: 'ability',
                  },
                }],
              },
            },
          ] },
        { level: 2, upgradeCostCP: 5,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 1 }, { k: 'countSymbol', symbol: 'meteor', count: 1 }] },
          effects: [
            { clause: { kind: 'removeStatus', status: 'any', stacks: 4, to: { r: 'opponent' }, bindRemovedTo: 'burned' } },
            {
              clause: {
                kind: 'conditional',
                cond: { c: 'boundAtLeast', name: 'burned', min: 1 },
                then: [{
                  clause: {
                    kind: 'dealDamage',
                    amount: { e: 'mul', a: { e: 'var', name: 'burned' }, b: 5 },
                    damageType: 'undefendable',
                    to: { r: 'opponent' },
                    sourceKind: 'ability',
                  },
                }],
              },
            },
          ] },
      ],
    },
    {
      id: 'pyromancer:ignite',
      kind: 'offensive',
      name: '点燃',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'smallStraight' },
          effects: [
            { clause: { kind: 'dealDamage', amount: 4, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 2, to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 4, matcher: { k: 'smallStraight' },
          effects: [
            { clause: { kind: 'dealDamage', amount: 7, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 3, to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      id: 'pyromancer:moltenArmor',
      kind: 'defensive',
      name: '熔岩护甲',
      defenseDiceCount: 1,
      tiers: [
        // 防御反伤：pure + sourceKind ability + target attacker（不可防御，但计入 damageDealtAtLeast）
        { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
          effects: [{
            clause: {
              kind: 'dealDamage',
              amount: { e: 'sumFaces' },
              damageType: 'pure',
              to: { r: 'attacker' },
              sourceKind: 'ability',
            },
          }] },
        { level: 2, upgradeCostCP: 3, matcher: { k: 'const', value: true },
          effects: [
            { clause: { kind: 'preventDamage', amount: 2, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'sumFaces' }, damageType: 'pure', to: { r: 'attacker' }, sourceKind: 'ability' } },
          ] },
      ],
    },
    {
      id: 'pyromancer:scorchTheEarth',
      kind: 'ultimate',
      name: '焦土',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countFace', face: 6, count: 5 },
          effects: [
            { clause: { kind: 'dealDamage', amount: 25, damageType: 'attack', to: { r: 'opponent' }, sourceKind: 'ultimate' } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 3, to: { r: 'opponent' } } },
          ] },
      ],
    },
  ],
  statuses: [],
  deck: [...COMMON_CARDS, ...pyromancerUpgrades],
};
