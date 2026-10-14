/**
 * MVP 四位英雄中的两位（Barbarian / Pyromancer）——覆盖全部高风险 DSL 构造：
 * graded（展开为条件分支）、allOf、smallStraight、countFace、countSymbol、
 * rollDicePool、removeStatus+bindRemovedTo、防御反伤(pure/ability)、自我反噬(pure/recoil)、Ultimate。
 *
 * ⚠️ 自用学习定位：机制自洽的自制数值，**非官方数值**，不含官方卡面文本。
 * 官方数值校准需在上线前做一次 rules-lawyering pass（架构 B8）。
 */
import type { CardDef, HeroDef, StatusDef } from '../types/content.js';
import type { EffectDef } from '../types/core.js';
import { COMMON_CARDS } from './cards.js';

// ── 狂战士：直球高伤，靠反噬换爆发 ──────────────────────
// 2026-10-13 官方校准：骰面/能力集合/L2-L3 数值全部读自官方 TTS 图包卡面
// （详见 docs/content-audit-report.md）。L1 除 warcry/critBash 外官方值未获取，
// 用「L2-1 档差」推定并标注 official:false；官方标注的条件效果引擎暂不支持处已注明。
const barbarianUpgrades: readonly CardDef[] = [
  // 官方卡组含以下升级卡（卡名经 OCR 视觉复核）；张数官方值未获取，暂记 1
  { defId: 'barbarian:smack:2', name: '重击 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:smack', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:smack:3', name: '重击 III', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:smack', tier: 3, count: 1, effects: [] },
  { defId: 'barbarian:sturdyBlow:2', name: '稳固打击 II', kind: 'upgrade', costCp: 1,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:sturdyBlow', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:sturdyBlow:3', name: '稳固打击 III', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:sturdyBlow', tier: 3, count: 1, effects: [] },
  { defId: 'barbarian:mightyBlow:2', name: '强力打击 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:mightyBlow', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:critBash:2', name: '暴击猛击 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:critBash', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:overpower:2', name: '压制 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:overpower', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:reckless:2', name: '鲁莽挥砍 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:reckless', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:fortitude:2', name: '坚忍 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:fortitude', tier: 2, count: 1, effects: [] },
  { defId: 'barbarian:thickSkin:2', name: '厚皮 II', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'barbarian:thickSkin', tier: 2, count: 1, effects: [] },
];

/** graded 的条件分支展开（官方 Smack/Fortitude/Fireball 为 3 档；Gunslinger Revolver 同构） */
function gradedBranch(symbol: string, tierDmg: readonly [number, number, number], mk: (n: number) => EffectDef): EffectDef {
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

/** 条件不可防御伤害（官方 Smack：4-of-a-kind 时本次攻击不可防御） */
const dmgConditionalUndefendable = (n: number): EffectDef =>
  ({ clause: { kind: 'dealDamage', amount: n, damageType: 'attack', to: { r: 'opponent' }, undefendableIf: { c: 'nOfAKind', n: 4 } } });

/** Barbarian 专属行动卡（card-28..32，2026-10-13 读图） */
const barbarianHeroCards: readonly CardDef[] = [
  // Concuss!：1 CP，直接施加 Concussion
  { defId: 'barbarian:concuss', name: '震晕', kind: 'mainPhase', costCp: 1,
    timing: ['main1', 'main2'], count: 1,
    effects: [{ clause: { kind: 'inflictStatus', status: 'common:concussion', stacks: 1, to: { r: 'opponent' } } }] },
  // Head Bash!：0 CP，Roll Phase Action。官方卡面原文（card-29 重读，2026-10-14）：
  //   "If you successfully dealt at least 8 dmg to an opponent after their defense
  //    concluded, play this card to inflict Concussion."
  // = 攻击方在防御结算（伤害 flush）后打出的**门槛型**行动卡，不是防守方防御窗口卡（O-1 修正）。
  // 「成功造成」= 防御减免后的净伤：flushNow 把承受方净伤归账给对手（engine.ts flushNow），
  //   因此 main2 求值 damageDealtAtLeast 时读到的是本次攻击的净伤。
  { defId: 'barbarian:headBash', name: '头槌', kind: 'rollPhase', costCp: 0,
    timing: ['postDefense'], count: 1,
    playIf: { c: 'damageDealtAtLeast', value: 8 },
    effects: [{ clause: { kind: 'inflictStatus', status: 'common:concussion', stacks: 1, to: { r: 'opponent' } } }] },
  // Get Some!：2 CP，攻击修正：Roll 5，每剑 +1 总伤害；再施加 Concussion
  { defId: 'barbarian:getSome', name: '来啊', kind: 'rollPhase', costCp: 2,
    timing: ['thenNode'], count: 1,
    effects: [
      { clause: { kind: 'rollDicePool', count: 5, perDie: true, cases: [
        { on: 'sword', effects: [{ clause: { kind: 'dealDamage', amount: 1, damageType: 'attack', to: { r: 'opponent' } } }] },
      ] } },
      { clause: { kind: 'inflictStatus', status: 'common:concussion', stacks: 1, to: { r: 'opponent' } } },
    ] },
  // Feelin' Good!：0 CP，Instant：Roll 3，治疗 1 + 2×心
  { defId: 'barbarian:feelinGood', name: '感觉不错', kind: 'instant', costCp: 0,
    timing: ['thenNode', 'preDefense', 'postDefense'], count: 1,
    effects: [
      { clause: { kind: 'heal', amount: 1, to: { r: 'self' } } },
      { clause: { kind: 'rollDicePool', count: 3, perDie: true, cases: [
        { on: 'life', effects: [{ clause: { kind: 'heal', amount: 2, to: { r: 'self' } } }] },
      ] } },
    ] },
  // Adrenaline Surge!：0 CP，PROMO：Roll 1，出心 → 治疗 2 + Concussion；其他 → 抽 1
  { defId: 'barbarian:adrenalineSurge', name: '肾上腺素激增（PROMO）', kind: 'mainPhase', costCp: 0,
    timing: ['main1', 'main2'], count: 1,
    effects: [
      { clause: { kind: 'rollDicePool', count: 1, bindSumTo: 'as' } },
      // barbarian 心面 = 4/5 点，出心即点数 ≥4
      { clause: { kind: 'conditional', cond: { c: 'boundAtLeast', name: 'as', min: 4 },
        then: [
          { clause: { kind: 'heal', amount: 2, to: { r: 'self' } } },
          { clause: { kind: 'inflictStatus', status: 'common:concussion', stacks: 1, to: { r: 'opponent' } } },
        ],
        else: [{ clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } }] } },
    ] },
];

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
      // 官方 L2: 3/4/5 剑 → 5/7/9；L3: 6/8/10；「4-of-a-kind 时不可防御」（undefendableIf，2026-10-14 接入）
      id: 'barbarian:smack',
      kind: 'offensive',
      name: '重击',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'sword', count: 3 },
          effects: [gradedBranch('sword', [4, 6, 8], (n) => dmgConditionalUndefendable(n))] }, // official:false 推定
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'sword', count: 3 },
          effects: [gradedBranch('sword', [5, 7, 9], (n) => dmgConditionalUndefendable(n))] },
        { level: 3, upgradeCostCP: 3, matcher: { k: 'countSymbol', symbol: 'sword', count: 3 },
          effects: [gradedBranch('sword', [6, 8, 10], (n) => dmgConditionalUndefendable(n))] },
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
      // 官方 L2（card-26）：大顺 → 20 伤害 + 条件反噬 5（仅当至少 1 点伤害成功造成）
      id: 'barbarian:reckless',
      kind: 'offensive',
      name: '鲁莽挥砍',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'largeStraight' },
          effects: [
            { clause: { kind: 'dealDamage', amount: 15, damageType: 'attack', to: { r: 'opponent' },
              recoilOnHit: { amount: 4, to: { r: 'self' } } } },
          ] }, // official:false L1 推定（15+4）
        { level: 2, upgradeCostCP: 2, matcher: { k: 'largeStraight' },
          effects: [
            { clause: { kind: 'dealDamage', amount: 20, damageType: 'attack', to: { r: 'opponent' },
              recoilOnHit: { amount: 5, to: { r: 'self' } } } },
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
      // 官方 L2（卡面红色边框 = 进攻类）：3/4/5 心 → 治疗 5/6/7；
      // 「3-of-a-kind 可移除自身 1 状态」（nOfAKind 条件，2026-10-14 接入）。
      //
      // ⚠️ 已知偏差（**显式记账**，不是静默偏差）：官方原文是 "may" —— **可选**。
      //    本实现按**必发**处理：引擎不支持 optionalPrompt 挂起 —— PendingKind 有枚举、
      //    legal.ts 有下发分支、Action 有 chooseOption，但 reduce 的 chooseOption 分支是空实现，
      //    且 UI 没有入口；一旦真的挂起，本地热座与联机会**卡死在 pending 上无法推进**，
      //    那比"效果不生效"严重得多。因此这里不包 `optional`，直接写成 conditional + removeStatus。
      //
      // ★ 回滚锚点（将来 optionalPrompt 挂起 + UI 入口就绪后）：
      //   ① 在 effects.ts 的 optional handler 实现挂起（当前是 `return []` 的诚实桩，注释里有指引）；
      //   ② 把下面两处 removeStatus 重新包回 `optional` 子句，即还原官方 may 语义。
      //
      // ⚠️ 残留风险（已实测复现，非理论推演）：removeStatus status:'any' 走**负面优先**移除，
      //    但仅当身上**一个负面状态都没有**时，它会退而吃掉**正面**状态 ——
      //    实测「身上只挂 fireMastery 2 层」时打出三同点，结果是 fireMastery 2 → 1。
      //    1v1 下 Barbarian 自身可能携带的负面状态为 burn / knockdown / stun /
      //    concussion / poison，因此该分支概率低，但**触发路径确实存在**。（见 effects.ts 的 removeStatus）
      id: 'barbarian:fortitude',
      kind: 'offensive',
      name: '坚忍',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'life', count: 3 },
          effects: [
            gradedBranch('life', [3, 4, 5], (n) => ({ clause: { kind: 'heal', amount: n, to: { r: 'self' } } })), // official:false 推定
            {
              clause: {
                kind: 'conditional',
                cond: { c: 'nOfAKind', n: 3 },
                // 官方 may（可选）→ MVP 按**必发**处理；已知偏差的记账见本能力头部注释，
                // 那里也写了回滚锚点（optionalPrompt 就绪后把这条重新包回 optional 即可）。
                then: [{ clause: { kind: 'removeStatus', status: 'any', stacks: 1, to: { r: 'self' } } }],
              },
            },
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'life', count: 3 },
          effects: [
            gradedBranch('life', [5, 6, 7], (n) => ({ clause: { kind: 'heal', amount: n, to: { r: 'self' } } })),
            {
              clause: {
                kind: 'conditional',
                cond: { c: 'nOfAKind', n: 3 },
                // 官方 may（可选）→ MVP 按**必发**处理；已知偏差的记账见本能力头部注释，
                // 那里也写了回滚锚点（optionalPrompt 就绪后把这条重新包回 optional 即可）。
                then: [{ clause: { kind: 'removeStatus', status: 'any', stacks: 1, to: { r: 'self' } } }],
              },
            },
          ] },
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
      id: 'barbarian:bloodlust',
      kind: 'ultimate',
      // 官方（双源一致，2026-10-14）：Rage —— 5 POW → 施加 Stun + 15 点伤害。
      // 来源 ①原版 S1 规则书配套社区数据（namu wiki 逐字：「5 strength stun applied. 15 unblockable damage」）；
      // 来源 ②法媒评测（aumeeplereporter）：「Rage, at 5 stars, inflicts 15 damage and a stun」。
      // Ultimate 伤害类型：不可防御且不可避免（规则书 Damage Table），引擎以 undefendable + sourceKind ultimate 表达。
      name: '怒火（Rage）',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'pow', count: 5 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:stun', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 15, damageType: 'undefendable', to: { r: 'opponent' }, sourceKind: 'ultimate' } },
          ] },
      ],
    },
  ],
  statuses: [],
  deck: [...COMMON_CARDS, ...barbarianUpgrades, ...barbarianHeroCards],
};

