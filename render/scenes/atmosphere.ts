/**
 * Retained cinematic atmosphere shared by the individual game arenas.
 *
 * Everything is allocated once. `update()` only changes transforms/alpha, so
 * the smoke, light shafts, floating embers and foreground shadows stay cheap
 * enough for phone controllers while still giving the broadcast real depth.
 */

import { Container, Graphics } from "pixi.js";

export interface AtmospherePalette {
  light: number;
  rim: number;
  fog: number;
  ember: number;
}

interface Wisp {
  glyph: Graphics;
  lane: number;
  speed: number;
  phase: number;
  foreground: boolean;
}

interface Shaft {
  glyph: Graphics;
  homeX: number;
  phase: number;
}

interface Mote {
  glyph: Graphics;
  x: number;
  y: number;
  speed: number;
  phase: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Two layers let a scene place haze behind its actors and soft silhouettes in
 * front. Add `back` after the scene's opaque backdrop and `front` immediately
 * before its HUD/overlay.
 */
export class CinematicAtmosphere {
  readonly back = new Container();
  readonly front = new Container();

  private backHaze = new Graphics();
  private vignette = new Graphics();
  private flash = new Graphics();
  private shafts: Shaft[] = [];
  private wisps: Wisp[] = [];
  private motes: Mote[] = [];
  private shadowBands: Graphics[] = [];
  private elapsedSec = 0;
  private width = 1;
  private height = 1;
  private horizon = 0.62;
  private flashLeftMs = 0;
  private flashPeak = 0;
  private phaseEnergy = 0.25;

  constructor(
    private palette: AtmospherePalette,
    private reducedMotion: boolean,
    visualDensity: number,
  ) {
    const density = clamp01(visualDensity);
    this.back.addChild(this.backHaze);

    const shaftCount = Math.max(2, Math.round(4 * density));
    for (let i = 0; i < shaftCount; i++) {
      const glyph = new Graphics()
        .poly([-0.2, 0, 0.2, 0, 0.85, 1, -0.85, 1])
        .fill({ color: i % 2 ? palette.rim : palette.light, alpha: 1 });
      glyph.alpha = 0;
      this.shafts.push({ glyph, homeX: (i + 0.55) / shaftCount, phase: i * 1.91 + 0.4 });
      this.back.addChild(glyph);
    }

    const backWispCount = Math.max(3, Math.round(6 * density));
    const frontWispCount = Math.max(1, Math.round(2 * density));
    for (let i = 0; i < backWispCount + frontWispCount; i++) {
      const foreground = i >= backWispCount;
      const glyph = new Graphics().ellipse(0, 0, 1, 0.32).fill({
        color: palette.fog,
        alpha: 1,
      });
      glyph.alpha = 0;
      const wisp: Wisp = {
        glyph,
        lane: (i * 0.37 + 0.13) % 1,
        speed: 0.012 + (i % 4) * 0.006,
        phase: i * 1.37,
        foreground,
      };
      this.wisps.push(wisp);
      (foreground ? this.front : this.back).addChild(glyph);
    }

    const moteCount = Math.max(6, Math.round(18 * density));
    for (let i = 0; i < moteCount; i++) {
      const size = 0.7 + (i % 4) * 0.42;
      const glyph = new Graphics().circle(0, 0, size).fill({
        color: i % 3 === 0 ? palette.light : palette.ember,
        alpha: 1,
      });
      const mote: Mote = {
        glyph,
        x: (i * 0.618 + 0.07) % 1,
        y: (i * 0.381 + 0.19) % 1,
        speed: 0.01 + (i % 5) * 0.005,
        phase: i * 0.83,
      };
      this.motes.push(mote);
      this.back.addChild(glyph);
    }

    for (let i = 0; i < 3; i++) {
      const band = new Graphics();
      this.shadowBands.push(band);
      this.front.addChild(band);
    }
    this.front.addChild(this.vignette, this.flash);
  }

  layout(width: number, height: number, horizon = 0.62): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.horizon = clamp01(horizon);

    this.backHaze
      .clear()
      .ellipse(width * 0.5, height * this.horizon, width * 0.58, height * 0.32)
      .fill({ color: this.palette.rim, alpha: 0.035 })
      .ellipse(width * 0.18, height * 0.42, width * 0.28, height * 0.44)
      .fill({ color: this.palette.light, alpha: 0.022 })
      .ellipse(width * 0.82, height * 0.5, width * 0.3, height * 0.48)
      .fill({ color: this.palette.rim, alpha: 0.02 });

    const shaftW = Math.max(80, width * 0.16);
    for (const shaft of this.shafts) {
      shaft.glyph.scale.set(shaftW, height * 0.92);
      shaft.glyph.pivot.set(0, 0);
      shaft.glyph.position.set(width * shaft.homeX, -height * 0.04);
    }

