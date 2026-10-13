import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

/** 与 shared 的 PlayerView 对齐的本地类型（前端不直接依赖服务端状态结构） */
interface View {
  you: 0 | 1;
  self: { heroId: string; hp: number; cp: number; hand: { uid: string; name: string; costCp: number }[]; deckCount: number; statuses: { id: string; stacks: number }[]; abilities: { id: string; name: string; tier: number }[] };
  opponent: { heroId: string; hp: number; cp: number; handCount: number; statuses: { id: string; stacks: number }[] };
  shared: {
    turn: number; phase: string; activeSeat: number;
    diceValues: number[]; diceLocked: boolean[]; rollAttemptsLeft: number;
    candidates: { abilityId: string; matchedIndices: number[] }[];
    pendingKind: string | null; pendingOptions: { id: string; label: string }[];
  };
  winner: 0 | 1 | 'draw' | null;
  finished: boolean;
}

const SERVER = import.meta.env.VITE_SERVER ?? 'http://localhost:3001';

export function App() {
  const [roomId, setRoomId] = useState('room-1');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const s = io(SERVER);
    s.on('state', (v: View) => setView(v));
    s.on('matchEnded', (p: { winner: unknown }) => addLog(`对局结束 winner=${String(p.winner)}`));
    setSocket(s);
    return () => { s.close(); };
  }, []);

  function addLog(line: string) {
    setLog((l) => [...l.slice(-50), line]);
  }

  function join() {
    if (!socket) return;
    socket.emit('room:join', { roomId }, (r: { seat: number; view: View }) => {
      setView(r.view);
      setJoined(true);
      addLog(`已加入房间 ${roomId}，座位 ${r.seat}`);
    });
  }

  function send(action: unknown) {
    if (!socket) return;
    socket.emit('game:action', { action }, (r: { ok: boolean; error?: unknown }) => {
      if (!r.ok) addLog(`动作被拒：${JSON.stringify(r.error)}`);
    });
  }

  const isMyTurn = useMemo(() => view?.shared.activeSeat === view?.you, [view]);
  const pending = view?.shared.pendingKind;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 500 }}>王权骰铸 · 网页对战</h1>

      {!joined && (
        <div style={{ marginBottom: 16 }}>
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ padding: 6, marginRight: 8 }} />
          <button onClick={join} style={{ padding: '6px 14px' }}>加入房间</button>
        </div>
      )}

      {view && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <Panel title={`对手 ${view.opponent.heroId}`}>
              <div>HP {view.opponent.hp}</div>
              <div>CP {view.opponent.cp}</div>
              <div>手牌 {view.opponent.handCount} 张</div>
              <Statuses list={view.opponent.statuses} />
            </Panel>
            <Panel title={`你 ${view.self.heroId}`}>
              <div>HP {view.self.hp}</div>
              <div>CP {view.self.cp}</div>
              <div>牌库 {view.self.deckCount} 张</div>
              <Statuses list={view.self.statuses} />
            </Panel>
          </div>

          <Panel title={`骰盘（剩余掷骰 ${view.shared.rollAttemptsLeft}）· 阶段 ${view.shared.phase} · 回合 ${view.shared.turn}`}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {view.shared.diceValues.length === 0 && <span style={{ color: '#888' }}>尚未掷骰</span>}
              {view.shared.diceValues.map((v, i) => (
                <button
                  key={i}
                  onClick={() => send({ t: 'toggleLock', index: i })}
                  style={{
                    width: 44, height: 44, fontSize: 18,
                    background: view.shared.diceLocked[i] ? '#FAEEDA' : '#F1EFE8',
                    border: '1px solid #888780', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            {isMyTurn && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {pending === 'abilityAnnounce' && (
                  <>
                    <button onClick={() => send({ t: 'performRoll' })} disabled={view.shared.rollAttemptsLeft <= 0}>掷骰</button>
                    {view.shared.candidates.map((c) => (
                      <button key={c.abilityId} onClick={() => send({ t: 'announceAbility', abilityId: c.abilityId })}>
                        激活 {view.self.abilities.find((a) => a.id === c.abilityId)?.name ?? c.abilityId}
                      </button>
                    ))}
                    <button onClick={() => send({ t: 'passAbility' })}>放弃激活</button>
                  </>
                )}
                {pending === 'defensiveRoll' && <button onClick={() => send({ t: 'defensiveRoll' })}>防御掷骰</button>}
                {pending === 'cardWindow' && <button onClick={() => send({ t: 'endMainPhase' })}>结束阶段</button>}
                {pending === 'discard' && <button onClick={() => send({ t: 'discardCards', uids: view.self.hand.slice(0, Math.max(0, view.self.hand.length - 6)).map((c) => c.uid) })}>弃牌</button>}
              </div>
            )}
            {!isMyTurn && <span style={{ color: '#888' }}>对手思考中…（回合制，不限时）</span>}
          </Panel>

          <Panel title="手牌">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {view.self.hand.map((c) => (
                <div key={c.uid} style={{ border: '1px solid #B4B2A9', borderRadius: 8, padding: '6px 10px' }}>
                  {c.name}（{c.costCp} CP）
                </div>
              ))}
              {view.self.hand.length === 0 && <span style={{ color: '#888' }}>无手牌</span>}
            </div>
          </Panel>

          <Panel title="日志">
            <div style={{ fontSize: 13, color: '#444', maxHeight: 160, overflow: 'auto' }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
              {log.length === 0 && <span style={{ color: '#888' }}>（暂无）</span>}
            </div>
          </Panel>

          {view.finished && (
            <div style={{ marginTop: 12, fontWeight: 500 }}>
              对局结束：{view.winner === 'draw' ? '平局' : `胜者 seat${view.winner}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #D3D1C7', borderRadius: 12, padding: 12, marginBottom: 12, flex: 1 }}>
      <div style={{ fontSize: 13, color: '#5F5E5A', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Statuses({ list }: { list: { id: string; stacks: number }[] }) {
  if (list.length === 0) return null;
  return (
    <div style={{ fontSize: 12, color: '#5F5E5A' }}>
      {list.map((s) => `${s.id}×${s.stacks}`).join('  ')}
    </div>
  );
}
