# AGENTS.md

Dice Throne (王权骰铸) — server-authoritative online board game. npm workspaces monorepo:
`packages/shared` (rules engine + content), `packages/server` (Socket.IO), `packages/web` (React).
UI, comments, and README are in Chinese.

## Commands

Run from repo root after `npm install`.

- `npm test` — engine unit tests (`node --test` via `tsx`).
  - Single file: `node --import tsx --test packages/shared/src/engine/engine.test.ts`
  - Single test: add `--test-name-pattern "<name>"`.
- `npm run match` — M0 acceptance: plays a full scripted match. Pass a seed: `npm run match -- <seed>`. Same seed must produce byte-identical output.
- `npm run typecheck -w @dt/shared` — the only working typecheck (see Gotchas).
- `npm run dev:server` — Socket.IO server on `:3001` (persists JSONL to `PERSIST_DIR`, default `./.matches`).
- `npm run dev:web` — Vite on `:5173`; talks to `VITE_SERVER` or `http://localhost:3001`.

## Gotchas / current state

- **Root `npm run typecheck` is broken** (TS6059). `packages/server/tsconfig.json` sets `rootDir: ./src` but imports shared sources from `../../shared/src`. Use `-w @dt/shared` to typecheck the engine; don't chase this failure as a regression.
- **`packages/web` does not typecheck** (tsconfig has no DOM lib / `vite/client` types; React event typings fail). Don't assume `tsc` passes for web.
- **`npm run build` currently fails on Windows**: missing optional `@rollup/rollup-win32-x64-msvc` (npm optional-dependency bug). Fix by deleting `node_modules` + `package-lock.json` and reinstalling, or installing that package directly. Only `packages/web` has a build script.
- Architecture comments cite `架构 §...`; that design doc is **not in this repo** — don't search for it.

## Conventions

- Relative ESM imports carry the `.js` extension even though sources are `.ts` (`verbatimModuleSyntax`). Use `import type` for types.
- `strict` + `noUncheckedIndexedAccess`: indexed access yields `T | undefined`.
- `@dt/shared` path alias exists in `tsconfig.base.json` but is **unused**; server imports `../../shared/src/index.js` directly.
- `packages/web` does not import `@dt/shared`; `src/App.tsx` redeclares a local `View` interface mirroring `PlayerView` — keep it in sync by hand.

## Architecture (non-obvious)

- **Server-authoritative + info hiding**: full `GameState` lives only on the server (`packages/server/src/index.ts`); clients get a per-seat `PlayerView` built by `projectState(state, content, seat)`. Never leak RNG state or deck order into a view.
- **Pure reducer over serializable state**: `createMatch(content, {seed, heroes})`, `reduce(state, env, content) -> {ok, state, events}`, `getCandidates(...)`, `reduceAuto(...)` (auto-resolves pending points; used by the scripted match). Inputs are not mutated.
- **Determinism is a hard requirement**: seeded `sfc32` RNG with named streams (`engine/rng.ts`). Same seed ⇒ identical match/event sequence. Do not introduce `Math.random`/`Date.now` into the engine or content; the server uses them only for seed and persistence timestamps.
- **Damage is bucketed**: effects write into a damage bucket; HP is written exactly once per seat at the P6 flush via `flushForSeat`. Healing caps at 60 and cannot revive.
- **Effects must stay serializable**: `EffectDef` may not contain closures; behavior dispatches through `EFFECT_HANDLERS` keyed by clause kind.
- **Content is fail-fast**: `createDefaultRegistry()` runs `validate()` (content-lint) and throws on error at startup. Adding a hero = add a `HeroDef`, register it in `createDefaultRegistry()` (`content/registry.ts`), and export from `src/index.ts` — no engine changes.

## Not implemented (don't assume)

- Response-window stack (`ResponseWindow` type exists, not wired into resolution).
- Full card/upgrade UI in web; it's a thin skeleton (join, roll/lock, announce, end phase).
- Only 2 heroes: `barbarian`, `pyromancer`.
