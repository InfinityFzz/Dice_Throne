/**
 * 房间管理 —— 大厅（选人 / 准备）→ 对局（MatchActor）→ 结束，
 * 外加断线保留座位、重连令牌校验、观战位、启动恢复。
 *
 * 与 M1 骨架的区别（PROGRESS 阶段 B 的 B3 / B4）：
 * - 房间有 **lobby 阶段**：两个座位各自选英雄、点准备，齐了才 `createMatch`；
 * - 每个座位持有一个 **重连令牌**，刷新页面 / 掉线后凭它回到**同一个座位**；
 * - 第三个及以后的连接进 **观战位**（`SpectatorView`，字段层面不含任何手牌内容）；
 * - 断线**不清空座位、不判负**（回合制，用户拍板 Q12）；
 * - 进程重启后从 `PERSIST_DIR` 恢复房间与对局（B2）。
 */
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Server, Socket } from 'socket.io';
import type { HeroId, Seat } from '../../shared/src/types/core.js';
import type { Action, GameEvent } from '../../shared/src/types/action.js';
import type { RoomPhase, RoomView, SeatInfo, AnyView } from '../../shared/src/types/net.js';
import type { ContentRegistry } from '../../shared/src/content/registry.js';
import { filterEvents, projectSpectator, projectState, lastRoomMeta, replayLog, type RoomMetaEntry }
  from '../../shared/src/index.js';
import { MatchActor, type ApplyResult } from './matchActor.js';
import { MatchLog, listMatchIds } from './matchLog.js';

const SEATS: readonly Seat[] = [0, 1];

type RoomMeta = RoomMetaEntry;

interface Room {
  meta: RoomMeta;
  actor: MatchActor | null;
  log: MatchLog | null;
  /** 每个座位当前连接的 socket id；null = 该座位掉线中（座位保留） */
  sockets: [string | null, string | null];
  spectators: Set<string>;
}

