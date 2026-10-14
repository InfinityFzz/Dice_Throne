/**
 * 内容数据模型（作者层 DSL）。新增英雄 = 新增一个 HeroDef，零引擎改动。
 * 硬验收标准：引擎不得对任何具体 HeroId 做特判。
 */
import type { Condition, DieFace, DiceMatcher, EffectDef, EntityId, Expr, HeroId, StatusId, CardId, Phase } from './core.js';

export type AbilityKind = 'offensive' | 'defensive' | 'passive' | 'ultimate';

/** matcher 挂在 tier 上（不是 slot 上），因此升级卡改变激活条件是天然支持的。 */
export interface AbilityTier {
  readonly level: 1 | 2 | 3;
  /** 从 L1 升到本级的**累计总价**（不是差价）。已升到 2 级再升 3 级只付差额。 */
  readonly upgradeCostCP: number;
  readonly matcher: DiceMatcher;
  readonly effects: readonly EffectDef[];
  readonly name?: string;
  /**
   * 防御掷骰骰数（仅防御能力；官方 Shadow Thief 暗影防御 L1=4 / L2=5）。
   * 缺省回落到 AbilitySlot.defenseDiceCount。
   */
  readonly defenseDiceCount?: number;
}

export interface AbilitySlotDef {
  readonly id: EntityId;
  readonly kind: AbilityKind;
  readonly name: string;
  /** 防御能力掷几颗骰（仅 kind==='defensive' 需要） */
  readonly defenseDiceCount?: number;
  readonly tiers: readonly AbilityTier[];
}

export interface StatusDef {
  readonly id: StatusId;
  readonly name: string;
  readonly polarity: 'positive' | 'negative';
  readonly stackLimit: number;
  readonly persistent: boolean;
  readonly spendable: boolean;
  readonly spendEffect?: readonly EffectDef[];
  readonly upkeep?: {
    readonly order: 'damage' | 'decay';
    readonly effects: readonly EffectDef[];
  };
  /**
   * 持有者被 **attack 类型**伤害瞄准时的通用挂钩（官方 Gunslinger Bounty）：
   * 攻击者对该目标的伤害入桶时追加 bonusDamage（同目标、同 attack 类型），并获得 attackerGainsCp 点 CP。
   * 官方 FAQ 口径：①对手防御中 prevent/avoid 多少都不影响加成与 CP（入桶即触发，与结算结果无关）；
   * ②不因防御方的伤害（pure 反伤）触发——damageType!=='attack' 天然不命中；
   * ③主伤害 amount 为 0 时不触发（「必须激活造成至少 1 点伤害的攻击」——入桶时点无法预知
   *   后续修正，按主伤害 > 0 近似，已知近似记账）。
   * 引擎只认本契约、不认任何具体状态 id（架构硬约束：不得对具体英雄/内容 id 特判）。
   *
   * `avoid: true`（官方 Shadow Thief Shadows 类）：持有者被普通攻击瞄准时**全部避开**
   * defendable 伤害（bucket avoid 只清 defendable+collateral，天然不作用于 undefendable/pure，
   * 与官方「不防 Ultimate、不防非进攻掷骰阶段伤害」细则吻合——Ultimate 经 sourceKind:'ultimate'
   * 豁免）。与 bonusDamage/attackerGainsCp 可共存（官方：攻击仍「成功」、其他效果照常发生）。
   */
  readonly onAttacked?: {
    readonly bonusDamage?: Expr;
    readonly attackerGainsCp?: Expr;
    readonly avoid?: true;
  };
  /**
   * 官方 Shadows 类弃置时序：持有者**从回合开始就带着**该状态并完整结束一个自己回合后弃置。
   * 引擎实现：inflictStatus 首次施加时盖 `sinceTurn` 章，endTurn 时若 sinceTurn < 当前 turn
   * 则弃置（本回合内获得的不算——官方「a turn in which you started with the same token」）。
   */
  readonly discardAtTurnEnd?: boolean;
}

export type CardKind = 'upgrade' | 'mainPhase' | 'rollPhase' | 'instant';

/** 可打时机——对应架构 §3.4 PlayTiming */
export type PlayTiming = 'main1' | 'main2' | 'thenNode' | 'preDefense' | 'postDefense';

export interface CardDef {
  readonly defId: CardId;
  readonly name: string;
  readonly kind: CardKind;
  readonly costCp: number;
  readonly timing: readonly PlayTiming[];
  /** upgrade 专用：指向要升级的能力槽与本卡对应的 tier */
  readonly targetAbilityId?: EntityId;
  readonly tier?: 1 | 2 | 3;
  readonly effects: readonly EffectDef[];
  /**
   * 打出门槛（官方 Head Bash! 语义：「若已对对手造成 ≥8 伤害，play this card to …」）。
   * 不满足时整卡不可打出（reduce 拒绝 + legalActions 灰显），不消耗卡、不进入结算。
   * 以打出者视角求值（damageDealtAtLeast 读打出者自己的统计）。
   */
  readonly playIf?: Condition;
  /** 牌组中数量 */
  readonly count: number;
}

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  /** 每颗骰的面（所有骰共用同一套面） */
  readonly dieFaces: readonly DieFace[];
  readonly diceCount: number;
  readonly startHp: number;
  readonly abilities: readonly AbilitySlotDef[];
  readonly statuses: readonly StatusDef[];
  readonly deck: readonly CardDef[];
}

/** 跳过哪些阶段的能力（如 skipPhase 用到的合法集合） */
export const SKIPPABLE_PHASES: readonly Phase[] = ['main1', 'main2', 'offensiveRoll', 'discard'];
