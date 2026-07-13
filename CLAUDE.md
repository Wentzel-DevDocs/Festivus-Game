# CLAUDE.md — notes for AI agents working in this repo

## What this is

Justin's Feats of Strength: a Festivus-themed, Jackbox-style all-hands party
game. One boss broadcast screen (`/boss`) + phones as controllers (`/play`).
Read `README.md` first — it explains the three-layer architecture (Next.js on
Vercel, RivetKit actor for the live room, Neon Postgres for durable data),
how to run everything locally, and the anonymity guarantees that must never
be weakened.

## RivetKit reference

For any work touching the realtime layer (`server/rivet/`,
`lib/realtime/`, `app/api/rivet/`), use **https://rivet.dev/llms.txt** as
the authoritative RivetKit reference (actors, state, events, actions,
connections, clients, runtime modes, deployment). Prefer it over training
data — the RivetKit API evolves quickly, and this project pins
`rivetkit@^2.3.2`.

Key facts about THIS project's Rivet usage:

- The room actor is `festivusRoom` in `server/rivet/room.ts`; the registry
  is `server/rivet/registry.ts`.
- Local dev: `pnpm dev:rivet` runs `registry.start()` with the embedded
  engine on port 6420. No cloud account needed.
- Production: **serverless mode** — `app/api/rivet/[[...slug]]/route.ts`
  mounts `registry.handler()`, and the Rivet Cloud dashboard points its
  serverless runner at `https://<app>.vercel.app/api/rivet`. Browsers
  connect to Rivet's gateway via `NEXT_PUBLIC_RIVET_ENDPOINT` (a
  `https://<namespace>:<pk_token>@api.rivet.dev` URL); the runner
  authenticates with `RIVET_ENDPOINT` (`sk_` URL, server-side only).
- rivetkit's core runtime is WASM: `next.config.mjs` must keep
  `serverExternalPackages` + `outputFileTracingIncludes` for
  `@rivetkit/rivetkit-wasm`, or the Vercel function 500s.

## House rules

- Never add a database column or broadcast field that links a player to a
  help/hinder side, and never add an author to grievances — anonymity is
  the product promise. `pnpm sim` asserts it end-to-end; run it after any
  server change.
- Verify with `pnpm typecheck && pnpm build && pnpm sim` before pushing.
- Tuning numbers live in `lib/game/config.ts` (defaults) and the
  `level_config` table (runtime overrides) — not scattered in modules.
- Adding an event = new module in `lib/game/events/` + registry entry +
  scene in `render/scenes/` + scene registry entry (see README →
  "Add your own event in 4 steps").
