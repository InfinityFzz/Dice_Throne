/**
 * 观战投影 —— 架构 ADR-002 的第三个视角（除 per-seat 之外）。
 *
 * 观战位**不是**「拿 seat0 的 PlayerView 然后前端自己把手牌糊掉」——那样 `legalActions`、
 * `remainingDeckCounts`、`self.hand` 全都已经下发到浏览器里了，糊掉只是视觉，信息已经泄漏。
 * 这里是字段层面就不生成：两个座位都用 `OpponentPlayerView`（只有手牌张数），
 * `legalActions` 恒为空数组（观战者不能操作）。
 */
import type { OpponentPlayerView, SharedView } from './view.js';

export interface SpectatorView {
  /** 观战者没有座位 */
  readonly you: null;
  readonly shared: SharedView;
  readonly players: readonly [OpponentPlayerView, OpponentPlayerView];
  /** 恒为空：观战者无任何可执行动作 */
  readonly legalActions: readonly [];
  readonly winner: 0 | 1 | 'draw' | null;
  readonly finished: boolean;
}