// ── 焰术士：火焰分档 + 状态消耗，玻璃大炮 ────────────────
// 2026-10-13 官方校准（第二轮）：升级卡 CP/效果全部读自官方 TTS 图包卡面
// （docs/content-audit-report.md §Pyromancer）。L1 除 Scorch/Meteoroid/Blazing Soul
// （卡面下方相邻格直读）外官方值未获取，用推定并标注。
const pyromancerUpgrades: readonly CardDef[] = [
  // 官方 CP = 卡面左上角印刷价
  { defId: 'pyromancer:fireball:2', name: '火球 II', kind: 'upgrade', costCp: 1,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:fireball', tier: 2, count: 2, effects: [] },
  { defId: 'pyromancer:pyroblast:2', name: '炎爆 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:pyroblast', tier: 2, count: 1, effects: [] },
  { defId: 'pyromancer:pyroblast:3', name: '炎爆 III', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:pyroblast', tier: 3, count: 1, effects: [] },
  { defId: 'pyromancer:ignite:2', name: '点燃 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:ignite', tier: 2, count: 2, effects: [] },
  { defId: 'pyromancer:burningSoul:2', name: '灼魂 II', kind: 'upgrade', costCp: 1,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:burningSoul', tier: 2, count: 1, effects: [] },
  { defId: 'pyromancer:hotStreak:2', name: '热浪连胜 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:hotStreak', tier: 2, count: 2, effects: [] },
  { defId: 'pyromancer:meteorite:2', name: '陨星 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:meteorite', tier: 2, count: 1, effects: [] },
  { defId: 'pyromancer:combustion:2', name: '燃尽 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:combustion', tier: 2, count: 1, effects: [] },
  { defId: 'pyromancer:moltenArmor:2', name: '熔岩护甲 II', kind: 'upgrade', costCp: 1,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:moltenArmor', tier: 2, count: 1, effects: [] },
  { defId: 'pyromancer:moltenArmor:3', name: '熔岩护甲 III', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'pyromancer:moltenArmor', tier: 3, count: 1, effects: [] },
];

/** Pyromancer 专属行动卡（card-28..32，2026-10-13 读图） */
const pyromancerHeroCards: readonly CardDef[] = [
  { defId: 'pyromancer:warmUp', name: '热身', kind: 'mainPhase', costCp: 0,
    timing: ['main1', 'main2'], count: 2,
    effects: [
      { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 1, to: { r: 'self' } },
        next: [{ clause: { kind: 'log', text: '官方效果「任意花费 CP 每 1 CP 换 1 FM」需自由出价输入，自动模式不行使' } }] },
    ] },
  { defId: 'pyromancer:fireUp', name: '燃起', kind: 'mainPhase', costCp: 3,
    timing: ['main1', 'main2'], count: 2,
    effects: [
      { clause: { kind: 'increaseStackLimit', status: 'common:fireMastery', by: 1, to: { r: 'self' } } },
      { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
    ] },
  // 攻击修正：在 then 窗口把附加伤害排入同一 bucket（flush 前与主攻击合并结算）
  { defId: 'pyromancer:redHot', name: '灼热', kind: 'rollPhase', costCp: 1,
    timing: ['thenNode'], count: 2,
    effects: [{
      clause: { kind: 'dealDamage', amount: { e: 'statusStacks', status: 'common:fireMastery', target: { r: 'self' } },
        damageType: 'attack', to: { r: 'opponent' } },
    }] },
  { defId: 'pyromancer:huzzah', name: '喝彩', kind: 'rollPhase', costCp: 1,
    timing: ['thenNode'], count: 2,
    effects: [{
      clause: { kind: 'rollDicePool', count: 1, cases: [
        { on: 'flame', effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'opponent' } } }] },
        { on: 'blaze', effects: [{ clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } }] },
        { on: 'fierySoul', effects: [{ clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } }] },
        { on: 'meteor', effects: [{ clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } }] },
      ] },
    }] },
  { defId: 'pyromancer:infernalInfusion', name: '炼狱灌注（PROMO）', kind: 'mainPhase', costCp: 0,
    timing: ['main1', 'main2'], count: 1,
    effects: [
      { clause: { kind: 'rollDicePool', count: 1, bindSumTo: 'ii' } },
      // meteor = 6 点：FM 补至上限（addStatus 按 cap 截断）；其余：抽 1
      { clause: { kind: 'conditional', cond: { c: 'boundAtLeast', name: 'ii', min: 6 },
        then: [{ clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 99, to: { r: 'self' } } }],
        else: [{ clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } }] } },
    ] },
];