    for (let i = 0; i < this.wisps.length; i++) {
      const wisp = this.wisps[i];
      const radiusX = width * (wisp.foreground ? 0.22 : 0.16) * (0.78 + (i % 3) * 0.16);
      const radiusY = height * (wisp.foreground ? 0.12 : 0.09);
      wisp.glyph.scale.set(radiusX, radiusY);
    }

    // Moving cast-shadow wedges suggest unseen gantries and spot rigs. Their
    // opacity stays deliberately low so they never cover game readability.
    for (let i = 0; i < this.shadowBands.length; i++) {
      const band = this.shadowBands[i];
      const base = width * (0.06 + i * 0.34);
      const span = width * (0.22 + i * 0.035);
      band
        .clear()
        .poly([
          base, height,
          base + span, height,
          base + span * 0.42, height * (this.horizon + 0.06),
          base + span * 0.2, height * (this.horizon + 0.04),
        ])
        .fill({ color: 0x020407, alpha: 0.055 });
    }

    this.vignette
      .clear()
      .poly([0, 0, width * 0.095, 0, width * 0.045, height, 0, height])
      .fill({ color: 0x020407, alpha: 0.19 })
      .poly([width, 0, width * 0.905, 0, width * 0.955, height, width, height])
      .fill({ color: 0x020407, alpha: 0.19 })
      .rect(0, height * 0.94, width, height * 0.06)
      .fill({ color: 0x020407, alpha: 0.15 });
    this.flash.clear().rect(0, 0, width, height).fill({ color: 0xffffff });
    this.flash.alpha = 0;
  }

  /** Brief, subtle full-frame exposure kick for slips, hits and miracles. */
  impact(strength = 1, color = this.palette.light): void {
    this.flash.tint = color;
    this.flashPeak = (this.reducedMotion ? 0.045 : 0.12) * clamp01(strength);
    this.flashLeftMs = this.reducedMotion ? 70 : 150;
  }

  update(dtMs: number, phase: string, actionEnergy = 0): void {
    const dtSec = Math.min(0.05, dtMs / 1000);
    if (!this.reducedMotion) this.elapsedSec += dtSec;

    const phaseTarget =
      phase === "event_countdown"
        ? 0.9
        : phase === "event_active"
          ? 0.62 + clamp01(actionEnergy) * 0.28
          : phase === "finale"
            ? 1
            : phase === "event_outcome" || phase === "splash"
              ? 0.4
              : phase === "grievance_reveal"
                ? 0.72
                : 0.28;
    this.phaseEnergy += (phaseTarget - this.phaseEnergy) * (1 - Math.exp(-dtMs / 320));

    const t = this.elapsedSec;
    for (const shaft of this.shafts) {
      const sway = this.reducedMotion ? 0 : Math.sin(t * 0.17 + shaft.phase) * this.width * 0.045;
      shaft.glyph.x = this.width * shaft.homeX + sway;
      shaft.glyph.rotation = this.reducedMotion ? -0.035 : -0.035 + Math.sin(t * 0.11 + shaft.phase) * 0.025;
      const pulse = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.72 + shaft.phase);
      shaft.glyph.alpha = (0.018 + pulse * 0.022) * this.phaseEnergy;
    }

    for (const wisp of this.wisps) {
      const travel = this.reducedMotion ? wisp.lane : (wisp.lane + t * wisp.speed) % 1.35;
      wisp.glyph.x = -this.width * 0.2 + travel * this.width * 1.35;
      const baseY = this.height * (this.horizon + (wisp.foreground ? 0.2 : 0.08));
      wisp.glyph.y = baseY + (this.reducedMotion ? 0 : Math.sin(t * 0.34 + wisp.phase) * this.height * 0.025);
      wisp.glyph.alpha = (wisp.foreground ? 0.022 : 0.034) * this.phaseEnergy;
    }

    for (const mote of this.motes) {
      if (!this.reducedMotion) {
        mote.y = (mote.y - mote.speed * dtSec + 1) % 1;
      }
      mote.glyph.position.set(
        this.width * mote.x + (this.reducedMotion ? 0 : Math.sin(t * 0.55 + mote.phase) * 8),
        this.height * (this.horizon + mote.y * (1 - this.horizon)),
      );
      const twinkle = this.reducedMotion ? 0.65 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.1 + mote.phase));
      mote.glyph.alpha = (0.14 + twinkle * 0.3) * this.phaseEnergy;
    }

    for (let i = 0; i < this.shadowBands.length; i++) {
      this.shadowBands[i].x = this.reducedMotion ? 0 : Math.sin(t * 0.12 + i * 2.2) * this.width * 0.012;
      this.shadowBands[i].alpha = 0.55 + this.phaseEnergy * 0.35;
    }

    if (this.flashLeftMs > 0) {
      this.flashLeftMs = Math.max(0, this.flashLeftMs - dtMs);
      this.flash.alpha = this.flashPeak * clamp01(this.flashLeftMs / (this.reducedMotion ? 70 : 150));
    } else {
      this.flash.alpha = 0;
    }
  }
}
