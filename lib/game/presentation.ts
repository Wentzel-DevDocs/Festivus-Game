/**
 * Public game-state cues for client-side presentation systems.
 *
 * This intentionally derives everything from the anonymous broadcast
 * snapshot: the soundtrack can react to crowd pressure and outcomes without
 * ever learning which player pressed which action.
 */

import type { Snapshot } from "../realtime/protocol";
import type { ScoreState } from "../sound";
import { GAME_CONFIG } from "./config";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Build one adaptive-score cue from the latest public room snapshot. */
export function scoreCueFor(snap: Snapshot): ScoreState {
  const remainingMs = Math.max(0, snap.phaseEndsAt - snap.serverNow);
  const eventDurationMs = Math.max(1, (snap.eventMeta?.durationSec ?? 20) * 1000);
  const eventElapsed = clamp01(1 - remainingMs / eventDurationMs);
  const actionTotal = snap.sideCounts ? snap.sideCounts[0] + snap.sideCounts[1] : 0;
  const crowdPressure = clamp01(actionTotal / Math.max(12, snap.playerCount * 20));

  let intensity = 0.2;
  switch (snap.phase) {
    case "lobby":
      intensity = 0.18 + clamp01(snap.playerCount / 18) * 0.24;
      break;
    case "grievance_write":
      intensity =
        0.22 +
        clamp01(
          snap.grievanceCount /
            Math.max(
              GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER,
              snap.playerCount * GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER,
            ),
        ) *
          0.28;
      break;
    case "grievance_reveal":
      intensity = 0.48;
      break;
    case "event_countdown":
      intensity =
        0.48 + clamp01(1 - remainingMs / GAME_CONFIG.COUNTDOWN_MS) * 0.32;
      break;
    case "event_active":
      intensity = clamp01(0.34 + eventElapsed * 0.4 + crowdPressure * 0.26);
      break;
    case "event_outcome":
      intensity = 0.44;
      break;
    case "finale":
      intensity = 0.88;
      break;
    case "splash":
      intensity = 0.32;
      break;
  }

  let latestRound: Snapshot["roundResults"][number] | null = null;
  if (snap.phase === "event_outcome") {
    for (let index = snap.roundResults.length - 1; index >= 0; index--) {
      if (snap.roundResults[index].eventId === snap.eventMeta?.id) {
        latestRound = snap.roundResults[index];
        break;
      }
    }
  }

  return {
    phase: snap.phase,
    eventId: snap.eventMeta?.id,
    intensity,
    outcome: latestRound?.winner ?? snap.matchSummary?.verdict ?? null,
  };
}
