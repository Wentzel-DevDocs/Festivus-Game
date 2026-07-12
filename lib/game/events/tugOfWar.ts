/**
 * EVENT 4 — TUG-OF-WAR (the only TEAM event).
 * Sides: Team A / Team B (assigned by the server, NOT picked).
 *
 * The actor Fisher–Yates-shuffles players into two teams (which team gets
 * the odd player is also randomized) and keeps `ctx.sideCounts` current as
 * late joiners drop onto the smaller team. Justin is the ribbon tied to the
 * rope's midpoint. Rope position runs -1 (Team B wins) .. +1 (Team A wins).
 *
 * FAIRNESS: the smaller team's per-player force is multiplied by
 * (largerCount / smallerCount) — see tugHandicap() — so equal per-person
 * effort centers the rope even with an odd headcount.
 */

import type { EventInput, EventModule, EventResult, SideIndex } from "../engine/types";
import { clamp, maybeMiracle, newMiracle, tugHandicap } from "../engine/math";
import type { MiracleState } from "../engine/math";

interface TugOfWarState {
  /** -1 = Team B pulled it home, +1 = Team A did. 0 = dead center. */
  ropePos: number;
  pending: [number, number];
  force: [number, number];
  miracle: MiracleState;
  elapsedMs: number;
}

export const tugOfWar: EventModule<TugOfWarState> = {
  id: "tugOfWar",
  name: "Tug-of-War",
  sideLabels: ["Team A", "Team B"],
  weight: 1,
  teamBased: true,
  durationSec: 25,

  init(): TugOfWarState {
    return {
      ropePos: 0,
      pending: [0, 0],
      force: [0, 0],
      miracle: newMiracle(),
      elapsedMs: 0,
    };
  },

  onInput(state, side: SideIndex, _input: EventInput) {
    state.pending[side]++;
    state.force[side]++;
  },

  tick(state, dtMs, ctx) {
    state.elapsedMs += dtMs;

    // Handicap is recomputed every tick from live headcounts, so a late
    // joiner landing on the smaller team rebalances the rope immediately.
    const [hA, hB] = tugHandicap(ctx.sideCounts);
    const crowd = Math.max(1, ctx.playerCount);
    const net = (state.pending[0] * hA - state.pending[1] * hB) * ctx.params.tapPower;
    state.ropePos = clamp(state.ropePos + net / crowd, -1, 1);
    state.pending = [0, 0];

    // Miracle: yank the rope back toward whichever team is losing.
    const elapsedFrac = state.elapsedMs / (ctx.params.durationSec * 1000);
    const trailing: SideIndex | null =
      Math.abs(state.ropePos) < 0.05 ? null : state.ropePos > 0 ? 1 : 0;
    const miracle = maybeMiracle(state.miracle, elapsedFrac, trailing, dtMs, ctx);
    if (miracle) {
      // ropePos spans 2 units, so double the boost to feel equivalent.
      const nudge = miracle.boost * 2;
      state.ropePos = clamp(state.ropePos + (miracle.side === 0 ? nudge : -nudge), -1, 1);
    }
  },

  isComplete(state) {
    return Math.abs(state.ropePos) >= 1;
  },

  /**
   * Team A reports through the "support" slots and Team B through "hinder"
   * (the round_results table has exactly two slots; teams are public, so
   * nothing sensitive rides on this mapping). On a timeout the team with
   * the rope lean wins; a dead-center rope is a coin flip.
   */
  resolve(state, ctx): EventResult {
    let winner: "support" | "hinder";
    if (state.ropePos > 0) winner = "support";
    else if (state.ropePos < 0) winner = "hinder";
    else winner = ctx.rng() < 0.5 ? "support" : "hinder";
    return {
      winner,
      supportForce: state.force[0],
      hinderForce: state.force[1],
      supportHead: ctx.sideCounts[0],
      hinderHead: ctx.sideCounts[1],
    };
  },

  view(state) {
    return { ropePos: state.ropePos };
  },
};
