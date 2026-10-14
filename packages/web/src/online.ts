/**
 * 联机客户端 —— 与本地热座（`local.ts`）对等的 hook，但权威端在服务端。
 *
 * 关键设计：
 * 1. **重连令牌落 sessionStorage**：刷新页面后自动 `room:rejoin`，回到同一个座位继续打。
 *    令牌按房间号分别存，换房间互不干扰。
 * 2. **断线自动重连**：socket.io 自带重连；重连成功后用令牌 rejoin，而不是重新 join
 *    （重新 join 会被判为第三个连接 → 观战位）。
 * 3. **客户端 seq 单调**：`clientSeq` 是幂等的依据，必须**按座位**单调递增且跨重连保持，
 *    因此它存在 ref 里而不是组件 state 里（重渲染不能让它回退）。
 * 4. 视图永远以服务端下发的为准（广播 `update` 或任意 ack 回带的 view）；前端不本地推演。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  toAction, type Action, type AnyView, type LegalActionView, type PlayerView,
  type GameEvent, type Seat, type JoinAck, type RoomView, type RoomAck,
  type ActionAck, type UpdatePacket, type HeroId,
} from '@dt/shared';

const SERVER = import.meta.env.VITE_SERVER ?? 'http://localhost:3001';

const tokenKey = (roomId: string): string => `dt:token:${roomId}`;
const seatKey = (roomId: string): string => `dt:seat:${roomId}`;

export interface OnlineMatch {
  readonly roomId: string;
  readonly room: RoomView | null;
  readonly view: AnyView | null;
  readonly seat: Seat | null;
  readonly status: 'idle' | 'connecting' | 'joining' | 'inRoom' | 'error';
  readonly error: string | null;
  readonly log: readonly string[];
  readonly online: boolean;
  /** 服务端广播过来的（已按可见性过滤的）战斗事件 */
  readonly events: readonly GameEvent[];
  join(roomId: string, name?: string): void;
  leave(): void;
  pickHero(heroId: HeroId): void;
  setReady(ready: boolean): void;
  send(action: Action): void;
  /** 测试/调试用：同一 clientSeq 重发，验证幂等 */
  resendLast(): void;
}

