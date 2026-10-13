/**
 * per-seat 视图投影 —— 架构 ADR-002。
 *
 * 这是**白名单**构造（不是深拷贝后 delete）：PlayerView 里根本不存在
 * rng / deck 顺序 / bucket 字段，客户端代码写不出读取它们的代码。
 */
import type { PlayerView, CardView, AbilityView } from '../types/view.js';
import type { CardInstance, GameState } from '../types/state.js';
import type { Seat } from '../types/core.js';
import type { ContentRegistry } from '../content/registry.js';
import { computeCandidates } from './engine.js';
import { Draft } from './effects.js';

function cardView(content: ContentRegistry, c: CardInstance): CardView {
  const def = content.getCard(c.defId);
  return {
    uid: c.uid,
    defId: c.defId,
    name: def.name,
    kind: def.kind,
    costCp: def.costCp,
    timing: [...def.timing],
    ...(def.targetAbilityId ? { targetAbilityId: def.targetAbilityId } : {}),
    ...(def.tier ? { tier: def.tier } : {}),
  };
}

function abilityViews(content: ContentRegistry, state: GameState, seat: Seat): AbilityView[] {
  const p = state.players[seat];
  const hero = content.getHero(p.heroId);
  return hero.abilities.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    tier: p.upgrades[a.id] ?? 1,
    ...(a.defenseDiceCount ? { defenseDiceCount: a.defenseDiceCount } : {}),
  }));
}

/** 自己牌库的剩余构成（多重集，顺序未知）——纯 UX 收益，零信息增益 */
function remainingDeckCounts(content: ContentRegistry, state: GameState, seat: Seat) {
  const p = state.players[seat];
  const total = new Map<string, number>();
  for (const c of p.deck) {
    total.set(c.defId, (total.get(c.defId) ?? 0) + 1);
  }
  return [...total.entries()].map(([defId, count]) => ({ defId, count }));
}

export function projectState(state: GameState, content: ContentRegistry, seat: Seat): PlayerView {
  const me = state.players[seat];
  const opp = state.players[seat === 0 ? 1 : 0];
  const d = new Draft(state, content);
  const candidates = computeCandidates(d, seat);

  return {
    you: seat,
    self: {
      seat,
      heroId: me.heroId,
      hp: me.hp,
      cp: me.cp,
      hand: me.hand.map((c) => cardView(content, c)),
      deckCount: me.deck.length,
      discard: me.discard.map((c) => cardView(content, c)),
      statuses: me.statuses.map((s) => ({ id: s.id, stacks: s.stacks })),
      abilities: abilityViews(content, state, seat),
      remainingDeckCounts: remainingDeckCounts(content, state, seat),
    },
    opponent: {
      seat: opp.seat,
      heroId: opp.heroId,
      hp: opp.hp,
      cp: opp.cp,
      // ★ 手牌只见张数
      handCount: opp.hand.length,
      deckCount: opp.deck.length,
      // 弃牌堆是公开信息
      discard: opp.discard.map((c) => cardView(content, c)),
      statuses: opp.statuses.map((s) => ({ id: s.id, stacks: s.stacks })),
      abilities: abilityViews(content, state, opp.seat),
      isThinking: state.pending?.seat === opp.seat,
    },
    shared: {
      turn: state.turn,
      phase: state.phase,
      ladderStep: state.ladderStep,
      activeSeat: state.activeSeat,
      diceValues: [...me.diceValues],
      diceLocked: [...me.diceLocked],
      rollAttemptsLeft: me.rollAttemptsLeft,
      candidates: candidates.map((c) => ({
        abilityId: c.abilityId,
        matchedIndices: [...c.matchedIndices],
        ...(c.tier !== undefined ? { tier: c.tier } : {}),
      })),
      pendingKind: state.pending?.kind ?? null,
      pendingOptions: (state.pending?.options ?? []).map((o) => ({ id: o.id, label: o.label })),
    },
    winner: state.winner,
    finished: state.finished,
  };
}
