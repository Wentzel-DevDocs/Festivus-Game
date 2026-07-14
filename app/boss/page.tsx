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
  const isPrimaryHost = room.you?.isHost === true;
  const isSecondaryDisplay = room.you !== null && !isPrimaryHost;

  // The join URL people type into their phones. window.location only exists
  // in the browser, so we read it after mount — rendering it directly would
  // make the server HTML disagree with the client (hydration mismatch).
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  /* ── Projector fullscreen ─────────────────────────────────────────── */

  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    setFullscreenSupported(document.fullscreenEnabled);
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement !== null);
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setFullscreenError("Fullscreen was blocked by this browser or display policy.");
    }
  }

  /* ── Sound wiring (this screen is usually the room's audio) ─────────── */

  // Only the server-designated primary host may produce room audio. Secondary
  // boss screens are forced quiet without overwriting the stored host choice.
  const [preferredMuted, setPreferredMuted] = useState(false);
  useEffect(() => {
    setPreferredMuted(getMuted());
  }, []);

  const effectiveMuted = !isPrimaryHost || preferredMuted;
  useEffect(() => sound.setMuted(effectiveMuted), [effectiveMuted]);

  function toggleMute() {
    // Secondary screens stay silent and must never overwrite the primary
    // display's localStorage preference (often shared by another tab).
    if (!isPrimaryHost) return;
    const next = !preferredMuted;
    setPreferredMuted(next);
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
    <main className="broadcast-shell mx-auto flex min-h-dvh w-full flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:h-dvh lg:min-h-0 lg:overflow-hidden lg:p-5">
      {/* a. Header bar. */}
      <header className="broadcast-header forge-panel flex shrink-0 flex-wrap items-center gap-3 p-3 lg:grid lg:grid-cols-[minmax(260px,auto)_minmax(280px,1fr)_auto] lg:gap-4">
        <div className="broadcast-heading flex min-w-0 flex-wrap items-center gap-3">
          <div className="broadcast-brand-lockup brand-lockup min-w-0">
            <span className="brand-sigil" aria-hidden="true" />
            <div className="min-w-0">
              <p className="eyebrow">Live broadcast</p>
              <h1 className="display-header truncate text-xl tracking-wide lg:text-2xl">
                Justin&apos;s Feats of Strength
              </h1>
            </div>
          </div>
          <div className="broadcast-stamp shrink-0">
            <Stamp>MANDATORY ATTENDANCE</Stamp>
          </div>
        </div>
        <div className="broadcast-phase min-w-0 flex-1 lg:flex-none">
          <PhaseBanner snapshot={snapshot} />
        </div>
        <div className="broadcast-header-actions flex shrink-0 items-center gap-2 lg:justify-self-end">
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={
              fullscreenSupported
                ? isFullscreen
                  ? "Exit fullscreen"
                  : "Enter fullscreen"
                : "Fullscreen is unavailable on this display"
            }
            disabled={!fullscreenSupported}
            className="broadcast-fullscreen aluminum-panel flex min-h-12 min-w-12 shrink-0 items-center justify-center text-aluminum-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {isFullscreen ? (
                <path d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" />
              ) : (
                <path d="M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5" />
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={effectiveMuted}
            aria-label={
              isPrimaryHost
                ? effectiveMuted
                  ? "Unmute sounds"
                  : "Mute sounds"
                : "Secondary boss display audio is muted"
            }
            title={
              isPrimaryHost
                ? effectiveMuted
                  ? "Unmute room audio"
                  : "Mute room audio"
                : "Audio is reserved for the primary host display"
            }
            disabled={!isPrimaryHost}
            className="broadcast-audio aluminum-panel flex min-h-12 min-w-12 shrink-0 items-center justify-center text-aluminum-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" />
              {effectiveMuted ? (
                <path d="m16 9 5 5m0-5-5 5" />
              ) : (
                <>
                  <path d="M16 9.5a4 4 0 0 1 0 5" />
                  <path d="M18.5 7a7 7 0 0 1 0 10" />
                </>
              )}
            </svg>
          </button>
          {fullscreenError && (
            <span className="sr-only" role="alert">
              {fullscreenError}
            </span>
          )}
        </div>
      </header>

      {/* Stage + right rail. Single column on small screens, split on TV. */}
      <div className="broadcast-body grid min-h-0 flex-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(310px,22vw,400px)] lg:overflow-hidden">
        {/* ── b. Main: the stage + host controls ─────────────────────── */}
        <section
          className="broadcast-primary grid min-h-0 min-w-0 grid-rows-[minmax(340px,52vh)_auto] gap-3 lg:grid-rows-[minmax(0,1fr)_auto]"
          aria-label="Live game broadcast"
        >
          {/* `relative` so phase overlays can sit on top of the canvas. */}
          <div className="broadcast-stage-frame stage-frame relative min-h-0 overflow-hidden rounded-[14px]">
            <GameCanvas
              room={room}
              mode="broadcast"
              className="broadcast-stage game-stage h-full min-h-[340px] w-full lg:min-h-0"
            />

            <div className="broadcast-stage-chrome stage-chrome pointer-events-none absolute inset-0 z-[3]" aria-hidden="true">
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
              <div className="broadcast-grievance-overlay absolute inset-0 z-[4] flex items-center justify-center overflow-y-auto bg-aluminum-950/35 p-4 backdrop-blur-[2px] sm:p-6">
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
              <div className="broadcast-results-overlay results-overlay absolute inset-0 z-[5] overflow-y-auto overscroll-contain bg-aluminum-950/88 p-4 backdrop-blur-md lg:p-6">
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

          {/* Every boss display reserves the same operator-row height, so a
              host promotion or extra spectator screen never resizes the stage.
              Only the server-designated primary receives action controls. */}
          <div className="broadcast-operator-row broadcast-controls forge-panel flex min-h-[74px] shrink-0 flex-wrap items-center gap-4 p-3 lg:h-[74px]">
            {snapshot && isPrimaryHost ? (
              <>
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
              </>
            ) : (
              <div
                className="broadcast-operator-status flex min-w-0 items-center gap-3"
                role="status"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    isSecondaryDisplay ? "bg-support" : "animate-pulse bg-grease"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="eyebrow">
                    {isSecondaryDisplay
                      ? "Spectator mirror"
                      : isPrimaryHost
                        ? "Primary operator"
                        : "Operator link pending"}
                  </p>
                  <p className="mt-1 text-xs text-aluminum-400">
                    {isSecondaryDisplay
                      ? "Primary host retains controls and room audio · this display stays synced and silent."
                      : isPrimaryHost
                        ? "Host role confirmed · controls arm when the room snapshot arrives."
                        : "Waiting for the room to designate the primary host display."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── c. Right rail ──────────────────────────────────────────── */}
        <aside
          className="broadcast-rail flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
          aria-label="Room access and standings"
        >
          {/* Join instructions — shown BIG. This URL is the whole onboarding. */}
          <div className={`broadcast-join-card forge-panel join-card shrink-0 p-4 ${joinIsPriority ? "join-card--priority" : "join-card--compact"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="eyebrow">Raid uplink</h2>
                <p className="mt-1 text-sm text-aluminum-400">
                  {joinIsPriority ? "Open on your phone to enter the war room" : "Late joins remain open"}
                </p>
              </div>
              <span className="hud-chip">No app</span>
            </div>
            <p className={`broadcast-join-url ${joinIsPriority ? "mt-4 text-2xl lg:text-3xl" : "mt-3 text-base"} break-words font-mono font-bold text-aluminum-100`}>
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
      <footer className="broadcast-footer shrink-0 text-center leading-none">
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
