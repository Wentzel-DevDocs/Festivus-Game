/**
 * EVENT 2 — SWIM SPRINT (solo).
 * Sides: "Jet Boost" / "Face Blast" — WATER GUNS, no grease here.
 *
 * The team stands on the sidelines with water guns. Net force = Justin's
 * swim speed across the pool. If he gets too soaked (net force too negative
 * for too long) he flails and sinks — the drowning gag (blue face, X eyes) —
 * losing time and a chunk of distance. Success = reach the far wall.
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

interface SwimSprintState {
  /** 0 = starting block, 1 = far wall. */
  progress: number;
  pending: [number, number];
  force: [number, number];
  /** Smoothed tap-only net force in progress/sec. Negative = getting soaked. */
  momentum: number;
  /** True while the drowning gag plays; taps still count, motion doesn't. */
  sinking: boolean;
  /** elapsedMs value at which the gag ends. */
  sinkUntilMs: number;
  miracle: MiracleState;
  elapsedMs: number;
}

export const swimSprint: EventModule<SwimSprintState> = {
  id: "swimSprint",
  name: "Swim Sprint",
  sideLabels: ["Jet Boost", "Face Blast"],
  weight: 1,
  teamBased: false,
  durationSec: 22,

  init(): SwimSprintState {
    return {
      progress: 0,
      pending: [0, 0],
      force: [0, 0],
      momentum: 0,
      sinking: false,
      sinkUntilMs: 0,
      miracle: newMiracle(),
      elapsedMs: 0,
    };
  },

  onInput(state, side: SideIndex, _input: EventInput) {
    state.pending[side]++;
    state.force[side]++;
  },

  tick(state, dtMs, ctx: EventTickCtx) {
    state.elapsedMs += dtMs;
    const dtSec = dtMs / 1000;

    // Tap-only net speed (progress/sec), smoothed so one burst of Face Blast
    // doesn't instantly drown him — it takes sustained soaking.
    const crowd = Math.max(1, ctx.playerCount);
    const tapNetPerSec =
      dtSec > 0 ? ((state.pending[0] - state.pending[1]) * ctx.params.tapPower) / crowd / dtSec : 0;
    state.momentum = state.momentum * 0.9 + tapNetPerSec * 0.1;

    if (state.sinking) {
      // Flailing: no forward motion until the gag ends.
      if (state.elapsedMs >= state.sinkUntilMs) state.sinking = false;
      state.pending = [0, 0];
    } else {
      state.progress = clamp01(state.progress + progressStep(state.pending, dtMs, ctx));
      state.pending = [0, 0];

      if (state.momentum < -ctx.params.sinkThreshold) {
        // Too soaked → drowning gag: lose a chunk of distance and stall.
        state.sinking = true;
        state.sinkUntilMs = state.elapsedMs + ctx.params.sinkMs;
        state.progress = clamp01(state.progress - ctx.params.sinkPenalty);
        state.momentum = 0;
        ctx.fx.push({ type: "sink" });
      }
    }

    const elapsedFrac = state.elapsedMs / (ctx.params.durationSec * 1000);
    const trailing: SideIndex = state.progress > 0.5 ? 1 : 0;
    const miracle = maybeMiracle(state.miracle, elapsedFrac, trailing, dtMs, ctx);
    if (miracle) {
      state.progress = clamp01(
        state.progress + (miracle.side === 0 ? miracle.boost : -miracle.boost),
      );
      if (miracle.side === 0) state.sinking = false; // a miracle also un-drowns
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
    return { progress: state.progress, sinking: state.sinking };
  },
};
