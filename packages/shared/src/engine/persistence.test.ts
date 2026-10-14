/**
 * 持久化 / 回放（架构 §1.3 持久化，PROGRESS 阶段 B 的 B2）。
 *
 * 核心断言只有一条：**从日志重建出来的状态，必须与一路 reduce 过来的状态完全一致**。
 * 这条不成立，B2（kill -9 后重启能恢复）就是假的。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultRegistry, createMatch, reduce, getLegalActions,
  type Action, type ContentRegistry, type GameState, type Seat,
  type LogEntry,
} from '../index.js';
import { parseLog, replayLog, shouldSnapshot, type LogMeta } from './persistence.js';

const content: ContentRegistry = createDefaultRegistry();

/** 简易 AI：从 legalActions 里挑一个能执行的（偏好顺序固定，保证可复现） */
const PREF: readonly Action['t'][] = [
  'announceAbility', 'performRoll', 'defensiveRoll', 'endMainPhase',
  'playCard', 'buyUpgrade', 'chooseOption', 'discardCards', 'respondPass', 'passAbility',
];

function pickAction(s: GameState, seat: Seat): Action | null {
  const legal = getLegalActions(s, content, seat);
  for (const t of PREF) {
    const a = legal.find((x) => x.t === t && x.enabled);
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
      case 'discardCards': {
        // 弃到手牌上限：丢前面的
        const p = s.players[seat];
        const over = Math.max(0, p.hand.length - 6);
        return { t: 'discardCards', uids: p.hand.slice(0, over).map((c) => c.uid) };
      }
      case 'respondPass': return { t: 'respondPass' };
      case 'passAbility': return { t: 'passAbility' };
      default: return null;
    }
  }
  return null;
}

interface ScriptedRun {
  readonly meta: LogMeta;
  readonly entries: readonly LogEntry[];
  readonly final: GameState;
}

/** 跑 N 步真实动作，同时产出一份「如果落盘会写成什么样」的日志 */
function runScripted(seed: string, steps: number, snapshotEvery: number): ScriptedRun {
  const meta: LogMeta = {
    roomId: `room-${seed}`, seed, heroes: ['barbarian', 'pyromancer'], createdAt: 0,
  };
  const entries: LogEntry[] = [{ k: 'meta', ...meta }];
  let state = createMatch(content, { seed, heroes: meta.heroes });
  entries.push({ k: 'snapshot', seq: state.seq, state });

  let sinceSnapshot = 0;
  let clientSeq = 0;
  for (let i = 0; i < steps && !state.finished; i++) {
    const seat: Seat = state.pending?.seat ?? state.activeSeat;
    const action = pickAction(state, seat);
    if (!action) break;
    const r = reduce(state, { seat, action, clientSeq: ++clientSeq }, content);
    assert.ok(r.ok, `第 ${i} 步动作应被接受：${JSON.stringify(action)}`);
    state = r.state;
    entries.push({ k: 'act', seq: state.seq, seat, clientSeq, action, ts: 0 });
    sinceSnapshot++;
    if (shouldSnapshot(sinceSnapshot, snapshotEvery)) {
      entries.push({ k: 'snapshot', seq: state.seq, state });
      sinceSnapshot = 0;
    }
  }
  return { meta, entries, final: state };
}

test('B2: 从日志重建的状态 == 一路 reduce 过来的状态', () => {
  for (const seed of ['s1', 's2', 's3']) {
    // 快照间隔 13：日志里既有多个快照，最后一条快照之后也还留着几个 act 需要真正重放
    const run = runScripted(seed, 120, 13);
    const rebuilt = replayLog(run.entries, content);
    assert.equal(rebuilt.replayed > 0, true, '应至少重放了一个动作（否则测的是纯快照加载）');
    assert.equal(
      JSON.stringify(rebuilt.state),
      JSON.stringify(run.final),
      `seed=${seed} 重建状态必须逐字段一致`,
    );
    assert.equal(rebuilt.meta.seed, seed);
  }
});

test('B2: 只有 meta（无 snapshot / 无 act）也能重建出初始局面', () => {
  const meta: LogMeta = { roomId: 'r', seed: 'only-meta', heroes: ['barbarian', 'pyromancer'], createdAt: 0 };
  const fresh = createMatch(content, { seed: meta.seed, heroes: meta.heroes });
  const rebuilt = replayLog([{ k: 'meta', ...meta }], content);
  assert.equal(JSON.stringify(rebuilt.state), JSON.stringify(fresh));
  assert.equal(rebuilt.replayed, 0);
});

test('B2: 快照间隔不影响重建结果（1 / 7 / 1000 三种策略一致）', () => {
  const a = replayLog(runScripted('snap', 90, 1).entries, content).state;
  const b = replayLog(runScripted('snap', 90, 7).entries, content).state;
  const c = replayLog(runScripted('snap', 90, 1000).entries, content).state;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(b), JSON.stringify(c));
});

test('B2: 日志缺 meta 时报错（不静默开新局）', () => {
  assert.throws(() => replayLog([{ k: 'snapshot', seq: 0, state: {} }], content), /缺少 meta/);
});

test('B2: 日志半行（进程被 kill 时截断）被丢弃且不影响前面部分', () => {
  const run = runScripted('trunc', 60, 20);
  const text = `${run.entries.map((e) => JSON.stringify(e)).join('\n')}\n{"k":"act","seq":`;
  const parsed = parseLog(text);
  assert.equal(parsed.length, run.entries.length, '半行必须被丢弃');
  const rebuilt = replayLog(parsed, content);
  assert.equal(JSON.stringify(rebuilt.state), JSON.stringify(run.final));
});

test('B2: 日志与内容层不一致（动作已非法）时报错而非静默跳过', () => {
  const run = runScripted('bad', 30, 1000);
  // 篡改：把第一条 act 换成一个当前绝不可能合法的动作
  const idx = run.entries.findIndex((e) => e.k === 'act');
  const first = run.entries[idx];
  assert.ok(first && first.k === 'act');
  const tampered: LogEntry[] = run.entries.map((e, i) =>
    i === idx ? { ...first, action: { t: 'toggleLock', index: 99 } as Action } : e);
  assert.throws(() => replayLog(tampered, content), /重放被拒/);
});
