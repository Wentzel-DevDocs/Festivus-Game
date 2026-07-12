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
 *   event_countdown  → pick a side + big countdown number
 *   event_active     → pick a side + MASH
 *   event_outcome    → who carried the round
 *   finale           → a small canvas so phone-only parties see the box pop
 *   splash           → match summary + leaderboard (+ run it back for host)
 *
 * All game state comes from useRoom(); this file only renders it and sends
 * inputs back. The server is the referee — we never compute results here.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useRoom, phaseTimerMs, type RoomApi, type RoomStatus } from "@/lib/realtime/useRoom";
import type { JoinParams, Snapshot } from "@/lib/realtime/protocol";
import type { FxEvent } from "@/lib/game/engine/types";
import type { Phase } from "@/lib/game/engine/session";
import { getSavedName, getStickyId, getMuted, saveMuted } from "@/lib/identity";
import { sound, type Sting } from "@/lib/sound";
import { GAME_CONFIG } from "@/lib/game/config";

import GameCanvas from "@/render/core";
import MashButton from "@/components/MashButton";
import SidePicker from "@/components/SidePicker";
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
  "The pole requires no decoration.",
  "Attendance is mandatory.",
  "The tinsel is distracting.",
  "Please direct all complaints to the airing of grievances.",
  "A high strength-to-weight ratio.",
  "Dinner will proceed as scheduled.",
];

/* ── Small presentational helpers (local to this page) ────────────────────── */

/** Green = connected, pulsing yellow = connecting, red = dropped. */
function ConnectionDot({ status }: { status: RoomStatus }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-aluminum-400">
        <span className="h-2.5 w-2.5 rounded-full bg-support" aria-hidden="true" />
        <span className="sr-only">connected</span>
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-aluminum-400">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-grease" aria-hidden="true" />
        <span className="sr-only">connecting</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-grievance">
      <span className="h-2.5 w-2.5 rounded-full bg-grievance" aria-hidden="true" />
      reconnecting…
    </span>
  );
}

