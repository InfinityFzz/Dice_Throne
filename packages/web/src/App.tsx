import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { resolveAsset, getActivePack, listCatalogIds } from './assets/index.js';
import type { AssetKind } from './assets/types.js';

/** 与 shared 的 PlayerView 对齐的本地类型（前端不直接依赖服务端状态结构） */
interface CardV { uid: string; defId: string; name: string; costCp: number; kind: string; timing: string[]; targetAbilityId?: string; tier?: number }
interface StatusV { id: string; stacks: number }
interface AbilityV { id: string; name: string; kind: string; tier: number; defenseDiceCount?: number }
interface View {
  you: 0 | 1;
  self: { heroId: string; hp: number; cp: number; hand: CardV[]; discard: CardV[]; deckCount: number; statuses: StatusV[]; abilities: AbilityV[] };
  opponent: { heroId: string; hp: number; cp: number; handCount: number; deckCount: number; discard: CardV[]; statuses: StatusV[]; abilities: AbilityV[] };
  shared: {
    turn: number; phase: string; ladderStep: string; activeSeat: number;
    diceValues: number[]; diceLocked: boolean[]; rollAttemptsLeft: number;
    candidates: { abilityId: string; tier?: number }[];
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>王权骰铸 · 网页对战</h1>
        <span style={{ fontSize: 12, color: '#5F5E5A' }}>资源包：{getActivePack()}</span>
      </div>

      {!view && <AssetAudit />}

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
              <HeroThumb heroId={view.opponent.heroId} />
              <div>HP {view.opponent.hp}</div>
              <div>CP {view.opponent.cp}</div>
              <div>手牌 {view.opponent.handCount} 张</div>
              <Statuses list={view.opponent.statuses} />
            </Panel>
            <Panel title={`你 ${view.self.heroId}`}>
              <HeroThumb heroId={view.self.heroId} />
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
                  title={view.shared.diceLocked[i] ? '已锁定' : '点击锁定/解锁'}
                  style={{
                    width: 52, height: 52, padding: 0, overflow: 'hidden',
                    background: view.shared.diceLocked[i] ? '#FAEEDA' : '#F1EFE8',
                    border: '1px solid #888780', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  <AssetImage kind="dieFace" id={`${view.self.heroId}:face:${v}`} width={50} height={50} alt={`骰面 ${v}`} fallbackText={String(v)} />
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
                <div key={c.uid} style={{ border: '1px solid #B4B2A9', borderRadius: 8, padding: 6, width: 92, textAlign: 'center' }}>
                  <AssetImage kind="card" id={c.defId} width={80} height={124} alt={c.name} fallbackText={c.name} />
                  <div style={{ fontSize: 11, marginTop: 4 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#5F5E5A' }}>{c.costCp} CP</div>
                </div>
              ))}
              {view.self.hand.length === 0 && <span style={{ color: '#888' }}>无手牌</span>}
            </div>
          </Panel>

          <Panel title="能力">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {view.self.abilities.map((a) => (
                <div key={a.id} style={{ width: 76, textAlign: 'center' }}>
                  <AssetImage kind="abilityIcon" id={a.id} width={64} height={64} alt={a.name} fallbackText={a.name} />
                  <div style={{ fontSize: 11 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: '#5F5E5A' }}>L{a.tier}</div>
                </div>
              ))}
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

function Statuses({ list }: { list: StatusV[] }) {
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {list.map((s) => (
        <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} title={`${s.id} ×${s.stacks}`}>
          <AssetImage kind="statusIcon" id={s.id} width={28} height={28} alt={s.id} fallbackText={s.id.slice(-2)} />
          <span style={{ fontSize: 12, color: '#5F5E5A' }}>×{s.stacks}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * 资产渲染的唯一入口：只调 resolveAsset，拿 url 直接喂 <img>。
 * 未知 id（不在 catalog）时 resolveAsset 会抛错 —— 这里降级为文字占位，不让整页崩。
 * substituted=true 表示当前包缺图、已落到 placeholder，用虚线框标出便于开发期补图。
 */
function AssetImage({ kind, id, width, height, alt, fallbackText }: {
  kind: AssetKind; id: string; width: number; height: number; alt?: string; fallbackText?: string;
}) {
  const ref = useMemo(() => {
    try {
      return resolveAsset(id, kind, { width, height });
    } catch {
      return null;
    }
  }, [kind, id, width, height]);

  if (!ref) {
    return <span style={{ fontSize: 11, color: '#888' }}>{fallbackText ?? id}</span>;
  }
  return (
    <img
      src={ref.url}
      alt={alt ?? id}
      width={width}
      height={height}
      title={ref.substituted ? `缺图（包 ${ref.pack} 无此资产）· ${id}` : id}
      style={{
        objectFit: 'contain',
        borderRadius: 6,
        display: 'block',
        ...(ref.substituted ? { outline: '1px dashed #B4B2A9', opacity: 0.9 } : {}),
      }}
    />
  );
}

function HeroThumb({ heroId }: { heroId: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <AssetImage kind="heroPanel" id={heroId} width={140} height={87} alt={heroId} fallbackText={heroId} />
    </div>
  );
}

/** 资源包自检：遍历 catalog 全部逻辑 id，统计真图命中 / 占位缺失，并预览前若干张真图。 */
function AssetAudit() {
  const report = useMemo(() => {
    const ids = listCatalogIds();
    const byKind = new Map<string, { hit: number; miss: number; samples: string[] }>();
    for (const { kind, id } of ids) {
      const acc = byKind.get(kind) ?? { hit: 0, miss: 0, samples: [] };
      try {
        const ref = resolveAsset(id, kind);
        if (ref.substituted) acc.miss++;
        else {
          acc.hit++;
          if (acc.samples.length < 6) acc.samples.push(ref.url);
        }
      } catch {
        acc.miss++;
      }
      byKind.set(kind, acc);
    }
    return { total: ids.length, byKind: [...byKind.entries()] };
  }, []);

  const hit = report.byKind.reduce((a, [, v]) => a + v.hit, 0);
  const samples = report.byKind.flatMap(([, v]) => v.samples).slice(0, 12);

  return (
    <Panel title={`资源包自检 · ${getActivePack()} · ${hit}/${report.total} 命中真图`}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {report.byKind.map(([kind, v]) => (
          <span key={kind} style={{ fontSize: 12, border: '1px solid #D3D1C7', borderRadius: 6, padding: '2px 6px' }}>
            {kind} {v.hit}/{v.hit + v.miss}
          </span>
        ))}
      </div>
      {samples.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {samples.map((u, i) => <img key={i} src={u} alt="" height={72} style={{ borderRadius: 4 }} />)}
        </div>
      )}
    </Panel>
  );
}
