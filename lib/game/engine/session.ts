/**
 * The session runner — a small phase machine the Rivet actor drives once
 * per tick. It owns WHEN things happen (auto-advance between phases); the
 * actor owns WHAT happens (via the hooks) and each event module owns HOW
 * its round plays.
 *
 * Phase order:
 *   lobby → grievance_write → grievance_reveal
 *     → [event_countdown → event_active → event_outcome] × 5
 *     → finale (jack-in-the-box) → splash → (host starts a new match)
 *
 * Pure logic: no timers, no I/O. The actor calls tickSession(state, now)
 * every ~40 ms and the machine advances when `now` passes `phaseEndsAt`.
 * That makes the whole flow testable with a fake clock (see scripts/simulate.ts).
 */

export type Phase =
  | "lobby"
  | "grievance_write"
  | "grievance_reveal"
  | "event_countdown"
  | "event_active"
  | "event_outcome"
  | "finale"
  | "splash";

export interface SessionState {
  phase: Phase;
  /** Clock value (ms) when the phase auto-advances. Infinity = waits for host. */
  phaseEndsAt: number;
  /** Which event is up: 0..4 during event phases, -1 otherwise. */
  eventIndex: number;
}

/** Timing knobs, injected from lib/game/config (and level_config overrides). */
export interface SessionTiming {
  grievanceWriteMs: number;
  grievanceRevealMs: number;
  countdownMs: number;
  outcomeMs: number;
  finaleMs: number;
  eventCount: number;
  /** Active-window length for event i (level_config can retune per event). */
  eventDurationMs(index: number): number;
}

/** What the actor plugs in. Called exactly once per transition. */
export interface SessionHooks {
  /** Fires at COUNTDOWN start: reset round tokens, assign tug teams, init module state. */
  onEventStart(index: number): void;
  /** Fires when the active window closes (timeout or early finish): resolve + record. */
  onEventEnd(index: number): void;
  /** Fires at finale start: compute verdict + champion, persist the match. */
  onMatchEnd(): void;
  /** Early-exit check, polled during event_active. */
  isEventComplete(index: number): boolean;
  /** Optional early-exit for the grievance write phase (everyone submitted). */
  allGrievancesIn?(): boolean;
}

export function newSession(): SessionState {
  return { phase: "lobby", phaseEndsAt: Infinity, eventIndex: -1 };
}

/** Host pressed Start (from the lobby or the splash of a finished match). */
export function startMatch(s: SessionState, now: number, t: SessionTiming): void {
  s.phase = "grievance_write";
  s.phaseEndsAt = now + t.grievanceWriteMs;
  s.eventIndex = -1;
}

/** Host pressed Skip: end the current phase right now (auto-advance handles the rest). */
export function skipPhase(s: SessionState): void {
  if (s.phase !== "lobby" && s.phase !== "splash") s.phaseEndsAt = -Infinity;
}

/**
 * Advance the machine. Loops so that a single call can cross several
 * boundaries if the clock jumped (e.g. the actor woke from sleep).
 */
export function tickSession(
  s: SessionState,
  now: number,
  t: SessionTiming,
  hooks: SessionHooks,
): void {
  // Early exits that beat the clock.
  if (s.phase === "grievance_write" && hooks.allGrievancesIn?.()) {
    s.phaseEndsAt = Math.min(s.phaseEndsAt, now);
  }
  if (s.phase === "event_active" && hooks.isEventComplete(s.eventIndex)) {
    s.phaseEndsAt = Math.min(s.phaseEndsAt, now);
  }

  let guard = 0;
  while (now >= s.phaseEndsAt && guard++ < 20) {
    switch (s.phase) {
      case "grievance_write":
        s.phase = "grievance_reveal";
        s.phaseEndsAt = now + t.grievanceRevealMs;
        break;

      case "grievance_reveal":
        enterCountdown(s, 0, now, t, hooks);
        break;

      case "event_countdown":
        s.phase = "event_active";
        s.phaseEndsAt = now + t.eventDurationMs(s.eventIndex);
        break;

      case "event_active":
        hooks.onEventEnd(s.eventIndex);
        s.phase = "event_outcome";
        s.phaseEndsAt = now + t.outcomeMs;
        break;

      case "event_outcome":
        if (s.eventIndex + 1 < t.eventCount) {
          enterCountdown(s, s.eventIndex + 1, now, t, hooks);
        } else {
          hooks.onMatchEnd();
          s.phase = "finale";
          s.phaseEndsAt = now + t.finaleMs;
          s.eventIndex = -1;
        }
        break;

      case "finale":
        s.phase = "splash";
        s.phaseEndsAt = Infinity; // stays until the host starts a new match
        break;

      case "lobby":
      case "splash":
        return; // host-gated phases never auto-advance
    }

    // Re-check the early-exit rules for the phase we just entered.
    if (s.phase === "event_active" && hooks.isEventComplete(s.eventIndex)) {
      s.phaseEndsAt = Math.min(s.phaseEndsAt, now);
    }
  }
}

function enterCountdown(
  s: SessionState,
  index: number,
  now: number,
  t: SessionTiming,
  hooks: SessionHooks,
): void {
  s.eventIndex = index;
  s.phase = "event_countdown";
  s.phaseEndsAt = now + t.countdownMs;
  hooks.onEventStart(index);
}
