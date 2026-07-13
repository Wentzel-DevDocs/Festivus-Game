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

import { useRoom } from "@/lib/realtime/useRoom";
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
  const joinIsPriority = phase === null || phase === "lobby";

  // The join URL people type into their phones. window.location only exists
  // in the browser, so we read it after mount — rendering it directly would
  // make the server HTML disagree with the client (hydration mismatch).
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
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
    // bufferRef is stable; RoomApi is rebuilt for each realtime snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.bufferRef],
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

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <main className="broadcast-shell mx-auto flex min-h-dvh w-full max-w-[1800px] flex-col gap-4 p-4 lg:p-5">
      {/* a. Header bar. */}
      <header className="forge-panel flex flex-wrap items-center gap-4 p-3">
        <div className="brand-lockup">
          <span className="brand-sigil" aria-hidden="true" />
          <div>
            <p className="eyebrow">Live broadcast</p>
            <h1 className="display-header text-xl tracking-wide lg:text-2xl">
              Justin&apos;s Feats of Strength
            </h1>
          </div>
        </div>
        <Stamp>MANDATORY ATTENDANCE</Stamp>
        <div className="min-w-0 flex-1">
          <PhaseBanner snapshot={snapshot} />
        </div>
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
      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(310px,22vw,380px)]">
        {/* ── b. Main: the stage + host controls ─────────────────────── */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* `relative` so phase overlays can sit on top of the canvas. */}
          <div className="stage-frame relative">
            <GameCanvas
              room={room}
              mode="broadcast"
              className="boss-stage w-full"
            />

            <div className="stage-chrome pointer-events-none absolute inset-0 z-[3]" aria-hidden="true">
              <div className="absolute left-3 top-3 flex flex-wrap gap-2 lg:left-4 lg:top-4">
                <span className="hud-chip live-chip">
                  <span className="live-beacon" /> Citadel live
                </span>
                <span className="hud-chip">Room 01</span>
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 lg:bottom-4 lg:left-4 lg:right-4">
                <span className="hud-chip">
                  {snapshot?.playerCount ?? 0} raider{(snapshot?.playerCount ?? 0) === 1 ? "" : "s"} connected
                </span>
                <span className="hud-chip hidden sm:inline-flex">
                  {room.status === "connected" ? "Realtime uplink stable" : "Reconnecting uplink"}
                </span>
              </div>
            </div>

            {/* d. Blind-submit overlay: a live COUNT only — the grievance
                texts stay hidden until the reveal. */}
            {phase === "grievance_write" && snapshot && (
              <div className="absolute inset-0 z-[4] flex items-center justify-center bg-aluminum-950/35 p-6 backdrop-blur-[2px]">
                <div className="grievance-seal forge-panel w-full max-w-2xl p-8 text-center lg:p-10">
                  <p className="eyebrow">Anonymous incident intake</p>
                  <p className="display-header mt-3 text-4xl tracking-wide lg:text-5xl">
                    {snapshot.grievanceCount} grievance
                    {snapshot.grievanceCount === 1 ? "" : "s"} and counting…
                  </p>
                  <div className="hud-rule my-5" />
                  <p className="mx-auto max-w-xl text-sm text-aluminum-300 lg:text-base">
                    Reports are sealed until the postmortem. Authorship is discarded
                    at intake and never enters the broadcast payload.
                  </p>
                  <div className="mt-5 flex justify-center gap-2" aria-hidden="true">
                    <span className="status-rune status-rune--active" />
                    <span className="status-rune status-rune--active" />
                    <span className="status-rune status-rune--active" />
                    <span className="status-rune" />
                    <span className="status-rune" />
                  </div>
                </div>
              </div>
            )}

            {/* e. Splash overlay: the match summary over a dimmed stage,
                with the full leaderboard underneath it. */}
            {phase === "splash" && snapshot && (
              <div className="results-overlay absolute inset-0 z-[5] overflow-y-auto bg-aluminum-950/88 p-4 backdrop-blur-md lg:p-6">
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
            <div className="forge-panel flex flex-wrap items-center gap-4 p-3">
              <button
                type="button"
                onClick={hostAction}
                className="display-header min-h-12 rounded-md border border-grievance bg-grievance/15 px-6 py-3 text-lg text-grievance transition-colors hover:bg-grievance hover:text-white"
              >
                {hostLabel}
              </button>
              <p className="text-xs text-aluminum-400">
                Auto-advance armed · skip is the incident-response override.
              </p>
            </div>
          )}
        </div>

        {/* ── c. Right rail ──────────────────────────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-4">
          {/* Join instructions — shown BIG. This URL is the whole onboarding. */}
          <div className={`forge-panel join-card p-4 ${joinIsPriority ? "join-card--priority" : "join-card--compact"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="eyebrow">Raid uplink</h2>
                <p className="mt-1 text-sm text-aluminum-400">
                  {joinIsPriority ? "Open on your phone to enter the war room" : "Late joins remain open"}
                </p>
              </div>
              <span className="hud-chip">No app</span>
            </div>
            <p className={`${joinIsPriority ? "mt-4 text-2xl lg:text-3xl" : "mt-3 text-base"} break-all font-mono font-bold text-aluminum-100`}>
              {/* Empty during the server render; fills in right after mount. */}
              {origin || "…"}
            </p>
            <div className="hud-rule my-3" />
            <div className="flex items-center justify-between gap-3 font-mono text-xs text-aluminum-400">
              <span>
                {snapshot?.playerCount ?? 0} raider
                {(snapshot?.playerCount ?? 0) === 1 ? "" : "s"} ·{" "}
                {snapshot?.bossCount ?? 0} broadcast
                {(snapshot?.bossCount ?? 0) === 1 ? "" : "s"}
              </span>
              <span className="text-support">Uplink open</span>
            </div>
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
