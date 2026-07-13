/**
 * party/server.ts — the PartyKit host for the Festivus room.
 *
 * PartyKit gives us one long-lived Durable Object per room id; we run exactly
 * one room (GAME_CONFIG.ROOM_ID). This file is a THIN adapter: it owns the
 * WebSocket lifecycle and a ~25 Hz tick timer, and forwards everything to
 * RoomCore, which holds all game logic and state (server/game/core.ts).
 *
 * Wire protocol (JSON strings both ways):
 *   server → client : { t: "snapshot", data }  { t: "you", data }
 *                     { t: "rpc:res", id, result }
 *   client → server : { t: "rpc", id, method, args }   (awaits a result)
 *                     { t: "msg", method, args }        (fire-and-forget)
 *
 * Env (partykit vars / secrets): APP_BASE_URL, INTERNAL_API_SECRET — used by
 * RoomCore to read tuning and write match results through the Next.js API.
 */

import type * as Party from "partykit/server";
import { GAME_CONFIG } from "../lib/game/config";
import { RoomCore, sanitizeJoin, TICK_MS, type Transport } from "../server/game/core";
import type { JoinParams } from "../lib/realtime/protocol";

export default class FestivusServer implements Party.Server {
  private core!: RoomCore;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  async onStart(): Promise<void> {
    const transport: Transport = {
      broadcast: (event, data) => this.room.broadcast(JSON.stringify({ t: event, data })),
      sendTo: (connId, event, data) =>
        this.room.getConnection(connId)?.send(JSON.stringify({ t: event, data })),
    };
    const env = {
      appBaseUrl: String(this.room.env.APP_BASE_URL ?? ""),
      internalSecret: String(this.room.env.INTERNAL_API_SECRET ?? ""),
    };
    this.core = new RoomCore(transport, env);
    await this.core.start();
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext): void {
    // JoinParams ride in the connection URL query (set by the client's
    // PartySocket `query`); sanitize server-side before trusting anything.
    const url = new URL(ctx.request.url);
    const raw: Partial<JoinParams> = {
      role: url.searchParams.get("role") as JoinParams["role"] | null ?? undefined,
      name: url.searchParams.get("name") ?? undefined,
      stickyId: url.searchParams.get("stickyId") ?? undefined,
    };
    this.core.connect(conn.id, sanitizeJoin(raw));
    this.ensureTicking();
  }

  onMessage(message: string, sender: Party.Connection): void {
    let msg: { t?: string; id?: number; method?: string; args?: unknown };
    try {
      msg = JSON.parse(typeof message === "string" ? message : "");
    } catch {
      return;
    }
    if (!msg?.method) return;

    if (msg.t === "rpc") {
      const result = this.core.action(sender.id, msg.method, msg.args);
      sender.send(JSON.stringify({ t: "rpc:res", id: msg.id, result }));
    } else {
      // fire-and-forget (tap, host controls) — result is ignored.
      this.core.action(sender.id, msg.method, msg.args);
    }
  }

  onClose(conn: Party.Connection): void {
    this.core.disconnect(conn.id);
    if (this.core.connectionCount === 0) this.stopTicking();
  }

  onError(conn: Party.Connection): void {
    this.core.disconnect(conn.id);
    if (this.core.connectionCount === 0) this.stopTicking();
  }

  /** Run the fixed tick only while someone is connected. */
  private ensureTicking(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.core.tick(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// Every browser connects to the single shared room id.
export const ROOM_ID = GAME_CONFIG.ROOM_ID;
