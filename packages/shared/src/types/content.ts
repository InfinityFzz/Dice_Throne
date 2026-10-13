/**
 * 内容数据模型（作者层 DSL）。新增英雄 = 新增一个 HeroDef，零引擎改动。
 * 硬验收标准：引擎不得对任何具体 HeroId 做特判。
 */
import type { DieFace, DiceMatcher, EffectDef, EntityId, HeroId, StatusId, CardId, Phase } from './core.js';

export type AbilityKind = 'offensive' | 'defensive' | 'passive' | 'ultimate';

/** matcher 挂在 tier 上（不是 slot 上），因此升级卡改变激活条件是天然支持的。 */
export interface AbilityTier {
  readonly level: 1 | 2 | 3;
  /** 从 L1 升到本级的**累计总价**（不是差价）。已升到 2 级再升 3 级只付差额。 */
  readonly upgradeCostCP: number;
  readonly matcher: DiceMatcher;
  readonly effects: readonly EffectDef[];
  readonly name?: string;
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
