/**
 * MatchActor —— 一个房间的**唯一写入者**（架构 §1.3「必须在 M1 落地」）。
 *
 * 为什么需要它，而不是像 M1 那样在 socket 回调里直接 `reduce`：
 *
 * 1. **串行化**：Node 单线程确实让 `reduce` 本身不会交错，但只要管线里出现任何 await
 *    （持久化、未来加的 AI / 超时 / 数据库），两个 socket 回调就会交替推进状态，
 *    出现「后发先至」和丢失更新。这里用一条 Promise 链把**所有**状态推进排成一队：
 *    谁先进队谁先写，队内绝无第二个写入者。
 * 2. **幂等**：客户端重发（网络重试、双击、断线重连后补发）不能把同一个动作结算两次。
 *    按 `seat + clientSeq` 去重：命中缓存就返回上次的结果，**不再 reduce**。
 *    `clientSeq` 倒退（过期重发）视为 stale 直接拒绝，不会污染状态。
 * 3. **持久化在队内**：写盘发生在「状态已确定」之后，且顺序与状态推进顺序严格一致。
 *
 * 对外只有一个入口 `apply()`，永远是异步的 —— 调用方无法绕过队列直接摸 state。
 */
import type { HeroId, Seat } from '../../shared/src/types/core.js';
import type { Action, GameEvent, RuleError } from '../../shared/src/types/action.js';
import type { GameState } from '../../shared/src/types/state.js';
import type { ContentRegistry } from '../../shared/src/content/registry.js';
import { createMatch, reduce, shouldSnapshot, replayLog } from '../../shared/src/index.js';
import type { MatchLog } from './matchLog.js';

export interface ApplyResult {
  readonly ok: boolean;
  /** 命中幂等缓存（重复提交），本次没有真的推进状态 */
  readonly duplicate: boolean;
  readonly error?: RuleError;
  readonly events: readonly GameEvent[];
  readonly state: GameState;
}

export interface ActorOptions {
  readonly roomId: string;
  readonly content: ContentRegistry;
  readonly seed: string;
  readonly heroes: readonly [HeroId, HeroId];
  readonly log: MatchLog;
  /** 每 N 个动作写一条快照；0 = 只在建局时写 */
  readonly snapshotEvery?: number;
}

const DEFAULT_SNAPSHOT_EVERY = 25;
/** 幂等缓存上限：只可能重发最近几个动作，保留太多没有意义 */
const IDEMPOTENCY_CACHE_MAX = 128;

export class MatchActor {
  private state: GameState;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly lastClientSeq: [number, number] = [-1, -1];
  private readonly cache = new Map<string, ApplyResult>();
  private sinceSnapshot = 0;
  private readonly snapshotEvery: number;

  private constructor(private readonly opts: ActorOptions, state: GameState) {
    this.state = state;
    this.snapshotEvery = opts.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY;
  }

  /** 新建一局：写 meta + 初始快照 */
  static async create(opts: ActorOptions): Promise<MatchActor> {
    const state = createMatch(opts.content, { seed: opts.seed, heroes: opts.heroes });
    await opts.log.append({
      k: 'meta', roomId: opts.roomId, seed: opts.seed,
      heroes: opts.heroes, createdAt: Date.now(),
    });
    await opts.log.append({ k: 'snapshot', seq: state.seq, state });
    await opts.log.flush();
    return new MatchActor(opts, state);
  }

  /** 从已有日志恢复（进程重启） */
  static async recover(opts: ActorOptions): Promise<MatchActor> {
    const { state } = replayLog(opts.log.snapshot, opts.content);
    return new MatchActor(opts, state);
  }

  getState(): GameState {
    return this.state;
  }

  get finished(): boolean {
    return this.state.finished;
  }

  /**
   * 提交一个动作。永远走队列，永远返回最新 state（调用方用它重新投影）。
   */
  apply(seat: Seat, action: Action, clientSeq: number): Promise<ApplyResult> {
    return this.enqueue(async () => {
      const key = `${seat}:${clientSeq}`;

      // ① 幂等：完全相同的重发 → 返回上次结果，不再推进
      const cached = this.cache.get(key);
      if (cached) {
        return { ...cached, duplicate: true, state: this.state };
      }
      // ② 过期：序号小于等于已处理的最大序号（乱序到达 / 重放旧包）
      if (clientSeq <= this.lastClientSeq[seat]) {
        return {
          ok: false,
          duplicate: true,
          error: { code: 'illegalAction', message: `动作序号 ${clientSeq} 已过期（已处理到 ${this.lastClientSeq[seat]}）` },
          events: [],
          state: this.state,
        };
      }

      const r = reduce(this.state, { seat, action, clientSeq }, this.opts.content);
      if (!r.ok) {
        return { ok: false, duplicate: false, error: r.error, events: [], state: this.state };
      }

      this.state = r.state;
      this.lastClientSeq[seat] = clientSeq;

      const result: ApplyResult = { ok: true, duplicate: false, events: r.events, state: r.state };
      this.remember(key, result);

      // ③ 持久化在队内：顺序与状态推进一致
      await this.opts.log.append({
        k: 'act', seq: r.state.seq, seat, clientSeq, action, ts: Date.now(),
      });
      this.sinceSnapshot++;
      if (shouldSnapshot(this.sinceSnapshot, this.snapshotEvery)) {
        await this.opts.log.append({ k: 'snapshot', seq: r.state.seq, state: r.state });
        this.sinceSnapshot = 0;
      }
      if (r.state.finished) await this.opts.log.flush();

      return result;
    });
  }

  /** 队内刷盘（关服 / 对局结束前调用） */
  flush(): Promise<void> {
    return this.enqueue(() => this.opts.log.flush());
  }

  private remember(key: string, result: ApplyResult): void {
    this.cache.set(key, result);
    while (this.cache.size > IDEMPOTENCY_CACHE_MAX) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  /**
   * Promise 链串行队列：`then(fn, fn)` 保证**无论前一个任务是成功还是失败**，
   * 后一个都会执行 —— 一个动作被拒不会影响队列继续消费。
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.then(() => undefined, () => undefined);
    return p;
  }
}
