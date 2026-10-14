/**
 * M2 端到端联调（PROGRESS 阶段 B 的 B5）。
 *
 * 真起一个服务端进程，用两个 socket.io 客户端把它走完一遍，中间刻意制造故障：
 *
 *   阶段 1  选人开局      两客户端加入 → 各选英雄 → 准备 → 对局开始（B4）
 *   阶段 2  打完整局      每步只用服务端下发的 legalActions（B1 权威校验）
 *   阶段 3  幂等          同一 clientSeq 重发 → duplicate=true，状态不动（B1）
 *   阶段 4  断线重连      座位 0 掉线 → 新连接凭 token 回到同一座位，视图逐字节一致（B3）
 *   阶段 5  kill 重启     kill 服务端 → 重启 → 两个座位重连，状态与死前一致（B2）
 *   阶段 6  观战 + 无泄漏  第三个连接只能拿 SpectatorView；全程视图不含 rng/bucket/手牌 uid
 *
 * 用法：npm run e2e
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import type { Action } from '../packages/shared/src/types/action.js';
import type {
  AnyView, JoinAck, RoomView, ActionAck, UpdatePacket, RoomAck,
} from '../packages/shared/src/types/net.js';
import type { LegalActionView, PlayerView } from '../packages/shared/src/types/view.js';
import type { Seat } from '../packages/shared/src/types/core.js';

const PORT = Number(process.env.E2E_PORT ?? 3101);
const BASE = `http://localhost:${PORT}`;
// 落在仓库内的临时目录：系统 temp 在受限环境下可能不可写
const PERSIST_DIR = mkdtempSync(path.join(process.cwd(), '.e2e-'));
const STEP_CAP = 4000;
const DISCONNECT_AT = 12;
const RESTART_AT = 30;

// ── 小工具 ─────────────────────────────────────────────
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
}
function section(t: string): void { console.log(`\n── ${t} ─────────────────────────────`); }
function note(t: string): void { console.log(`   ${t}`); }

function emitAck<T>(s: Socket, ev: string, payload?: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`emit ${ev} 超时`)), timeoutMs);
    s.emit(ev, payload, (r: T) => { clearTimeout(t); resolve(r); });
  });
}

function waitFor(cond: () => boolean, label: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      if (cond()) { resolve(); return; }
      if (Date.now() - t0 > timeoutMs) { reject(new Error(`等待超时：${label}`)); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function httpAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

async function startServer(label: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'packages/server/src/index.ts'],
    { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), PERSIST_DIR }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout?.on('data', (d: Buffer) => {
    const s = d.toString().trim();
    if (s) console.log(`   [${label}] ${s}`);
  });
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${label}:err] ${d}`));
  const t0 = Date.now();
  while (!(await httpAlive())) {
    if (Date.now() - t0 > 25000) { child.kill(); throw new Error('服务端启动超时'); }
    await new Promise((r) => setTimeout(r, 150));
  }
  return child;
}

// ── 客户端封装 ─────────────────────────────────────────
class Client {
  view: PlayerView | null = null;
  room: RoomView | null = null;
  seat: Seat | null = null;
  token: string | null = null;
  clientSeq = 0;
  updates = 0;
  socket: Socket;

  constructor(readonly label: string, private readonly roomId: string) {
    this.socket = io(BASE, { transports: ['websocket'], reconnection: false });
    this.socket.on('connect_error', (e: Error) => console.error(`[${label}] connect_error: ${e.message}`));
  }

  /** 服务端每次推进都会广播本座位专属的 update —— 客户端永远以它为准 */
  bind(): void {
    this.socket.on('update', (p: UpdatePacket) => {
      this.updates++;
      this.room = p.room;
      if (p.view.you !== null) this.view = p.view as PlayerView;
    });
    this.socket.on('room', (r: RoomView) => { this.room = r; });
  }

  async connect(): Promise<void> {
    await waitFor(() => this.socket.connected, `${this.label} 连接建立`);
  }

  async join(name: string): Promise<void> {
    const r = await emitAck<JoinAck>(this.socket, 'room:join', { roomId: this.roomId, name });
    if (!r.ok) throw new Error(`${this.label} 加入失败：${r.message}`);
    this.seat = r.seat;
    this.token = r.token;
    this.room = r.room;
    if (r.view && r.view.you !== null) this.view = r.view as PlayerView;
  }

  async rejoin(): Promise<void> {
    if (this.seat === null || !this.token) throw new Error(`${this.label} 没有座位/令牌可重连`);
    const r = await emitAck<JoinAck>(this.socket, 'room:rejoin', {
      roomId: this.roomId, seat: this.seat, token: this.token,
    });
    if (!r.ok) throw new Error(`${this.label} 重连失败：${r.message}`);
    this.room = r.room;
    if (r.view && r.view.you !== null) this.view = r.view as PlayerView;
  }

  async pick(heroId: string): Promise<RoomAck> {
    return emitAck<RoomAck>(this.socket, 'room:pick', { heroId });
  }
  async ready(v: boolean): Promise<RoomAck> {
    return emitAck<RoomAck>(this.socket, 'room:ready', { ready: v });
  }

  /** seq 省略时自动递增；显式传入用于制造重复提交 */
  async act(action: Action, seq?: number): Promise<ActionAck> {
    const clientSeq = seq ?? ++this.clientSeq;
    if (seq !== undefined && seq > this.clientSeq) this.clientSeq = seq;
    return emitAck<ActionAck>(this.socket, 'game:action', { action, clientSeq });
  }

  async sync(): Promise<void> { await emitAck<UpdatePacket | null>(this.socket, 'room:sync', {}); }
  disconnect(): void { this.socket.disconnect(); }
}