export const PYROMANCER: HeroDef = {
  id: 'pyromancer',
  name: '焰术士',
  dieFaces: [
    // 官方值（技能板 + 骰面贴图 + 升级卡 matcher 三方一致）：
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
      // 官方 L2（card-18，1 CP）：graded 3/4/5 焰 → 4/6/8 + Gain 2 Fire Mastery。
      // L1 数值 = 英雄板（审计双重印证 4/6/8，无 FM 增益）。官方无 Fireball III。
      id: 'pyromancer:fireball',
      kind: 'offensive',
      name: '火球',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'flame', count: 3 },
          effects: [gradedBranch('flame', [4, 6, 8], (n) => dmgTo(n))] },
        { level: 2, upgradeCostCP: 1, matcher: { k: 'countSymbol', symbol: 'flame', count: 3 },
          effects: [
            gradedBranch('flame', [4, 6, 8], (n) => dmgTo(n)),
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
          ] },
      ],
    },
    {
      // 官方 L2（card-19，2 CP）：3焰+1meteor → Deal 6 + Roll 2（每焰 +3 伤害；blaze→Burn；
      // gain 2 FM；meteor→Knockdown）。L3（card-20，3 CP）另有「可重掷 1 颗池骰」，
      // 需骰池交互输入，自动模式不行使（optional 兜底语义）。
      id: 'pyromancer:pyroblast',
      kind: 'offensive',
      name: '炎爆',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 3 }, { k: 'countSymbol', symbol: 'meteor', count: 1 }] },
          effects: [
            dmgTo(4),
            { clause: { kind: 'rollDicePool', count: 2, perDie: true, cases: [
              { on: 'flame', effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'opponent' } } }] },
            ] } },
          ] }, // official:false L1 推定
        { level: 2, upgradeCostCP: 2, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 3 }, { k: 'countSymbol', symbol: 'meteor', count: 1 }] },
          effects: [
            dmgTo(6),
            { clause: { kind: 'rollDicePool', count: 2, perDie: true, cases: [
              { on: 'flame', effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'opponent' } } }] },
              { on: 'blaze', effects: [{ clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } }] },
              { on: 'meteor', effects: [{ clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } }] },
            ] } },
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
          ] },
        { level: 3, upgradeCostCP: 3, matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 3 }, { k: 'countSymbol', symbol: 'meteor', count: 1 }] },
          effects: [
            dmgTo(6),
            { clause: { kind: 'rollDicePool', count: 2, perDie: true, cases: [
              { on: 'flame', effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'opponent' } } }] },
              { on: 'blaze', effects: [{ clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } }] },
              { on: 'meteor', effects: [{ clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } }] },
            ] } },
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
            // 官方：If desired, you may re-roll 1 die（骰池重掷，自动模式不行使）
            { clause: { kind: 'optional', prompt: '重掷 1 颗炎爆池骰？', steps: [] } },
          ] },
      ],
    },
    {
      // 官方 L1（card-24 下方相邻格 BLAZING SOUL）：2blaze+2fierySoul → FM 上限 +1、
      // gain 5 FM、Knockdown。L2（card-24，2 CP）：大顺 → gain 2 FM、Burn、4 伤害 + 每 FM 2 伤害。
      id: 'pyromancer:ignite',
      kind: 'offensive',
      name: '点燃',
      tiers: [
        { level: 1, upgradeCostCP: 0,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'blaze', count: 2 }, { k: 'countSymbol', symbol: 'fierySoul', count: 2 }] },
          effects: [
            { clause: { kind: 'increaseStackLimit', status: 'common:fireMastery', by: 1, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 5, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'largeStraight' },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'add', a: 4, b: { e: 'mul', a: 2, b: { e: 'statusStacks', status: 'common:fireMastery', target: { r: 'self' } } } },
              damageType: 'attack', to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      // 官方 L2（card-21，1 CP）：2 fierySoul → 3 FS 时 Burn；4 FS 时 FM 上限 +1；
      // gain 2 FM；对对手造成 1×FS collateral。L1 官方值未获取（推定）。
      id: 'pyromancer:burningSoul',
      kind: 'offensive',
      name: '灼魂',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'fierySoul', count: 2 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 1, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'countSymbol', symbol: 'fierySoul' }, damageType: 'collateral', to: { r: 'opponent' } } },
          ] }, // official:false L1 推定
        { level: 2, upgradeCostCP: 1, matcher: { k: 'countSymbol', symbol: 'fierySoul', count: 2 },
          effects: [
            { clause: { kind: 'conditional', cond: { c: 'diceSymbolAtLeast', symbol: 'fierySoul', min: 3 },
              then: [{ clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } }] } },
            { clause: { kind: 'conditional', cond: { c: 'diceSymbolAtLeast', symbol: 'fierySoul', min: 4 },
              then: [{ clause: { kind: 'increaseStackLimit', status: 'common:fireMastery', by: 1, to: { r: 'self' } } }] } },
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'countSymbol', symbol: 'fierySoul' }, damageType: 'collateral', to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      // 官方 L1（card-23 下方相邻格 SCORCH）：2焰+2blaze → gain 2 FM、Burn、6 伤害。
      // L2（card-23，2 CP）：小顺 → gain 2 FM、6 伤害 + 每 FM 1 伤害。
      id: 'pyromancer:hotStreak',
      kind: 'offensive',
      name: '热浪连胜',
      tiers: [
        { level: 1, upgradeCostCP: 0,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'flame', count: 2 }, { k: 'countSymbol', symbol: 'blaze', count: 2 }] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } },
            dmgTo(6),
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'smallStraight' },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'add', a: 6, b: { e: 'statusStacks', status: 'common:fireMastery', target: { r: 'self' } } },
              damageType: 'attack', to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      // 官方 L1（card-25 下方相邻格 METEOROID）：3 meteor → Knockdown + Burn + Stun。
      // L2（card-25，2 CP）：4 meteor → gain 2 FM、Stun、每 FM 1 点不可防御、另 3 点 collateral。
      id: 'pyromancer:meteorite',
      kind: 'offensive',
      name: '陨星',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'meteor', count: 3 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:stun', stacks: 1, to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'meteor', count: 4 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 2, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'common:stun', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'statusStacks', status: 'common:fireMastery', target: { r: 'self' } },
              damageType: 'undefendable', to: { r: 'opponent' } } },
            { clause: { kind: 'additionally', steps: [
              { clause: { kind: 'dealDamage', amount: 3, damageType: 'collateral', to: { r: 'opponent' } } },
            ] } },
          ] },
      ],
    },
    {
      // 官方 L2（card-22，2 CP）：4 符号齐 → gain 1 FM；移除至多 4 FM，每枚 4 点不可防御。
      // 「移除至多 N」需自由出价输入，promptNumber 兜底绑定 0（自动模式不移除）。
      // L1 官方值未获取（推定同构，2 枚 / 3 点）。
      id: 'pyromancer:combustion',
      kind: 'offensive',
      name: '燃尽',
      tiers: [
        { level: 1, upgradeCostCP: 0,
          matcher: { k: 'allOf', of: [
            { k: 'countSymbol', symbol: 'flame', count: 1 }, { k: 'countSymbol', symbol: 'blaze', count: 1 },
            { k: 'countSymbol', symbol: 'fierySoul', count: 1 }, { k: 'countSymbol', symbol: 'meteor', count: 1 },
          ] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 1, to: { r: 'self' } } },
            { clause: { kind: 'promptNumber', max: 2, bindTo: 'fmSpent', prompt: '移除至多 2 枚火焰掌控' } },
            { clause: { kind: 'removeStatus', status: 'common:fireMastery', stacks: { e: 'var', name: 'fmSpent' }, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'mul', a: { e: 'var', name: 'fmSpent' }, b: 3 },
              damageType: 'undefendable', to: { r: 'opponent' } } },
          ] }, // official:false L1 推定
        { level: 2, upgradeCostCP: 2,
          matcher: { k: 'allOf', of: [
            { k: 'countSymbol', symbol: 'flame', count: 1 }, { k: 'countSymbol', symbol: 'blaze', count: 1 },
            { k: 'countSymbol', symbol: 'fierySoul', count: 1 }, { k: 'countSymbol', symbol: 'meteor', count: 1 },
          ] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 1, to: { r: 'self' } } },
            { clause: { kind: 'promptNumber', max: 4, bindTo: 'fmSpent', prompt: '移除至多 4 枚火焰掌控' } },
            { clause: { kind: 'removeStatus', status: 'common:fireMastery', stacks: { e: 'var', name: 'fmSpent' }, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: { e: 'mul', a: { e: 'var', name: 'fmSpent' }, b: 4 },
              damageType: 'undefendable', to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      // 官方 L2（card-26，1 CP）：DEFENSE ROLL 5 → gain 1×fierySoul FM；焰+blaze 同掷 → Burn；
      // 对攻击者造成 1×flame 伤害。L3（card-27，3 CP）：gain 1×FS + 1×meteor FM；同上 Burn；
      // 造成 1×flame + 1×meteor 伤害。L1 官方值未获取（推定为 L2 去增益的简化版）。
      id: 'pyromancer:moltenArmor',
      kind: 'defensive',
      name: '熔岩护甲',
      defenseDiceCount: 5,
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
          effects: [
            { clause: { kind: 'dealDamage', amount: { e: 'countSymbol', symbol: 'flame' },
              damageType: 'pure', to: { r: 'attacker' }, sourceKind: 'ability' } },
          ] }, // official:false L1 推定
        { level: 2, upgradeCostCP: 1, matcher: { k: 'const', value: true },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: { e: 'countSymbol', symbol: 'fierySoul' }, to: { r: 'self' } } },
            { clause: { kind: 'conditional', cond: { c: 'and', of: [
              { c: 'diceSymbolAtLeast', symbol: 'flame', min: 1 }, { c: 'diceSymbolAtLeast', symbol: 'blaze', min: 1 },
            ] },
              then: [{ clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'attacker' } } }] } },
            { clause: { kind: 'dealDamage', amount: { e: 'countSymbol', symbol: 'flame' },
              damageType: 'pure', to: { r: 'attacker' }, sourceKind: 'ability' } },
          ] },
        { level: 3, upgradeCostCP: 3, matcher: { k: 'const', value: true },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery',
              stacks: { e: 'add', a: { e: 'countSymbol', symbol: 'fierySoul' }, b: { e: 'countSymbol', symbol: 'meteor' } }, to: { r: 'self' } } },
            { clause: { kind: 'conditional', cond: { c: 'and', of: [
              { c: 'diceSymbolAtLeast', symbol: 'flame', min: 1 }, { c: 'diceSymbolAtLeast', symbol: 'blaze', min: 1 },
            ] },
              then: [{ clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'attacker' } } }] } },
            { clause: { kind: 'dealDamage',
              amount: { e: 'add', a: { e: 'countSymbol', symbol: 'flame' }, b: { e: 'countSymbol', symbol: 'meteor' } },
              damageType: 'pure', to: { r: 'attacker' }, sourceKind: 'ability' } },
          ] },
      ],
    },
    {
      id: 'pyromancer:scorchTheEarth',
      kind: 'ultimate',
      // 官方（双源一致，2026-10-14）：Scorch the Earth! —— 5-of-a-kind Meteor（五颗 6）：
      // 施加 Knockdown & Burn → Gain 3 Fire Mastery → Deal 12 dmg → 另对所有对手 2 点 collateral。
      // 来源 ①原版 S1 规则书 PDF v1.1（filesusr.com 官方托管，文本层逐字）；
      // 来源 ②Season One ReRolled 规则书（rulespal.com）—— 两版面板此条目完全一致。
      // 1v1 下「all opponents」即唯一对手。
      name: '焦土（Scorch the Earth!）',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countFace', face: 6, count: 5 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:burn', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:fireMastery', stacks: 3, to: { r: 'self' } } },
            { clause: { kind: 'dealDamage', amount: 12, damageType: 'undefendable', to: { r: 'opponent' }, sourceKind: 'ultimate' } },
            { clause: { kind: 'dealDamage', amount: 2, damageType: 'collateral', to: { r: 'opponent' }, sourceKind: 'ultimate' } },
          ] },
      ],
    },
  ],
  statuses: [],
  deck: [...COMMON_CARDS, ...pyromancerUpgrades, ...pyromancerHeroCards],
};

