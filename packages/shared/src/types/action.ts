/**
 * 玩家动作（客户端发给服务端的意图）与引擎事件（结构化战斗日志）。
 */
import type { EntityId, HeroId, Seat } from './core.js';

export type Action =
  | { t: 'selectHero'; heroId: HeroId }
  | { t: 'ready' }
  // 主要阶段
  | { t: 'playCard'; uid: EntityId }
  | { t: 'buyUpgrade'; abilityId: EntityId; tier: 1 | 2 | 3 }
  | { t: 'sellCard'; uid: EntityId }
  | { t: 'endMainPhase' }
  // 进攻掷骰
  | { t: 'performRoll' }
  | { t: 'toggleLock'; index: number }
  | { t: 'announceAbility'; abilityId: EntityId }
  | { t: 'passAbility' }
  // 防御
  | { t: 'defensiveRoll' }
  // 响应窗口
  | { t: 'respondPass' }
  // 通用选择
  | { t: 'chooseOption'; optionId: string }
  | { t: 'discardCards'; uids: readonly EntityId[] }
  | { t: 'concede' };

export interface ActionEnvelope {
  readonly seat: Seat;
  readonly action: Action;
  /** 客户端单调递增序号，用于幂等去重 */
  readonly clientSeq: number;
}

export type GameEventType =
  | 'matchStarted' | 'phaseChanged' | 'diceRolled' | 'abilityActivated'
  | 'cardPlayed' | 'upgradeBought' | 'defenseRolled' | 'damageApplied'
  | 'statusChanged' | 'pendingRequested' | 'pendingResolved'
  | 'windowOpened' | 'windowClosed' | 'matchEnded' | 'note';

export interface GameEvent {
  readonly seq: number;
  readonly type: GameEventType;
  readonly turn: number;
  readonly phase: string;
  /** visibility: public 广播所有人；seat 仅该座位可见；server 不广播（仅日志） */
  readonly visibility: { v: 'public' } | { v: 'seat'; seat: Seat } | { v: 'server' };
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RuleError {
  readonly code:
    | 'notYourTurn' | 'wrongPhase' | 'illegalAction' | 'notEnoughCp'
    | 'cardNotFound' | 'abilityNotAvailable' | 'noPending' | 'pendingMismatch'
    | 'heroLocked' | 'matchFinished' | 'permissionDenied' | 'internal';
  readonly message: string;
}

export type ReduceResult =
  | { ok: true; state: GameState; events: readonly GameEvent[] }
  | { ok: false; error: RuleError; events: readonly [] };

// 前向声明避免循环 import
import type { GameState } from './state.js';
