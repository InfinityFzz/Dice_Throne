/**
 * legalActions 属性测试 + T14 投影泄漏测试（架构 §2.2.2 / §2.2.3）。
 *
 * 两条核心性质：
 * 1. 「UI 可见 ⇔ 引擎接受」：对任意推进到的 state，legalActions 中 enabled=true 的项
 *    喂给 reduce() 必须被接受（不返回 notYourTurn / wrongPhase / illegalAction / notEnoughCp）。
 * 2. T14：PlayerView 的序列化中不得出现对手手牌 uid、牌库卡 uid、rng 状态、bucket 明细。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultRegistry, createMatch, reduce, reduceAuto, projectState, projectSpectator,
  filterEvents, getLegalActions, toAction, type ContentRegistry, type GameState, type Seat,
  type ActionEnvelope, type LegalActionView,
} from '../index.js';

const content: ContentRegistry = createDefaultRegistry();

/** 待推进时由谁行动：pending 优先，否则行动方 */
function actorOf(s: GameState): Seat {
  return s.pending ? s.pending.seat : s.activeSeat;
}

/** 极简 AI：按优先级挑一个 enabled 动作 */
const PRIORITY: readonly LegalActionView['t'][] = [
  'announceAbility', 'performRoll', 'buyUpgrade', 'playCard', 'endMainPhase',
  'defensiveRoll', 'chooseOption', 'discardCards', 'passAbility', 'sellCard', 'respondPass',
];
function pick(s: GameState, legal: readonly LegalActionView[]): ActionEnvelope | null {
  const seat = actorOf(s);
  for (const t of PRIORITY) {
    const hit = legal.find((a) => a.t === t && a.enabled);
    if (!hit) continue;
    let uids: readonly string[] | undefined;
    if (t === 'discardCards') {
      const p = s.players[seat];
      uids = p.hand.slice(0, Math.max(0, p.hand.length - 6)).map((c) => c.uid);
    }
    const action = toAction(hit, uids ? { uids } : undefined);
    if (!action) continue;
    return { seat, action, clientSeq: s.seq };
  }
  return null;
}

/** 性质 1：可见即可执行（在副本上试探，不推进主流程） */
function assertEnabledActionsAccepted(s: GameState): void {
  const seat = actorOf(s);
  const legal = getLegalActions(s, content, seat);
  for (const a of legal) {
    if (!a.enabled) continue;
    const action = toAction(a);
    if (!action) continue;
    if (a.t === 'discardCards') continue; // uids 由 UI 选，单独测
    const r = reduce(s, { seat, action, clientSeq: s.seq }, content);
    assert.equal(
      r.ok, true,
      `legalActions 声明可执行但被拒：${a.t} / ${a.label} → ${r.ok ? '' : `${r.error.code}:${r.error.message}`}（phase=${s.phase}）`,
    );
  }
  // 非行动方不应拿到越权动作
  const other: Seat = seat === 0 ? 1 : 0;
  for (const a of getLegalActions(s, content, other)) {
    if (!a.enabled) continue;
    if (a.t === 'defensiveRoll' || a.t === 'chooseOption' || a.t === 'respondPass') continue;
    assert.fail(`非行动方不应出现可执行动作：${a.t}（phase=${s.phase} pending=${s.pending?.kind ?? '-'}）`);
  }
}

