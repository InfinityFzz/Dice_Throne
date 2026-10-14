/**
 * 联机协议（客户端 ⇄ 服务端）的共享类型。
 *
 * 为什么要单独一个文件：协议是**双方契约**，只有把它放进 shared，
 * 服务端与前端才可能在同一份类型上对齐 —— 否则迟早出现「服务端改名了前端没跟」的运行时 undefined。
 *
 * 约定：
 * - 所有 emit 的 ack 都返回带 `ok` 的判别联合，客户端不靠猜。
 * - `ActionAck` / `JoinAck` **总是带回最新 view**：这样即使客户端漏收一次广播
 *   （断线、事件乱序、重连），下一次 ack 也能把它拉回最新状态，无需额外的 resync 接口。
 */
import type { HeroId, Seat } from './core.js';
import type { Action, GameEvent, RuleError } from './action.js';
import type { PlayerView } from './view.js';
import type { SpectatorView } from './spectator.js';

/** 客户端能拿到的视图：有座位 = PlayerView，观战 = SpectatorView */
export type AnyView = PlayerView | SpectatorView;

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface SeatInfo {
  readonly seat: Seat;
  /** 未选英雄时为 null */
  readonly heroId: HeroId | null;
  readonly ready: boolean;
  /** 该座位当前是否有连接（断线中为 false，但座位仍被保留） */
  readonly connected: boolean;
  readonly name: string;
}

export interface RoomView {
  readonly roomId: string;
  readonly phase: RoomPhase;
  readonly seats: readonly [SeatInfo, SeatInfo];
  readonly spectatorCount: number;
  /** 对局已开始时才有值 */
  readonly startedAt: number | null;
}

// ── 客户端 → 服务端 ───────────────────────────────────

export interface JoinRequest {
  readonly roomId: string;
  readonly name?: string;
}

export interface RejoinRequest {
  readonly roomId: string;
  readonly seat: Seat;
  /** 首次加入时服务端下发的重连令牌；存 sessionStorage，刷新页面后凭它回到原座位 */
  readonly token: string;
}

export interface ActionRequest {
  readonly action: Action;
  /** 客户端**每座位单调递增**的序号（不是 state.seq）。用于幂等去重。 */
  readonly clientSeq: number;
}

// ── 服务端 → 客户端（ack）─────────────────────────────

export type JoinFailure = {
  readonly ok: false;
  readonly code: 'roomFull' | 'badToken' | 'seatTaken' | 'badHero' | 'notInRoom' | 'internal';
  readonly message: string;
};

export type JoinAck =
  | {
      readonly ok: true;
      /** null = 观战位（两个座位都已被占） */
      readonly seat: Seat | null;
      /** 观战位没有令牌（无需重连校验） */
      readonly token: string | null;
      readonly room: RoomView;
      readonly view: AnyView | null;
    }
  | JoinFailure;

export type ActionAck =
  | { readonly ok: true; readonly view: AnyView; readonly duplicate: boolean }
  | {
      readonly ok: false;
      readonly code: RuleError['code'];
      readonly message: string;
      /** 被拒也回带最新 view，客户端不会停留在旧状态 */
      readonly view: AnyView;
    };

export interface RoomAck {
  readonly ok: boolean;
  readonly room: RoomView;
  readonly message?: string;
}

/**
 * 每次状态推进的广播包。
 * `events` 已按 `visibility` 过滤：public 所有人可见，seat 仅该座位可见，server 不下发。
 */
export interface UpdatePacket {
  readonly view: AnyView;
  readonly events: readonly GameEvent[];
  readonly room: RoomView;
}
