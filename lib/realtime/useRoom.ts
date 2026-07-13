"use client";

/**
 * useRoom — the one React hook that connects a screen to the live room.
 *
 * Both the boss view and the player controller call this. It:
 *  - opens a Socket.IO connection to the room server with {role, name, stickyId},
 *  - keeps the latest Snapshot in a ref updated at full server rate
 *    (~25 Hz) for the PixiJS canvas to interpolate from,
 *  - mirrors it into React state at a gentler ~10 Hz so the DOM
 *    (timers, leaderboards) re-renders cheaply,
 *  - surfaces per-connection facts ("you": host flag, team, own side),
 *  - exposes typed action senders (tap, pickSide, host controls…).
 *
 * Transport: value-returning actions (pickSide, submitGrievance,
 * switchToPlayer, hello) use Socket.IO acks (`emitWithAck`); taps and host
 * controls are fire-and-forget emits. Socket.IO auto-reconnects, so a dropped
 * connection heals itself.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { GAME_CONFIG } from "@/lib/game/config";
import type { FxEvent } from "@/lib/game/engine/types";
import {
  EVT_SNAPSHOT,
  EVT_YOU,
  type JoinParams,
  type Snapshot,
  type YouMessage,
} from "./protocol";

export type RoomStatus = "connecting" | "connected" | "disconnected";

/** Latest + previous snapshot with arrival times — interpolation fodder. */
export interface SnapshotBuffer {
  latest: Snapshot | null;
  previous: Snapshot | null;
  latestAt: number;
  previousAt: number;
}

export interface RoomApi {
  snapshot: Snapshot | null;
  bufferRef: React.RefObject<SnapshotBuffer>;
  you: YouMessage | null;
  status: RoomStatus;
  onFx(cb: (fx: FxEvent) => void): () => void;
  tap(): void;
  pickSide(side: 0 | 1): Promise<0 | 1 | null>;
  submitGrievance(text: string): Promise<{ ok: boolean; reason?: string }>;
  hostStart(): void;
  hostSkip(): void;
  hostHideGrievance(id: string): void;
  switchToPlayer(name?: string): Promise<boolean>;
}

/** How often the DOM-facing snapshot state refreshes. */
const DOM_UPDATE_MS = 100;

/** The room server's URL. Local dev default; production is a Railway URL etc. */
const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || "http://127.0.0.1:1999";

/** A client bound to one socket: action RPC + fire-and-forget. */
interface RoomConn {
  rpc<T>(method: string, args?: unknown): Promise<T | null>;
  fire(method: string, args?: unknown): void;
}

export function useRoom(join: JoinParams | null): RoomApi {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [you, setYou] = useState<YouMessage | null>(null);
  const [status, setStatus] = useState<RoomStatus>("connecting");

  const bufferRef = useRef<SnapshotBuffer>({
    latest: null,
    previous: null,
    latestAt: 0,
    previousAt: 0,
  });
  const connRef = useRef<RoomConn | null>(null);
  const fxListeners = useRef<Set<(fx: FxEvent) => void>>(new Set());
  const lastDomUpdate = useRef(0);

  // Key by the join identity so a role/name change reconnects cleanly.
  const joinKey = join ? `${join.role}|${join.name}|${join.stickyId}` : null;

  useEffect(() => {
    if (!join || !joinKey) return;

    const socket: Socket = io(GAME_SERVER_URL, {
      transports: ["websocket"],
      // JoinParams travel as handshake query — re-sent on every reconnect.
      query: { role: join.role, name: join.name, stickyId: join.stickyId },
    });

    const rpc = <T,>(method: string, args?: unknown): Promise<T | null> =>
      socket
        .timeout(5000)
        .emitWithAck("rpc", { method, args })
        .then((r) => r as T)
        .catch(() => null);
    const fire = (method: string, args?: unknown) => {
      socket.emit("msg", { method, args });
    };
    connRef.current = { rpc, fire };

    socket.on(EVT_SNAPSHOT, (snap: Snapshot) => {
      const buf = bufferRef.current;
      buf.previous = buf.latest;
      buf.previousAt = buf.latestAt;
      buf.latest = snap;
      buf.latestAt = performance.now();

      for (const fx of snap.fx) for (const cb of fxListeners.current) cb(fx);

      const now = performance.now();
      if (now - lastDomUpdate.current >= DOM_UPDATE_MS) {
        lastDomUpdate.current = now;
        setSnapshot(snap);
      }
    });

    socket.on(EVT_YOU, (msg: YouMessage) => setYou(msg));

    socket.on("connect", () => {
      setStatus("connected");
      // Snapshot + "you" arrive push-style, but fetch "you" once in case this
      // is a reconnect that missed the onConnect send.
      void rpc<YouMessage>("hello").then((y) => y && setYou(y));
    });
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));

    return () => {
      socket.close();
      connRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinKey]);

  return useMemo<RoomApi>(() => {
    const conn = () => connRef.current;
    return {
      snapshot,
      bufferRef,
      you,
      status,
      onFx(cb) {
        fxListeners.current.add(cb);
        return () => fxListeners.current.delete(cb);
      },
      tap() {
        conn()?.fire("tap");
      },
      async pickSide(side) {
        const res = await (conn()?.rpc<{ ok: boolean; side: 0 | 1 | null }>("pickSide", side) ??
          Promise.resolve(null));
        return res?.side ?? null;
      },
      async submitGrievance(text) {
        const res = await (conn()?.rpc<{ ok: boolean; reason?: string }>("submitGrievance", text) ??
          Promise.resolve(null));
        return res ?? { ok: false, reason: "not connected" };
      },
      hostStart() {
        conn()?.fire("hostStart");
      },
      hostSkip() {
        conn()?.fire("hostSkip");
      },
      hostHideGrievance(id) {
        conn()?.fire("hostHideGrievance", id);
      },
      async switchToPlayer(name) {
        const res = await (conn()?.rpc<{ ok: boolean }>("switchToPlayer", name ?? null) ??
          Promise.resolve(null));
        return res?.ok ?? false;
      },
    };
  }, [snapshot, you, status]);
}

/** Milliseconds left in the current phase, from a snapshot. */
export function phaseTimerMs(snap: Snapshot | null): number {
  if (!snap || !snap.phaseEndsAt) return 0;
  return Math.max(0, snap.phaseEndsAt - snap.serverNow);
}
