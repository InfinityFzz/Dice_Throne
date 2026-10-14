/**
 * 联机服务端入口 —— 架构 ADR-001（Socket.IO）/ ADR-002（服务端权威 + per-seat 投影）。
 *
 * 要点：
 * 1. 服务端持有全量 GameState；客户端只收到自己的 PlayerView（观战位收 SpectatorView）。
 * 2. 客户端只发「意图」，由 MatchActor 串行校验后推进；`reduce` 拒绝即回绝，状态不动。
 * 3. 回合制（用户拍板 Q12）：不设操作倒计时；断线保留座位、不判负。
 * 4. 持久化 = JSONL（meta / act / 周期快照）+ 房间元信息；启动时自动恢复（B2/B3）。
 *
 * 协议类型见 `shared/types/net.ts`（双方共用同一份定义）。
 */
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createDefaultRegistry } from '../../shared/src/index.js';
import type { HeroId, Seat } from '../../shared/src/types/core.js';
import type { Action, RuleError } from '../../shared/src/types/action.js';
import type {
  ActionAck, ActionRequest, JoinAck, JoinRequest, RejoinRequest, RoomAck, UpdatePacket,
} from '../../shared/src/types/net.js';
import { RoomManager } from './roomManager.js';

const PORT = Number(process.env.PORT ?? 3001);
const PERSIST_DIR = process.env.PERSIST_DIR ?? './.matches';

const content = createDefaultRegistry();

const http = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Dice Throne server OK');
});

const io = new Server(http, { cors: { origin: '*' } });
const rooms = new RoomManager(io, content, PERSIST_DIR);

function seatOf(socket: Socket): Seat | null {
  const s = socket.data.seat;
  return s === 0 || s === 1 ? s : null;
}

/** 动作回执的错误分支：也回带最新 view，客户端不会停留在旧状态 */
function reject(ack: ((r: ActionAck) => void) | undefined, roomId: string, seat: Seat | null,
  code: RuleError['code'], message: string): void {
  const view = rooms.viewForById(roomId, seat);
  if (!view) { ack?.({ ok: false, code: 'internal', message: '无法生成视图', view: undefined as never }); return; }
  ack?.({ ok: false, code, message, view });
}

io.on('connection', (socket: Socket) => {
  const roomIdOf = (): string | undefined => socket.data.roomId as string | undefined;

  async function replyJoin(ack: ((r: JoinAck) => void) | undefined, r: {
    ok: boolean; seat: Seat | null; token: string | null; message?: string;
  }, roomId: string): Promise<void> {
    const rv = rooms.roomView(roomId);
    if (!r.ok) {
      ack?.({ ok: false, code: 'internal', message: r.message ?? '加入失败' });
      return;
    }
    ack?.({ ok: true, seat: r.seat, token: r.token, room: rv, view: rooms.viewForById(roomId, r.seat) });
    // 让房间里的其他人立刻看到座位变化
    rooms.broadcast(roomId, []);
  }

  // ── 加入 / 重连 ───────────────────────────────────
  socket.on('room:join', async (req: JoinRequest, ack?: (r: JoinAck) => void) => {
    const roomId = String(req?.roomId ?? '').trim();
    if (!roomId) { ack?.({ ok: false, code: 'internal', message: '房间号不能为空' }); return; }
    const r = await rooms.join(roomId, socket, req?.name);
    await replyJoin(ack, r, roomId);
  });

  socket.on('room:rejoin', async (req: RejoinRequest, ack?: (r: JoinAck) => void) => {
    const roomId = String(req?.roomId ?? '').trim();
    const seat = req?.seat;
    if (!roomId || (seat !== 0 && seat !== 1)) {
      ack?.({ ok: false, code: 'badToken', message: '重连参数不合法' });
      return;
    }
    const r = await rooms.rejoin(roomId, socket, seat, String(req?.token ?? ''));
    await replyJoin(ack, r, roomId);
  });

  // ── 大厅：选英雄 / 准备 ───────────────────────────
  socket.on('room:pick', async (p: { heroId: HeroId }, ack?: (r: RoomAck) => void) => {
    const roomId = roomIdOf();
    const seat = seatOf(socket);
    if (!roomId || seat === null) { ack?.({ ok: false, room: rooms.roomView(roomId ?? ''), message: '未加入房间' }); return; }
    const r = await rooms.pickHero(roomId, seat, p?.heroId);
    ack?.({ ok: r.ok, room: rooms.roomView(roomId), message: r.message });
  });

  socket.on('room:ready', async (p: { ready: boolean }, ack?: (r: RoomAck) => void) => {
    const roomId = roomIdOf();
    const seat = seatOf(socket);
    if (!roomId || seat === null) { ack?.({ ok: false, room: rooms.roomView(roomId ?? ''), message: '未加入房间' }); return; }
    const r = await rooms.setReady(roomId, seat, Boolean(p?.ready));
    ack?.({ ok: r.ok, room: rooms.roomView(roomId), message: r.message });
  });

  // ── 对局动作 ──────────────────────────────────────
  socket.on('game:action', async (req: ActionRequest, ack?: (r: ActionAck) => void) => {
    const roomId = roomIdOf();
    const seat = seatOf(socket);
    if (!roomId || seat === null) { reject(ack, roomId ?? '', seat, 'permissionDenied', '未加入房间或不在座位上'); return; }
    if (!req || !req.action || typeof req.clientSeq !== 'number') {
      reject(ack, roomId, seat, 'illegalAction', '动作包不合法');
      return;
    }
    const r = await rooms.applyAction(roomId, seat, req.action as Action, req.clientSeq);
    if (!r) { reject(ack, roomId, seat, 'internal', '对局尚未开始'); return; }
    const view = rooms.viewForById(roomId, seat);
    if (!view) { reject(ack, roomId, seat, 'internal', '无法生成视图'); return; }
    if (!r.ok) {
      ack?.({ ok: false, code: r.error?.code ?? 'internal', message: r.error?.message ?? '动作被拒', view });
      return;
    }
    ack?.({ ok: true, view, duplicate: r.duplicate });
  });

  // ── 主动同步（客户端重连后若漏了广播，可显式拉一次）──
  // 注意：socket.io 的 ack 回调是**最后一个**实参，payload 在前；
  // 即使客户端不带 payload，也要把第一位让给 payload，否则 ack 恒为 undefined（客户端永久等待）。
  socket.on('room:sync', (_payload: unknown, ack?: (r: UpdatePacket | null) => void) => {
    const roomId = roomIdOf();
    const seat = seatOf(socket);
    if (!roomId) { ack?.(null); return; }
    const view = rooms.viewForById(roomId, seat);
    ack?.(view ? { view, events: [], room: rooms.roomView(roomId) } : null);
  });

  socket.on('disconnect', () => {
    rooms.detach(socket);
  });
});

async function main(): Promise<void> {
  const restored = await rooms.restore();
  if (restored.length > 0) {
    console.log(`[restore] 已从 ${PERSIST_DIR} 恢复 ${restored.length} 个对局：${restored.join(', ')}`);
  }
  http.listen(PORT, () => {
    console.log(`Dice Throne server listening on http://localhost:${PORT}  (persist: ${PERSIST_DIR})`);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void rooms.shutdown().finally(() => process.exit(0));
  });
}

void main();
