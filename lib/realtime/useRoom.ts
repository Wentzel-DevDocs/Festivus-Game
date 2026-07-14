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
 *  - surfaces per-connection facts ("you": host flag and tug team),
 *  - exposes typed action senders (direct-side tap, host controls…).
 *
 * Transport: value-returning actions (submitGrievance, switchToPlayer,
 * hello) use Socket.IO acks (`emitWithAck`); taps and host
 * controls are connected-only, volatile fire-and-forget emits, so Socket.IO
 * drops offline input instead of replaying it into a later phase.
 * Socket.IO auto-reconnects, so a dropped connection heals itself.
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
  /** Latest transport failure, cleared as soon as a connection succeeds. */
  error: string | null;
  /** Ask Socket.IO to reconnect immediately (automatic retries remain enabled). */
  reconnect(): void;
  onFx(cb: (fx: FxEvent) => void): () => void;
  /** Side is required for solo events and omitted for assigned-team tug. */
  tap(side?: 0 | 1): void;
  submitGrievance(text: string): Promise<{ ok: boolean; reason?: string }>;
  hostStart(): void;
  /** Player-safe start accepted from an idle lobby or completed splash. */
  startNextMatch(): void;
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
  fire(method: string, args?: unknown, volatile?: boolean): void;
}

function emptySnapshotBuffer(): SnapshotBuffer {
  return {
    latest: null,
    previous: null,
    latestAt: 0,
    previousAt: 0,
  };
}

export function useRoom(join: JoinParams | null): RoomApi {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [you, setYou] = useState<YouMessage | null>(null);
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const bufferRef = useRef<SnapshotBuffer>(emptySnapshotBuffer());
  const connRef = useRef<RoomConn | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fxListeners = useRef<Set<(fx: FxEvent) => void>>(new Set());
  const lastDomUpdate = useRef(0);

  // Key by the join identity so a role/name change reconnects cleanly.
  const joinKey = join ? `${join.role}|${join.name}|${join.stickyId}` : null;

  useEffect(() => {
    if (!join || !joinKey) return;

    // A changed identity or reconnect must never render or authorize against
    // the previous connection's role and phase.
    setSnapshot(null);
    setYou(null);
    setStatus("connecting");
    setError(null);
    bufferRef.current = emptySnapshotBuffer();
    lastDomUpdate.current = 0;

    const socket: Socket = io(GAME_SERVER_URL, {
      transports: ["websocket"],
      // JoinParams travel as handshake query — re-sent on every reconnect.
      query: { role: join.role, name: join.name, stickyId: join.stickyId },
    });
    socketRef.current = socket;

    const rpc = <T,>(method: string, args?: unknown): Promise<T | null> => {
      if (!socket.connected) return Promise.resolve(null);
      return socket
        .timeout(5000)
        .emitWithAck("rpc", { method, args })
        .then((r) => r as T)
        .catch(() => null);
    };
    const fire = (method: string, args?: unknown, volatile = false) => {
      // Ordinary Socket.IO emits are buffered while offline and replayed on
      // reconnect. Game input must describe what the player is doing NOW, so
      // drop it instead of letting stale taps or controls cross phase bounds.
      if (!socket.connected) return;
      if (volatile) socket.volatile.emit("msg", { method, args });
      else socket.emit("msg", { method, args });
    };
    const roomConn: RoomConn = { rpc, fire };
    connRef.current = roomConn;

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
      setError(null);
      // Snapshot + "you" arrive push-style, but fetch "you" once in case this
      // is a reconnect that missed the onConnect send.
      void rpc<YouMessage>("hello").then((y) => y && setYou(y));
    });
    socket.on("disconnect", (reason) => {
      setStatus("disconnected");
      if (reason === "io server disconnect") {
        setError("The room server ended this connection. Retry to rejoin.");
      }
      setSnapshot(null);
      setYou(null);
      bufferRef.current = emptySnapshotBuffer();
    });
    socket.on("connect_error", (cause: Error) => {
      setStatus("disconnected");
      setError(cause.message || "The room server could not be reached.");
      setSnapshot(null);
      setYou(null);
      bufferRef.current = emptySnapshotBuffer();
    });
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));

    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
      if (connRef.current === roomConn) connRef.current = null;
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
      error,
      reconnect() {
        const socket = socketRef.current;
        if (!socket) return;
        setError(null);
        setStatus("connecting");
        socket.connect();
      },
      onFx(cb) {
        fxListeners.current.add(cb);
        return () => fxListeners.current.delete(cb);
      },
      tap(side) {
        conn()?.fire("tap", side, true);
      },
      async submitGrievance(text) {
        const res = await (conn()?.rpc<{ ok: boolean; reason?: string }>("submitGrievance", text) ??
          Promise.resolve(null));
        return res ?? { ok: false, reason: "not connected" };
      },
      hostStart() {
        conn()?.fire("hostStart", undefined, true);
      },
      startNextMatch() {
        conn()?.fire("startNextMatch", undefined, true);
      },
      hostSkip() {
        conn()?.fire("hostSkip", undefined, true);
      },
      hostHideGrievance(id) {
        conn()?.fire("hostHideGrievance", id, true);
      },
      async switchToPlayer(name) {
        const res = await (conn()?.rpc<{ ok: boolean }>("switchToPlayer", name ?? null) ??
          Promise.resolve(null));
        return res?.ok ?? false;
      },
    };
  }, [error, snapshot, you, status]);
}

/** Milliseconds left in the current phase, from a snapshot. */
export function phaseTimerMs(snap: Snapshot | null): number {
  if (!snap || !snap.phaseEndsAt) return 0;
  return Math.max(0, snap.phaseEndsAt - snap.serverNow);
}