export function useOnlineMatch(): OnlineMatch {
  const [roomId, setRoomId] = useState<string>('');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [view, setView] = useState<AnyView | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [status, setStatus] = useState<OnlineMatch['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<readonly string[]>([]);
  const [online, setOnline] = useState(false);
  const [events, setEvents] = useState<readonly GameEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);
  /** 按座位单调递增的动作序号（幂等依据），跨重连保持 */
  const seqRef = useRef<number>(0);
  const lastActionRef = useRef<Action | null>(null);
  const roomIdRef = useRef<string>('');
  const seatRef = useRef<Seat | null>(null);

  const addLog = useCallback((line: string) => {
    setLog((l) => [...l.slice(-120), line]);
  }, []);

  // ── 建立连接（只建一次）──────────────────────────────
  useEffect(() => {
    const s = io(SERVER, { transports: ['websocket'] });
    socketRef.current = s;

    s.on('connect', () => {
      setOnline(true);
      // 断线重连成功后：若有本地令牌，凭它回到原座位，而不是重新 join
      const rid = roomIdRef.current;
      if (!rid) return;
      const token = sessionStorage.getItem(tokenKey(rid));
      const savedSeat = sessionStorage.getItem(seatKey(rid));
      if (token && (savedSeat === '0' || savedSeat === '1')) {
        const seatNum = Number(savedSeat) as Seat;
        s.emit('room:rejoin', { roomId: rid, seat: seatNum, token }, (r: JoinAck) => {
          if (!r.ok) { setError(`重连失败：${r.message}`); setStatus('error'); return; }
          setRoom(r.room);
          if (r.view) setView(r.view);
          setStatus('inRoom');
          addLog(`已重连房间 ${rid} · 座位 ${seatNum}`);
        });
      }
    });
    s.on('disconnect', (reason: string) => {
      setOnline(false);
      addLog(`连接断开（${reason}）—— 回合制不判负，等待自动重连…`);
    });
    s.on('connect_error', (e: Error) => {
      setOnline(false);
      addLog(`连接错误：${e.message}`);
    });

    s.on('room', (r: RoomView) => setRoom(r));
    s.on('update', (p: UpdatePacket) => {
      setView(p.view);
      setRoom(p.room);
      if (p.events.length > 0) setEvents((ev) => [...ev, ...p.events].slice(-200));
    });
    s.on('room:superseded', () => {
      setError('该座位已在另一个标签页登录，本连接被顶下线');
      setStatus('error');
    });

    return () => { s.close(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 加入房间 ─────────────────────────────────────────
  const join = useCallback((id: string, name?: string) => {
    const s = socketRef.current;
    if (!s) return;
    setError(null);
    setStatus('connecting');
    setRoomId(id);
    roomIdRef.current = id;
    const doJoin = (): void => {
      s.emit('room:join', { roomId: id, name }, (r: JoinAck) => {
        if (!r.ok) { setError(`加入失败：${r.message}`); setStatus('error'); return; }
        setRoom(r.room);
        setSeat(r.seat);
        seatRef.current = r.seat;
        seqRef.current = 0;
        if (r.view) setView(r.view);
        setStatus('inRoom');
        if (r.seat === null) {
          addLog(`房间 ${id} 座位已满，进入观战位`);
        } else {
          sessionStorage.setItem(tokenKey(id), r.token ?? '');
          sessionStorage.setItem(seatKey(id), String(r.seat));
          addLog(`已加入房间 ${id} · 座位 ${r.seat}`);
        }
      });
    };
    if (s.connected) doJoin();
    else s.once('connect', doJoin);
  }, [addLog]);

  const leave = useCallback(() => {
    sessionStorage.removeItem(tokenKey(roomIdRef.current));
    sessionStorage.removeItem(seatKey(roomIdRef.current));
    socketRef.current?.close();
    socketRef.current = null;
    setView(null); setRoom(null); setSeat(null); setStatus('idle'); setOnline(false);
  }, []);

  const pickHero = useCallback((heroId: HeroId) => {
    const s = socketRef.current;
    if (!s) return;
    s.emit('room:pick', { heroId }, (r: RoomAck) => {
      if (!r.ok) addLog(`选英雄失败：${r.message ?? ''}`);
      else setRoom(r.room);
    });
  }, [addLog]);

  const setReady = useCallback((ready: boolean) => {
    const s = socketRef.current;
    if (!s) return;
    s.emit('room:ready', { ready }, (r: RoomAck) => {
      if (!r.ok) addLog(`准备失败：${r.message ?? ''}`);
      else setRoom(r.room);
    });
  }, [addLog]);

  const send = useCallback((action: Action) => {
    const s = socketRef.current;
    if (!s) return;
    lastActionRef.current = action;
    const clientSeq = ++seqRef.current;
    s.emit('game:action', { action, clientSeq }, (r: ActionAck) => {
      // 无论成功失败，都以服务端回带的最新视图为准
      if (r.view) setView(r.view);
      if (!r.ok) addLog(`动作被拒：${r.message}`);
      else if (r.duplicate) addLog(`（重复提交已去重：${action.t}）`);
    });
  }, [addLog]);

  const resendLast = useCallback(() => {
    const s = socketRef.current;
    const a = lastActionRef.current;
    if (!s || !a) return;
    s.emit('game:action', { action: a, clientSeq: seqRef.current }, (r: ActionAck) => {
      if (r.view) setView(r.view);
      addLog(r.ok && r.duplicate ? `重发命中幂等缓存：${a.t}` : `重发结果 ok=${r.ok}`);
    });
  }, [addLog]);

  const playerView = view && view.you !== null ? (view as PlayerView) : null;

  return {
    roomId, room, view, seat, status, error, log, online, events,
    join, leave, pickHero, setReady, send, resendLast,
  };
}

/** 动作按钮：把 LegalActionView 还原成 Action 再发出去 */
export function useActionSender(send: (a: Action) => void) {
  return useMemo(() => (a: LegalActionView, uids?: readonly string[]) => {
    const action = toAction(a, uids ? { uids } : undefined);
    if (action) send(action);
  }, [send]);
}

/** 事件 → 一行中文日志（与 local.ts 的 describeEvent 同一套文案） */
export function describeNetEvent(e: GameEvent): string | null {
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