// ── 简易 AI：只用服务端下发的 legalActions ──────────────
const PREF: readonly LegalActionView['t'][] = [
  'announceAbility', 'performRoll', 'defensiveRoll', 'endMainPhase',
  'chooseOption', 'discardCards', 'respondPass', 'playCard', 'buyUpgrade', 'passAbility',
];

function choose(view: PlayerView): Action | null {
  for (const t of PREF) {
    const a = view.legalActions.find((x) => x.t === t && x.enabled);
    if (!a) continue;
    switch (a.t) {
      case 'performRoll': return { t: 'performRoll' };
      case 'announceAbility': return a.abilityId ? { t: 'announceAbility', abilityId: a.abilityId } : null;
      case 'defensiveRoll': return { t: 'defensiveRoll' };
      case 'endMainPhase': return { t: 'endMainPhase' };
      case 'playCard': return a.uid ? { t: 'playCard', uid: a.uid } : null;
      case 'buyUpgrade':
        return a.abilityId && a.tier ? { t: 'buyUpgrade', abilityId: a.abilityId, tier: a.tier } : null;
      case 'chooseOption': return a.optionId ? { t: 'chooseOption', optionId: a.optionId } : null;
      case 'respondPass': return { t: 'respondPass' };
      case 'passAbility': return { t: 'passAbility' };
      case 'discardCards': {
        const over = Math.max(0, view.self.hand.length - 6);
        return { t: 'discardCards', uids: view.self.hand.slice(0, over).map((c) => c.uid) };
      }
      default: return null;
    }
  }
  return null;
}

/** 下发视图不得含隐藏信息（ADR-002） */
function assertNoLeak(who: string, v: AnyView): void {
  const blob = JSON.stringify(v);
  for (const bad of ['"rng"', 'rngSeed', '"bucket"', 'pendingRecoils', '"counters"']) {
    ok(!blob.includes(bad), `${who} 视图泄漏了 ${bad}`);
  }
  if (v.you === null) {
    ok(!blob.includes('remainingDeckCounts'), '观战视图泄漏了 remainingDeckCounts');
    ok(!blob.includes('"hand"'), '观战视图泄漏了 hand 明细');
    ok(v.legalActions.length === 0, '观战视图不应带可执行动作');
  }
}

