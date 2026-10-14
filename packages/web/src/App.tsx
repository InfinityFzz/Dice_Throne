import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  toAction, type Action, type LegalActionView, type PlayerView, type Seat,
} from '@dt/shared';
import { resolveAsset, getActivePack, listCatalogIds } from './assets/index.js';
import type { AssetKind } from './assets/types.js';
import { useLocalMatch, describeEvent } from './local.js';

const SERVER = import.meta.env.VITE_SERVER ?? 'http://localhost:3001';

export function App() {
  const [mode, setMode] = useState<'local' | 'online'>('local');
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1040, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>王权骰铸 · 网页对战</h1>
        <button onClick={() => setMode('local')} style={tabStyle(mode === 'local')}>本地热座</button>
        <button onClick={() => setMode('online')} style={tabStyle(mode === 'online')}>联机</button>
        <span style={{ fontSize: 12, color: '#5F5E5A' }}>资源包：{getActivePack()}</span>
      </div>
      {mode === 'local' ? <LocalGame /> : <OnlineGame />}
    </div>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', fontSize: 13, cursor: 'pointer',
  border: '1px solid #B4B2A9', borderRadius: 6,
  background: active ? '#FAEEDA' : '#fff', fontWeight: active ? 500 : 400,
});

/** 已在专属区域（骰子/手牌卡/能力）渲染的动作类型，不进通用动作条 */
const INLINE_TYPES = new Set<LegalActionView['t']>(['playCard', 'sellCard', 'buyUpgrade', 'toggleLock']);

// ── 本地热座 ───────────────────────────────────────────────

