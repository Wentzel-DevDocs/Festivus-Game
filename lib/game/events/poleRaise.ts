/**
 * EVENT 1 — POLE RAISE (warmup, solo).
 * Sides: Support / Grease.
 *
 * The whole team's net force raises a bare aluminum pole from the ground.
 * Justin strains at the base. Success = fully raised before time runs out.
 */

import type {
  EventInitCtx,
  EventInput,
  EventModule,
  EventResult,
  EventTickCtx,
  SideIndex,
} from "../engine/types";
import { clamp01, maybeMiracle, newMiracle, progressStep } from "../engine/math";
import type { MiracleState } from "../engine/math";

interface PoleRaiseState {
  /** 0 = pole flat on the ground, 1 = fully raised. */
  progress: number;
  /** Taps landed since the last tick, per side. Drained every tick. */
  pending: [number, number];
  /** Cumulative counted taps per side (the event's force totals). */
  force: [number, number];
  miracle: MiracleState;
  elapsedMs: number;
}

export const poleRaise: EventModule<PoleRaiseState> = {
  id: "poleRaise",
  name: "Pole Raise",
  sideLabels: ["Support", "Grease"],
  weight: 1,
  teamBased: false,
  durationSec: 20,

  init(): PoleRaiseState {
    return {
      progress: 0,
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
    state.progress = clamp01(state.progress + progressStep(state.pending, dtMs, ctx));
    state.pending = [0, 0];

    // Festivus Miracle: nudge whichever side is currently losing the pole.
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
    return { progress: state.progress };
  },
};
