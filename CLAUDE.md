# CLAUDE.md — notes for AI agents working in this repo

## What this is

Justin's Feats of Strength: a Festivus-themed, Jackbox-style all-hands party
game. One boss broadcast screen (`/boss`) + phones as controllers (`/play`).
Read `README.md` first — it explains the three-layer architecture (Next.js on
Vercel, a PartyKit room for the live game, Neon Postgres for durable data),
how to run everything locally, and the anonymity guarantees that must never
be weakened.

## Realtime layer (PartyKit)

The live room is a **PartyKit** server. For anything touching it, use
**https://docs.partykit.io** as the authoritative reference (Server class,
`onConnect`/`onMessage`/`onClose`, `room.broadcast`, connection state,
`partykit dev`/`deploy`).

Key facts about THIS project's realtime layer:

- **All game logic is transport-agnostic** in `server/game/core.ts`
  (`RoomCore`): the roster, per-round anonymity tokens, the event sim, the
  fixed tick, and every action. It talks to the world through a small
  `Transport` (broadcast + sendTo), so it can be hosted anywhere and tested
  without a network.
- `party/server.ts` is a **thin PartyKit adapter** over `RoomCore`: it owns
  the WebSocket lifecycle and a ~25 Hz `setInterval` tick (started on first
  connect, stopped when empty), and translates messages. `partykit.json`
  points `main` at it.
- Wire protocol is JSON strings: `{t:"snapshot"|"you", data}` server→client;
  `{t:"rpc",id,method,args}` (awaits `{t:"rpc:res",id,result}`) and
  `{t:"msg",method,args}` (fire-and-forget) client→server. The RPC shim lives
  in `lib/realtime/useRoom.ts`.
- Local dev: `pnpm dev:party` runs `partykit dev` on port 1999. Deploy:
  `npx partykit login` then `npx partykit deploy` (or `pnpm deploy:party`) →
  `festivus-game.<user>.partykit.dev`. Browsers reach it via
  `NEXT_PUBLIC_PARTYKIT_HOST` (hostname only). The room reaches the Next.js
  API via `APP_BASE_URL` + `INTERNAL_API_SECRET` (set with `partykit env`).
- `pnpm sim` drives `RoomCore` directly through an in-memory transport — no
  server, no WebSockets, no DB — so it's the fast, authoritative check.

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