function LocalGame() {
  const m = useLocalMatch();
  const { view } = m;
  const legal = view.legalActions;

  const handActions = useMemo(() => {
    const map = new Map<string, { play?: LegalActionView; sell?: LegalActionView }>();
    for (const a of legal) {
      if (!a.uid) continue;
      const cur = map.get(a.uid) ?? {};
      if (a.t === 'playCard') cur.play = a;
      if (a.t === 'sellCard') cur.sell = a;
      map.set(a.uid, cur);
    }
    return map;
  }, [legal]);

  const upgradeActions = useMemo(() => {
    const map = new Map<string, LegalActionView[]>();
    for (const a of legal) {
      if (a.t !== 'buyUpgrade' || !a.abilityId) continue;
      map.set(a.abilityId, [...(map.get(a.abilityId) ?? []), a]);
    }
    return map;
  }, [legal]);

  function run(a: LegalActionView, extraUids?: readonly string[]) {
    const action = toAction(a, extraUids ? { uids: extraUids } : undefined);
    if (action) m.dispatch(action);
  }

  const actor: Seat = m.state.pending?.seat ?? m.state.activeSeat;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#5F5E5A' }}>
          回合 {view.shared.turn} · 阶段 {view.shared.phase} · 行动方 seat{actor}
        </span>
        <span style={{ fontSize: 12, color: '#5F5E5A' }}>视角：</span>
        {(['auto', 0, 1] as const).map((v) => (
          <button key={String(v)} onClick={() => m.setViewer(v)} style={tabStyle(m.viewer === v)}>
            {v === 'auto' ? '跟随行动方' : `seat${v}`}
          </button>
        ))}
        <button onClick={() => m.reset()} style={tabStyle(false)}>重开一局</button>
      </div>

      {m.lastError && (
        <div style={{ color: '#A32D2D', fontSize: 13, marginBottom: 8 }}>动作被拒：{m.lastError}</div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <Panel title={`对手 ${view.opponent.heroId}（seat${view.opponent.seat}）`}>
          <HeroThumb heroId={view.opponent.heroId} />
          <div>HP {view.opponent.hp}</div>
          <div>CP {view.opponent.cp}</div>
          <div>手牌 {view.opponent.handCount} 张 · 牌库 {view.opponent.deckCount} 张</div>
          <Statuses list={view.opponent.statuses} />
        </Panel>
        <Panel title={`你 ${view.self.heroId}（seat${view.self.seat}）`}>
          <HeroThumb heroId={view.self.heroId} />
          <div>HP {view.self.hp}</div>
          <div>CP {view.self.cp}</div>
          <div>牌库 {view.self.deckCount} 张 · 弃牌 {view.self.discard.length} 张</div>
          <Statuses list={view.self.statuses} />
        </Panel>
      </div>

      <Panel title={`骰盘（剩余掷骰 ${view.shared.rollAttemptsLeft}）`}>
        <DiceTray
          view={view}
          onLock={(i) => {
            const a = legal.find((x) => x.t === 'toggleLock' && x.index === i && x.enabled);
            if (a) run(a);
          }}
          lockable={(i) => legal.some((x) => x.t === 'toggleLock' && x.index === i && x.enabled)}
        />
        <ActionRow
          actions={legal.filter((a) => !INLINE_TYPES.has(a.t))}
          onRun={run}
          hand={view.self.hand.map((c) => c.uid)}
        />
      </Panel>

      <Panel title={`手牌（${view.self.hand.length}）`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view.self.hand.map((c) => {
            const acts = handActions.get(c.uid) ?? {};
            return (
              <div key={c.uid} style={{ border: '1px solid #B4B2A9', borderRadius: 8, padding: 6, width: 104, textAlign: 'center' }}>
                <AssetImage kind="card" id={c.defId} width={92} height={143} alt={c.name} fallbackText={c.name} />
                <div style={{ fontSize: 11, marginTop: 4 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: '#5F5E5A', marginBottom: 4 }}>
                  {c.costCp} CP{c.tier ? ` · L${c.tier}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                  {acts.play && (
                    <button onClick={() => run(acts.play!)} disabled={!acts.play.enabled}
                      title={acts.play.reason ?? acts.play.label} style={miniBtn(!acts.play.enabled)}>打出</button>
                  )}
                  {acts.sell && (
                    <button onClick={() => run(acts.sell!)} title={acts.sell.label} style={miniBtn(false)}>卖 +1</button>
                  )}
                </div>
              </div>
            );
          })}
          {view.self.hand.length === 0 && <span style={{ color: '#888' }}>无手牌</span>}
        </div>
      </Panel>

      <Panel title="能力">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view.self.abilities.map((a) => {
            const ups = upgradeActions.get(a.id) ?? [];
            return (
              <div key={a.id} style={{ width: 92, textAlign: 'center' }}>
                <AssetImage kind="abilityIcon" id={a.id} width={72} height={72} alt={a.name} fallbackText={a.name} />
                <div style={{ fontSize: 11 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: '#5F5E5A' }}>L{a.tier}</div>
                {ups.map((u) => (
                  <button key={u.tier} onClick={() => run(u)} disabled={!u.enabled}
                    title={u.reason ?? u.label} style={miniBtn(!u.enabled)}>升 L{u.tier}</button>
                ))}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="战斗日志">
        <div style={{ fontSize: 13, color: '#444', maxHeight: 180, overflow: 'auto' }}>
          {m.events.map(describeEvent).filter((x): x is string => x !== null).slice(-60).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          {m.events.length === 0 && <span style={{ color: '#888' }}>（暂无）</span>}
        </div>
      </Panel>

      {view.finished && (
        <div style={{ marginTop: 12, fontWeight: 500 }}>
          对局结束：{view.winner === 'draw' ? '平局' : `seat${view.winner} 获胜`}
        </div>
      )}
      <AssetAudit />
    </>
  );
}

// ── 联机 ───────────────────────────────────────────────────

function OnlineGame() {
  const [roomId, setRoomId] = useState('room-1');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const s = io(SERVER);
    s.on('state', (v: PlayerView) => setView(v));
    s.on('matchEnded', (p: { winner: unknown }) => addLog(`对局结束 winner=${String(p.winner)}`));
    setSocket(s);
    return () => { s.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addLog(line: string) { setLog((l) => [...l.slice(-50), line]); }

  function join() {
    if (!socket) return;
    socket.emit('room:join', { roomId }, (r: { seat: number; view: PlayerView }) => {
      setView(r.view);
      setJoined(true);
      addLog(`已加入房间 ${roomId}，座位 ${r.seat}`);
    });
  }

  function send(action: Action) {
    if (!socket) return;
    socket.emit('game:action', { action }, (r: { ok: boolean; error?: unknown }) => {
      if (!r.ok) addLog(`动作被拒：${JSON.stringify(r.error)}`);
    });
  }

  if (!view) {
    return (
      <div style={{ marginBottom: 16 }}>
        <input value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ padding: 6, marginRight: 8 }} />
        <button onClick={join} style={{ padding: '6px 14px' }}>加入房间</button>
        <AssetAudit />
      </div>
    );
  }

  const legal = view.legalActions;
  const isMyTurn = view.shared.activeSeat === view.you || view.shared.pendingKind !== null;

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
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
        <DiceTray
          view={view}
          onLock={(i) => {
            const a = legal.find((x) => x.t === 'toggleLock' && x.index === i && x.enabled);
            const act = a && toAction(a);
            if (act) send(act);
          }}
          lockable={(i) => legal.some((x) => x.t === 'toggleLock' && x.index === i && x.enabled)}
        />
        <ActionRow
          actions={legal.filter((a) => !INLINE_TYPES.has(a.t))}
          onRun={(a, uids) => {
            const act = toAction(a, uids ? { uids } : undefined);
            if (act) send(act);
          }}
          hand={view.self.hand.map((c) => c.uid)}
        />
        {!isMyTurn && <div style={{ color: '#888', fontSize: 13, marginTop: 6 }}>对手思考中…（回合制，不限时）</div>}
      </Panel>

      <Panel title={`手牌（${view.self.hand.length}）`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view.self.hand.map((c) => {
            const play = legal.find((a) => a.t === 'playCard' && a.uid === c.uid);
            const sell = legal.find((a) => a.t === 'sellCard' && a.uid === c.uid);
            return (
              <div key={c.uid} style={{ border: '1px solid #B4B2A9', borderRadius: 8, padding: 6, width: 104, textAlign: 'center' }}>
                <AssetImage kind="card" id={c.defId} width={92} height={143} alt={c.name} fallbackText={c.name} />
                <div style={{ fontSize: 11, marginTop: 4 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: '#5F5E5A', marginBottom: 4 }}>{c.costCp} CP</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                  {play && (
                    <button onClick={() => { const x = toAction(play); if (x) send(x); }}
                      disabled={!play.enabled} title={play.reason ?? play.label} style={miniBtn(!play.enabled)}>打出</button>
                  )}
                  {sell && (
                    <button onClick={() => { const x = toAction(sell); if (x) send(x); }} style={miniBtn(false)}>卖 +1</button>
                  )}
                </div>
              </div>
            );
          })}
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
          对局结束：{view.winner === 'draw' ? '平局' : `seat${view.winner} 获胜`}
        </div>
      )}
      {joined && <div style={{ fontSize: 12, color: '#5F5E5A' }}>房间 {roomId} · 座位 {view.you}</div>}
    </>
  );
}

// ── 通用组件 ───────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #D3D1C7', borderRadius: 12, padding: 12, marginBottom: 12, flex: 1 }}>
      <div style={{ fontSize: 13, color: '#5F5E5A', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function DiceTray({ view, onLock, lockable }: {
  view: PlayerView;
  onLock: (index: number) => void;
  lockable: (index: number) => boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      {view.shared.diceValues.length === 0 && <span style={{ color: '#888' }}>尚未掷骰</span>}
      {view.shared.diceValues.map((v, i) => (
        <button
          key={i}
          onClick={() => onLock(i)}
          disabled={!lockable(i)}
          title={view.shared.diceLocked[i] ? '点击解锁' : '点击锁定'}
          style={{
            width: 54, height: 54, padding: 0, overflow: 'hidden',
            cursor: lockable(i) ? 'pointer' : 'default',
            background: view.shared.diceLocked[i] ? '#FAEEDA' : '#F1EFE8',
            border: `1px solid ${view.shared.diceLocked[i] ? '#EF9F27' : '#888780'}`,
            borderRadius: 8,
          }}
        >
          <AssetImage kind="dieFace" id={`${view.self.heroId}:face:${v}`} width={52} height={52} alt={`骰面 ${v}`} fallbackText={String(v)} />
        </button>
      ))}
    </div>
  );
}

function ActionRow({ actions, onRun, hand }: {
  actions: readonly LegalActionView[];
  onRun: (a: LegalActionView, uids?: readonly string[]) => void;
  hand: readonly string[];
}) {
  if (actions.length === 0) return <span style={{ color: '#888', fontSize: 13 }}>当前无可执行动作</span>;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {actions.map((a, i) => (
        <button
          key={`${a.t}-${a.abilityId ?? a.optionId ?? i}`}
          onClick={() => onRun(a, a.t === 'discardCards' ? hand.slice(0, Math.max(0, hand.length - 6)) : undefined)}
          disabled={!a.enabled}
          title={a.reason ?? a.label}
          style={{
            padding: '6px 12px', fontSize: 13, cursor: a.enabled ? 'pointer' : 'not-allowed',
            border: '1px solid #B4B2A9', borderRadius: 6,
            background: a.enabled ? '#fff' : '#F1EFE8', color: a.enabled ? '#000' : '#888',
          }}
        >
          {a.label}{!a.enabled && a.reason ? `（${a.reason}）` : ''}
        </button>
      ))}
    </div>
  );
}

function Statuses({ list }: { list: readonly { id: string; stacks: number }[] }) {
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

  if (!ref) return <span style={{ fontSize: 11, color: '#888' }}>{fallbackText ?? id}</span>;
  return (
    <img
      src={ref.url}
      alt={alt ?? id}
      width={width}
      height={height}
      title={ref.substituted ? `缺图（包 ${ref.pack} 无此资产）· ${id}` : id}
      style={{
        objectFit: 'contain', borderRadius: 6, display: 'block', margin: '0 auto',
        ...(ref.substituted ? { outline: '1px dashed #B4B2A9', opacity: 0.9 } : {}),
      }}
    />
  );
}

function HeroThumb({ heroId }: { heroId: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <AssetImage kind="heroPanel" id={heroId} width={150} height={93} alt={heroId} fallbackText={heroId} />
    </div>
  );
}

const miniBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '3px 8px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid #B4B2A9', borderRadius: 5,
  background: disabled ? '#F1EFE8' : '#fff', color: disabled ? '#888' : '#000',
});

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
