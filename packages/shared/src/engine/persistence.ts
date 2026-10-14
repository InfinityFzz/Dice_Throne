/**
 * 对局持久化 / 回放 —— 架构 §1.3「持久化」。
 *
 * 设计：**纯 append-only 日志 + 周期快照**，从不改写已写下的行。
 *
 * - `meta`：建局参数（seed / 双方英雄）。
 * - `room`：房间元信息（阶段、选人、准备状态、重连令牌）。**取最后一条**
 *   （每次房间状态变化追加一行，不做原地覆盖——覆盖写在某些受限文件系统上会失败）。
 * - `snapshot`：某一 seq 的完整 GameState（JSON）。
 * - `act`：一次被接受的玩家动作。
 *
 * 恢复 = 取最后一条 snapshot → 按序 replay 其后的 `act`。
 *
 * 因为引擎是**纯函数 + 种子化 RNG**（`reduce` 不读时钟、不读随机源），
 * 同一份 (snapshot, 动作序列) 必然重放出同一个 state —— 这是 B2 的正确性根基，
 * 也是 `persistence.test.ts` 里那条「离线回放 ≡ 在线推进」断言成立的原因。
 *
 * 之所以把这份纯逻辑放在 shared 而不是 server：可脱离文件系统单测，
 * 且未来换存储（SQLite / Redis）时重建语义不用重写。
 */
import type { HeroId, Seat } from '../types/core.js';
import type { Action } from '../types/action.js';
import type { GameState } from '../types/state.js';
import type { RoomPhase } from '../types/net.js';
import type { ContentRegistry } from '../content/registry.js';
import { createMatch, reduce } from './engine.js';

/**
 * 房间元信息日志行。**每次变化追加一行，读取时取最后一条** ——
 * 不做原地覆盖：覆盖写（writeFile）在受限/只读挂载的文件系统上会失败，
 * 而 append-only 也因此天然可恢复（最后一行写坏了，前面的仍然可用）。
 */
export interface RoomMetaEntry {
  readonly roomId: string;
  readonly phase: RoomPhase;
  readonly seed: string;
  readonly names: readonly [string, string];
  readonly picks: readonly [HeroId | null, HeroId | null];
  readonly ready: readonly [boolean, boolean];
  readonly tokens: readonly [string | null, string | null];
  readonly startedAt: number | null;
}

export type LogEntry =
  | {
      readonly k: 'meta';
      readonly roomId: string;
      readonly seed: string;
      readonly heroes: readonly [HeroId, HeroId];
      readonly createdAt: number;
    }
  | ({ readonly k: 'room'; readonly ts: number } & RoomMetaEntry)
  | { readonly k: 'snapshot'; readonly seq: number; readonly state: unknown }
  | {
      readonly k: 'act';
      readonly seq: number;
      readonly seat: Seat;
      readonly clientSeq: number;
      readonly action: Action;
      readonly ts: number;
    };

export interface LogMeta {
  readonly roomId: string;
  readonly seed: string;
  readonly heroes: readonly [HeroId, HeroId];
  readonly createdAt: number;
}

export function isLogEntry(x: unknown): x is LogEntry {
  if (typeof x !== 'object' || x === null) return false;
  const k = (x as { k?: unknown }).k;
  return k === 'meta' || k === 'room' || k === 'snapshot' || k === 'act';
}

/** 取最后一条房间元信息行（没有则 null） */
export function lastRoomMeta(entries: readonly LogEntry[]): RoomMetaEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.k === 'room') {
      const { k: _k, ts: _ts, ...meta } = e;
      return meta;
    }
  }
  return null;
}

export function parseLog(text: string): readonly LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    let v: unknown;
    try {
      v = JSON.parse(t);
    } catch {
      // 半行（进程被 kill 时可能只写了一半）——丢弃，前面的日志仍然可用
      continue;
    }
    if (isLogEntry(v)) out.push(v);
  }
  return out;
}

/** GameState 是纯 JSON 结构（无 Map / 无 undefined / 无函数），可直接往返。 */
export function hydrateState(raw: unknown): GameState {
  return JSON.parse(JSON.stringify(raw)) as GameState;
}

export interface ReplayResult {
  readonly meta: LogMeta;
  readonly state: GameState;
  /** 被重放的动作数（不含快照之前的） */
  readonly replayed: number;
}

/**
 * 从日志重建对局。找不到 meta 或没有任何 snapshot/act 时抛错——
 * 宁可启动失败也不要拿一个「看起来能跑但其实是新局」的状态糊过去。
 */
export function replayLog(entries: readonly LogEntry[], content: ContentRegistry): ReplayResult {
  const metaEntry = entries.find((e): e is Extract<LogEntry, { k: 'meta' }> => e.k === 'meta');
  if (!metaEntry) throw new Error('replay: 日志缺少 meta 行');

  const meta: LogMeta = {
    roomId: metaEntry.roomId,
    seed: metaEntry.seed,
    heroes: metaEntry.heroes,
    createdAt: metaEntry.createdAt,
  };

  let startIdx = -1;
  let state = createMatch(content, { seed: meta.seed, heroes: meta.heroes });
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e?.k === 'snapshot') {
      startIdx = i;
      state = hydrateState(e.state);
    }
  }

  let replayed = 0;
  for (let i = startIdx + 1; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.k !== 'act') continue;
    const r = reduce(state, { seat: e.seat, action: e.action, clientSeq: e.clientSeq }, content);
    if (!r.ok) {
      throw new Error(
        `replay: 第 ${i} 行动作重放被拒（${r.error.code}: ${r.error.message}）—— 日志与内容层不一致`,
      );
    }
    state = r.state;
    replayed++;
  }
  return { meta, state, replayed };
}

/**
 * 决定何时写快照：每 `every` 个动作一条，把回放长度压在 O(every)。
 * 返回 true 时调用方应在**追加该动作之后**再写一条 snapshot。
 */
export function shouldSnapshot(actionsSinceSnapshot: number, every: number): boolean {
  return every > 0 && actionsSinceSnapshot >= every;
}
