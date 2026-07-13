/**
 * server/game/server.ts — the standalone realtime room server.
 *
 * A plain Socket.IO server hosting ONE Festivus room via RoomCore
 * (server/game/core.ts, which holds all game logic and state). Runs on any
 * always-on Node host — Railway, Render, Fly, a VPS. No platform-specific
 * anything: it listens on $PORT and speaks WebSockets.
 *
 * Wire protocol (mirrors lib/realtime/useRoom.ts):
 *   server → client : emit "snapshot" (Snapshot)   emit "you" (YouMessage)
 *   client → server : emit "rpc" {method,args} with ack   (value-returning)
 *                     emit "msg" {method,args}             (fire-and-forget)
 *
 * Env (all optional — the room plays without them, just no persistence):
 *   PORT                 listen port (host provides it; default 1999)
 *   APP_ORIGIN           CORS allow-origin for the browser (default *)
 *   APP_BASE_URL         where to reach the Next.js API (results + tuning)
 *   INTERNAL_API_SECRET  shared secret for POST /api/results
 */

import { Server } from "socket.io";
import { RoomCore, sanitizeJoin, TICK_MS, type Transport } from "./core";

// Local-dev convenience: load .env.local if the (dev-only) dotenv package is
// present. In production the host (Railway) provides env directly, dotenv is
// pruned from the install, and this import throws → caught → harmless no-op.
try {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
} catch {
  /* dotenv not installed (production) — env comes from the host */
}

const PORT = Number(process.env.PORT) || 1999;

const io = new Server(PORT, {
  cors: { origin: process.env.APP_ORIGIN || "*" },
  // Trim the handshake: we only need the realtime channel.
  serveClient: false,
});

// One transport, reused across room resets. socket.id doubles as a room the
// socket auto-joins, so `io.to(id)` targets exactly one connection.
const transport: Transport = {
  broadcast: (event, data) => io.emit(event, data),
  sendTo: (id, event, data) => io.to(id).emit(event, data),
};

const env = {
  appBaseUrl: process.env.APP_BASE_URL || "",
  internalSecret: process.env.INTERNAL_API_SECRET || "",
};

// The live room. Recreated when it empties, so the next crowd starts in a
// fresh lobby (the old "everyone went home mid-match" behavior).
let core = makeCore();
function makeCore(): RoomCore {
  const c = new RoomCore(transport, env);
  void c.start();
  return c;
}

/** Socket.IO query values arrive as string | string[] | undefined. */
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

io.on("connection", (socket) => {
  const q = socket.handshake.query;
  core.connect(socket.id, sanitizeJoin({ role: str(q.role), name: str(q.name), stickyId: str(q.stickyId) }));

  socket.on("rpc", (payload: { method?: string; args?: unknown }, ack?: (r: unknown) => void) => {
    const result = payload?.method ? core.action(socket.id, payload.method, payload.args) : { ok: false };
    if (typeof ack === "function") ack(result);
  });

  socket.on("msg", (payload: { method?: string; args?: unknown }) => {
    if (payload?.method) core.action(socket.id, payload.method, payload.args);
  });

  socket.on("disconnect", () => {
    core.disconnect(socket.id);
    if (core.connectionCount === 0) core = makeCore();
  });
});

// The fixed ~25 Hz tick, always driven by whichever core is current.
setInterval(() => core.tick(), TICK_MS);

console.log(`Festivus room server listening on :${PORT}`);