/** 性质 2（T14）：投影不得泄漏隐藏信息 */
function assertNoLeak(s: GameState): void {
  for (const seat of [0, 1] as Seat[]) {
    const view = projectState(s, content, seat);
    const blob = JSON.stringify(view);
    const me = s.players[seat];
    const opp = s.players[seat === 0 ? 1 : 0];

    // uid 形如 "0-2"，必须按 JSON 字段精确匹配，否则 "10-2" / "1-34" 会误命中
    const hasUid = (uid: string): boolean => blob.includes(`"uid":"${uid}"`);

    for (const c of opp.hand) {
      assert.ok(!hasUid(c.uid), `T14 泄漏：对手手牌 uid ${c.uid} 出现在 PlayerView`);
    }
    for (const c of opp.deck) {
      assert.ok(!hasUid(c.uid), `T14 泄漏：对手牌库 uid ${c.uid} 出现在 PlayerView`);
    }
    for (const c of me.deck) {
      assert.ok(!hasUid(c.uid), `T14 泄漏：自己牌库 uid ${c.uid}（顺序属隐藏信息）出现在 PlayerView`);
    }
    // rng 是嵌套对象，序列化后必然带 rngSeed / rngStreams 之类的键
    assert.ok(!blob.includes('"rng"'), 'T14 泄漏：rng 出现在 PlayerView');
    assert.ok(!blob.includes('rngSeed'), 'T14 泄漏：rngSeed 出现在 PlayerView');
    assert.ok(!blob.includes('rngStreams'), 'T14 泄漏：rngStreams 出现在 PlayerView');
    assert.ok(!blob.includes('"bucket"'), 'T14 泄漏：bucket 出现在 PlayerView');
    assert.ok(!blob.includes('pendingRecoils'), 'T14 泄漏：bucket 明细出现在 PlayerView');
    // 手牌只见张数
    assert.equal(view.opponent.handCount, opp.hand.length);
  }
}

test('legalActions 与 reduce 守卫一致：可见即可执行（多seed推进）', () => {
  for (const seed of ['la-1', 'la-2', 'la-3', 'la-4', 'la-5']) {
    let s = createMatch(content, { seed, heroes: ['barbarian', 'pyromancer'] });
    assertNoLeak(s);
    let steps = 0;
    while (!s.finished && steps++ < 1200) {
      assertEnabledActionsAccepted(s);
      const env = pick(s, getLegalActions(s, content, actorOf(s)));
      if (!env) break;
      const r = reduce(s, env, content);
      assert.equal(r.ok, true, `推进失败 seed=${seed} step=${steps}: ${r.ok ? '' : r.error.message}`);
      s = r.state;
      if (steps % 7 === 0) assertNoLeak(s);
    }
    assert.ok(s.finished, `seed=${seed} 未能在 1200 步内分出胜负（steps=${steps} turn=${s.turn}）`);
  }
});

test('T14：投影不含对手手牌/牌库 uid、rng、bucket', () => {
  let s = createMatch(content, { seed: 't14', heroes: ['barbarian', 'pyromancer'] });
  for (let i = 0; i < 60 && !s.finished; i++) {
    const env = pick(s, getLegalActions(s, content, actorOf(s)));
    if (!env) break;
    const r = reduce(s, env, content);
    if (!r.ok) break;
    s = r.state;
  }
  assertNoLeak(s);
});

test('CP 不足时动作仍下发但 enabled=false 且带原因', () => {
  // 用固定种子推进到主要阶段，检查是否出现 disabled 项（CP 不足以买高费升级/打出贵牌）
  let s = createMatch(content, { seed: 'cp-check', heroes: ['barbarian', 'pyromancer'] });
  let sawDisabled = false;
  for (let i = 0; i < 200 && !s.finished; i++) {
    const seat = actorOf(s);
    const legal = getLegalActions(s, content, seat);
    for (const a of legal) {
      if (!a.enabled) {
        sawDisabled = true;
        assert.ok(a.reason && a.reason.length > 0, `disabled 动作必须给出原因：${a.t}`);
        // 且引擎确实会拒
        const action = toAction(a);
        if (action && a.t !== 'discardCards') {
          const r = reduce(s, { seat, action, clientSeq: s.seq }, content);
          assert.equal(r.ok, false, `disabled 动作却被执行成功：${a.t}`);
        }
      }
    }
    const env = pick(s, legal);
    if (!env) break;
    const r = reduce(s, env, content);
    if (!r.ok) break;
    s = r.state;
  }
  assert.ok(sawDisabled, '样本中未出现任何 disabled 动作，断言无效（应换种子）');
});

