/**
 * per-seat 投影。客户端**只**拿到这个类型——
 * 字段层面不存在 rng / deck 顺序 / bucket 内部明细，因此客户端代码写不出读取它们的代码。
 * 这是 fail-safe 白名单，不是深拷贝后 delete。
 */
import type { CardId, EntityId, HeroId, LadderStep, PendingKind, Phase, Seat, StatusId } from './core.js';

export interface CardView {
  readonly uid: EntityId;
  readonly defId: CardId;
  readonly name: string;
  readonly kind: 'upgrade' | 'mainPhase' | 'rollPhase' | 'instant';
  readonly costCp: number;
  readonly timing: readonly string[];
  readonly targetAbilityId?: EntityId;
  readonly tier?: 1 | 2 | 3;
}

export interface AbilityView {
  readonly id: EntityId;
  readonly kind: 'offensive' | 'defensive' | 'passive' | 'ultimate';
  readonly name: string;
  readonly tier: number;
  readonly defenseDiceCount?: number;
}

export interface SelfPlayerView {
  readonly seat: Seat;
  readonly heroId: HeroId;
  readonly hp: number;
  readonly cp: number;
  readonly hand: readonly CardView[];
  readonly deckCount: number;
  readonly discard: readonly CardView[];
  readonly statuses: readonly { id: StatusId; stacks: number }[];
  readonly abilities: readonly AbilityView[];
  /** 自己牌库的剩余构成（多重集，顺序未知） */
  readonly remainingDeckCounts: readonly { defId: CardId; count: number }[];
}

export interface OpponentPlayerView {
  readonly seat: Seat;
  readonly heroId: HeroId;
  readonly hp: number;
  readonly cp: number;
  /** 手牌只见张数 */
  readonly handCount: number;
  readonly deckCount: number;
  readonly discard: readonly CardView[];
  readonly statuses: readonly { id: StatusId; stacks: number }[];
  readonly abilities: readonly AbilityView[];
  readonly isThinking: boolean;
}

export interface SharedView {
  readonly turn: number;
  readonly phase: Phase;
  readonly ladderStep: LadderStep | null;
  readonly activeSeat: Seat;
  /** 骰值公开 */
  readonly diceValues: readonly number[];
  readonly diceLocked: readonly boolean[];
  readonly rollAttemptsLeft: number;
  /** 可选能力（含高亮用骰子下标） */
  readonly candidates: readonly { abilityId: EntityId; matchedIndices: readonly number[]; tier?: number }[];
  readonly pendingKind: PendingKind | null;
  readonly pendingOptions: readonly { id: string; label: string }[];
}

export interface PlayerView {
  readonly you: Seat;
  readonly self: SelfPlayerView;
  readonly opponent: OpponentPlayerView;
  readonly shared: SharedView;
  readonly winner: Seat | 'draw' | null;
  readonly finished: boolean;
}
