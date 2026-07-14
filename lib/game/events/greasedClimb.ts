/**
 * EVENT 3 — GREASED CLIMB (solo).
 * Sides: Support / Grease.
 *
 * Net force = Justin's height up the aluminum pole. Every few seconds the
 * grease check fires: if the Grease side has been out-mashing lately,
 * Justin loses his grip and slides back down. Success = reach the top.
 */

import type {
  EventInput,
  EventModule,
  EventResult,
  EventTickCtx,
  SideIndex,
} from "../engine/types";
import { clamp01, maybeMiracle, newMiracle, progressStep } from "../engine/math";
import type { MiracleState } from "../engine/math";

interface GreasedClimbState {
  /** 0 = ground, 1 = top of the pole. */
  progress: number;
  pending: [number, number];
  force: [number, number];
  /** Taps per side since the last grease check (the "recent window"). */
  window: [number, number];
  /** Counts down to the next grease check. */
  slipTimerMs: number;
  /** True for one tick when a slip fires (renderer plays the slide). */
  slipping: boolean;
  miracle: MiracleState;
  elapsedMs: number;
}

/** Next check lands slipEverySec ± 25% so slips don't feel metronomic. */
function nextSlipTimer(ctx: EventTickCtx): number {
  return ctx.params.slipEverySec * 1000 * (0.75 + ctx.rng() * 0.5);
}

export const greasedClimb: EventModule<GreasedClimbState> = {
  id: "greasedClimb",
  name: "Greased Climb",
  sideLabels: ["Support", "Grease"],
  weight: 1,
  teamBased: false,
  durationSec: 24,

  init(ctx): GreasedClimbState {
    return {
      progress: 0,
      pending: [0, 0],
      force: [0, 0],
      window: [0, 0],
      slipTimerMs: ctx.params.slipEverySec * 1000,
      slipping: false,
      miracle: newMiracle(),
      elapsedMs: 0,
    };
  },

  onInput(state, side: SideIndex, _input: EventInput) {
    state.pending[side]++;
    state.force[side]++;
    state.window[side]++;
  },

  tick(state, dtMs, ctx) {
    state.elapsedMs += dtMs;
    state.slipping = false;

    state.progress = clamp01(state.progress + progressStep(state.pending, dtMs, ctx));
    state.pending = [0, 0];

    // The grease check: has the Grease side earned a slip since last check?
    state.slipTimerMs -= dtMs;
    if (state.slipTimerMs <= 0) {
      const [sup, hin] = state.window;
      const greaseShare = hin / Math.max(1, sup + hin);
      if (greaseShare > ctx.params.slipShare && state.progress > 0.05) {
        state.progress = clamp01(state.progress - ctx.params.slipAmount);
        state.slipping = true;
        ctx.fx.push({ type: "slip", side: 1 });
      }
      state.window = [0, 0];
      state.slipTimerMs = nextSlipTimer(ctx);
    }

    const elapsedFrac = state.elapsedMs / (ctx.params.durationSec * 1000);
    const trailing: SideIndex = state.progress > 0.5 ? 1 : 0;
    const miracle = maybeMiracle(state.miracle, elapsedFrac, trailing, dtMs, ctx);
    if (miracle) {
      state.progress = clamp01(
        state.progress + (miracle.side === 0 ? miracle.boost : -miracle.boost),
      );
    }
  },

  isComplete(state) {
    return state.progress >= 1;
  },

  resolve(state): EventResult {
    return {
      winner: state.progress >= 1 ? "support" : "hinder",
      supportForce: state.force[0],
      hinderForce: state.force[1],
      supportHead: 0,
      hinderHead: 0,
    };
  },

  view(state) {
    return { progress: state.progress, slipping: state.slipping };
  },
};
