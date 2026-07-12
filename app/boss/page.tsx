"use client";

/**
 * /boss — the BIG-SCREEN BROADCAST.
 *
 * Plug a laptop into the TV, open this page, done. It is a SPECTATOR view:
 * the server ignores game inputs from boss connections, so there are no
 * mash or side controls here at all — just the PixiJS stage, the join
 * instructions (the URL, big — that's how people join, no QR), the
 * leaderboard, the grievance feed, and the host controls.
 *
 * The first boss connection is the host, so this screen also carries the
 * "START THE FEATS" button. After that, auto-advance runs the show.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useRoom, phaseTimerMs } from "@/lib/realtime/useRoom";
import type { JoinParams } from "@/lib/realtime/protocol";
import type { FxEvent } from "@/lib/game/engine/types";
import type { Phase } from "@/lib/game/engine/session";
import { getStickyId, getMuted, saveMuted } from "@/lib/identity";
import { sound, type Sting } from "@/lib/sound";

import GameCanvas from "@/render/core";
import Leaderboard from "@/components/Leaderboard";
import GrievanceFeed from "@/components/GrievanceFeed";
import Stamp from "@/components/Stamp";
import PhaseBanner from "@/components/PhaseBanner";
import SplashCard from "@/components/SplashCard";

/* ── Shared constants ─────────────────────────────────────────────────────── */

/**
 * Which sound sting each transient fx event maps to. (Same table lives in
 * /play — the two pages are deliberately self-contained.)
 */
const FX_TO_STING: Record<FxEvent["type"], Sting> = {
  miracle: "bell",
  sink: "splash",
  slip: "slip",
  count: "bell",
  countBroken: "murmur",
  pinned: "thunk",
  win: "win",
  lose: "lose",
};