test('主要阶段能拿到出牌与买升级动作', () => {
  let s = createMatch(content, { seed: 'main-actions', heroes: ['barbarian', 'pyromancer'] });
  let sawPlay = false, sawUpgrade = false;
  for (let i = 0; i < 200 && !s.finished; i++) {
    const seat = actorOf(s);
    if (s.phase === 'main1' || s.phase === 'main2') {
      const legal = getLegalActions(s, content, seat);
      if (legal.some((a) => a.t === 'playCard')) sawPlay = true;
      if (legal.some((a) => a.t === 'buyUpgrade')) sawUpgrade = true;
    }
    const env = pick(s, getLegalActions(s, content, actorOf(s)));
    if (!env) break;
    const r = reduce(s, env, content);
    if (!r.ok) break;
    s = r.state;
  }
  assert.ok(sawPlay, '主要阶段应能拿到 playCard 动作');
  assert.ok(sawUpgrade, '主要阶段应能拿到 buyUpgrade 动作');
});

/**
 * T14（观战位）：SpectatorView 是第三个投影视角，必须同样无泄漏 ——
 * 而且比 PlayerView 更严：**任何一方**的手牌 uid 都不能出现，两侧都只见张数。
 */
function assertNoSpectatorLeak(s: GameState): void {
  const view = projectSpectator(s, content);
  const blob = JSON.stringify(view);
  const hasUid = (uid: string): boolean => blob.includes(`"uid":"${uid}"`);
  for (const seat of [0, 1] as Seat[]) {
    for (const c of s.players[seat].hand) {
      assert.ok(!hasUid(c.uid), `T14 泄漏：观战视图出现 seat${seat} 手牌 uid ${c.uid}`);
    }
    for (const c of s.players[seat].deck) {
      assert.ok(!hasUid(c.uid), `T14 泄漏：观战视图出现 seat${seat} 牌库 uid ${c.uid}`);
    }
    assert.equal(view.players[seat].handCount, s.players[seat].hand.length);
  }
  for (const forbidden of ['"rng"', '"bucket"', 'pendingRecoils', 'remainingDeckCounts']) {
    assert.ok(!blob.includes(forbidden), `T14 泄漏：观战视图出现 ${forbidden}`);
  }
  assert.equal(view.legalActions.length, 0, '观战者不应拿到任何可执行动作');
  assert.equal(view.you, null);
}

test('T14：观战投影不含任一方手牌 uid / rng / bucket，且无可执行动作', () => {
  let s = createMatch(content, { seed: 'spec', heroes: ['barbarian', 'pyromancer'] });
  assertNoSpectatorLeak(s);
  for (let i = 0; i < 60 && !s.finished; i++) {
    const env = pick(s, getLegalActions(s, content, actorOf(s)));
    if (!env) break;
    const r = reduce(s, env, content);
    if (!r.ok) break;
    s = r.state;
    if (i % 5 === 0) assertNoSpectatorLeak(s);
  }
  assertNoSpectatorLeak(s);
});

test('事件按 visibility 过滤：server 事件永不下发，seat 事件只给本人', () => {
  const serverOnly = { seq: 1, type: 'note' as const, turn: 0, phase: 'main1',
    visibility: { v: 'server' } as const, payload: {} };
  const forSeat0 = { seq: 2, type: 'note' as const, turn: 0, phase: 'main1',
    visibility: { v: 'seat', seat: 0 } as const, payload: {} };
  const publicEv = { seq: 3, type: 'note' as const, turn: 0, phase: 'main1',
    visibility: { v: 'public' } as const, payload: {} };
  const all = [serverOnly, forSeat0, publicEv];

  assert.deepEqual(filterEvents(all, 0).map((e) => e.seq), [2, 3]);
  assert.deepEqual(filterEvents(all, 1).map((e) => e.seq), [3]);
  // 观战者只能看 public
  assert.deepEqual(filterEvents(all, null).map((e) => e.seq), [3]);
});
