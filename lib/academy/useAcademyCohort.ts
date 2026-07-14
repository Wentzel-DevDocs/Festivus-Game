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
  /** Rotate the local identity and detach from any cohort owned by the previous learner. */
  startNewLearner(): string;
}

const GAME_SERVER_URL =
  process.env.NEXT_PUBLIC_GAME_SERVER_URL || "http://127.0.0.1:1999";
export const ACADEMY_LEARNER_KEY_STORAGE = "festivus-academy:learner-key:v1";
const LEARNER_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
let volatileLearnerKey: string | null = null;

function createLearnerKey() {
  return crypto.randomUUID();
}

function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
}

export function getAcademyLearnerKey() {
  try {
    const existing = window.localStorage.getItem(ACADEMY_LEARNER_KEY_STORAGE);
    if (existing && LEARNER_KEY_PATTERN.test(existing)) {
      volatileLearnerKey = existing;
      return existing;
    }

    const created = createLearnerKey();
    window.localStorage.setItem(ACADEMY_LEARNER_KEY_STORAGE, created);
    volatileLearnerKey = created;
    return created;
  } catch {
    if (!volatileLearnerKey) volatileLearnerKey = createLearnerKey();
    return volatileLearnerKey;
  }
}

export function rotateAcademyLearnerKey() {
  const created = createLearnerKey();
  volatileLearnerKey = created;
  try {
    window.localStorage.setItem(ACADEMY_LEARNER_KEY_STORAGE, created);
  } catch {
    // A stable in-memory key still keeps one sandboxed page internally consistent.
  }
  return created;
}

export function useAcademyCohort(trackSlug: string): AcademyCohortApi {
  const [status, setStatus] = useState<AcademyCohortStatus>("connecting");
  const [snapshot, setSnapshot] = useState<AcademyCohortSnapshot | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const joinRef = useRef<AcademyCohortJoinArgs | null>(null);
  const learnerKeyRef = useRef<string | null>(null);

  useEffect(() => {
    learnerKeyRef.current = getAcademyLearnerKey();
    setStatus("connecting");
    setSnapshot(null);
    if (joinRef.current?.trackSlug !== trackSlug) joinRef.current = null;

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
        if (result.ok && result.snapshot?.trackSlug === trackSlug) {
          setSnapshot(result.snapshot);
        } else if (joinRef.current === args) {
          joinRef.current = null;
          setSnapshot(null);
        }
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
      const expectedRoom = joinRef.current
        ? normalizeRoomCode(joinRef.current.roomCode)
        : null;
      if (
        next.trackSlug === trackSlug &&
        expectedRoom &&
        next.roomCode === expectedRoom
      ) {
        setSnapshot(next);
      }
    });

    const syncLearnerIdentity = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== ACADEMY_LEARNER_KEY_STORAGE) {
        return;
      }
      const nextLearnerKey = getAcademyLearnerKey();
      if (nextLearnerKey === learnerKeyRef.current) return;

      learnerKeyRef.current = nextLearnerKey;
      joinRef.current = null;
      setSnapshot(null);
      setStatus("connecting");
      socket.disconnect();
      socket.connect();
    };
    window.addEventListener("storage", syncLearnerIdentity);

    return () => {
      window.removeEventListener("storage", syncLearnerIdentity);
      socket.close();
      socketRef.current = null;
    };
  }, [trackSlug]);

  const activeSnapshot = snapshot?.trackSlug === trackSlug ? snapshot : null;

  return useMemo<AcademyCohortApi>(
    () => ({
      status,
      joined: Boolean(activeSnapshot),
      snapshot: activeSnapshot,
      async join(roomCode, name) {
        const args = { roomCode, name, trackSlug, learnerKey: getAcademyLearnerKey() };
        joinRef.current = args;
        const socket = socketRef.current;
        if (!socket?.connected) return { ok: false, reason: "Cohort server is offline." };
        try {
          const result = (await socket
            .timeout(5_000)
            .emitWithAck(ACADEMY_COHORT_EVENTS.join, args)) as AcademyCohortJoinResult;
          if (result.ok && result.snapshot?.trackSlug === trackSlug) {
            setSnapshot(result.snapshot);
          } else if (joinRef.current === args) {
            joinRef.current = null;
            setSnapshot(null);
          }
          return result;
        } catch {
          if (joinRef.current === args) joinRef.current = null;
          return { ok: false, reason: "Cohort server did not respond." };
        }
      },
      async validateMission(missionId, code) {
        const socket = socketRef.current;
        if (!socket?.connected || !activeSnapshot) {
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
      startNewLearner() {
        const nextLearnerKey = rotateAcademyLearnerKey();
        learnerKeyRef.current = nextLearnerKey;
        joinRef.current = null;
        setSnapshot(null);
        setStatus("connecting");

        const socket = socketRef.current;
        if (socket) {
          socket.disconnect();
          socket.connect();
        }
        return nextLearnerKey;
      },
    }),
    [activeSnapshot, status, trackSlug],
  );
}
