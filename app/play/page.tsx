"use client";

/**
 * /play — the PHONE CONTROLLER.
 *
 * This is what every player holds during the party. One column, thumb-sized
 * controls, and a main panel that swaps with the game phase:
 *
 *   lobby            → wait (and pre-write grievances)
 *   grievance_write  → the anonymous grievance composer
 *   grievance_reveal → "eyes on the big screen" + the feed
 *   event_countdown  → both direct action controls arm
 *   event_active     → HELP or HINDER on every strike
 *   event_outcome    → who carried the round
 *   finale           → a small canvas so phone-only parties see the box pop
 *   splash           → match summary + leaderboard (+ run it back for host)
 *
 * All game state comes from useRoom(); this file only renders it and sends
 * inputs back. The server is the referee — we never compute results here.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useRoom, type RoomApi, type RoomStatus } from "@/lib/realtime/useRoom";
import type { JoinParams, Snapshot } from "@/lib/realtime/protocol";
import type { FxEvent } from "@/lib/game/engine/types";
import type { Phase } from "@/lib/game/engine/session";
import { getSavedName, getStickyId, getMuted, saveMuted } from "@/lib/identity";
import { sound, type Sting } from "@/lib/sound";
import { GAME_CONFIG } from "@/lib/game/config";

import GameCanvas from "@/render/core";
import DualActionPad from "@/components/DualActionPad";
import MashButton from "@/components/MashButton";
import TeamAssignment from "@/components/TeamAssignment";
import Leaderboard from "@/components/Leaderboard";
import GrievanceFeed from "@/components/GrievanceFeed";
import Ticker from "@/components/Ticker";
import PhaseBanner from "@/components/PhaseBanner";
import SplashCard from "@/components/SplashCard";

/* ── Shared constants ─────────────────────────────────────────────────────── */

/**
 * Which sound sting each transient fx event maps to. The server pushes fx
 * (a slip, a miracle…) inside snapshots; we just translate them to noises.
 * (The boss page keeps an identical copy — pages are written independently.)
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

/** Deadpan filler for the ticker when there are no grievances to show. */
const IDLE_TICKER_LINES = [
  "Production is stable until morale improves.",
  "No sprint points were allocated to the aluminum pole.",
  "This incident is not reproducible in staging.",
  "Please attach logs before blaming the grease.",
  "Attendance is mandatory. Cameras remain optional.",
  "The deploy window closes when the grievances begin.",
];

/* ── Small presentational helpers (local to this page) ────────────────────── */

/** Green = connected, pulsing yellow = connecting, red = dropped. */
function ConnectionDot({ status }: { status: RoomStatus }) {
  if (status === "connected") {
    return (
      <span className="controller-connection controller-connection--online flex items-center gap-1.5 text-xs text-aluminum-400">
        <span className="h-2.5 w-2.5 rounded-full bg-support" aria-hidden="true" />
        <span className="sr-only">connected</span>
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="controller-connection controller-connection--pending flex items-center gap-1.5 text-xs text-aluminum-400">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-grease" aria-hidden="true" />
        <span className="sr-only">connecting</span>
      </span>
    );
  }
  return (
    <span className="controller-connection controller-connection--offline flex items-center gap-1.5 text-xs text-grievance">
      <span className="h-2.5 w-2.5 rounded-full bg-grievance" aria-hidden="true" />
      reconnecting…
    </span>
  );
}

/**
 * Compact shared stage for non-event phases. The Pixi backdrop keeps the
 * controller in the same world as the broadcast without crowding out the
 * phase's actual job (typing, reading, or reviewing results).
 */
type AmbientStageSize = "compact" | "standard" | "report" | "connecting";

const AMBIENT_STAGE_SIZE_CLASSES: Record<AmbientStageSize, string> = {
  compact: "controller-ambient-stage--compact h-36",
  standard: "controller-ambient-stage--standard h-40",
  report: "controller-ambient-stage--report h-44",
  connecting: "controller-ambient-stage--connecting h-52",
};

function AmbientStage({
  room,
  kicker,
  title,
  detail,
  size = "standard",
}: {
  room: RoomApi;
  kicker: string;
  title: string;
  detail: string;
  size?: AmbientStageSize;
}) {
  return (
    <section
      className={`controller-ambient-stage game-stage relative overflow-hidden ${AMBIENT_STAGE_SIZE_CLASSES[size]}`}
      aria-label={title}
    >
      <GameCanvas
        room={room}
        mode="controller"
        className="controller-ambient-canvas absolute inset-0 h-full w-full"
      />
      <div className="controller-stage-copy pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4">
        <p className="controller-stage-kicker eyebrow">{kicker}</p>
        <h2 className="controller-stage-title display-header mt-1 text-xl text-aluminum-100">
          {title}
        </h2>
        <p className="controller-stage-detail mt-1 max-w-sm text-xs text-aluminum-300">
          {detail}
        </p>
      </div>
    </section>
  );
}

