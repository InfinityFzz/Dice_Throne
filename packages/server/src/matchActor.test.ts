/**
 * MatchActor 单测（PROGRESS 阶段 B 的 B1）。
 *
 * 三条性质：
 * 1. **串行**：并发 fire 一批动作，最终状态必须与「顺序提交」完全一致 —— 队列保证不交错、不丢更新。
 * 2. **幂等**：同一 (seat, clientSeq) 重发只结算一次。
 * 3. **过期拒绝**：clientSeq 倒退的重发被拒，且状态不动。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  createDefaultRegistry, getLegalActions, toAction,
  type Action, type ContentRegistry, type GameState, type Seat,
} from '../../shared/src/index.js';
import { MatchActor } from './matchActor.js';
import { MatchLog } from './matchLog.js';

const content: ContentRegistry = createDefaultRegistry();

const PREF: readonly string[] = [
  'announceAbility', 'performRoll', 'defensiveRoll', 'endMainPhase',
  'chooseOption', 'discardCards', 'respondPass', 'playCard', 'buyUpgrade', 'passAbility',
];

function nextAction(s: GameState, seat: Seat): Action | null {
  for (const t of PREF) {
    const a = getLegalActions(s, content, seat).find((x) => x.t === t && x.enabled);
    if (!a) continue;
    if (a.t === 'discardCards') {
      const over = Math.max(0, s.players[seat].hand.length - 6);
      return { t: 'discardCards', uids: s.players[seat].hand.slice(0, over).map((c) => c.uid) };
    }
    const act = toAction(a);
    if (act) return act;
  }
  return null;
}

function makeTmp(): string {
  return mkdtempSync(path.join(process.cwd(), '.actortest-'));
}

async function makeActor(dir: string, roomId: string, seed: string): Promise<MatchActor> {
  const log = await MatchLog.open(dir, roomId);
  return MatchActor.create({ roomId, content, seed, heroes: ['barbarian', 'pyromancer'], log });
}

/** 顺序提交 n 步，返回最终状态与动作序列（基准）。seq 按**座位**计数 —— 与真实客户端一致。 */
async function sequential(actor: MatchActor, n: number): Promise<{
  state: GameState;
  trace: readonly { seat: Seat; action: Action; clientSeq: number }[];
}> {
  const counters: Record<string, number> = { 0: 0, 1: 0 };
  const trace: { seat: Seat; action: Action; clientSeq: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = actor.getState();
    if (s.finished) break;
    const seat: Seat = s.pending?.seat ?? s.activeSeat;
    const a = nextAction(s, seat);
    if (!a) break;
    const clientSeq = (counters[String(seat)] ?? 0) + 1;
    counters[String(seat)] = clientSeq;
    const r = await actor.apply(seat, a, clientSeq);
    assert.ok(r.ok, `顺序提交第 ${i} 步被拒：${r.error?.message}`);
    trace.push({ seat, action: a, clientSeq });
  }
  return { state: actor.getState(), trace };
}

test('B1: 并发提交一批动作，结果与顺序提交完全一致（串行队列）', async () => {
  const dir = makeTmp();
  try {
    const N = 24;
    // ① 先在 A 上顺序跑一遍，记下「(座位, 动作, 序号)」序列
    const a1 = await makeActor(dir, 'serial-a', 'same-seed');
    const { state: baseline, trace } = await sequential(a1, N);
    assert.ok(trace.length > 3, '样本太短，断言无效');

    // ② 在 B 上把同一批动作**一次性全部 fire**（不 await），再统一收
    const a2 = await makeActor(dir, 'serial-b', 'same-seed');
    const fired = trace.map((t) => a2.apply(t.seat, t.action, t.clientSeq));
    const results = await Promise.all(fired);

    // 队列必须按入队顺序逐个执行：全部被接受，且没有一个被判为重复
    assert.equal(results.filter((r) => r.ok).length, trace.length, '并发提交时应全部被接受');
    assert.equal(results.filter((r) => r.duplicate).length, 0, '并发提交不应出现重复判定');
    assert.equal(
      JSON.stringify(a2.getState()),
      JSON.stringify(baseline),
      '并发提交后状态必须与顺序提交一致（队列串行、无交错、无丢失更新）',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B1: 同一 clientSeq 重发只结算一次（幂等）', async () => {
  const dir = makeTmp();
  try {
    const actor = await makeActor(dir, 'idem', 'seed-idem');
    const seat: Seat = actor.getState().pending?.seat ?? actor.getState().activeSeat;
    const act = nextAction(actor.getState(), seat);
    assert.ok(act, '应能拿到一个动作');

    const first = await actor.apply(seat, act, 1);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    const afterFirst = JSON.stringify(actor.getState());

    for (let k = 0; k < 3; k++) {
      const dup = await actor.apply(seat, act, 1);
      assert.equal(dup.ok, true, '重复提交应返回成功（而不是报错）');
      assert.equal(dup.duplicate, true, '重复提交必须被标记为 duplicate');
      assert.equal(JSON.stringify(actor.getState()), afterFirst, '重复提交不得再次推进状态');
      assert.equal(dup.events.length, first.events.length, '重复提交不应再产生事件');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B1: 序号倒退的重发不会再次推进状态（缓存命中 or 过期拒绝）', async () => {
  const dir = makeTmp();
  try {
    const actor = await makeActor(dir, 'stale', 'seed-stale');
    const { trace } = await sequential(actor, 6);
    assert.ok(trace.length >= 2, '样本太短，断言无效');
    const before = JSON.stringify(actor.getState());

    // ① 命中幂等缓存的重发（这个序号确实被用过）→ 返回上次结果，状态不动
    const used = trace[trace.length - 2]!;
    const replay = await actor.apply(used.seat, used.action, used.clientSeq);
    assert.equal(replay.duplicate, true, '用过的序号必须被识别为重复');
    assert.equal(JSON.stringify(actor.getState()), before, '重复提交不得推进状态');

    // ② 缓存里没有、且序号早于已处理的最大序号 → 判为过期并拒绝
    const seat = used.seat;
    const staleSeq = Math.max(0, used.clientSeq - 1);
    const action = nextAction(actor.getState(), seat)
      ?? nextAction(actor.getState(), seat === 0 ? 1 : 0);
    assert.ok(action, '应仍能拿到一个动作');
    const stale = await actor.apply(seat, action, staleSeq);
    assert.equal(stale.duplicate, true, '过期提交应标记为 duplicate');
    assert.equal(JSON.stringify(actor.getState()), before, '过期提交不得推进状态');
    console.log(`     过期提交 → ok=${stale.ok} ${stale.error?.message ?? ''}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B2: MatchActor.recover 从日志重建 == 原状态', async () => {
  const dir = makeTmp();
  try {
    const log = await MatchLog.open(dir, 'rec');
    const actor = await MatchActor.create({
      roomId: 'rec', content, seed: 'rec-seed', heroes: ['barbarian', 'pyromancer'], log,
    });
    await sequential(actor, 40);
    const before = JSON.stringify(actor.getState());
    await actor.flush();

    const log2 = await MatchLog.open(dir, 'rec');
    const restored = await MatchActor.recover({
      roomId: 'rec', content, seed: 'rec-seed', heroes: ['barbarian', 'pyromancer'], log: log2,
    });
    assert.equal(JSON.stringify(restored.getState()), before, '重建状态必须逐字段一致');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
