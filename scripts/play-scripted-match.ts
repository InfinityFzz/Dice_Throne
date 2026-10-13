/**
 * M0 验收脚本：从固定种子跑完整局到分出胜负。
 *
 * 用法：npm run match  （或 node --import tsx scripts/play-scripted-match.ts）
 *
 * 验收标准：
 * 1. 同一 seed 两次运行结果完全一致（确定性）。
 * 2. 能跑到 winner 非 null（不会卡死在某个阶段）。
 * 3. 事件序列快照稳定。
 */
import {
  createDefaultRegistry, createMatch, reduce, getCandidates,
  type GameState, type ActionEnvelope, type Seat,
} from '../packages/shared/src/index.js';

const SEED = process.argv[2] ?? 'dice-throne-m0';
const MAX_STEPS = 400;

const content = createDefaultRegistry();
let state: GameState = createMatch(content, { seed: SEED, heroes: ['barbarian', 'pyromancer'] });

console.log(`=== 王权骰铸 M0 脚本对战 ===`);
console.log(`seed=${SEED}  先手=seat${state.startSeat}`);
console.log(`座位0=${state.players[0].heroId}  座位1=${state.players[1].heroId}\n`);

/** 极简启发式 AI：能激活就激活，不能就再掷一次，没次数了就放弃 */
function chooseAction(s: GameState): ActionEnvelope | null {
  const p = s.pending;
  if (!p) return null;
  const seat = p.seat;

  switch (p.kind) {
    case 'abilityAnnounce': {
      const cands = getCandidates(s, content, seat);
      const player = s.players[seat];
      // 大招优先，其次任意可激活能力
      const hero = content.getHero(player.heroId);
      const ultimate = cands.find((c) => hero.abilities.find((a) => a.id === c.abilityId)?.kind === 'ultimate');
      if (ultimate) return { seat, action: { t: 'announceAbility', abilityId: ultimate.abilityId }, clientSeq: s.seq };
      if (cands.length > 0 && player.rollAttemptsLeft <= 1) {
        return { seat, action: { t: 'announceAbility', abilityId: cands[0]!.abilityId }, clientSeq: s.seq };
      }
      if (player.rollAttemptsLeft > 0) {
        return { seat, action: { t: 'performRoll' }, clientSeq: s.seq };
      }
      if (cands.length > 0) {
        return { seat, action: { t: 'announceAbility', abilityId: cands[0]!.abilityId }, clientSeq: s.seq };
      }
      return { seat, action: { t: 'passAbility' }, clientSeq: s.seq };
    }
    case 'defensiveRoll':
      return { seat, action: { t: 'defensiveRoll' }, clientSeq: s.seq };
    case 'cardWindow':
      return { seat, action: { t: 'endMainPhase' }, clientSeq: s.seq };
    case 'discard': {
      const player = s.players[seat];
      const need = player.hand.length - 6;
      if (need <= 0) return { seat, action: { t: 'endMainPhase' }, clientSeq: s.seq };
      return { seat, action: { t: 'discardCards', uids: player.hand.slice(0, need).map((c) => c.uid) }, clientSeq: s.seq };
    }
    default:
      return { seat, action: { t: 'endMainPhase' }, clientSeq: s.seq };
  }
}

let steps = 0;
let lastTurn = -1;
while (!state.finished && steps++ < MAX_STEPS) {
  if (state.turn !== lastTurn && state.turn % 5 === 0) {
    lastTurn = state.turn;
    console.log(`[回合 ${state.turn}] seat0 HP=${state.players[0].hp} CP=${state.players[0].cp} | seat1 HP=${state.players[1].hp} CP=${state.players[1].cp}`);
  }
  const env = chooseAction(state);
  if (!env) { console.log('无可执行动作，中止'); break; }

  const r = reduce(state, env, content);
  if (!r.ok) {
    console.error(`❌ 动作被拒: ${r.error.code} - ${r.error.message}`);
    console.error(`   seat=${env.seat} action=${JSON.stringify(env.action)} phase=${state.phase}`);
    process.exit(1);
  }
  for (const ev of r.events) {
    if (ev.type === 'damageApplied') {
      console.log(`  ⚔ seat${ev.payload.seat} 受到 ${ev.payload.net} 伤害 → HP ${ev.payload.hpAfter}`);
    } else if (ev.type === 'matchEnded') {
      console.log(`\n🏁 对局结束：winner=${ev.payload.winner}${ev.payload.reason ? ` (${ev.payload.reason})` : ''}`);
    }
  }
  state = r.state;
}

console.log(`\n=== 结果 ===`);
console.log(`总步数=${steps}  回合数=${state.turn}`);
console.log(`seat0 HP=${state.players[0].hp}  seat1 HP=${state.players[1].hp}`);
console.log(`winner=${state.winner}  finished=${state.finished}`);

if (!state.finished) {
  console.error('\n❌ M0 未通过：对局未分出胜负');
  process.exit(1);
}
console.log('\n✅ M0 通过：脚本对战跑完整局');