// ── 神枪手：悬赏经济 + 装填增伤 + 概率型防御 ──────────────
// 2026-10-14 官方校准（第三位英雄，M3 第一位）：骰面/状态/能力 L1-L3 数值/专属卡全部读自
// 官方 TTS 图包卡面（panel.webp + card-18..32 逐张读图，15/15）。L1 数值另经双源交叉印证：
//   ① boardgame.bg《Dice Throne S2 Battle Chest》规则书英雄面板文本（官方排版）；
//   ② namu wiki Gunslinger 条目（逐能力列出 L1 数值与升级效果）。
// 两源与卡图 L2/L3 完美衔接（Revolver 3/4/5→4/5/6、Showdown 7/5→8/6→9/6、
// BountyHunter 1→2、TakeCover 5→6、FanTheHammer 7→8、Deadeye 6→8），故 L1 全部 official ✅，
// 本英雄**没有推定值**。Ultimate「枪林弹雨」数值双源一致（boardgame.bg + 繁中规则书 gokids PDF）。
const gunslingerStatuses: readonly StatusDef[] = [
  {
    // 官方值（Gunslinger 技能板原图，2026-10-14）：Stack limit 2；正面效果。
    // 「结束进攻掷骰阶段且带有攻击时可消耗：掷 1 骰，把点数的一半（向上取整）作为伤害加到该次攻击。」
    // ⚠️ 已知边界（与 evasive 同款）：spend 类状态尚无玩家主动消耗的动作入口，
    // 状态数据先按官方登记（spendEffect 语义完备），入口补齐后即生效。
    id: 'gunslinger:reload',
    name: '装填',
    polarity: 'positive',
    stackLimit: 2,
    persistent: false, // 面板未标 Persistent
    spendable: true,
    spendEffect: [
      { clause: { kind: 'rollDicePool', count: 1, bindSumTo: 'reloadRoll' } },
      { clause: { kind: 'dealDamage', amount: { e: 'ceilDiv', a: { e: 'var', name: 'reloadRoll' }, b: 2 },
        damageType: 'attack', to: { r: 'opponent' } } },
    ],
  },
  {
    // 官方值（Gunslinger 技能板原图）：Stack limit 1；Persistent。
    // 「受此 token 影响的玩家被对手攻击时：攻击者伤害 +1 并获得 1 CP。」
    // 机制经 StatusDef.onAttacked 通用契约接入引擎（effects.ts dealDamage handler），
    // 引擎不认本 id、只认契约（架构硬约束）。官方 FAQ 三条口径已写入 core.ts 注释。
    id: 'gunslinger:bounty',
    name: '悬赏',
    polarity: 'negative',
    stackLimit: 1,
    persistent: true,
    spendable: false,
    onAttacked: { bonusDamage: 1, attackerGainsCp: 1 },
  },
];

