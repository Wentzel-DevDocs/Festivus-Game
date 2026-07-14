"use client";

/**
 * PhaseBanner — the status strip across the top of every screen: which
 * phase of the party we're in, how long it has left, and (during events)
 * the aggregate direct-action totals per side.
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

/** Short world-state copy that makes every utilitarian phase feel deliberate. */
function phaseKicker(snap: Snapshot): string {
  switch (snap.phase) {
    case "lobby":
      return "War room assembling";
    case "grievance_write":
      return "Anonymous incident intake";
    case "grievance_reveal":
      return "Postmortem unsealed";
    case "event_countdown":
      return "Dual inputs arming";
    case "event_active":
      return "Production under load";
    case "event_outcome":
      return "Round telemetry finalized";
    case "finale":
      return "Final release candidate";
    case "splash":
      return "Post-deploy report";
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

  // Solo rounds expose anonymous action totals, never who pressed them.
  // Tug-of-war teams are public, so there we name the team headcounts.
  let countsLine: string | null = null;
  if (snapshot?.sideCounts) {
    const [a, b] = snapshot.sideCounts;
    countsLine =
      isEventPhase && meta?.teamBased
        ? `Team A ${a} · Team B ${b}`
        : `${a} help actions · ${b} hinder actions`;
  }

  return (
    <div className="forge-panel flex min-h-12 items-center justify-between gap-3 px-3 py-2 sm:px-4">
      <div className="min-w-0">
        <p className="eyebrow truncate text-[9px] sm:text-[10px]">
          {snapshot ? phaseKicker(snapshot) : "Negotiating realtime uplink"}
        </p>
        <h2 className="display-header truncate text-sm text-aluminum-100 sm:text-lg">
          {snapshot ? phaseTitle(snapshot) : "CONNECTING…"}
          {/* Double-points chip: the finale event is worth 2× approval. */}
          {isEventPhase && meta?.weight === 2 && (
            <span className="ml-2 inline-block rounded-sm border border-grease/70 bg-grease/10 px-1.5 py-0.5 align-middle font-mono text-[9px] text-grease">
              2× score
            </span>
          )}
        </h2>
        {countsLine && (
          <p className="truncate font-mono text-[10px] text-aluminum-400">{countsLine}</p>
        )}
      </div>

      {/* Seconds remaining — big, mono, tabular so digits don't wiggle. */}
      <div
        className="ember-pulse min-w-12 shrink-0 rounded-md border border-grease/35 bg-aluminum-950/80 px-2 py-1 text-center font-mono text-xl tabular-nums text-grease sm:text-2xl"
        aria-label="Seconds remaining"
      >
        {seconds ?? "—"}
      </div>
    </div>
  );
}
