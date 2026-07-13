# CLAUDE.md — notes for AI agents working in this repo

## What this is

Justin's Feats of Strength: a Festivus-themed, Jackbox-style all-hands party
game. One boss broadcast screen (`/boss`) + phones as controllers (`/play`).
Read `README.md` first — it explains the three-layer architecture (Next.js on
Vercel, a standalone Node room server for the live game, Neon Postgres for
durable data), how to run everything locally, and the anonymity guarantees
that must never be weakened.

## Realtime layer (standalone Socket.IO server)

The live room is a plain **Socket.IO** server on any always-on Node host
(Railway/Render/Fly). No platform-specific anything.

Key facts about THIS project's realtime layer:

- **All game logic is transport-agnostic** in `server/game/core.ts`
  (`RoomCore`): the roster, per-round anonymity tokens, the event sim, the
  fixed tick, and every action. It talks to the world through a small
  `Transport` (broadcast + sendTo), so it can be hosted anywhere and tested
  without a network.
- `server/game/server.ts` is a **thin Socket.IO adapter** over `RoomCore`: it
  owns the WebSocket lifecycle and a ~25 Hz `setInterval` tick, listens on
  `$PORT`, and recreates the room when the last client leaves (fresh lobby).
- Wire protocol: server emits `"snapshot"` / `"you"`; client emits `"rpc"`
  `{method,args}` (with a Socket.IO ack for the return value) and `"msg"`
  `{method,args}` (fire-and-forget). Both map to `RoomCore.action()`. The
  client lives in `lib/realtime/useRoom.ts` (`socket.io-client`).
- Local dev: `pnpm dev:server` runs the server on port 1999. Deploy: Railway
  reads `railway.json` and runs `pnpm start:server`. Browsers reach it via
  `NEXT_PUBLIC_GAME_SERVER_URL` (full URL). The room reads `APP_BASE_URL` +
  `INTERNAL_API_SECRET` from its host env to reach the Next.js API.
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
