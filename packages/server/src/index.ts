/**
 * 联机服务端 —— 架构 ADR-001（Socket.IO）/ ADR-002（服务端权威 + per-seat 投影）。
 *
 * 要点：
 * 1. 服务端持有全量 GameState；客户端只收到自己的 PlayerView。
 * 2. 客户端只发「意图」，服务端校验合法性后再推进。
 * 3. 回合制（用户拍板 Q12）：不设操作倒计时；断线不判负。
 * 4. 对局每次推进追加写入 JSONL，支持进程重启后恢复（Q5 连带要求，持久化 P1）。
 */
import { createServer } from 'node:http';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { Server } from 'socket.io';
import {
  createDefaultRegistry, createMatch, reduce, projectState,
  type GameState, type Seat,
} from '../../shared/src/index.js';

const PORT = Number(process.env.PORT ?? 3001);
const PERSIST_DIR = process.env.PERSIST_DIR ?? './.matches';

const content = createDefaultRegistry();

interface Room {
  id: string;
  state: GameState;
  sockets: (string | null)[];
  heroes: readonly [string, string];
}

const rooms = new Map<string, Room>();

function persist(room: Room): void {
  if (!existsSync(PERSIST_DIR)) mkdirSync(PERSIST_DIR, { recursive: true });
  const line = JSON.stringify({ roomId: room.id, seq: room.state.seq, turn: room.state.turn, ts: Date.now() });
  appendFileSync(`${PERSIST_DIR}/${room.id}.jsonl`, `${line}\n`);
}

function broadcast(room: Room, io: Server): void {
  for (const seat of [0, 1] as Seat[]) {
    const sid = room.sockets[seat];
    if (!sid) continue;
    io.to(sid).emit('state', projectState(room.state, content, seat));
  }
}

const http = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Dice Throne server OK');
});

const io = new Server(http, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, heroId }: { roomId: string; heroId?: string }, ack?: (r: unknown) => void) => {
    let room = rooms.get(roomId);
    if (!room) {
      const heroes: [string, string] = [heroId ?? 'barbarian', 'pyromancer'];
      room = {
        id: roomId,
        state: createMatch(content, { seed: `${roomId}-${Date.now()}`, heroes }),
        sockets: [null, null],
        heroes,
      };
      rooms.set(roomId, room);
    }
    const seat: Seat = room.sockets[0] === null ? 0 : room.sockets[1] === null ? 1 : 0;
    if (room.sockets[seat] === null) room.sockets[seat] = socket.id;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.seat = seat;
    ack?.({ seat, view: projectState(room.state, content, seat) });
    broadcast(room, io);
  });

  socket.on('game:action', (payload: { action: unknown }, ack?: (r: unknown) => void) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) { ack?.({ ok: false, error: 'not in room' }); return; }
    const room = rooms.get(roomId);
    if (!room) { ack?.({ ok: false, error: 'room not found' }); return; }
    const seat = socket.data.seat as Seat;
    const env = { seat, action: payload.action as never, clientSeq: room.state.seq };
    const r = reduce(room.state, env, content);
    if (!r.ok) { ack?.({ ok: false, error: r.error }); return; }
    room.state = r.state;
    persist(room);
    ack?.({ ok: true });
    broadcast(room, io);
    if (room.state.finished) {
      io.to(roomId).emit('matchEnded', { winner: room.state.winner });
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    const room = rooms.get(roomId);
    // Q5：断线不判负，保留座位等待重连
    if (room) {
      const seat = socket.data.seat as Seat;
      if (room.sockets[seat] === socket.id) room.sockets[seat] = null;
    }
  });
});

http.listen(PORT, () => {
  console.log(`Dice Throne server listening on http://localhost:${PORT}`);
});
