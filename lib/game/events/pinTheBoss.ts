/**
 * EVENT 5 — PIN THE BOSS (finale, weight 2, solo sides).
 * Sides: "Prop Up" / "Pile On".
 *
 * NOT just more mashing: a center see-saw "pin bar" (0 = Justin upright,
 * 1 = flat on the mat). Pile On shoves the bar toward PINNED; Prop Up
 * resists; a spring constantly pulls it back upright. To win, Pile On must
 * HOLD the bar past the pin line for a 1–2–3 count; Prop Up can smash the
 * count back to zero by shoving the bar under the line. If the clock runs
 * out first, Justin survives and Prop Up takes it.
 *
 * Resolving this event crowns the match champion and completes the
 * approval read (it counts double in the beloved/greased verdict).
 */

import type { EventInput, EventModule, EventResult, SideIndex } from "../engine/types";
import { clamp01, maybeMiracle, newMiracle } from "../engine/math";
import type { MiracleState } from "../engine/math";

interface PinTheBossState {
  /** See-saw pin bar: 0 = upright, 1 = pinned flat. */
  pinPos: number;
  /** How long the bar has been held past the pin line (ms). */
  holdMs: number;
  /** The 1–2–3 count (0 until the first full second of hold). */
  count: number;
  /** True while the bar is past the line (renderer shows the referee). */
  overLine: boolean;
  /** Set once the 3-count lands — the event is decided. */
  pinnedOut: boolean;
  pending: [number, number];
  force: [number, number];
  miracle: MiracleState;
  elapsedMs: number;
}

export const pinTheBoss: EventModule<PinTheBossState> = {
  id: "pinTheBoss",
  name: "Pin the Boss",
  sideLabels: ["Prop Up", "Pile On"],
  weight: 2,
  teamBased: false,
  durationSec: 25,

  init(): PinTheBossState {
    return {
      pinPos: 0,
      holdMs: 0,
      count: 0,
      overLine: false,
      pinnedOut: false,
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
    if (state.pinnedOut) return;
    state.elapsedMs += dtMs;
    const dtSec = dtMs / 1000;
    const crowd = Math.max(1, ctx.playerCount);

    // See-saw physics: spring pulls upright, Pile On pushes down, Prop Up
    // pushes back up. (Side 1 = hinder = toward pinned.)
    const push = ((state.pending[1] - state.pending[0]) * ctx.params.tapPower) / crowd;
    state.pinPos = clamp01(state.pinPos + push - ctx.params.springRate * dtSec);
    state.pending = [0, 0];

    const wasOver = state.overLine;
    state.overLine = state.pinPos >= ctx.params.pinLine;

    if (state.overLine) {
      if (!wasOver) ctx.fx.push({ type: "pinned" });
      state.holdMs += dtMs;
      const newCount = Math.min(3, Math.floor(state.holdMs / ctx.params.holdCountMs));
      if (newCount > state.count) {
        state.count = newCount;
        ctx.fx.push({ type: "count", value: newCount });
        if (newCount >= 3) state.pinnedOut = true; // 1… 2… 3! Pinned.
      }
    } else if (wasOver && state.count > 0) {
      // Prop Up smashed the count — referee waves it off.
      ctx.fx.push({ type: "countBroken" });
      state.holdMs = 0;
      state.count = 0;
    } else {
      state.holdMs = 0;
    }

    // Miracle: help whichever side is losing the see-saw right now.
    const elapsedFrac = state.elapsedMs / (ctx.params.durationSec * 1000);
    const trailing: SideIndex = state.pinPos > 0.5 ? 0 : 1;
    const miracle = maybeMiracle(state.miracle, elapsedFrac, trailing, dtMs, ctx);
    if (miracle) {
      // Trailing side 0 (Prop Up) → bar springs up; side 1 → bar slams down.
      const nudge = miracle.boost * 1.5;
      state.pinPos = clamp01(state.pinPos + (miracle.side === 1 ? nudge : -nudge));
    }
  },

  isComplete(state) {
    return state.pinnedOut;
  },

  resolve(state, ctx): EventResult {
    return {
      // 3-count landed → Pile On (hinder) pinned the boss. Otherwise he
      // survived the clock and Prop Up (support) takes it.
      winner: state.pinnedOut ? "hinder" : "support",
      supportForce: state.force[0],
      hinderForce: state.force[1],
      supportHead: ctx.sideCounts[0],
      hinderHead: ctx.sideCounts[1],
    };
  },

  view(state) {
    return {
      pinPos: state.pinPos,
      count: state.count,
      overLine: state.overLine,
      pinnedOut: state.pinnedOut,
    };
  },
};
