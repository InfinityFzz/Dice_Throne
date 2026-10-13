/**
 * 对局状态。服务端持有全量 GameState；客户端只拿 PlayerView（见 view.ts）。
 */
import type {
  BucketKind, DamageSourceKind, DamageType, EntityId, HeroId, LadderStep,
  PendingKind, Phase, Seat, StatusId, CardId, WindowTrigger,
} from './core.js';

export interface RngState {
  readonly seed: string;
  /** 命名流各自独立的计数器：setup / shuffle:0 / dice:0 / misc ... */
  readonly counters: Readonly<Record<string, number>>;
}

export interface StatusInstance {
  readonly id: StatusId;
  readonly stacks: number;
}

export interface CardInstance {
  readonly uid: EntityId;
  readonly defId: CardId;
}

export interface BucketEntry {
  readonly bucketKind: BucketKind;
  readonly amount: number;
  readonly damageType?: DamageType;
  readonly sourceKind?: DamageSourceKind;
  readonly toSeat: Seat;
  readonly fromSeat: Seat;
}

export interface DamageBucket {
  readonly entries: readonly BucketEntry[];
  readonly heals: readonly { toSeat: Seat; amount: number }[];
  readonly avoid: readonly { toSeat: Seat }[];
}

/** 权限令牌：Ultimate / Stun 剥夺对手行动权 */
export interface PermissionToken {
  readonly id: EntityId;
  readonly seat: Seat;
  readonly reason: 'ultimate' | 'stun' | 'system';
  readonly releaseAt: 'cleanup' | 'turnEnd';
}

export interface ResponseWindow {
  readonly id: EntityId;
  readonly trigger: WindowTrigger;
  readonly openedAtStep: LadderStep;
  readonly eligibleSeats: readonly Seat[];
  readonly order: readonly Seat[];
  readonly cursor: number;
  /** ≥2 关闭 */
  readonly passStreak: number;
  /** 硬上限，超限强制关闭 */
  readonly actionCount: number;
}

export interface WindowStack {
  readonly stack: readonly ResponseWindow[];
  readonly nextSeq: number;
}

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly isDefault?: boolean;
}

export interface PendingRequest {
  readonly id: EntityId;
  readonly seat: Seat;
  readonly kind: PendingKind;
  readonly options: readonly ChoiceOption[];
  /** 回合制：恒为 null（用户拍板 Q12 取消限时）。仅竞技模式启用。 */
  readonly deadlineAt: number | null;
  /** 异常兜底选项（进程重启恢复 / 缺席判负 / 投降时推进状态机用）。必填。 */
  readonly autoResolve: string;
}

export interface PlayerState {
  readonly seat: Seat;
  readonly heroId: HeroId;
  readonly hp: number;
  readonly startHp: number;
  readonly cp: number;
  readonly hand: readonly CardInstance[];
  readonly deck: readonly CardInstance[];
  readonly discard: readonly CardInstance[];
  /** 已购买的升级：abilityId -> 当前 tier */
  readonly upgrades: Readonly<Record<EntityId, number>>;
  readonly statuses: readonly StatusInstance[];
  /** 本回合剩余掷骰次数 */
  readonly rollAttemptsLeft: number;
  readonly diceValues: readonly number[];
  readonly diceLocked: readonly boolean[];
  /** 本次结算是否已用过防御掷骰（不变量：一次 Roll Phase 内 ≤ 1） */
  readonly defenseUsed: boolean;
  readonly permissionTokens: readonly PermissionToken[];
  /** 本回合造成的伤害（按 turnIndex 重置） */
  readonly turnDamageDealt: number;
  readonly turnIndexAtLastReset: number;
}

export interface GameState {
  readonly rng: RngState;
  readonly turn: number;
  readonly phase: Phase;
  readonly ladderStep: LadderStep | null;
  readonly activeSeat: Seat;
  readonly startSeat: Seat;
  readonly players: readonly [PlayerState, PlayerState];
  readonly pending: PendingRequest | null;
  readonly bucket: DamageBucket;
  readonly windows: WindowStack;
  /** 临时骰池（rollDicePool 用） */
  readonly tempDice: readonly number[];
  /** 变量绑定（bind / bindRemovedTo） */
  readonly bindings: Readonly<Record<string, number>>;
  /** 本回合是否已获得额外进攻阶段（Stun 抢回合，防无限） */
  readonly extraRollPhaseUsed: boolean;
  readonly seq: number;
  readonly winner: Seat | 'draw' | null;
  readonly finished: boolean;
}

export const EMPTY_BUCKET: DamageBucket = Object.freeze({ entries: [], heals: [], avoid: [] });
export const EMPTY_WINDOWS: WindowStack = Object.freeze({ stack: [], nextSeq: 0 });