// ── 主流程 ─────────────────────────────────────────────
async function main(): Promise<void> {
  let server = await startServer('server-1');
  const roomId = 'e2e-room';
  const A = new Client('A', roomId);
  const B = new Client('B', roomId);
  A.bind(); B.bind();

  const cleanups: (() => void)[] = [
    () => A.disconnect(), () => B.disconnect(),
    () => { try { server.kill(); } catch { /* 已退出 */ } },
  ];

  try {
    // ── 阶段 1：选人开局（B4）─────────────────────────
    section('阶段 1 · 加入房间 / 选英雄 / 准备开局');
    await A.connect(); await B.connect();
    await A.join('玩家A');
    await B.join('玩家B');
    ok(A.seat === 0 && B.seat === 1, `座位分配错误（A=${A.seat} B=${B.seat}）`);
    ok(typeof A.token === 'string' && (A.token?.length ?? 0) > 0, 'A 未拿到重连令牌');
    note(`座位：A=seat${A.seat} B=seat${B.seat}`);

    const r0 = await A.ready(true);
    ok(r0.ok === false, '未选英雄时准备应被拒');
    note(`未选英雄准备被拒：${r0.message ?? ''}`);

    const pA = await A.pick('barbarian');
    const pB = await B.pick('pyromancer');
    ok(pA.ok && pB.ok, '选英雄失败');
    const badPick = await A.pick('nonexistent-hero');
    ok(badPick.ok === false, '未知英雄应被拒');

    await A.ready(true);
    ok(A.view === null, '只有一方准备时不应开局');
    await B.ready(true);
    await waitFor(() => A.view !== null && B.view !== null, '双方收到开局视图', 8000);
    ok(A.view?.self.heroId === 'barbarian', 'A 的英雄与所选不一致');
    ok(B.view?.self.heroId === 'pyromancer', 'B 的英雄与所选不一致');
    assertNoLeak('A', A.view!);
    assertNoLeak('B', B.view!);
    note('对局已开始，双方收到首帧投影且无泄漏');

    // ── 阶段 2~5 ─────────────────────────────────────
    section('阶段 2 · 按服务端 legalActions 打完整局（中途插入 3/4/5）');
    let steps = 0;
    let disconnected = false;
    let restarted = false;

    while (steps < STEP_CAP) {
      if (A.view?.finished || B.view?.finished) break;

      // ── 阶段 4：断线重连（B3）─────────────────────
      if (!disconnected && steps === DISCONNECT_AT) {
        disconnected = true;
        section('阶段 4 · 断线重连（同一座位 + 视图逐字节一致）');
        const before = JSON.stringify(A.view);
        const seqBefore = A.clientSeq;
        A.disconnect();
        await waitFor(() => A.socket.disconnected, 'A 已断开');
        note('A 断开连接（座位保留，回合制不判负）');
        A.socket = io(BASE, { transports: ['websocket'], reconnection: false });
        A.bind();
        A.clientSeq = seqBefore;
        await A.connect();
        await A.rejoin();
        note(`A 重连 → seat${A.seat}（令牌校验通过）`);
        ok(A.seat === 0, 'A 重连后座位变了');
        ok(A.view?.self.heroId === 'barbarian', 'A 重连后英雄变了');
        ok(JSON.stringify(A.view) === before, 'A 重连后视图与断线前不一致');
      }

      // ── 阶段 5：kill 服务端后重启恢复（B2）─────────
      if (!restarted && steps === RESTART_AT) {
        restarted = true;
        section('阶段 5 · kill 服务端 → 重启 → 从 JSONL 恢复（B2）');
        const before = JSON.stringify([A.view, B.view]);
        server.kill();
        await waitFor(() => server.exitCode !== null || server.signalCode !== null, '服务端退出', 10000);
        note(`服务端已退出（code=${String(server.exitCode)} signal=${String(server.signalCode)}）`);
        server = await startServer('server-2');
        note('服务端已重启，开始恢复房间…');
        for (const c of [A, B]) {
          c.socket.disconnect();
          c.socket = io(BASE, { transports: ['websocket'], reconnection: false });
          c.bind();
          await c.connect();
          await c.rejoin();
        }
        ok(JSON.stringify([A.view, B.view]) === before, '重启后视图与死前不一致 —— 持久化恢复失败');
        ok(A.view?.self.heroId === 'barbarian' && B.view?.self.heroId === 'pyromancer', '重启后座位/英雄错位');
        note(`重启恢复成功：回合 ${A.view?.shared.turn} · 阶段 ${A.view?.shared.phase}`);
      }

      const actor = [A, B].find((c) => c.view && !c.view.finished
        && c.view.legalActions.some((x) => x.enabled));
      if (!actor || !actor.view) {
        // 双方都无可执行动作 —— 先强制同步一次，仍无则说明状态机卡住
        await A.sync(); await B.sync();
        const still = [A, B].find((c) => c.view?.legalActions.some((x) => x.enabled));
        if (!still) {
          const dump = [A, B].map((c) => `seat${c.seat}: turn=${c.view?.shared.turn} `
            + `phase=${c.view?.shared.phase} pending=${String(c.view?.shared.pendingKind)} `
            + `active=${c.view?.shared.activeSeat} legal=${c.view?.legalActions.length} `
            + `finished=${String(c.view?.finished)}`).join('\n     ');
          throw new Error(`第 ${steps} 步双方都无可执行动作：\n     ${dump}`);
        }
        continue;
      }
      const action = choose(actor.view);
      if (!action) throw new Error(`第 ${steps} 步 seat${actor.seat} 无法从 legalActions 构造动作`);

      // ── 阶段 3：幂等（B1）─────────────────────────
      if (steps === 6) {
        section('阶段 3 · 同一 clientSeq 重发（幂等去重）');
        const first = await actor.act(action);
        ok(first.ok, '首次提交应成功');
        const beforeDup = JSON.stringify(first.view);
        const dup = await actor.act(action, actor.clientSeq); // 同一 clientSeq
        note(`重复提交 → ok=${dup.ok} duplicate=${dup.ok ? dup.duplicate : '-'}`);
        ok(dup.ok && dup.duplicate === true, '重复提交未被识别为 duplicate');
        ok(JSON.stringify(dup.view) === beforeDup, '重复提交后状态被推进了两次');
        actor.view = dup.view as PlayerView;
        steps++;
        continue;
      }

      const ack = await actor.act(action);
      if (!ack.ok) {
        throw new Error(`第 ${steps} 步 seat${actor.seat} 的 ${action.t} 被服务端拒绝：${ack.code} ${ack.message}`);
      }
      actor.view = ack.view as PlayerView;
      if (steps % 10 === 0) assertNoLeak(`seat${actor.seat}`, actor.view);
      steps++;
      if (steps % 50 === 0) note(`…已走 ${steps} 步（回合 ${actor.view.shared.turn}）`);
    }

    await A.sync(); await B.sync();
    section('阶段 2 结果');
    ok(steps < STEP_CAP, `${STEP_CAP} 步内未走完（实际 ${steps}）`);
    ok(A.view?.finished === true && B.view?.finished === true, '双方未同时收到结束状态');
    ok(A.view?.winner === B.view?.winner, '双方看到的胜者不一致');
    note(`完整一局走完：${steps} 步 · ${A.view!.shared.turn} 回合 · 胜者 seat${String(A.view!.winner)}`);

    // ── 阶段 6：观战位 ───────────────────────────────
    section('阶段 6 · 观战位（第三个连接）');
    const S = new Client('S', roomId);
    S.bind();
    cleanups.push(() => S.disconnect());
    await S.connect();
    const sr = await emitAck<JoinAck>(S.socket, 'room:join', { roomId, name: '看客' });
    ok(sr.ok, `观战者加入失败：${sr.ok ? '' : sr.message}`);
    ok(sr.seat === null, '第三个连接应进观战位（seat=null）');
    ok(sr.view !== null && sr.view.you === null, '观战者应拿到 SpectatorView');
    assertNoLeak('观战者', sr.view!);
    note(`观战位就位，房间观战人数 ${sr.room.spectatorCount}`);

    ok(disconnected, '断线重连阶段未执行');
    ok(restarted, 'kill 重启阶段未执行');

    section('全部通过');
    console.log(`M2 e2e ✓  ${steps} 步完整局 · 幂等 ✓ · 断线重连 ✓ · kill 重启恢复 ✓ · 观战无泄漏 ✓`);
  } finally {
    for (const f of cleanups) { try { f(); } catch { /* ignore */ } }
    rmSync(PERSIST_DIR, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\n${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