function newToken(): string {
  return randomBytes(16).toString('hex');
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly io: Server,
    private readonly content: ContentRegistry,
    private readonly persistDir: string,
  ) {}

  // ── 启动恢复 ────────────────────────────────────────
  /** 扫描 PERSIST_DIR：先读房间元信息（最后一条 room 行），phase≠lobby 再回放对局日志 */
  async restore(): Promise<readonly string[]> {
    if (!existsSync(this.persistDir)) return [];
    const restored: string[] = [];
    for (const id of await listMatchIds(this.persistDir)) {
      const log = await MatchLog.open(this.persistDir, id);
      const meta = lastRoomMeta(log.snapshot);
      if (!meta) continue;
      const room: Room = {
        meta, actor: null, log, sockets: [null, null], spectators: new Set(),
      };
      if (meta.phase !== 'lobby') {
        try {
          room.actor = await MatchActor.recover({
            roomId: id, content: this.content, seed: meta.seed,
            heroes: [meta.picks[0] ?? 'barbarian', meta.picks[1] ?? 'pyromancer'],
            log,
          });
          restored.push(id);
        } catch (e) {
          console.error(`[restore] 房间 ${id} 回放失败，回退到大厅：${e instanceof Error ? e.message : String(e)}`);
          room.meta = { ...meta, phase: 'lobby' };
        }
      }
      this.rooms.set(id, room);
    }
    return restored;
  }

  /**
   * 房间元信息落盘：append 一行到对局日志（**不覆盖**）。
   * 失败只记日志 —— 元信息丢了最多影响重连令牌，绝不能把服务进程带崩。
   */
  private async writeMeta(room: Room): Promise<void> {
    if (!room.log) return;
    try {
      await room.log.append({ k: 'room', ts: Date.now(), ...room.meta });
    } catch (e) {
      console.error(`[persist] 写房间元信息失败（忽略）：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 查询 ────────────────────────────────────────────
  /** 取房间，不存在则创建（并打开它的 append-only 日志） */
  private async ensure(id: string): Promise<Room> {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    if (!existsSync(this.persistDir)) await mkdir(this.persistDir, { recursive: true });
    const meta: RoomMeta = {
      roomId: id, phase: 'lobby', seed: `${id}-${Date.now()}-${randomBytes(4).toString('hex')}`,
      names: ['玩家 A', '玩家 B'], picks: [null, null], ready: [false, false],
      tokens: [null, null], startedAt: null,
    };
    const room: Room = {
      meta, actor: null, log: await MatchLog.open(this.persistDir, id),
      sockets: [null, null], spectators: new Set(),
    };
    this.rooms.set(id, room);
    await this.writeMeta(room);
    return room;
  }

  roomView(id: string): RoomView {
    const r = this.rooms.get(id);
    const seatInfo = (seat: Seat, room?: Room): SeatInfo => ({
      seat,
      heroId: room?.meta.picks[seat] ?? null,
      ready: room?.meta.ready[seat] ?? false,
      connected: room?.sockets[seat] != null && room.sockets[seat] !== null,
      name: room?.meta.names[seat] ?? `玩家 ${seat === 0 ? 'A' : 'B'}`,
    });
    return {
      roomId: id,
      phase: r?.meta.phase ?? 'lobby',
      seats: [seatInfo(0, r), seatInfo(1, r)],
      spectatorCount: r?.spectators.size ?? 0,
      startedAt: r?.meta.startedAt ?? null,
    };
  }

  /** 按房间 id 取视图（房间不存在或尚未开局 → null） */
  viewForById(id: string, seat: Seat | null): AnyView | null {
    const room = this.rooms.get(id);
    return room ? this.viewFor(room, seat) : null;
  }

  viewFor(room: Room, seat: Seat | null): AnyView | null {
    if (!room.actor) return null;
    return seat === null
      ? projectSpectator(room.actor.getState(), this.content)
      : projectState(room.actor.getState(), this.content, seat);
  }

  // ── 加入 / 重连 / 观战 ──────────────────────────────
  /**
   * 加入房间：优先占空座位，两个座位都已被占（含掉线保留中的）则进观战位。
   * 掉线保留的座位**不能**被新人抢走 —— 只有凭令牌重连才能坐回去。
   */
  async join(id: string, socket: Socket, name?: string): Promise<{
    ok: boolean; seat: Seat | null; token: string | null; message?: string;
  }> {
    const room = await this.ensure(id);
    // 先看有没有「从未分配过」的座位（tokens[seat] === null 且 sockets[seat] === null）
    for (const seat of SEATS) {
      if (room.meta.tokens[seat] === null && room.sockets[seat] === null) {
        const token = newToken();
        room.meta = {
          ...room.meta,
          tokens: room.meta.tokens.map((t, i) => (i === seat ? token : t)) as [string | null, string | null],
          names: room.meta.names.map((n, i) => (i === seat ? (name ?? n) : n)) as [string, string],
        };
        room.sockets[seat] = socket.id;
        socket.data.roomId = id;
        socket.data.seat = seat;
        socket.data.token = token;
        socket.join(id);
        await this.writeMeta(room);
        this.broadcastRoom(id);
        return { ok: true, seat, token };
      }
    }
    // 没有空座位 → 观战
    return this.attachSpectator(room, socket, id);
  }

  /** 重连：令牌必须与该座位当前令牌一致 */
  async rejoin(id: string, socket: Socket, seat: Seat, token: string): Promise<{
    ok: boolean; seat: Seat | null; token: string | null; message?: string;
  }> {
    const room = this.rooms.get(id);
    if (!room) return { ok: false, seat: null, token: null, message: '房间不存在' };
    if (room.meta.tokens[seat] !== token || token === '') {
      return { ok: false, seat: null, token: null, message: '重连令牌无效' };
    }
    // 旧连接（若还在）踢出房间，避免一个座位两个 socket
    const old = room.sockets[seat];
    if (old && old !== socket.id) {
      const s = this.io.sockets.sockets.get(old);
      if (s) { s.data.seat = null; s.leave(id); s.emit('room:superseded', { roomId: id }); }
    }
    room.sockets[seat] = socket.id;
    socket.data.roomId = id;
    socket.data.seat = seat;
    socket.data.token = token;
    socket.join(id);
    this.broadcastRoom(id);
    return { ok: true, seat, token };
  }

  private async attachSpectator(room: Room, socket: Socket, id: string): Promise<{
    ok: boolean; seat: null; token: null;
  }> {
    room.spectators.add(socket.id);
    socket.data.roomId = id;
    socket.data.seat = null;
    socket.join(id);
    this.broadcastRoom(id);
    return { ok: true, seat: null, token: null };
  }

  // ── 大厅操作 ────────────────────────────────────────
  async pickHero(id: string, seat: Seat, heroId: HeroId): Promise<{ ok: boolean; message?: string }> {
    const room = this.rooms.get(id);
    if (!room) return { ok: false, message: '房间不存在' };
    if (room.meta.phase !== 'lobby') return { ok: false, message: '对局已开始，不能换英雄' };
    try {
      this.content.getHero(heroId);
    } catch {
      return { ok: false, message: `未知英雄 ${heroId}` };
    }
    // 换英雄会让「已准备」失效
    room.meta = {
      ...room.meta,
      picks: room.meta.picks.map((p, i) => (i === seat ? heroId : p)) as [HeroId | null, HeroId | null],
    };
    await this.writeMeta(room);
    this.broadcastRoom(id);
    return { ok: true };
  }

  async setReady(id: string, seat: Seat, ready: boolean): Promise<{ ok: boolean; message?: string }> {
    const room = this.rooms.get(id);
    if (!room) return { ok: false, message: '房间不存在' };
    if (room.meta.phase !== 'lobby') return { ok: false, message: '对局已开始' };
    if (!room.meta.picks[seat]) return { ok: false, message: '请先选择英雄' };
    const next = room.meta.ready.map((r, i) => (i === seat ? ready : r)) as [boolean, boolean];
    room.meta = { ...room.meta, ready: next };

    const bothReady = next[0] && next[1]
      && room.meta.picks[0] !== null && room.meta.picks[1] !== null;
    if (bothReady) {
      await this.startMatch(room);
    } else {
      await this.writeMeta(room);
    }
    this.broadcastRoom(id);
    return { ok: true };
  }

  private async startMatch(room: Room): Promise<void> {
    const id = room.meta.roomId;
    const heroes: [HeroId, HeroId] = [
      room.meta.picks[0] ?? 'barbarian',
      room.meta.picks[1] ?? 'pyromancer',
    ];
    const log = room.log ?? await MatchLog.open(this.persistDir, id);
    room.log = log;
    room.actor = await MatchActor.create({
      roomId: id, content: this.content, seed: room.meta.seed, heroes, log,
    });
    room.meta = { ...room.meta, phase: 'playing', startedAt: Date.now() };
    await this.writeMeta(room);
    this.broadcast(id, []);
  }

  // ── 对局动作 ────────────────────────────────────────
  async applyAction(id: string, seat: Seat, action: Action, clientSeq: number): Promise<ApplyResult | null> {
    const room = this.rooms.get(id);
    if (!room?.actor) return null;
    const r = await room.actor.apply(seat, action, clientSeq);
    if (room.meta.phase !== 'ended' && r.state.finished) {
      room.meta = { ...room.meta, phase: 'ended' };
      await this.writeMeta(room);
    }
    this.broadcast(id, r.events);
    return r;
  }

  // ── 断线 ────────────────────────────────────────────
  /** 断线：只摘 socket，**保留座位与令牌**（回合制不判负） */
  detach(socket: Socket): void {
    const id = socket.data.roomId as string | undefined;
    if (!id) return;
    const room = this.rooms.get(id);
    if (!room) return;
    const seat = socket.data.seat as Seat | null | undefined;
    if (seat === 0 || seat === 1) {
      if (room.sockets[seat] === socket.id) room.sockets[seat] = null;
    } else if (room.spectators.delete(socket.id)) {
      // 观战者离开
    }
    socket.leave(id);
    this.broadcastRoom(id);
  }

  // ── 广播 ────────────────────────────────────────────
  broadcastRoom(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    this.io.to(id).emit('room', this.roomView(id));
  }

  /** per-seat 广播：每个连接只收到自己那份投影 + 自己可见的事件 */
  broadcast(id: string, events: readonly GameEvent[]): void {
    const room = this.rooms.get(id);
    if (!room) return;
    const rv = this.roomView(id);
    for (const seat of SEATS) {
      const sid = room.sockets[seat];
      const view = this.viewFor(room, seat);
      if (!sid || !view) continue;
      this.io.to(sid).emit('update', { view, events: filterEvents(events, seat), room: rv });
    }
    const sv = this.viewFor(room, null);
    for (const sid of room.spectators) {
      if (!sv) continue;
      this.io.to(sid).emit('update', { view: sv, events: filterEvents(events, null), room: rv });
    }
  }

  async shutdown(): Promise<void> {
    for (const room of this.rooms.values()) {
      await room.actor?.flush();
      await room.log?.flush();
    }
  }
}
