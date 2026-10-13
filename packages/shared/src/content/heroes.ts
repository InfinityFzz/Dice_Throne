/**
 * MVP 四位英雄中的两位（Barbarian / Pyromancer）——覆盖全部高风险 DSL 构造：
 * graded（展开为条件分支）、allOf、smallStraight、countFace、countSymbol、
 * rollDicePool、removeStatus+bindRemovedTo、防御反伤(pure/ability)、自我反噬(pure/recoil)、Ultimate。
 *
 * ⚠️ 自用学习定位：机制自洽的自制数值，**非官方数值**，不含官方卡面文本。
 * 官方数值校准需在上线前做一次 rules-lawyering pass（架构 B8）。
 */
import type { CardDef, HeroDef } from '../types/content.js';
import type { EffectDef } from '../types/core.js';
import { COMMON_CARDS } from './cards.js';

// ── 狂战士：直球高伤，靠反噬换爆发 ──────────────────────
// 2026-10-13 官方校准：骰面/能力集合/L2-L3 数值全部读自官方 TTS 图包卡面
// （详见 docs/content-audit-report.md）。L1 除 warcry/critBash 外官方值未获取，
// 用「L2-1 档差」推定并标注 official:false；官方标注的条件效果引擎暂不支持处已注明。
const barbarianUpgrades: readonly CardDef[] = [
  // 官方卡组含以下升级卡（卡名经 OCR 视觉复核）；张数官方值未获取，暂记 1
  { defId: 'barbarian:smack:2', name: 'Smack II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:smack', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:smack:3', name: 'Smack III', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:smack', tier: 3, count: 1, effects: [] },
  { defId: 'barbarian:sturdyBlow:2', name: 'Sturdy Blow II', kind: 'upgrade', costCp: 1,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:sturdyBlow', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:sturdyBlow:3', name: 'Sturdy Blow III', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:sturdyBlow', tier: 3, count: 1, effects: [] },
  { defId: 'barbarian:mightyBlow:2', name: 'Mighty Blow II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:mightyBlow', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:critBash:2', name: 'Crit Bash II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:critBash', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:overpower:2', name: 'Overpower II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:overpower', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:reckless:2', name: 'Reckless II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:reckless', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:fortitude:2', name: 'Fortitude II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:fortitude', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:thickSkin:2', name: 'Thick Skin II', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:thickSkin', tier: 2, count: 1, effects: [] },
];

/** graded 的条件分支展开（官方 Smack/Fortitude 为 3/4/5 档） */
function gradedBranch(symbol: 'sword' | 'life', tierDmg: readonly [number, number, number], mk: (n: number) => EffectDef): EffectDef {
  return {
    clause: {
      kind: 'conditional',
      cond: { c: 'diceSymbolAtLeast', symbol, min: 5 },
      then: [mk(tierDmg[2] as number)],
      else: [{
        clause: {
          kind: 'conditional',
          cond: { c: 'diceSymbolAtLeast', symbol, min: 4 },
          then: [mk(tierDmg[1] as number)],
          else: [mk(tierDmg[0] as number)],
        },
      }],
    },
  };
}
const dmgTo = (n: number, t: 'attack' | 'undefendable' = 'attack'): EffectDef =>
  ({ clause: { kind: 'dealDamage', amount: n, damageType: t, to: { r: 'opponent' } } });

export const BARBARIAN: HeroDef = {
  id: 'barbarian',
  name: '狂战士',
  dieFaces: [
    // 官方值（Barbarian 技能板原图逐面核读，2026-10-13）：1-3 SWORD，4-5 LIFE，6 POW
    { value: 1, symbols: ['sword'] },
    { value: 2, symbols: ['sword'] },
    { value: 3, symbols: ['sword'] },
    { value: 4, symbols: ['life'] },
    { value: 5, symbols: ['life'] },
    { value: 6, symbols: ['pow'] },
  ],
  diceCount: 5,
  startHp: 50,
  abilities: [
    {
      // 官方 L2: 3/4/5 剑 → 5/7/9；L3: 6/8/10；「4-of-a-kind(同点)时不可防御」引擎暂无该条件，待扩展
      id: 'barbarian:smack',
      kind: 'offensive',
      name: '重击',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'sword', count: 3 },
          effects: [gradedBranch('sword', [4, 6, 8], (n) => dmgTo(n))] }, // official:false 推定
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'sword', count: 3 },
          effects: [gradedBranch('sword', [5, 7, 9], (n) => dmgTo(n))] },
        { level: 3, upgradeCostCP: 3, matcher: { k: 'countSymbol', symbol: 'sword', count: 3 },
          effects: [gradedBranch('sword', [6, 8, 10], (n) => dmgTo(n))] },
      ],
    },
    {
      // 官方 L2: 2剑+2星 → 5 不可防御（1 CP）；L3 → 6（2 CP）
      id: 'barbarian:sturdyBlow',
      kind: 'offensive',
      name: '稳固打击',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'sword', count: 2 }, { k: 'countSymbol', symbol: 'pow', count: 2 }] },
          effects: [dmgTo(3, 'undefendable')] }, // official:false 推定
        { level: 2, upgradeCostCP: 1, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'sword', count: 2 }, { k: 'countSymbol', symbol: 'pow', count: 2 }] },
          effects: [dmgTo(5, 'undefendable')] },
        { level: 3, upgradeCostCP: 2, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'sword', count: 2 }, { k: 'countSymbol', symbol: 'pow', count: 2 }] },
          effects: [dmgTo(6, 'undefendable')] },
      ],
    },
    {
      // 官方 L2: 小顺 → 8 不可防御
      id: 'barbarian:mightyBlow',
      kind: 'offensive',
      name: '强力打击',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'smallStraight' },
          effects: [dmgTo(6, 'undefendable')] }, // official:false 推定
        { level: 2, upgradeCostCP: 2, matcher: { k: 'smallStraight' },
          effects: [dmgTo(8, 'undefendable')] },
      ],
    },
    {
      // 官方 L1(Crit Smash): 3星 → Concussion + 2 不可防御；L2(Crit Bash): 4星 → Stun + 7 不可防御
      id: 'barbarian:critBash',
      kind: 'offensive',
      name: '暴击猛击',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'pow', count: 3 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:concussion', stacks: 1, to: { r: 'opponent' } } },
            dmgTo(2, 'undefendable'),
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'pow', count: 4 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:stun', stacks: 1, to: { r: 'opponent' } } },
            dmgTo(7, 'undefendable'),
          ] },
      ],
    },
    {
      // 官方 L2: 3剑+2星 → Roll 3 骰，伤害=总点数；≥10 → Concussion
      id: 'barbarian:overpower',
      kind: 'offensive',
      name: '压制',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'sword', count: 2 }, { k: 'countSymbol', symbol: 'pow', count: 2 }] },
          effects: [
            { clause: { kind: 'rollDicePool', count: 2, cases: [], bindSumTo: 'opRoll' } },
            { clause: { kind: 'dealDamage', amount: { e: 'var', name: 'opRoll' }, damageType: 'attack', to: { r: 'opponent' } } },
          ] }, // official:false 推定
        { level: 2, upgradeCostCP: 2, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'sword', count: 3 }, { k: 'countSymbol', symbol: 'pow', count: 2 }] },
          effects: [
            { clause: { kind: 'rollDicePool', count: 3, cases: [], bindSumTo: 'opRoll' } },
            { clause: { kind: 'dealDamage', amount: { e: 'var', name: 'opRoll' }, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'conditional', cond: { c: 'boundAtLeast', name: 'opRoll', min: 10 },
              then: [{ clause: { kind: 'inflictStatus', status: 'common:concussion', stacks: 1, to: { r: 'opponent' } } }] } },
          ] },
      ],
    },
    {
      // 官方 L2: 大顺 → 20 伤害 + 反噬 5；
      // ⚠️ 官方反噬为条件性（仅当至少 1 点伤害成功造成 = hitSuccess 语义），引擎 Condition 暂无该类型，现为无条件，待扩展
      id: 'barbarian:reckless',
      kind: 'offensive',
      name: '鲁莽挥砍',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'largeStraight' },
          effects: [
            dmgTo(15),
            { clause: { kind: 'dealDamage', amount: 4, damageType: 'pure', to: { r: 'self' }, sourceKind: 'recoil' } },
          ] }, // official:false 推定（15+4）
        { level: 2, upgradeCostCP: 2, matcher: { k: 'largeStraight' },
          effects: [
            dmgTo(20),
            { clause: { kind: 'dealDamage', amount: 5, damageType: 'pure', to: { r: 'self' }, sourceKind: 'recoil' } },
          ] },
      ],
    },
    {
      // 官方 L1（卡面相邻格直读）：2剑+2心 → 治疗 2 + 2 不可防御；官方卡组无升级卡（L1 封顶）
      id: 'barbarian:warCry',
      kind: 'offensive',
      name: '战吼',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'sword', count: 2 }, { k: 'countSymbol', symbol: 'life', count: 2 }] },
          effects: [
            { clause: { kind: 'heal', amount: 2, to: { r: 'self' } } },
            dmgTo(2, 'undefendable'),
          ] },
      ],
    },
    {
      // 官方 L2（卡面红色边框 = 进攻类）：3/4/5 心 → 治疗 5/6/7；「3-of-a-kind 可移除自身 1 状态」引擎暂无该条件
      id: 'barbarian:fortitude',
      kind: 'offensive',
      name: '坚忍',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'life', count: 3 },
          effects: [gradedBranch('life', [3, 4, 5], (n) => ({ clause: { kind: 'heal', amount: n, to: { r: 'self' } } }))] }, // official:false 推定
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'life', count: 3 },
          effects: [gradedBranch('life', [5, 6, 7], (n) => ({ clause: { kind: 'heal', amount: n, to: { r: 'self' } } }))] },
      ],
    },
    {
      // 官方 L2（绿色边框 = 防御类）：防御骰出 4 → 治疗 2×红心数；双心可预防 1 来袭状态。
      // ⚠️ matcher/heal 的求值对象应为防御骰结果，引擎对 defensive matcher 的 scope 求值待验证
      id: 'barbarian:thickSkin',
      kind: 'defensive',
      name: '厚皮',
      defenseDiceCount: 4,
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
          effects: [{ clause: { kind: 'heal', amount: { e: 'mul', a: 1, b: { e: 'countSymbol', symbol: 'life' } }, to: { r: 'self' } } }] }, // official:false 推定
        { level: 2, upgradeCostCP: 3, matcher: { k: 'countFace', face: 4, count: 1 },
          effects: [{ clause: { kind: 'heal', amount: { e: 'mul', a: 2, b: { e: 'countSymbol', symbol: 'life' } }, to: { r: 'self' } } }] },
      ],
    },
    {
      // ⚠️ official:false：Barbarian 的 Ultimate 印在实体面板上，图包未包含，数值未知。
      // 以下为占位推定（5 星极难达成），待获取官方值后替换。
      id: 'barbarian:bloodlust',
      kind: 'ultimate',
      name: '血怒（占位，官方值待补）',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'pow', count: 5 },
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
    // 官方值（源 A 技能板 + 源 D 骰面贴图 + 升级卡 matcher 三方一致）：
    // 1-3 FLAME，4 BLAZE，5 FIERY SOUL，6 METEOR
    { value: 1, symbols: ['flame'] },
    { value: 2, symbols: ['flame'] },
    { value: 3, symbols: ['flame'] },
    { value: 4, symbols: ['blaze'] },
    { value: 5, symbols: ['fierySoul'] },
    { value: 6, symbols: ['meteor'] },
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
        // 官方值（英雄板 tier1 + FIREBALL II 卡同梯 4/6/8 双重印证）：
        // 3 焰→4，4 焰→6，5 焰→8；官方另有「获得 1 Fire Mastery」效果（机制层，未实装，待裁定）
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'flame', count: 3 },
          effects: [{
            clause: {
              kind: 'conditional',
              cond: { c: 'diceSymbolAtLeast', symbol: 'flame', min: 5 },
              then: [{ clause: { kind: 'dealDamage', amount: 8, damageType: 'attack', to: { r: 'opponent' } } }],
              else: [{
                clause: {
                  kind: 'conditional',
                  cond: { c: 'diceSymbolAtLeast', symbol: 'flame', min: 4 },
                  then: [{ clause: { kind: 'dealDamage', amount: 6, damageType: 'attack', to: { r: 'opponent' } } }],
                  else: [{ clause: { kind: 'dealDamage', amount: 4, damageType: 'attack', to: { r: 'opponent' } } }],
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
            // 官方 Burn stack limit 1，官方卡一律施加单个 Burn（源 A 技能板 + 升级卡）
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 4, matcher: { k: 'smallStraight' },
          effects: [
            { clause: { kind: 'dealDamage', amount: 7, damageType: 'attack', to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } },
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
