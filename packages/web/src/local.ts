/**
 * 本地热座模式 —— 浏览器内直接跑引擎（权威端就是本标签页）。
 *
 * 为什么允许前端 import 引擎：联机时客户端只拿 PlayerView（服务端权威，见 ADR-002）；
 * 本地热座是**单机模式**，本标签页本身就是权威端，没有对手可防，因此不违反信息隐藏。
 * 投影仍然走 projectState()，UI 代码与联机模式完全同构 —— 切换模式不改一行业务逻辑。
 */
import { useCallback, useMemo, useState } from 'react';
import {
  createDefaultRegistry, createMatch, reduce, projectState,
  type Action, type GameState, type PlayerView, type Seat,
  type GameEvent, type ContentRegistry,
} from '@dt/shared';

const content: ContentRegistry = createDefaultRegistry();

export interface LocalMatch {
  readonly state: GameState;
  readonly view: PlayerView;
  /** 'auto' = 跟随当前行动方；也可锁定某一座位看 */
  readonly viewer: Seat | 'auto';
  readonly events: readonly GameEvent[];
  readonly lastError: string | null;
  dispatch(action: Action): void;
  setViewer(v: Seat | 'auto'): void;
  reset(seed?: string): void;
}

export function useLocalMatch(initialSeed = 'local-1'): LocalMatch {
  const [state, setState] = useState<GameState>(() =>
    createMatch(content, { seed: initialSeed, heroes: ['barbarian', 'pyromancer'] }));
  const [viewer, setViewer] = useState<Seat | 'auto'>('auto');
  const [events, setEvents] = useState<readonly GameEvent[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const seat: Seat = viewer === 'auto' ? (state.pending?.seat ?? state.activeSeat) : viewer;

  const dispatch = useCallback((action: Action) => {
    setState((s) => {
      const actor = s.pending?.seat ?? s.activeSeat;
      const r = reduce(s, { seat: actor, action, clientSeq: s.seq }, content);
      if (!r.ok) {
        setLastError(`${r.error.code}: ${r.error.message}`);
        return s;
      }
      setLastError(null);
      setEvents((ev) => [...ev, ...r.events].slice(-200));
      return r.state;
    });
  }, []);

  const reset = useCallback((seed?: string) => {
    setState(createMatch(content, { seed: seed ?? `local-${Date.now()}`, heroes: ['barbarian', 'pyromancer'] }));
    setEvents([]);
    setLastError(null);
  }, []);

  const view = useMemo(() => projectState(state, content, seat), [state, seat]);

  return { state, view, viewer, events, lastError, dispatch, setViewer, reset };
}

/** 事件 → 一行中文日志（本地模式的战斗记录） */
export function describeEvent(e: GameEvent): string | null {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'matchStarted': return '对局开始';
    case 'phaseChanged': return `阶段 → ${String(p.phase)}`;
    case 'diceRolled': return `seat${p.seat} 掷骰 [${(p.values as number[]).join(', ')}]`;
    case 'cardPlayed': return `seat${p.seat} 打出 ${String(p.name)}`;
    case 'upgradeBought': return `seat${p.seat} 升级 ${String(p.abilityId)} → L${String(p.tier)}（${String(p.cost)} CP）`;
    case 'defenseRolled': return `seat${p.seat} 防御掷骰 [${(p.values as number[]).join(', ')}]`;
    case 'damageApplied':
      return `seat${p.seat} ${Number(p.net) >= 0 ? '受到' : '治疗'}${Math.abs(Number(p.net))} → HP ${String(p.hpAfter)}${p.recoil ? '（反噬）' : ''}`;
    case 'statusChanged': return `seat${p.seat} 状态 ${String(p.statusId)} ${Number(p.delta) > 0 ? '+' : ''}${String(p.delta)}`;
    case 'matchEnded': return `对局结束：${p.winner === 'draw' ? '平局' : `seat${p.winner} 胜`}`;
    case 'note':
      return p.kind === 'income' ? `seat${p.seat} 收入 +1 CP`
        : p.kind === 'abilityPassed' ? `seat${p.seat} 放弃激活`
          : p.kind === 'autoDiscard' ? `seat${p.seat} 超上限自动弃牌`
            : null;
    default: return null;
  }
}
