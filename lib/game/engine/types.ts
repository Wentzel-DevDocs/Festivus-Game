/**
 * The Event contract — every feat of strength implements this one interface.
 *
 * ANONYMITY BY CONSTRUCTION: notice that nothing in this file mentions a
 * player id, name, or connection. Event modules only ever see a SIDE INDEX
 * (0 = help Justin, 1 = hinder Justin; for tug-of-war, 0 = Team A, 1 = Team B).
 * The room resolves "which side is this tap on?" through an ephemeral
 * per-round token held in memory, then throws the token away. An event module
 * literally cannot leak who picked what — it never knows.
 *
 * The contract's `render` half lives client-side: each module here has a
 * matching PixiJS scene in render/scenes/<id>.ts, keyed by the same id and
 * drawing from the module's public `view()` output. (The server can't hold
 * Pixi code, so the one-contract-two-files split keeps both halves honest.)
 *
 * ADDING A LEVEL = write one file in lib/game/events/ implementing
 * `EventModule`, register it in lib/game/engine/registry.ts, add a scene in
 * render/scenes/, and (optionally) seed tuning numbers into level_config.
 */

import type { EventParams } from "../config";

/** 0 = help/support/Team A · 1 = hinder/grease/Team B */
export type SideIndex = 0 | 1;

/** The only input kinds an event ever receives. */
export type EventInput = { kind: "tap" };

/**
 * Transient visual effects for the CURRENT tick only. Modules push events
 * here (a slip, a splash, a miracle); the actor drains the queue into the
 * next snapshot; clients play the effect and forget it.
 */
export interface FxEvent {
  type:
    | "miracle" // Festivus Miracle comeback boost
    | "slip" // greased climb slide-down
    | "sink" // swim sprint drowning gag
    | "count" // pin-the-boss hold count ticked up
    | "countBroken" // support smashed the pin count back to zero
    | "pinned" // pin bar crossed the line
    | "win"
    | "lose";
  /** Which side the effect favors/afflicts, when that makes sense. */
  side?: SideIndex;
  /** Optional payload, e.g. the count number for "count". */
  value?: number;
}

/** Context handed to init(): everything a module may know about the room. */
export interface EventInitCtx {
  /** Total connected players (not bosses). */
  playerCount: number;
  /** Players per side — AGGREGATE headcounts only. */
  sideCounts: [number, number];
  /** Tuning numbers (level_config row, or defaults from lib/game/config). */
  params: EventParams;
}

/** Context handed to onInput()/tick()/isComplete()/resolve(). */
export interface EventTickCtx extends EventInitCtx {
  /** Push transient visual effects here. */
  fx: FxEvent[];
  /** Random source — injectable so tests can be deterministic. */
  rng: () => number;
}

/**
 * What a finished event reports. AGGREGATES ONLY — force totals and
 * headcounts per side. This is exactly what lands in the round_results
 * table; there is nowhere to put a player id even if you wanted to.
 */
export interface EventResult {
  /** Who won: "support" (Justin helped through) or "hinder" (he was stopped).
   *  Tug-of-war reports its winning team through the same two slots
   *  (support = Team A, hinder = Team B) — see tugOfWar.ts. */
  winner: "support" | "hinder";
  /** Total counted taps per side across the event. */
  supportForce: number;
  hinderForce: number;
  /** Headcount per side (how many PEOPLE, not taps). */
  supportHead: number;
  hinderHead: number;
}

/**
 * A JSON-safe bundle of PUBLIC visual state for the renderer — numbers and
 * booleans only, aggregates only. Broadcast to every screen each snapshot.
 */
export type EventView = Record<string, number | boolean>;

export interface EventModule<S = unknown> {
  /** Unique id — also keys the render scene and the level_config row. */
  id: string;
  /** Display name for the countdown banner. */
  name: string;
  /** [help label, hinder label] shown on the side picker. */
  sideLabels: [string, string];
  /** Scoring weight: finale = 2, everything else = 1. */
  weight: number;
  /** True only for tug-of-war: sides are assigned teams, not secret picks. */
  teamBased: boolean;
  /** Default active-window length; level_config can override. */
  durationSec: number;

  /** Build fresh state for a new round. */
  init(ctx: EventInitCtx): S;

  /** One player input landed on `side` (identity already stripped). */
  onInput(state: S, side: SideIndex, input: EventInput, ctx: EventTickCtx): void;

  /** Advance the simulation by dtMs. Runs every server tick (~40 ms). */
  tick(state: S, dtMs: number, ctx: EventTickCtx): void;

  /** True once the event decided early (goal reached / boss pinned). */
  isComplete(state: S, ctx: EventTickCtx): boolean;

  /** Final aggregate outcome (also called on timeout). */
  resolve(state: S, ctx: EventTickCtx): EventResult;

  /** Public visual state for the PixiJS scene (aggregates only). */
  view(state: S): EventView;
}