/** Thin progress bar: how far Justin has gotten this event (0..1). */
function JustinBar({ progress }: { progress: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-aluminum-800"
      role="progressbar"
      aria-label={`${GAME_CONFIG.BOSS_NAME}'s progress`}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Snapshots arrive ~10×/sec; a 100 ms linear transition smooths the
          steps so the bar glides instead of jumping. */}
      <div
        className="h-full bg-support transition-[width] duration-100 ease-linear"
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
  // The SERVER'S quota survives refreshes and remounts (it's keyed by your
  // sticky id); our local `sent` list does not. When the server says the
  // limit is reached, trust it over the local count.
  const [limitReached, setLimitReached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = limitReached
    ? 0
    : GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER - sent.length;

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || remaining <= 0) return;
    const res = await room.submitGrievance(trimmed);
    if (res.ok) {
      setSent((prev) => [...prev, trimmed]);
      setText("");
      setError(null);
    } else if (res.reason === "limit reached") {
      setLimitReached(true);
      setError("You've aired your full allotment of grievances. The rest can wait for dinner.");
    } else {
      // e.g. a dropped connection or the wrong phase.
      setError(res.reason ?? "The committee rejected that one. Try again.");
    }
  }

  return (
    <div className="memo-panel flex flex-col gap-2 p-4">
      {note && <p className="text-xs italic text-aluminum-600">{note}</p>}
      <label
        htmlFor="grievance-text"
        className="display-header text-xs tracking-widest text-aluminum-700"
      >
        Air a grievance (anonymous, really — there is no author column)
      </label>
      <textarea
        id="grievance-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={GAME_CONFIG.MAX_GRIEVANCE_LENGTH}
        rows={3}
        placeholder="I got a lot of problems with you people…"
        className="w-full resize-none rounded border border-memo-line bg-white px-3 py-2 text-base text-aluminum-900 placeholder:text-aluminum-400"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-aluminum-600">
          {remaining} of {GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER} left
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!text.trim() || remaining <= 0}
          className="display-header min-h-12 rounded bg-grievance px-5 py-2 tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Submit
        </button>
      </div>

      {/* One receipt line per accepted grievance — proof it went through. */}
      {sent.length > 0 && (
        <ul className="space-y-0.5 text-xs text-support">
          {sent.map((g, i) => (
            <li key={i}>sent ✓ — &ldquo;{g.length > 40 ? `${g.slice(0, 40)}…` : g}&rdquo;</li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-grievance">{error}</p>}

      <p className="text-xs text-aluminum-600">
        {grievanceCount} grievance{grievanceCount === 1 ? "" : "s"} submitted so far
      </p>
    </div>
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
        <div className="flex flex-col gap-3">
          <div className="memo-panel p-4">
            <p className="display-header text-lg tracking-wide">
              Waiting for the host to start.
            </p>
            <p className="mt-1 font-mono text-sm text-aluminum-600">
              {snapshot.playerCount} player{snapshot.playerCount === 1 ? "" : "s"} in the room
            </p>
            {/* Fallback for phone-only parties with no big screen plugged in:
                the first player becomes host and can start from here. */}
            {room.you?.isHost && (
              <button
                type="button"
                onClick={() => room.hostStart()}
                className="display-header mt-3 min-h-12 w-full rounded bg-grievance px-4 py-3 text-lg tracking-widest text-white"
              >
                Start the feats
              </button>
            )}
          </div>
          <GrievanceComposer
            room={room}
            grievanceCount={snapshot.grievanceCount}
            note="get a head start on your grievances"
          />
        </div>
      );

    case "grievance_write":
      return <GrievanceComposer room={room} grievanceCount={snapshot.grievanceCount} />;

    case "grievance_reveal":
      return (
        <div className="flex flex-col gap-3">
          <p className="display-header text-center text-lg tracking-wide text-aluminum-300">
            Eyes on the big screen.
          </p>
          <GrievanceFeed items={snapshot.grievanceFeed} canHide={false} />
        </div>
      );

    case "event_countdown":
    case "event_active": {
      const teamBased = meta?.teamBased ?? false;
      const picked = room.you?.side ?? null;
      const team = room.you?.team ?? null;
      // You may only mash once the event is live AND you belong to a side —
      // your secret pick in solo events, your public team in tug-of-war.
      const canMash =
        phase === "event_active" && (teamBased ? team !== null : picked !== null);
      const countdownSec = Math.ceil(phaseTimerMs(snapshot) / 1000);

      return (
        <div className="flex flex-col gap-3">
          {/* Justin responds within a tick — the phone should show it. */}
          <JustinBar progress={snapshot.justinProgress} />

          {phase === "event_countdown" && (
            <p
              className="display-header text-center text-7xl tabular-nums text-grease"
              aria-live="polite"
            >
              {countdownSec}
            </p>
          )}

          <SidePicker
            labels={meta?.sideLabels ?? ["Help", "Hinder"]}
            picked={picked}
            team={team}
            teamBased={teamBased}
            onPick={(s) => void room.pickSide(s)}
          />
          <MashButton enabled={canMash} onTap={() => room.tap()} />
        </div>
      );
    }

    case "event_outcome": {
      // The server appends the finished round to roundResults; the last
      // entry is the one that just ended.
      const last = snapshot.roundResults[snapshot.roundResults.length - 1];
      const labels = meta?.sideLabels ?? ["Support", "Hinder"];
      // Finding yourself by name is fine HERE: mash totals are public
      // leaderboard data. Side picks are the secret, and those never
      // appear per-player anywhere in the snapshot.
      const myMashes = snapshot.players.find((p) => p.name === myName)?.mashes ?? 0;

      return (
        <div className="memo-panel p-4 text-center">
          <p className="display-header text-sm tracking-widest text-aluminum-600">
            {last?.eventName ?? meta?.name ?? "Event"}
          </p>
          <p className="display-header mt-1 text-2xl tracking-wide">
            {last
              ? last.winner === "support"
                ? `${labels[0]} carried it!`
                : `${labels[1]} got him!`
              : "Tallying…"}
          </p>
          <p className="mt-2 font-mono text-sm text-aluminum-600">
            Your mashes this match: {myMashes}
          </p>
        </div>
      );
    }

    case "finale":
      return (
        <div className="flex flex-col gap-2">
          <p className="display-header text-center text-lg tracking-wide text-aluminum-300">
            Watch the box. 🎁
          </p>
          {/* Phone-only parties still get the jack-in-the-box moment. */}
          <GameCanvas room={room} className="h-48 rounded" />
        </div>
      );

    case "splash":
      return (
        <div className="flex flex-col gap-3">
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
              className="display-header min-h-12 w-full rounded bg-grievance px-4 py-3 text-lg tracking-widest text-white"
            >
              Run it back
            </button>
          )}
        </div>
      );

    default:
      // Exhaustive today; a future phase just shows a calm memo.
      return (
        <div className="memo-panel p-4">
          <p className="text-sm">One moment…</p>
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

  // Server fx → sound stings. onFx registers into a stable listener set
  // inside the hook, so re-subscribing when `room` re-memoizes is cheap.
  useEffect(
    () =>
      room.onFx((fx) => {
        sound.play(FX_TO_STING[fx.type]);
      }),
    [room],
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

  const isEventPhase =
    phase === "event_countdown" || phase === "event_active" || phase === "event_outcome";

  // Ticker: grievances while they're being revealed, deadpan memos otherwise.
  const revealTexts =
    phase === "grievance_reveal" && snapshot
      ? snapshot.grievanceFeed.map((g) => g.text)
      : [];
  const tickerMessages = revealTexts.length > 0 ? revealTexts : IDLE_TICKER_LINES;

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 p-3">
      {/* a. Status row: phase banner + connection dot + mute (top-right). */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <PhaseBanner snapshot={snapshot} />
        </div>
        <ConnectionDot status={room.status} />
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          className="aluminum-panel flex min-h-12 min-w-12 items-center justify-center text-xl"
        >
          {/* Speaker glyphs, not text — hence the aria-label above. */}
          <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
        </button>
      </div>

      {/* b. Phase-dependent main panel. myName prefers the SERVER-sanitized
          name (profanity mask / trim can rewrite what was typed) so the
          roster lookup always matches. */}
      <div className="flex-1">
        {snapshot && join ? (
          <PhasePanel room={room} snapshot={snapshot} myName={room.you?.name || join.name} />
        ) : (
          <div className="memo-panel p-4">
            <p className="text-sm">Connecting to the room…</p>
          </div>
        )}
      </div>

      {/* c. Bottom rail: compact leaderboard during events, ticker always. */}
      {snapshot && isEventPhase && (
        <Leaderboard
          compact
          players={snapshot.players}
          alltime={snapshot.leaderboard}
          headOfHousehold={snapshot.matchSummary?.headOfHousehold ?? null}
        />
      )}
      <Ticker messages={tickerMessages} />
    </main>
  );
}
