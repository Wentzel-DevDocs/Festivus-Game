"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  ACADEMY_COHORT_EVENTS,
  type AcademyCohortJoinArgs,
  type AcademyCohortJoinResult,
  type AcademyCohortSnapshot,
  type AcademyCohortValidationResult,
} from "./cohortProtocol";

export type AcademyCohortStatus = "connecting" | "connected" | "disconnected";

export interface AcademyCohortApi {
  status: AcademyCohortStatus;
  joined: boolean;
  snapshot: AcademyCohortSnapshot | null;
  join(roomCode: string, name: string): Promise<AcademyCohortJoinResult>;
  validateMission(missionId: string, code: string): Promise<AcademyCohortValidationResult>;
}

const GAME_SERVER_URL =
  process.env.NEXT_PUBLIC_GAME_SERVER_URL || "http://127.0.0.1:1999";
const LEARNER_KEY_STORAGE = "festivus-academy:learner-key:v1";

function getLearnerKey() {
  try {
    const existing = window.localStorage.getItem(LEARNER_KEY_STORAGE);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(LEARNER_KEY_STORAGE, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function useAcademyCohort(trackSlug: string): AcademyCohortApi {
  const [status, setStatus] = useState<AcademyCohortStatus>("connecting");
  const [snapshot, setSnapshot] = useState<AcademyCohortSnapshot | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const joinRef = useRef<AcademyCohortJoinArgs | null>(null);

  useEffect(() => {
    getLearnerKey();
    const socket = io(GAME_SERVER_URL, {
      transports: ["websocket"],
      auth: { surface: "academy" },
    });
    socketRef.current = socket;

    const emitJoin = async (args: AcademyCohortJoinArgs) => {
      try {
        const result = (await socket
          .timeout(5_000)
          .emitWithAck(ACADEMY_COHORT_EVENTS.join, args)) as AcademyCohortJoinResult;
        if (result.ok && result.snapshot) setSnapshot(result.snapshot);
        return result;
      } catch {
        return { ok: false, reason: "Cohort server did not respond." };
      }
    };

    socket.on("connect", () => {
      setStatus("connected");
      if (joinRef.current) void emitJoin(joinRef.current);
    });
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    socket.on(ACADEMY_COHORT_EVENTS.snapshot, (next: AcademyCohortSnapshot) => {
      if (next.trackSlug === trackSlug) setSnapshot(next);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [trackSlug]);

  return useMemo<AcademyCohortApi>(
    () => ({
      status,
      joined: Boolean(snapshot),
      snapshot,
      async join(roomCode, name) {
        const args = { roomCode, name, trackSlug, learnerKey: getLearnerKey() };
        joinRef.current = args;
        const socket = socketRef.current;
        if (!socket?.connected) return { ok: false, reason: "Cohort server is offline." };
        try {
          const result = (await socket
            .timeout(5_000)
            .emitWithAck(ACADEMY_COHORT_EVENTS.join, args)) as AcademyCohortJoinResult;
          if (result.ok && result.snapshot) setSnapshot(result.snapshot);
          return result;
        } catch {
          return { ok: false, reason: "Cohort server did not respond." };
        }
      },
      async validateMission(missionId, code) {
        const socket = socketRef.current;
        if (!socket?.connected || !snapshot) {
          return { ok: false, reason: "Join a live cohort before publishing progress." };
        }
        try {
          return (await socket
            .timeout(5_000)
            .emitWithAck(ACADEMY_COHORT_EVENTS.validate, { missionId, code })) as AcademyCohortValidationResult;
        } catch {
          return { ok: false, reason: "Cohort server did not respond." };
        }
      },
    }),
    [snapshot, status, trackSlug],
  );
}