/** ms → "M:SS" for the phase timer readout. */
function formatTimer(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function BossPage() {
  // Build the join params once, in an effect: localStorage (stickyId) only
  // exists in the browser, and useRoom reconnects if the identity changes.
  const [join, setJoin] = useState<JoinParams | null>(null);
  useEffect(() => {
    setJoin({ role: "boss", name: "Big Screen", stickyId: getStickyId() });
  }, []);

  const room = useRoom(join);
  const snapshot = room.snapshot;
  const phase = snapshot?.phase ?? null;

  // The join URL people type into their phones. window.location only exists
  // in the browser, so we read it after mount — rendering it directly would
  // make the server HTML disagree with the client (hydration mismatch).
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Re-render 4×/second so the phase timer text counts down smoothly even
  // between throttled snapshot updates.
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTimerTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  /* ── Sound wiring (this screen is usually the room's audio) ─────────── */

  // Default UNMUTED: getMuted() is false unless someone muted before.
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const m = getMuted();
    setMuted(m);
    sound.setMuted(m);
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sound.setMuted(next);
    saveMuted(next);
  }

  // Browsers require one user gesture before audio may play; the first
  // click/tap anywhere (e.g. pressing START) unlocks the AudioContext.
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Server fx → sound stings.
  useEffect(
    () =>
      room.onFx((fx) => {
        sound.play(FX_TO_STING[fx.type]);
      }),
    [room],
  );

  // Finale choreography: crank on entry, pop ~2.5 s later (in step with the
  // jack-in-the-box animation on the canvas).
  const prevPhaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === "finale" && prev !== "finale") {
      sound.play("crank");
      const timer = setTimeout(() => sound.play("pop"), 2500);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  /* ── Host control strip ────────────────────────────────────────────── */

  // Phase-aware primary action. Lobby and splash both (re)start a match;
  // anything else offers a skip. Auto-advance means skip is rarely needed.
  let hostLabel = "Skip →";
  let hostAction: () => void = () => room.hostSkip();
  if (phase === "lobby") {
    hostLabel = "Start the feats";
    hostAction = () => room.hostStart();
  } else if (phase === "splash") {
    hostLabel = "Run it back";
    hostAction = () => room.hostStart();
  }

  /* ── Derived display data ──────────────────────────────────────────── */

  const timerMs = phaseTimerMs(snapshot);
  const showTimer = snapshot !== null && snapshot.phaseEndsAt > 0 && timerMs > 0;

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 p-4">
      {/* a. Header bar. */}
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="display-header text-2xl tracking-wide lg:text-3xl">
          Justin&apos;s Feats of Strength
        </h1>
        <Stamp>MANDATORY ATTENDANCE</Stamp>
        <div className="min-w-0 flex-1">
          <PhaseBanner snapshot={snapshot} />
        </div>
        {/* Countdown/timer readout, refreshed by the 250 ms tick above. */}
        {showTimer && (
          <span className="font-mono text-2xl tabular-nums text-grease" aria-label="time remaining">
            {formatTimer(timerMs)}
          </span>
        )}
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          className="aluminum-panel flex min-h-12 min-w-12 items-center justify-center text-xl"
        >
          <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
        </button>
      </header>

      {/* Stage + right rail. Single column on small screens, split on TV. */}
      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* ── b. Main: the stage + host controls ─────────────────────── */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* `relative` so phase overlays can sit on top of the canvas. */}
          <div className="relative">
            <GameCanvas
              room={room}
              className="w-full h-[52vh] lg:h-[62vh] rounded-lg overflow-hidden"
            />

            {/* d. Blind-submit overlay: a live COUNT only — the grievance
                texts stay hidden until the reveal. */}
            {phase === "grievance_write" && snapshot && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="memo-panel p-8 text-center">
                  <p className="display-header text-4xl tracking-wide">
                    {snapshot.grievanceCount} grievance
                    {snapshot.grievanceCount === 1 ? "" : "s"} and counting…
                  </p>
                  <p className="mt-2 text-sm text-aluminum-600">
                    Submissions are anonymous. Texts are sealed until the reveal.
                  </p>
                </div>
              </div>
            )}

            {/* e. Splash overlay: the match summary over a dimmed stage,
                with the full leaderboard underneath it. */}
            {phase === "splash" && snapshot && (
              <div className="absolute inset-0 overflow-y-auto bg-aluminum-950/80 p-6">
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                  <SplashCard summary={snapshot.matchSummary} />
                  <Leaderboard
                    players={snapshot.players}
                    alltime={snapshot.leaderboard}
                    headOfHousehold={snapshot.matchSummary?.headOfHousehold ?? null}
                  />
                </div>
              </div>
            )}
          </div>

          {/* HOST CONTROL strip. A boss screen is always the host, but we
              still gate on the server's word (room.you.isHost). */}
          {snapshot && room.you?.isHost && (
            <div className="aluminum-panel flex flex-wrap items-center gap-4 p-3">
              <button
                type="button"
                onClick={hostAction}
                className="display-header min-h-12 rounded bg-grievance px-6 py-3 text-lg tracking-widest text-white"
              >
                {hostLabel}
              </button>
              <p className="text-xs text-aluminum-400">
                auto-advance is on; you only need Start.
              </p>
            </div>
          )}
        </div>

        {/* ── c. Right rail ──────────────────────────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-4">
          {/* Join instructions — shown BIG. This URL is the whole onboarding. */}
          <div className="memo-panel p-4">
            <h2 className="display-header text-sm tracking-widest text-aluminum-700">
              Join in
            </h2>
            <p className="mt-1 text-sm text-aluminum-800">open</p>
            <p className="break-all font-mono text-2xl font-bold text-aluminum-900">
              {/* Empty during the server render; fills in right after mount. */}
              {origin || "…"}
            </p>
            <p className="text-sm text-aluminum-800">on your phone</p>
            <p className="mt-2 font-mono text-xs text-aluminum-600">
              {snapshot?.playerCount ?? 0} player
              {(snapshot?.playerCount ?? 0) === 1 ? "" : "s"} ·{" "}
              {snapshot?.bossCount ?? 0} screen
              {(snapshot?.bossCount ?? 0) === 1 ? "" : "s"}
            </p>
          </div>

          <Leaderboard
            players={snapshot?.players ?? []}
            alltime={snapshot?.leaderboard ?? []}
            headOfHousehold={snapshot?.matchSummary?.headOfHousehold ?? null}
          />

          {/* The feed is empty until the reveal shuffles it in, and it stays
              populated afterwards — so "non-empty" is exactly "reveal + after".
              The host can hide anything that crosses the line. */}
          {snapshot && snapshot.grievanceFeed.length > 0 && (
            <GrievanceFeed
              items={snapshot.grievanceFeed}
              canHide={true}
              onHide={(id) => room.hostHideGrievance(id)}
            />
          )}
        </aside>
      </div>

      {/* f. Footer: the operator can grab their phone and play too. */}
      <footer className="text-center">
        <Link
          href="/"
          className="text-xs text-aluminum-500 underline underline-offset-2 hover:text-aluminum-300"
        >
          jump in and play →
        </Link>
      </footer>
    </main>
  );
}
