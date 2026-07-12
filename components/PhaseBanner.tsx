"use client";

/**
 * PhaseBanner — the status strip across the top of every screen: which
 * phase of the party we're in, how long it has left, and (during events)
 * the aggregate headcounts per side.
 *
 * Timer accuracy: a snapshot tells us "the phase ends N ms after the
 * server's clock read T". That number is frozen the moment the snapshot is
 * taken, so if we displayed it directly the countdown would only move when
 * fresh snapshots arrive. Instead we note WHEN each snapshot landed on this
 * device and subtract the local time elapsed since — that makes the clock
 * tick smoothly even if snapshots stall. A 250 ms interval forces the
 * re-renders that keep the displayed number fresh.
 */

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/realtime/protocol";
import { phaseTimerMs } from "@/lib/realtime/useRoom";

interface PhaseBannerProps {
  snapshot: Snapshot | null;
}

/** Human-friendly title for the current phase. */
function phaseTitle(snap: Snapshot): string {
  switch (snap.phase) {
    case "lobby":
      return "THE LOBBY";
    case "grievance_write":
      return "AIRING OF GRIEVANCES";
    case "grievance_reveal":
      return "THE GRIEVANCES, ALOUD";
    case "finale":
      return "THE FINALE";
    case "splash":
      return "HAPPY FESTIVUS";
    default: {
      // The remaining phases are all event_* (countdown / active / outcome).
      const meta = snap.eventMeta;
      if (!meta) return "EVENT";
      return `EVENT ${meta.index + 1}/${meta.total}: ${meta.name.toUpperCase()}`;
    }
  }
}

export default function PhaseBanner({ snapshot }: PhaseBannerProps) {
  // Remember when THIS snapshot object arrived (by reference — a new
  // snapshot is a new object). Done during render on purpose: we need the
  // arrival time before the first paint, not one effect-tick later.
  const arrival = useRef<{ snap: Snapshot | null; at: number }>({
    snap: null,
    at: 0,
  });
  if (arrival.current.snap !== snapshot) {
    arrival.current = { snap: snapshot, at: Date.now() };
  }

  // A ticking interval whose only job is to force re-renders so the
  // countdown below is recomputed 4×/second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  // Server-reported remaining time, minus how long ago we heard it.
  const elapsedSinceSnapshot = Date.now() - arrival.current.at;
  const remainingMs = Math.max(0, phaseTimerMs(snapshot) - elapsedSinceSnapshot);

  // Phases that wait for the host (the lobby, the splash) have no real
  // deadline — phaseTimerMs comes back 0 or non-finite. Show a dash instead
  // of a clock stuck at zero.
  const seconds =
    Number.isFinite(remainingMs) && remainingMs > 0
      ? Math.ceil(remainingMs / 1000)
      : null;

  const meta = snapshot?.eventMeta ?? null;
  const isEventPhase = snapshot?.phase.startsWith("event") ?? false;

  // Headcount line: anonymous aggregates only ("9 helping · 4 hindering").
  // Tug-of-war teams are public, so there we name the teams instead.
  let countsLine: string | null = null;
  if (snapshot?.sideCounts) {
    const [a, b] = snapshot.sideCounts;
    countsLine =
      isEventPhase && meta?.teamBased
        ? `Team A ${a} · Team B ${b}`
        : `${a} helping · ${b} hindering`;
  }

  return (
    <div className="aluminum-panel flex items-center justify-between gap-4 px-4 py-2">
      <div className="min-w-0">
        <h2 className="display-header truncate text-lg text-aluminum-100 sm:text-xl">
          {snapshot ? phaseTitle(snapshot) : "CONNECTING…"}
          {/* Double-points chip: the finale event is worth 2× approval. */}
          {isEventPhase && meta?.weight === 2 && (
            <span className="display-header ml-2 inline-block rounded bg-grease px-1.5 py-0.5 align-middle text-xs text-aluminum-950">
              Double Points
            </span>
          )}
        </h2>
        {countsLine && (
          <p className="font-mono text-xs text-aluminum-400">{countsLine}</p>
        )}
      </div>

      {/* Seconds remaining — big, mono, tabular so digits don't wiggle. */}
      <div
        className="shrink-0 font-mono text-3xl tabular-nums text-aluminum-100"
        aria-label="Seconds remaining"
      >
        {seconds ?? "—"}
      </div>
    </div>
  );
}
