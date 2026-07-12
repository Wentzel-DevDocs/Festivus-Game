/**
 * Shared simulation math used by every event module.
 * Pure functions only — no globals, no I/O — so they are trivially testable.
 */

import { MIRACLE } from "../config";
import type { EventTickCtx, SideIndex } from "./types";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const clamp01 = (v: number) => clamp(v, 0, 1);

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The core movement rule every event shares:
 * Justin's baseline motion = slow automatic drift
 *   + (supportForce − hinderForce) scaled by crowd size.
 *
 * `taps` are the taps counted THIS tick per side. Dividing by the player
 * count means 4 coworkers and 40 coworkers both produce a human-paced
 * Justin — nobody has to retune the game per party size.
 */
export function progressStep(
  taps: [number, number],
  dtMs: number,
  ctx: Pick<EventTickCtx, "params" | "playerCount">,
): number {
  const { drift, tapPower } = ctx.params;
  const crowd = Math.max(1, ctx.playerCount);
  const net = ((taps[0] - taps[1]) * tapPower) / crowd;
  return drift * (dtMs / 1000) + net;
}

/** Fisher–Yates shuffle (unbiased), returns a NEW array. */
export function fisherYates<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── Festivus Miracle ─────────────────────────────────────────────────────── */

export interface MiracleState {
  fired: boolean;
}

export const newMiracle = (): MiracleState => ({ fired: false });

/**
 * Once per event, a random small comeback boost for the trailing side.
 *
 * Call every tick. Becomes eligible after `MIRACLE.afterFrac` of the event
 * has elapsed; then fires with a per-tick probability tuned so it lands
 * ~`expectedDelayMs` later on average. Returns the boost magnitude to apply
 * toward `trailing`, or null. The caller applies it (each event knows what
 * "toward" means on its own scale) and we push the "miracle" fx here.
 */
export function maybeMiracle(
  m: MiracleState,
  elapsedFrac: number,
  trailing: SideIndex | null,
  dtMs: number,
  ctx: EventTickCtx,
): { side: SideIndex; boost: number } | null {
  if (m.fired || trailing === null || elapsedFrac < MIRACLE.afterFrac) return null;
  const perTickChance = dtMs / MIRACLE.expectedDelayMs;
  if (ctx.rng() >= perTickChance) return null;
  m.fired = true;
  ctx.fx.push({ type: "miracle", side: trailing });
  return { side: trailing, boost: MIRACLE.boost };
}

/* ── Tug-of-war fairness ──────────────────────────────────────────────────── */

/**
 * Odd-headcount handicap: the smaller team's per-player force is multiplied
 * by (largerCount / smallerCount), so equal per-person effort centers the
 * rope no matter how the split fell. Recomputed whenever counts change
 * (late joiners drop onto the smaller team).
 */
export function tugHandicap(counts: [number, number]): [number, number] {
  const [a, b] = [Math.max(1, counts[0]), Math.max(1, counts[1])];
  return [a < b ? b / a : 1, b < a ? a / b : 1];
}