const gunslingerUpgrades: readonly CardDef[] = [
  // 官方 CP = 卡面左上角印刷价（card-18..25、31 逐张读图，2026-10-14）
  { defId: 'gunslinger:duel:2', name: '决斗 II', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:duel', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:showdown:2', name: '对决 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:showdown', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:showdown:3', name: '对决 III', kind: 'upgrade', costCp: 3,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:showdown', tier: 3, count: 1, effects: [] },
  { defId: 'gunslinger:revolver:2', name: '左轮 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:revolver', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:fanTheHammer:2', name: '花式射击 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:fanTheHammer', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:bountyHunter:2', name: '赏金猎人 II', kind: 'upgrade', costCp: 1,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:bountyHunter', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:takeCover:2', name: '寻找掩护 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:takeCover', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:deadeye:2', name: '神枪手 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:deadeye', tier: 2, count: 1, effects: [] },
  { defId: 'gunslinger:quickDraw:2', name: '快速拔枪 II', kind: 'upgrade', costCp: 2,
    timing: ['main1', 'main2'], targetAbilityId: 'gunslinger:quickDraw', tier: 2, count: 1, effects: [] },
];

/** Gunslinger 专属行动卡（card-26..32，2026-10-14 逐张读图；Run And Gun! 为 PROMO） */
const gunslingerHeroCards: readonly CardDef[] = [
  // Wild West!：1 CP，Roll Phase Action，Attack Modifier。
  // 官方卡面："When you spend a Reload, you may re-roll that die one time. If you do,
  // add an additional 1 dmg to the outcome." —— 触发点在「消耗装填」这个玩家动作上，
  // 而 spend 类状态当前没有玩家动作入口（见 gunslinger:reload 注释），故暂不可行使。
  // 与 Warm Up「自由出价换 FM」同款已知偏差：登记卡（卡组完整 33 张、资产可挂图），
  // 效果不行使，log 记账。
  { defId: 'gunslinger:wildWest', name: '蛮荒西部', kind: 'rollPhase', costCp: 1,
    timing: ['thenNode'], count: 1,
    effects: [{ clause: { kind: 'log', text: '官方效果「消耗装填时可重掷那颗骰一次并 +1 伤害」依赖 spend 玩家入口，暂不行使' } }] },
  // Wanted!：2 CP，直接给对手上悬赏（1v1「chosen opponent」即唯一对手，无偏差）
  { defId: 'gunslinger:wanted', name: '通缉', kind: 'mainPhase', costCp: 2,
    timing: ['main1', 'main2'], count: 1,
    effects: [{ clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } }] },
  // Spin The Chamber!：1 CP，获得 1 层装填
  { defId: 'gunslinger:spinTheChamber', name: '转轮', kind: 'mainPhase', costCp: 1,
    timing: ['main1', 'main2'], count: 1,
    effects: [{ clause: { kind: 'inflictStatus', status: 'gunslinger:reload', stacks: 1, to: { r: 'self' } } }] },
  // Roulette!：1 CP，掷 1 骰：子弹→2 伤害；疾冲→击倒；靶心→悬赏。
  // ⚠️ 已知偏差（显式记账）：官方 "Choose a player"（可含自己），1v1 MVP 固定对手——
  // 引擎 choose 当前自动取 default（无挂起），目标选择先按主流用法收敛，入口就绪后改 choose。
  { defId: 'gunslinger:roulette', name: '俄罗斯轮盘', kind: 'mainPhase', costCp: 1,
    timing: ['main1', 'main2'], count: 1,
    effects: [{
      clause: { kind: 'rollDicePool', count: 1, cases: [
        { on: 'bullet', effects: [{ clause: { kind: 'dealDamage', amount: 2, damageType: 'attack', to: { r: 'opponent' } } }] },
        { on: 'dash', effects: [{ clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } }] },
        { on: 'bullseye', effects: [{ clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } }] },
      ] },
    }] },
  // Eat Lead!：1 CP，Roll Phase Action，Attack Modifier。
  // 官方卡面："Roll 5: Add 1 × bullet to the total dmg. If at least 4 dmg was added, inflict Knockdown."
  // perDie 每颗子弹 +1 伤害（与主攻击同桶合并）；「加入 ≥4」= 子弹数 ≥4，
  // diceSymbolAtLeast 在 tempDice 在场时按临时池求值（effects.ts evalCondition），同序列内直接可判。
  { defId: 'gunslinger:eatLead', name: '吃铅弹', kind: 'rollPhase', costCp: 1,
    timing: ['thenNode'], count: 1,
    effects: [
      { clause: { kind: 'rollDicePool', count: 5, perDie: true, cases: [
        { on: 'bullet', effects: [{ clause: { kind: 'dealDamage', amount: 1, damageType: 'attack', to: { r: 'opponent' } } }] },
      ] } },
      { clause: { kind: 'conditional', cond: { c: 'diceSymbolAtLeast', symbol: 'bullet', min: 4 },
        then: [{ clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } }] } },
    ] },
  // Run And Gun!：0 CP，PROMO（Dice Throne Comic Issue One）。
  // 官方卡面："Roll 1: On bullseye, inflict Bounty & Knockdown on a chosen opponent.
  // On any other outcome, draw 1 card." —— bullseye = 6 点。
  { defId: 'gunslinger:runAndGun', name: '且战且走（PROMO）', kind: 'mainPhase', costCp: 0,
    timing: ['main1', 'main2'], count: 1,
    effects: [
      { clause: { kind: 'rollDicePool', count: 1, bindSumTo: 'rng1' } },
      { clause: { kind: 'conditional', cond: { c: 'boundAtLeast', name: 'rng1', min: 6 },
        then: [
          { clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } },
          { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
        ],
        else: [{ clause: { kind: 'drawCards', amount: 1, to: { r: 'self' } } }] } },
    ] },
];

