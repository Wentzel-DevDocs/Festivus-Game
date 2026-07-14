/**
 * The realtime protocol — every shape that crosses the WebSocket, shared by
 * the room server (server/game/core.ts) and the React pages (client).
 *
 * AUTHORITATIVE MODEL: clients send INPUTS ONLY (a tap plus its direct side);
 * actor is the single source of truth. It counts mashes itself, rate-caps
 * them per sticky player identity, simulates Justin, and broadcasts snapshots
 * ~25×/second. Clients interpolate between snapshots and never report
 * totals of their own.
 *
 * ANONYMITY: read the Snapshot type bottom-up — there is no field anywhere
 * that pairs a player with a HELP/HINDER action. Side data is aggregate
 * only (action totals + force totals). The lone exception is tug-of-war
 * `team`, which is deliberately public (it's a team sport).
 */

import type { EventView, FxEvent } from "../game/engine/types";
import type { Phase } from "../game/engine/session";

export type Role = "boss" | "player";

/** Sent once as connection params when a client connects to the room. */
export interface JoinParams {
  role: Role;
  /** Display name, 1–24 chars (server clamps + strips). */
  name: string;
  /** localStorage uuid — identifies NAME and SCORE only, never a side. */
  stickyId: string;
}

/* ── Client → server: the action surface (see server/game/core.ts) ─────────
 *   tap(sideIndex)              one help/hinder mash (solo events)
 *   tap()                       one assigned-team mash (tug-of-war)
 *   hostStart()                 start the match (host only)
 *   hostSkip()                  skip the current phase (host only)
 *   hostHideGrievance(id)       remove a grievance from the feed (host only)
 *   submitGrievance(text)       blind-submit a gripe
 *   switchToPlayer(name)        boss connection becomes a player
 * ────────────────────────────────────────────────────────────────────────── */

/** Public roster entry. `team` is set ONLY during tug-of-war. */
export interface PlayerPub {
  name: string;
  /** Counted mashes this match (the live leaderboard metric). */
  mashes: number;
  team: 0 | 1 | null;
}

/** A grievance in the shuffled reveal feed. No author — there is none. */
export interface GrievancePub {
  id: string;
  text: string;
}

/** All-time standings from Neon (durable across sessions). */
export interface LeaderboardEntry {
  name: string;
  totalMashes: number;
  wins: number;
  bestScore: number;
}

/** Aggregate outcome of one finished event (mirrors round_results). */
export interface RoundResultPub {
  eventId: string;
  eventName: string;
  winner: "support" | "hinder";
  supportForce: number;
  hinderForce: number;
  /** Public tug-team headcounts; zero for dual-action solo events. */
  supportHead: number;
  hinderHead: number;
}

/** Computed at match end, shown in the finale + splash. */
export interface MatchSummary {
  /** From weighted AGGREGATE action contribution only. */
  verdict: "beloved" | "greased" | "divided";
  approvalSupport: number;
  approvalHinder: number;
  /** Most mashes this match → crowned champion / next Head of Household. */
  championName: string | null;
  championMashes: number;
  /** All-time wins leader coming INTO this match — the target on the poster. */
  headOfHousehold: string | null;
}

/** Static facts about the current event, for headers and direct controls. */
export interface EventMetaPub {
  id: string;
  name: string;
  sideLabels: [string, string];
  teamBased: boolean;
  durationSec: number;
  index: number;
  total: number;
  weight: number;
}

/** Broadcast to every connection ~25×/second. */
export interface Snapshot {
  /** Server clock (ms). timerMs = phaseEndsAt − serverNow. */
  serverNow: number;
  phase: Phase;
  phaseEndsAt: number;
  eventMeta: EventMetaPub | null;
  /** Public visual state from the event module's view() — aggregates only. */
  eventView: EventView | null;
  /** Canonical "how far is Justin" 0..1 (all events normalize into this). */
  justinProgress: number;
  /** Rope position -1..1; 0 outside tug-of-war. */
  tugPosition: number;
  /** Transient effects since the last snapshot (play once, forget). */
  fx: FxEvent[];
  /** Live roster sorted by mashes, aggregates + names only. */
  players: PlayerPub[];
  playerCount: number;
  bossCount: number;
  /**
   * Aggregate side totals. Solo events: counted actions per side. Tug:
   * public team headcounts used for fair team balancing.
   */
  sideCounts: [number, number] | null;
  /** Shuffled at reveal; empty before. Host-hidden items are removed. */
  grievanceFeed: GrievancePub[];
  /** How many have been submitted (for the write-phase progress UI). */
  grievanceCount: number;
  leaderboard: LeaderboardEntry[];
  /** True until the finale — the approval read stays sealed. */
  approvalHidden: boolean;
  matchSummary: MatchSummary | null;
  roundResults: RoundResultPub[];
}

/**
 * Private per-connection message (conn.send, never broadcast): connection
 * facts only YOU should see. Solo-side state does not exist: every direct
 * action carries its side and is immediately reduced to aggregate totals.
 */
export interface YouMessage {
  isHost: boolean;
  role: Role;
  /** Your display name AFTER server sanitation (profanity mask, trim). The
   *  client uses this — not its locally saved input — to find itself in
   *  the public roster. */
  name: string;
  /** Your tug-of-war team, when assigned. */
  team: 0 | 1 | null;
  /** Private quota state so refreshes still show an accurate personal count. */
  grievancesRemaining: number;
}

/** Event names the actor broadcasts / sends. */
export const EVT_SNAPSHOT = "snapshot";
export const EVT_YOU = "you";
