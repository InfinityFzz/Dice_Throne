# AGENTS.md

Dice Throne (王权骰铸) — server-authoritative online board game. npm workspaces monorepo:
`packages/shared` (rules engine + content), `packages/server` (Socket.IO), `packages/web` (React).
UI, comments, and README are in Chinese.

## Commands

Run from repo root after `npm install`.

- `npm test` — engine + MatchActor unit tests (`node --test` via `tsx`).
  - Single file: `node --import tsx --test packages/shared/src/engine/engine.test.ts`
  - Single test: add `--test-name-pattern "<name>"`.
- `npm run match` — M0 acceptance: plays a full scripted match. Pass a seed: `npm run match -- <seed>`. Same seed must produce byte-identical output.
- `npm run e2e` — **M2 acceptance**: spawns a real server + two socket.io clients, plays a full match, then injects failures (duplicate submit / disconnect-rejoin / kill-and-restart / spectator leak scan).
- `npm run typecheck -w @dt/shared` — the only working typecheck (see Gotchas).
- `npm run dev:server` — Socket.IO server on `:3001` (persists JSONL to `PERSIST_DIR`, default `./.matches`).
- `npm run dev:web` — Vite on `:5173`; talks to `VITE_SERVER` or `http://localhost:3001`.

## Gotchas / current state

- **All three packages typecheck clean** (`tsc -p tsconfig.json --noEmit` in `shared`, `server`, `web`). The previously broken `server/tsconfig.json` `rootDir` and `web/tsconfig.json` missing DOM lib / `vite/client` types were fixed — don't reintroduce them.
- `npm run build` on Windows needs the optional `@rollup/rollup-win32-x64-msvc`; it is now recorded in `packages/web/package.json` optionalDependencies. If it's missing, install it directly rather than wiping `node_modules`.
- Architecture comments cite `架构 §...`; the design/architecture docs live in **`md/`** (not `docs/`): `md/docs/architecture/dice-throne-architecture.md` + `md/docs/architecture/adr/`, `md/design/`.
- Progress / gaps / plan: **`docs/PROGRESS.md`**; official-value audit: **`docs/content-audit-report.md`**.
- Real TTS artwork (`packages/web/src/assets/packs/local-tts/images/**`) is **gitignored** — never commit it, and never let `manifest.json` be the only thing that changes when you meant to import images. Asset pipeline: `npm run assets:import` → `assets:catalog` → `assets:check`; card-name → defId confirmation is `npm run assets:confirm` (table: `packs/local-tts/name-map.json`).
- `resolveAsset` **throws** on unknown logical ids (not in `ASSET_CATALOG`) — always wrap in try/catch or run `assets:catalog` after adding content.
- The UI has **no play-card entry points yet** even though the engine supports `playCard / buyUpgrade / sellCard / chooseOption`. See `docs/PROGRESS.md` P0.

## Conventions

- Relative ESM imports carry the `.js` extension even though sources are `.ts` (`verbatimModuleSyntax`). Use `import type` for types.
- `strict` + `noUncheckedIndexedAccess`: indexed access yields `T | undefined`.
- `@dt/shared` path alias in `tsconfig.base.json` is used by `packages/web` (via Vite workspace resolution); `packages/server` imports `../../shared/src/index.js` directly. Don't rely on the alias from server code.
- `packages/web` imports `@dt/shared` and has **no** hand-rolled mirror of `PlayerView` — never reintroduce one. Local hot-seat mode legitimately imports the engine (that tab *is* the authority); online mode only ever sees server-projected views.

## Architecture (non-obvious)

- **Server-authoritative + info hiding**: full `GameState` lives only on the server. Clients get a per-seat `PlayerView` built by `projectState(state, content, seat)`; spectators get `SpectatorView` from `projectSpectator(...)` (hand counts only, no `legalActions`). Never leak RNG state or deck order into a view.
- **One MatchActor per room** (`packages/server/src/matchActor.ts`): every state mutation goes through a Promise-chain FIFO queue; writes happen inside the queue so disk order == state order. Idempotency key is `seat + clientSeq` (per-client monotone counter, **not** `state.seq`).
- **Append-only persistence** (`shared/src/engine/persistence.ts` + `server/matchLog.ts`): JSONL rows are `meta` / `room` / `snapshot` / `act`. Recovery = last snapshot + replay of following `act`s. **Never use `writeFile` for persistence** — truncating/overwriting writes fail with EPERM on restricted mounts and break half-line recovery; always `appendFile`.
- **Protocol lives in `shared/types/net.ts`** — both sides import the same types. Socket.IO ack callbacks are the **last** positional arg: `socket.on('room:sync', (_payload, ack) => ...)`, even when the client sends no payload.
- **Every action ack carries the latest view**, so clients never need a separate resync call and cannot get stuck on stale state.
- **Pure reducer over serializable state**: `createMatch(content, {seed, heroes})`, `reduce(state, env, content) -> {ok, state, events}`, `getCandidates(...)`, `reduceAuto(...)` (auto-resolves pending points; used by the scripted match). Inputs are not mutated.
- **Determinism is a hard requirement**: seeded `sfc32` RNG with named streams (`engine/rng.ts`). Same seed ⇒ identical match/event sequence. Do not introduce `Math.random`/`Date.now` into the engine or content; the server uses them only for seed and persistence timestamps.
- **Damage is bucketed**: effects write into a damage bucket; HP is written exactly once per seat at the P6 flush via `flushForSeat`. Healing caps at 60 and cannot revive.
- **Effects must stay serializable**: `EffectDef` may not contain closures; behavior dispatches through `EFFECT_HANDLERS` keyed by clause kind.
- **Content is fail-fast**: `createDefaultRegistry()` runs `validate()` (content-lint) and throws on error at startup. Adding a hero = add a `HeroDef`, register it in `createDefaultRegistry()` (`content/registry.ts`), and export from `src/index.ts` — no engine changes.

## Not implemented (don't assume)

- Response-window stack (`ResponseWindow` type exists, not wired into resolution).
- Only 2 heroes: `barbarian`, `pyromancer`.
- Rooms are in-memory + JSONL; a room with **no** match yet (pure lobby) is not restored on restart unless a `room` log row exists (it always does after the first join).
- Idempotency cache is not persisted — after a server restart the first resubmit of a pre-kill seq is not flagged `duplicate` (state stays correct because seqs are monotone).
