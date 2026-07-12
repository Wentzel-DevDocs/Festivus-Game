"use client";

/**
 * useRoom — the one React hook that connects a screen to the live room.
 *
 * Both the boss view and the player controller call this. It:
 *  - opens the RivetKit WebSocket connection with {role, name, stickyId},
 *  - keeps the latest Snapshot in a ref updated at full server rate
 *    (~25 Hz) for the PixiJS canvas to interpolate from,
 *  - mirrors it into React state at a gentler ~10 Hz so the DOM
 *    (timers, leaderboards) re-renders cheaply,
 *  - surfaces per-connection facts ("you": host flag, team, own side),
 *  - exposes typed action senders (tap, pickSide, host controls…).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "rivetkit/client";
// Type-only import: the actor's action signatures reach the browser as
// TYPES; none of the server code lands in the bundle.
import type { Registry } from "@/server/rivet/registry";
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
  /** Throttled (~10 Hz) snapshot for DOM rendering. */
  snapshot: Snapshot | null;
  /** Full-rate buffer for the canvas (read inside requestAnimationFrame). */
  bufferRef: React.RefObject<SnapshotBuffer>;
  you: YouMessage | null;
  status: RoomStatus;
  /** Register a listener for transient fx (sounds, shakes). Returns unsubscribe. */
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

type RoomConn = ReturnType<
  ReturnType<typeof createClient<Registry>>["festivusRoom"]["getOrCreate"]
> extends infer H
  ? H extends { connect(params?: unknown): infer C }
    ? C
    : never
  : never;

/**
 * Connect to the shared room. Pass null to stay disconnected (the landing
 * page does this until a name is chosen).
 */
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

    const client = createClient<Registry>({
      endpoint: process.env.NEXT_PUBLIC_RIVET_ENDPOINT || "http://127.0.0.1:6420",
      token: process.env.NEXT_PUBLIC_RIVET_TOKEN || undefined,
    });

    const conn = client.festivusRoom.getOrCreate([GAME_CONFIG.ROOM_ID]).connect(join);
    connRef.current = conn as unknown as RoomConn;

    const offSnapshot = conn.on(EVT_SNAPSHOT, (snap: Snapshot) => {
      const buf = bufferRef.current;
      buf.previous = buf.latest;
      buf.previousAt = buf.latestAt;
      buf.latest = snap;
      buf.latestAt = performance.now();

      // Fx are one-snapshot transients: fan out every one, immediately.
      for (const fx of snap.fx) for (const cb of fxListeners.current) cb(fx);

      // DOM state only needs ~10 Hz.
      const now = performance.now();
      if (now - lastDomUpdate.current >= DOM_UPDATE_MS) {
        lastDomUpdate.current = now;
        setSnapshot(snap);
      }
    });

    const offYou = conn.on(EVT_YOU, (msg: YouMessage) => setYou(msg));
    const offOpen = conn.onOpen(() => {
      setStatus("connected");
      // Snapshot + "you" both arrive push-style, but fetch "you" once in
      // case this is a reconnect that missed the onConnect send.
      void (conn as { hello(): Promise<YouMessage> }).hello().then(setYou).catch(() => {});
    });
    const offClose = conn.onClose(() => setStatus("disconnected"));

    return () => {
      offSnapshot();
      offYou();
      offOpen();
      offClose();
      void conn.dispose();
      connRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinKey]);

  return useMemo<RoomApi>(() => {
    /** Fire-and-forget action call against the live connection. */
    const call = <T,>(name: string, ...args: unknown[]): Promise<T | null> => {
      const conn = connRef.current as unknown as Record<
        string,
        (...a: unknown[]) => Promise<T>
      > | null;
      if (!conn) return Promise.resolve(null);
      return conn[name](...args).catch(() => null);
    };

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
        void call("tap");
      },
      async pickSide(side) {
        const res = await call<{ ok: boolean; side: 0 | 1 | null }>("pickSide", side);
        return res?.side ?? null;
      },
      async submitGrievance(text) {
        const res = await call<{ ok: boolean; reason?: string }>("submitGrievance", text);
        return res ?? { ok: false, reason: "not connected" };
      },
      hostStart() {
        void call("hostStart");
      },
      hostSkip() {
        void call("hostSkip");
      },
      hostHideGrievance(id) {
        void call("hostHideGrievance", id);
      },
      async switchToPlayer(name) {
        const res = await call<{ ok: boolean }>("switchToPlayer", name);
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
