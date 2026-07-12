/**
 * The shape the Rivet actor POSTs to /api/results when a match ends —
 * the ONLY write path from live game to durable storage.
 *
 * Nothing in here can express "player X picked side Y": participants carry
 * mash counts only, round results carry aggregates only, grievances are
 * bare strings. The write boundary enforces anonymity as hard as the schema.
 */

import type { RoundResultPub } from "../realtime/protocol";

export interface ParticipantPersist {
  /** The player's sticky uuid (their durable identity). */
  stickyId: string;
  name: string;
  /** Counted mashes this match. */
  mashes: number;
}

export interface MatchPersistPayload {
  /** Unix ms timestamps. */
  startedAt: number;
  endedAt: number;
  /** Weighted AGGREGATE headcounts across the match. */
  approvalSupport: number;
  approvalHinder: number;
  /** Sticky id of the champion (most mashes), or null for an empty match. */
  championStickyId: string | null;
  participants: ParticipantPersist[];
  roundResults: RoundResultPub[];
  /** Visible grievance texts, already shuffled — order carries no signal. */
  grievances: string[];
}