/** Thin progress bar: how far Justin has gotten this event (0..1). */
function JustinBar({ progress }: { progress: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      className="progress-rail w-full"
      role="progressbar"
      aria-label={`${GAME_CONFIG.BOSS_NAME}'s progress`}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Snapshots arrive ~10×/sec; a 100 ms linear transition smooths the
          steps so the bar glides instead of jumping. */}
      <div
        className="h-full transition-[width] duration-100 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The grievance composer. Used both in the lobby (head start) and during
 * the official grievance_write phase. Submissions are BLIND: the server
 * shows only a running count until the reveal, and stores no author.
 */
function GrievanceComposer({
  room,
  grievanceCount,
  note,
}: {
  room: RoomApi;
  grievanceCount: number;
  note?: string;
}) {
  const [text, setText] = useState("");
  // We remember how many the server ACCEPTED from us, so we can show the
  // remaining quota and a little "sent" receipt per submission.
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The private `you` message keeps this exact after refresh; the local
  // receipt count makes the button update immediately while its ack travels.
  const remaining = Math.max(
    0,
    Math.min(
      room.you?.grievancesRemaining ?? GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER,
      GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER - sent.length,
    ),
  );

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || remaining <= 0) return;
    const res = await room.submitGrievance(trimmed);
    if (res.ok) {
      setSent((prev) => [...prev, trimmed]);
      setText("");
      setError(null);
    } else if (res.reason === "limit reached") {
      setError("You've aired your full allotment of grievances. The rest can wait for dinner.");
    } else {
      // e.g. a dropped connection or the wrong phase.
      setError(res.reason ?? "The committee rejected that one. Try again.");
    }
  }

  return (
    <form
      className="controller-grievance-composer forge-panel flex flex-col gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="controller-grievance-header flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Anonymous feedback channel</p>
          <h2 className="display-header mt-1 text-xl text-aluminum-100">
            Air a grievance
          </h2>
          {note && <p className="mt-1 text-xs text-aluminum-400">{note}</p>}
        </div>
        <span
          className="hud-chip shrink-0"
          aria-label={`${remaining} of ${GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER} per-player submissions remaining`}
        >
          {remaining}/{GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER} yours left
        </span>
      </div>

      <p
        id="grievance-privacy"
        className="controller-grievance-privacy rounded-lg border border-support/20 bg-support/5 px-3 py-2 text-xs leading-5 text-aluminum-300"
      >
        Every player may seal up to {GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER} grievances.
        Identity is never collected—there is no author field in the live room or
        database. The room sees only a sealed count until reveal.
      </p>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="grievance-text"
          className="display-header text-xs tracking-widest text-aluminum-300"
        >
          What should the all-hands hear?
        </label>
        <textarea
          id="grievance-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={GAME_CONFIG.MAX_GRIEVANCE_LENGTH}
          rows={4}
          aria-describedby="grievance-privacy grievance-count"
          placeholder="The sprint was called focused, then six priorities entered production…"
          className="controller-grievance-input w-full resize-none rounded-lg border border-aluminum-600 bg-aluminum-950/80 px-3 py-3 text-base text-aluminum-100 placeholder:text-aluminum-500"
        />
        <div
          id="grievance-count"
          className="controller-grievance-meta flex items-center justify-between gap-3 font-mono text-[11px] text-aluminum-400"
        >
          <span>
            {grievanceCount} sealed room-wide
          </span>
          <span>
            {text.length}/{GAME_CONFIG.MAX_GRIEVANCE_LENGTH}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={!text.trim() || remaining <= 0}
        className="controller-grievance-submit action-plate display-header min-h-12 w-full border border-grievance px-5 py-3 tracking-widest text-aluminum-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Seal grievance
      </button>

      {/* Local receipts prove acceptance without keeping the grievance copy
          visible over somebody's shoulder. The server still stores no author. */}
      {sent.length > 0 && (
        <div
          className="controller-grievance-receipts border-t border-aluminum-700 pt-3"
          aria-live="polite"
        >
          <p className="eyebrow mb-2">Private receipts on this device</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-xs text-support">
            {sent.map((_, index) => (
              <li key={index} className="rounded border border-support/20 bg-support/5 px-2 py-1.5">
                Grievance {String(index + 1).padStart(2, "0")} · sealed ✓
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="text-xs text-grievance" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/* ── The main phase panel ─────────────────────────────────────────────────── */

/**
 * Renders whatever the current phase calls for. Kept as one function with a
 * switch so you can read the whole match flow top to bottom.
 */
function PhasePanel({
  room,
  snapshot,
  myName,
}: {
  room: RoomApi;
  snapshot: Snapshot;
  myName: string;
}) {
  const phase = snapshot.phase;
  const meta = snapshot.eventMeta;

  switch (phase) {
    case "lobby":
      return (
        <div className="controller-lobby flex flex-col gap-3">
          <AmbientStage
            room={room}
            kicker="All-hands room online"
            title="Waiting on the host deploy"
            detail={`${snapshot.playerCount} player${snapshot.playerCount === 1 ? "" : "s"} connected · queue anonymous feedback while the room warms up.`}
          />
          <div className="controller-lobby-panel forge-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Lobby telemetry</p>
                <p className="display-header mt-1 text-lg text-aluminum-100">
                  {snapshot.playerCount} player{snapshot.playerCount === 1 ? "" : "s"} ready
                </p>
              </div>
              <span className="hud-chip">Live socket</span>
            </div>
            {/* Fallback for phone-only parties with no big screen plugged in:
                the first player becomes host and can start from here. */}
            {room.you?.isHost && (
              <button
                type="button"
                onClick={() => room.hostStart()}
                className="action-plate display-header mt-4 min-h-12 w-full border border-grievance px-4 py-3 text-lg tracking-widest text-aluminum-100"
              >
                Ship the feats
              </button>
            )}
          </div>
          <GrievanceComposer
            room={room}
            grievanceCount={snapshot.grievanceCount}
            note="Open early for anyone who already has release notes."
          />
        </div>
      );

    case "grievance_write":
      return (
        <div className="controller-grievance-intake flex flex-col gap-3">
          <AmbientStage
            room={room}
            kicker="Intake window open"
            title="The anonymous channel is live"
            detail="No attribution log. No identity field. Submit the feedback that somehow missed the retro."
            size="compact"
          />
          <GrievanceComposer room={room} grievanceCount={snapshot.grievanceCount} />
        </div>
      );

    case "grievance_reveal":
      return (
        <div className="controller-reveal flex flex-col gap-3">
          <AmbientStage
            room={room}
            kicker="Shuffled release"
            title="The receipts are live"
            detail="Authors were never recorded. Follow the reveal here or put eyes on the broadcast."
            size="compact"
          />
          <div className="hud-chip self-center" role="status">
            Shuffled order · zero attribution
          </div>
          <GrievanceFeed items={snapshot.grievanceFeed} canHide={false} />
        </div>
      );

    case "event_countdown":
    case "event_active":
    case "event_outcome": {
      const teamBased = meta?.teamBased ?? false;
      const team = room.you?.team ?? null;
      // Tug-of-war remains a public assigned-team mash. Every other event
      // dispatches a help/hinder side directly on each strike.
      const canTeamMash = phase === "event_active" && teamBased && team !== null;

      // The server appends the finished round to roundResults; the last entry
      // is the one that just ended. Mash totals are public leaderboard data.
      const last = snapshot.roundResults[snapshot.roundResults.length - 1];
      const labels = meta?.sideLabels ?? ["Support", "Hinder"];
      const myMashes = snapshot.players.find((p) => p.name === myName)?.mashes ?? 0;
      const assignmentLabel =
        team === 0
          ? "Team A assigned · your pulls move only Team A"
          : team === 1
            ? "Team B assigned · your pulls move only Team B"
            : "Team assignment pending";
      const eventPhaseKey = phase.replace("event_", "");

      return (
        <section
          className={`controller-event-grid controller-event-grid--${eventPhaseKey} grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-center`}
          aria-label={`${meta?.name ?? "Current event"} player station`}
          data-event-phase={phase}
        >
          <section
            className={`controller-event-visual controller-event-visual--${eventPhaseKey} flex min-w-0 flex-col gap-2`}
            aria-label="Shared aggregate game arena"
          >
            {/* Every controller now renders the same aggregate-only scene as
                the broadcast. It never receives or branches on anyone's side. */}
            <GameCanvas
              room={room}
              mode="controller"
              className={`controller-event-stage controller-event-stage--${eventPhaseKey} game-stage player-stage w-full`}
            />
            <div className="controller-progress-panel forge-panel px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="eyebrow">Aggregate progress</span>
                <span className="font-mono text-[10px] text-aluminum-400">
                  {Math.round(snapshot.justinProgress * 100)}%
                </span>
              </div>
              <JustinBar progress={snapshot.justinProgress} />
            </div>
          </section>

          <section
            className={`controller-event-actions controller-event-actions--${eventPhaseKey} flex min-w-0 flex-col justify-center gap-3`}
            aria-label="Player input controls"
          >
            {phase === "event_outcome" ? (
              <div
                className="controller-outcome-card forge-panel border-grease/30 p-4 text-center"
                aria-live="polite"
              >
                <p className="eyebrow">Round shipped · official result</p>
                <p className="display-header mt-1 text-2xl text-aluminum-100">
                  {last
                    ? last.winner === "support"
                      ? `${labels[0]} carried it!`
                      : `${labels[1]} got him!`
                    : "Tallying…"}
                </p>
                <p className="mt-2 font-mono text-xs text-aluminum-400">
                  Your mashes this match · {myMashes}
                </p>
              </div>
            ) : (
              <>
                {teamBased ? (
                  <>
                    {phase === "event_active" ? (
                      <div
                        className="controller-assignment hud-chip min-h-11 justify-center text-center"
                        role="status"
                      >
                        {assignmentLabel}
                      </div>
                    ) : (
                      <TeamAssignment team={team} />
                    )}
                    <MashButton
                      enabled={canTeamMash}
                      label={team === 0 ? "Pull A" : team === 1 ? "Pull B" : "Pull"}
                      onTap={() => room.tap()}
                    />
                  </>
                ) : (
                  <DualActionPad
                    labels={labels}
                    state={phase === "event_active" ? "active" : "countdown"}
                    onTap={(side) => room.tap(side)}
                  />
                )}
              </>
            )}
          </section>
        </section>
      );
    }

    case "finale":
      return (
        <div className="controller-finale flex flex-col gap-3">
          <div className="text-center">
            <p className="eyebrow">Final release in progress</p>
            <h2 className="display-header mt-1 text-2xl text-aluminum-100">
              Watch the box
            </h2>
            <p className="mt-1 text-xs text-aluminum-400">
              The production deploy has no rollback plan.
            </p>
          </div>
          {/* Phone-only parties still get the jack-in-the-box moment. */}
          <GameCanvas
            room={room}
            mode="controller"
            className="controller-finale-stage game-stage h-64 w-full"
          />
        </div>
      );

    case "splash":
      return (
        <div className="controller-splash flex flex-col gap-3">
          <AmbientStage
            room={room}
            kicker="Post-match review"
            title="The room has reached a verdict"
            detail="Weighted aggregate actions decided the result. Players could help, hinder, or do both; no action was tied to an identity."
            size="report"
          />
          <SplashCard summary={snapshot.matchSummary} />
          <Leaderboard
            compact
            players={snapshot.players}
            alltime={snapshot.leaderboard}
            headOfHousehold={snapshot.matchSummary?.headOfHousehold ?? null}
          />
          {room.you?.isHost && (
            <button
              type="button"
              onClick={() => room.hostStart()}
              className="action-plate display-header min-h-12 w-full border border-grievance px-4 py-3 text-lg tracking-widest text-aluminum-100"
            >
              Redeploy the match
            </button>
          )}
        </div>
      );

    default:
      // Exhaustive today; a future phase just shows a calm memo.
      return (
        <div className="forge-panel p-4" role="status">
          <p className="eyebrow">Room state changing</p>
          <p className="mt-1 text-sm text-aluminum-300">One moment…</p>
        </div>
      );
  }
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function PlayPage() {
  const router = useRouter();

  // Build the join params ONCE, in an effect (never during render):
  //  - localStorage only exists in the browser, and
  //  - useRoom reconnects whenever the join identity changes, so we must
  //    hand it a stable object, not a fresh one per render.
  // Until join is set, useRoom(null) simply stays disconnected.
  const [join, setJoin] = useState<JoinParams | null>(null);
  useEffect(() => {
    const name = getSavedName();
    if (!name) {
      // No name saved → this person skipped the landing page. Send them back.
      router.replace("/");
      return;
    }
    setJoin({ role: "player", name, stickyId: getStickyId() });
  }, [router]);

  const room = useRoom(join);
  const snapshot = room.snapshot;

  /* ── Sound wiring ──────────────────────────────────────────────────── */

  // Mute preference: load once, persist on toggle.
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

  // Browsers refuse to play audio until a user gesture. The very first
  // pointerdown anywhere on the page unlocks the AudioContext, then the
  // listener removes itself ({ once: true }).
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Server fx → sound stings. Subscribe once per stable room lifetime; the
  // RoomApi object itself is rebuilt for each 25 Hz snapshot.
  useEffect(
    () =>
      room.onFx((fx) => {
        sound.play(FX_TO_STING[fx.type]);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.bufferRef],
  );

  // Finale choreography: the moment we ENTER the finale, wind the crank,
  // then pop the lid ~2.5 s later (matching the canvas animation). The
  // timeout is cleared if we leave the phase or unmount first.
  const prevPhaseRef = useRef<Phase | null>(null);
  const phase = snapshot?.phase ?? null;
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === "finale" && prev !== "finale") {
      sound.play("crank");
      const timer = setTimeout(() => sound.play("pop"), 2500);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  /* ── Derived display data ──────────────────────────────────────────── */

  // Ticker: grievances while they're being revealed, deadpan memos otherwise.
  const revealTexts =
    phase === "grievance_reveal" && snapshot
      ? snapshot.grievanceFeed.map((g) => g.text)
      : [];
  const tickerMessages = revealTexts.length > 0 ? revealTexts : IDLE_TICKER_LINES;
  const isEventPhase = phase?.startsWith("event_") ?? false;
  const shellModeClass = isEventPhase
    ? "controller-shell--event max-w-6xl"
    : "controller-shell--flow max-w-lg";

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <main
      className={`controller-shell safe-bottom mx-auto flex min-h-dvh w-full flex-col gap-3 p-3 ${shellModeClass}`}
      data-phase={phase ?? "connecting"}
    >
      {/* a. Status row: phase banner + connection dot + mute (top-right). */}
      <header
        className={`controller-header flex items-center gap-2 ${isEventPhase ? "controller-header--event" : "controller-header--flow"}`}
      >
        <div className="brand-sigil h-10 w-10" aria-hidden="true" />
        <div className="controller-identity min-w-0 flex-1">
          <p className="eyebrow truncate">
            Controller · {room.you?.name || join?.name || "Player"}
          </p>
          <PhaseBanner snapshot={snapshot} />
        </div>
        <ConnectionDot status={room.status} />
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          className="controller-audio-toggle aluminum-panel flex min-h-11 min-w-11 items-center justify-center text-aluminum-200"
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
            {muted ? (
              <path d="m16 9 5 5m0-5-5 5" />
            ) : (
              <>
                <path d="M16 9.5a4 4 0 0 1 0 5" />
                <path d="M18.5 7a7 7 0 0 1 0 10" />
              </>
            )}
          </svg>
        </button>
      </header>

      {/* b. Phase-dependent main panel. myName prefers the SERVER-sanitized
          name (profanity mask / trim can rewrite what was typed) so the
          roster lookup always matches. */}
      <div
        className={`controller-phase-main min-h-0 flex-1 ${isEventPhase ? "controller-phase-main--event" : "controller-phase-main--flow"}`}
      >
        {snapshot && join ? (
          <PhasePanel room={room} snapshot={snapshot} myName={room.you?.name || join.name} />
        ) : (
          <div className="controller-connecting flex flex-col gap-3">
            <AmbientStage
              room={room}
              kicker="Secure room handshake"
              title="Joining the all-hands"
              detail="Negotiating the live socket and loading the arena. Your controller will recover automatically if the connection drops."
              size="connecting"
            />
            <div className="forge-panel p-4" role="status" aria-live="polite">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-grease" aria-hidden="true" />
                <div>
                  <p className="eyebrow">Connection pending</p>
                  <p className="mt-1 text-sm text-aluminum-300">
                    Registering this controller with the live room…
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* c. Standings return between rounds so the live character and mash
          control remain above the fold on small phones. */}
      {snapshot && phase === "event_outcome" && (
        <section className="controller-outcome-standings" aria-label="Round standings">
          <Leaderboard
            compact
            players={snapshot.players}
            alltime={snapshot.leaderboard}
            headOfHousehold={snapshot.matchSummary?.headOfHousehold ?? null}
          />
        </section>
      )}
      <div
        className={`controller-footer-ticker ${isEventPhase ? "controller-footer-ticker--event" : "controller-footer-ticker--flow"}`}
      >
        <Ticker messages={tickerMessages} />
      </div>
    </main>
  );
}