/** Duel/Showdown 共用的「你与对手各掷 1 骰并比较」骨架（官方 Gunslinger 招牌机制） */
function duelRolls(selfBind: string, oppBind: string): readonly EffectDef[] {
  return [
    // 对手那颗必须按对手的英雄骰面映射符号（rollDicePool.owner，2026-10-14 引擎扩展）
    { clause: { kind: 'rollDicePool', count: 1, owner: { r: 'opponent' }, bindSumTo: oppBind } },
    { clause: { kind: 'rollDicePool', count: 1, bindSumTo: selfBind } },
  ];
}

export const GUNSLINGER: HeroDef = {
  id: 'gunslinger',
  name: '神枪手',
  dieFaces: [
    // 官方值（Gunslinger 技能板原图逐面核读，2026-10-14）：1-3 BULLET，4-5 DASH，6 BULLSEYE
    { value: 1, symbols: ['bullet'] },
    { value: 2, symbols: ['bullet'] },
    { value: 3, symbols: ['bullet'] },
    { value: 4, symbols: ['dash'] },
    { value: 5, symbols: ['dash'] },
    { value: 6, symbols: ['bullseye'] },
  ],
  diceCount: 5,
  startHp: 50,
  abilities: [
    {
      // 官方 L2（card-21，2 CP）：3/4/5 子弹 → 4/5/6；4-of-a-kind（点数轴）→ 击倒。
      // L1 = 3/4/5 伤害、无击倒（boardgame.bg 面板 + namu wiki 双源一致）。
      id: 'gunslinger:revolver',
      kind: 'offensive',
      name: '左轮',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'bullet', count: 3 },
          effects: [gradedBranch('bullet', [3, 4, 5], (n) => dmgTo(n))] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'bullet', count: 3 },
          effects: [
            gradedBranch('bullet', [4, 5, 6], (n) => dmgTo(n)),
            { clause: { kind: 'conditional', cond: { c: 'nOfAKind', n: 4 },
              then: [{ clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } }] } },
          ] },
      ],
    },
    {
      // 官方 L2（card-23，1 CP）：2 子弹+2 靶心 → 悬赏 + 2 不可防御。
      // L1 = 悬赏 + 1 不可防御（boardgame.bg 面板 + namu wiki 双源一致）。
      id: 'gunslinger:bountyHunter',
      kind: 'offensive',
      name: '赏金猎人',
      tiers: [
        { level: 1, upgradeCostCP: 0,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'bullet', count: 2 }, { k: 'countSymbol', symbol: 'bullseye', count: 2 }] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 1, damageType: 'undefendable', to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 1,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'bullet', count: 2 }, { k: 'countSymbol', symbol: 'bullseye', count: 2 }] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 2, damageType: 'undefendable', to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      // 官方 L1（boardgame.bg 面板 + namu wiki 双源）：小顺 → 双方各掷 1 骰，你的点数 ≥ 对手 → 7，否则 5。
      // L2（card-19，2 CP）→ 8/6；L3（card-20，3 CP）→ 9/6（卡图逐张读图）。
      id: 'gunslinger:showdown',
      kind: 'offensive',
      name: '对决',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'smallStraight' },
          effects: [
            ...duelRolls('sdSelf', 'sdOpp'),
            { clause: { kind: 'conditional', cond: { c: 'boundCompare', a: 'sdSelf', op: '>=', b: 'sdOpp' },
              then: [dmgTo(7)], else: [dmgTo(5)] } },
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'smallStraight' },
          effects: [
            ...duelRolls('sdSelf', 'sdOpp'),
            { clause: { kind: 'conditional', cond: { c: 'boundCompare', a: 'sdSelf', op: '>=', b: 'sdOpp' },
              then: [dmgTo(8)], else: [dmgTo(6)] } },
          ] },
        { level: 3, upgradeCostCP: 3, matcher: { k: 'smallStraight' },
          effects: [
            ...duelRolls('sdSelf', 'sdOpp'),
            { clause: { kind: 'conditional', cond: { c: 'boundCompare', a: 'sdSelf', op: '>=', b: 'sdOpp' },
              then: [dmgTo(9)], else: [dmgTo(6)] } },
          ] },
      ],
    },
    {
      // 官方 L1（card-24 下方相邻格 MARK THE TARGET）：3 疾冲 → 获得 2 闪避 + 悬赏。
      // L2（card-24，2 CP）：2 子弹+3 疾冲 → 获得 1 闪避 + 6 伤害（卡图逐张读图）。
      id: 'gunslinger:takeCover',
      kind: 'offensive',
      name: '寻找掩护',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'dash', count: 3 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 2, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 2,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'bullet', count: 2 }, { k: 'countSymbol', symbol: 'dash', count: 3 }] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } },
            dmgTo(6),
          ] },
      ],
    },
    {
      // 官方 L1（card-22 下方相邻格 PISTOL WHIP）：2 疾冲+1 靶心 → 获得 1 闪避 + 击倒 + 1 不可防御。
      // L2（card-22，2 CP）：大顺 → 获得 2 闪避 + 8 伤害（卡图逐张读图）。
      id: 'gunslinger:fanTheHammer',
      kind: 'offensive',
      name: '花式射击',
      tiers: [
        { level: 1, upgradeCostCP: 0,
          matcher: { k: 'allOf', of: [{ k: 'countSymbol', symbol: 'dash', count: 2 }, { k: 'countSymbol', symbol: 'bullseye', count: 1 }] },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 1, damageType: 'undefendable', to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'largeStraight' },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 2, to: { r: 'self' } } },
            dmgTo(8),
          ] },
      ],
    },
    {
      // 官方 L1（card-25 下方相邻格 ENFORCER）：3 靶心 → 获得 1 闪避 + 对两个对手各悬赏&击倒
      // （1v1 下「两个对手」即唯一对手，两状态都给对手）。L2（card-25，2 CP）：4 靶心 → 击倒 + 8 不可防御。
      id: 'gunslinger:deadeye',
      kind: 'offensive',
      name: '神枪手',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'bullseye', count: 3 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
          ] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'countSymbol', symbol: 'bullseye', count: 4 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 8, damageType: 'undefendable', to: { r: 'opponent' } } },
          ] },
      ],
    },
    {
      // 官方 L1（boardgame.bg 面板）：防御掷骰 1；你与攻击者各掷 1 骰，你的点数 ≥ 攻击者（S1 卡面
      // "equal or greater"）→ 可选：造成 3 伤害 或 防止一半来袭伤害（向上取整）；否则造成 1 伤害。
      // L2（card-18，3 CP）效果与 L1 相同（升级价值在官方规则为「本能力升级」的一般 CP 消耗）。
      //
      // ⚠️ 已知偏差（显式记账）：官方「你 may choose to either…」是玩家二选一；
      // 引擎 choose 当前自动取 default（无挂起，choose handler 诚实注释）。default 取
      // 「防止一半来袭伤害」（防御能力的保守语义：不替玩家主动加害）。
      // 引擎为此扩展三项（2026-10-14）：boundCompare 条件 / rollDicePool.owner /
      // incomingDamage 表达式（core.ts 注释有官方卡面原文与口径说明）。
      id: 'gunslinger:duel',
      kind: 'defensive',
      name: '决斗',
      defenseDiceCount: 1,
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: true },
          effects: [
            ...duelRolls('duelSelf', 'duelOpp'),
            { clause: { kind: 'conditional', cond: { c: 'boundCompare', a: 'duelSelf', op: '>=', b: 'duelOpp' },
              then: [{
                clause: { kind: 'choose', who: 'owner', options: [
                  { id: 'duelCover', label: '防止一半来袭伤害（向上取整）', isDefault: true,
                    effects: [{ clause: { kind: 'preventDamage',
                      amount: { e: 'ceilDiv', a: { e: 'incomingDamage', target: { r: 'self' } }, b: 2 },
                      to: { r: 'self' } } }] },
                  { id: 'duelStrike', label: '对攻击者造成 3 点伤害',
                    effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'attacker' } } }] },
                ] } },
              ],
              else: [{ clause: { kind: 'dealDamage', amount: 1, damageType: 'attack', to: { r: 'attacker' } } }] } },
          ] },
        { level: 2, upgradeCostCP: 3, matcher: { k: 'const', value: true },
          effects: [
            ...duelRolls('duelSelf', 'duelOpp'),
            { clause: { kind: 'conditional', cond: { c: 'boundCompare', a: 'duelSelf', op: '>=', b: 'duelOpp' },
              then: [{
                clause: { kind: 'choose', who: 'owner', options: [
                  { id: 'duelCover', label: '防止一半来袭伤害（向上取整）', isDefault: true,
                    effects: [{ clause: { kind: 'preventDamage',
                      amount: { e: 'ceilDiv', a: { e: 'incomingDamage', target: { r: 'self' } }, b: 2 },
                      to: { r: 'self' } } }] },
                  { id: 'duelStrike', label: '对攻击者造成 3 点伤害',
                    effects: [{ clause: { kind: 'dealDamage', amount: 3, damageType: 'attack', to: { r: 'attacker' } } }] },
                ] } },
              ],
              else: [{ clause: { kind: 'dealDamage', amount: 1, damageType: 'attack', to: { r: 'attacker' } } }] } },
          ] },
      ],
    },
    {
      // 官方 L1（boardgame.bg 面板 PASSIVE）：维持阶段获得 1 装填；
      // L2（card-31，2 CP）追加「消耗装填时可重掷那颗骰一次」。
      // ⚠️ 已知偏差（显式记账）：引擎没有 passive 能力的 upkeep 钩子（StatusDef.upkeep 只覆盖
      // 状态），且 spend 类状态没有玩家动作入口（见 gunslinger:reload）——两条路径都断，
      // 故本能力登记但**完全不生效**（matcher const false 诚实渲染「永不触发」）。
      // 引擎补 passive upkeep 钩子 + spend 入口后，把 matcher 改 const true 并填 effects。
      id: 'gunslinger:quickDraw',
      kind: 'passive',
      name: '快速拔枪',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'const', value: false }, effects: [] },
        { level: 2, upgradeCostCP: 2, matcher: { k: 'const', value: false }, effects: [] },
      ],
    },
    {
      id: 'gunslinger:fillEmWithLead',
      kind: 'ultimate',
      // 官方（双源一致，2026-10-14）：Fill 'Em With Lead! —— 5 靶心（5-of-a-kind）：
      // 获得 1 闪避 → 施加悬赏与击倒 → 造成 10 点伤害。
      // 来源 ①boardgame.bg《Dice Throne S2 Battle Chest》规则书面板文本（官方排版逐字）；
      // 来源 ②繁中规则书（gokids PDF）：「獲得閃避。施加懸賞與擊倒。然後造成 10 傷害。」
      // Ultimate 伤害：不可防御且不可避免（规则书 Damage Table），引擎口径同 bloodlust。
      // 卡面尾部「若消耗一个装填可重掷那颗骰」属掷骰阶段的玩家交互（激活前改骰），
      // 不是效果的一部分——依赖 spend 入口，同 quickDraw 暂不行使。
      name: '枪林弹雨（Fill ’Em With Lead!）',
      tiers: [
        { level: 1, upgradeCostCP: 0, matcher: { k: 'countSymbol', symbol: 'bullseye', count: 5 },
          effects: [
            { clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } },
            { clause: { kind: 'inflictStatus', status: 'gunslinger:bounty', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'inflictStatus', status: 'common:knockdown', stacks: 1, to: { r: 'opponent' } } },
            { clause: { kind: 'dealDamage', amount: 10, damageType: 'undefendable', to: { r: 'opponent' }, sourceKind: 'ultimate' } },
          ] },
      ],
    },
  ],
  statuses: gunslingerStatuses,
  deck: [...COMMON_CARDS, ...gunslingerUpgrades, ...gunslingerHeroCards],
};
