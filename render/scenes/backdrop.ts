/**
 * SCENE — BACKDROP (the calm idle stage).
 *
 * Shown during "lobby", "grievance_write", "grievance_reveal" and any phase
 * that has no dedicated scene. The DOM panels layered OVER the canvas do all
 * the talking in those phases, so this scene deliberately stays quiet:
 * a dark brushed-aluminum wall, one soft spotlight, one unadorned aluminum
 * pole on a little platform. Very high strength-to-weight ratio.
 *
 * The only life in it is a red "grievance glow" behind the pole:
 *   · grievance_write  → the glow warms up (people are typing complaints)
 *   · grievance_reveal → it pulses gently (complaints being read aloud)
 *   · reducedMotion    → the glow still appears, but holds steady (no pulse)
 */

import { Container, Graphics, Text } from "pixi.js";
import type { SceneFactory, SceneServices } from "../core";
import { COLORS, makePole, ParticleBurst, springTo } from "../toolkit";
import type { SpringState } from "../toolkit";

/** --color-aluminum-300 from app/globals.css (toolkit only mirrors a few). */
const ALUMINUM_300 = 0xb8bfc6;
/** Grease/gold, used for the Festivus-miracle flash. */
const GOLD = 0xd9a514;

/** Condensed display stack — mirrors --font-display in app/globals.css. */
const DISPLAY_FONT = ["Arial Narrow", "Helvetica Neue", "Roboto Condensed", "sans-serif"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/* ── Festivus-miracle flash ────────────────────────────────────────────────
 * Scenes are self-contained on purpose (no shared scene-helper module), so
 * each scene carries its own small copy of this overlay. A miracle never
 * actually fires during backdrop phases, but every scene honors the fx
 * contract anyway — it costs almost nothing and can never surprise us.   */
class MiracleFlash {
  private text: Text;
  private burst: ParticleBurst;
  private msLeft = 0;
  private pop: SpringState = { value: 1, velocity: 0 };
  private cx = 0;
  private cy = 0;

  constructor(layer: Container, private reducedMotion: boolean) {
    this.burst = new ParticleBurst(layer);
    this.text = new Text({
      text: "FESTIVUS MIRACLE!",
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: 44,
        fontWeight: "700",
        fill: GOLD,
        letterSpacing: 4,
      },
    });
    this.text.anchor.set(0.5);
    this.text.visible = false;
    layer.addChild(this.text);
  }

  layout(width: number, height: number): void {
    this.cx = width / 2;
    this.cy = height * 0.34;
    this.text.position.set(this.cx, this.cy);
    this.text.style.fontSize = Math.min(44, width * 0.06);
  }

  trigger(): void {
    this.msLeft = 1600;
    this.pop.value = 1.7; // spring settles back to 1 → a "stamped" pop-in
    this.pop.velocity = 0;
    this.burst.burst({
      x: this.cx,
      y: this.cy + 30,
      count: this.reducedMotion ? 20 : 40, // halve particles for reduced motion
      color: [GOLD, COLORS.memo, 0xe8c95a],
      spread: Math.PI,
      speed: 320,
    });
  }

  update(dtMs: number): void {
    this.burst.update(dtMs);
    if (this.msLeft <= 0) {
      this.text.visible = false;
      return;
    }
    this.msLeft -= dtMs;
    this.text.visible = true;
    this.text.alpha = clamp01(this.msLeft / 600); // linger, then fade out
    springTo(this.pop, 1, dtMs, 160, 14);
    this.text.scale.set(this.pop.value);
  }

  destroy(): void {
    this.burst.destroy();
  }
}

/* ── The scene ────────────────────────────────────────────────────────────── */

export const backdropScene: SceneFactory = () => {
  let services: SceneServices | null = null;
  let world: Container | null = null; // all the scenery
  let overlay: Container | null = null; // flashes above the scenery
  let glow: Container | null = null; // red grievance glow (alpha-driven)
  let miracle: MiracleFlash | null = null;

  let glowAlpha = 0; // smoothed toward a per-phase target
  let elapsedMs = 0; // local clock for the reveal pulse
  let lastW = 0;
  let lastH = 0;

  /**
   * (Re)build the whole static tree for a canvas size. Rebuilding on resize
   * is the simplest correct thing — resizes are rare, and this scene is
   * cheap (a handful of Graphics).
   */
  function build(width: number, height: number): void {
    if (!world) return;
    world.removeChildren().forEach((c) => c.destroy({ children: true }));

    const cx = width / 2;
    const platformY = height * 0.78;
    const poleH = height * 0.42;

    // Brushed-aluminum wall: the canvas is already dark; faint horizontal
    // "memo ruling" lines make the darkness read as material, not void.
    const lines = new Graphics();
    for (let y = 13; y < height; y += 26) {
      lines.moveTo(0, y).lineTo(width, y);
    }
    lines.stroke({ width: 1, color: COLORS.aluminumDark, alpha: 0.35 });
    world.addChild(lines);

    // Soft spotlight: three stacked translucent ellipses fake a glow without
    // GPU filters (we save the fancy stuff for confetti).
    const spotW = Math.min(width * 0.4, 320);
    const spot = new Graphics()
      .ellipse(cx, platformY, spotW, spotW * 0.28)
      .fill({ color: COLORS.aluminumLight, alpha: 0.05 })
      .ellipse(cx, platformY, spotW * 0.7, spotW * 0.2)
      .fill({ color: COLORS.aluminumLight, alpha: 0.06 })
      .ellipse(cx, platformY, spotW * 0.42, spotW * 0.12)
      .fill({ color: COLORS.aluminumLight, alpha: 0.07 });
    world.addChild(spot);

    // Grievance glow — sits BEHIND the pole; update() drives its alpha,
    // so we build it at full internal opacity and start the container at 0.
    glow = new Container();
    const glowY = platformY - poleH * 0.55;
    const g = new Graphics()
      .circle(cx, glowY, poleH * 0.5)
      .fill({ color: COLORS.grievance, alpha: 0.05 })
      .circle(cx, glowY, poleH * 0.36)
      .fill({ color: COLORS.grievance, alpha: 0.07 })
      .circle(cx, glowY, poleH * 0.22)
      .fill({ color: COLORS.grievance, alpha: 0.09 });
    glow.addChild(g);
    glow.alpha = glowAlpha; // keep continuity across a resize rebuild
    world.addChild(glow);

    // The stage platform: a modest aluminum riser.
    const pw = Math.min(width * 0.32, 260);
    const platform = new Graphics()
      .roundRect(cx - pw / 2, platformY - 12, pw, 24, 8)
      .fill({ color: COLORS.aluminumDark })
      .rect(cx - pw / 2 + 4, platformY - 12, pw - 8, 3)
      .fill({ color: COLORS.aluminum, alpha: 0.6 });
    world.addChild(platform);

    // The pole itself. No decoration — decoration is distracting.
    const pole = makePole(poleH, 12);
    pole.position.set(cx, platformY - 8);
    world.addChild(pole);

    // Title, condensed and upper-case like a memo header.
    const titleSize = Math.min(width * 0.075, 58);
    const title = new Text({
      text: "FEATS OF STRENGTH",
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: titleSize,
        fontWeight: "700",
        fill: ALUMINUM_300,
        letterSpacing: titleSize * 0.22,
      },
    });
    title.anchor.set(0.5);
    title.position.set(cx, height * 0.16);
    world.addChild(title);
  }

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      world = new Container();
      overlay = new Container();
      stage.addChild(world, overlay);
      miracle = new MiracleFlash(overlay, svc.reducedMotion);
      build(width, height);
      miracle.layout(width, height);
      lastW = width;
      lastH = height;
    },

    update(args): void {
      if (!world || !services) return;

      // Reposition everything if the canvas changed size (rotation, resize).
      if (args.width !== lastW || args.height !== lastH) {
        lastW = args.width;
        lastH = args.height;
        build(lastW, lastH);
        miracle?.layout(lastW, lastH);
      }

      elapsedMs += args.dtMs;

      // Honor the fx contract even here (see note on MiracleFlash).
      for (const f of args.fx) {
        if (f.type === "miracle") miracle?.trigger();
      }
      miracle?.update(args.dtMs);

      // Pick the glow's target strength from the phase, then ease toward it
      // so phase changes fade rather than snap.
      const phase = args.snap.phase;
      let target = 0;
      if (phase === "grievance_write") {
        target = 0.5; // warming up: grievances are being typed
      } else if (phase === "grievance_reveal") {
        target = services.reducedMotion
          ? 0.6 // steady under reduced motion — no pulsing loop
          : 0.55 + 0.25 * Math.sin((elapsedMs / 1000) * 2.4);
      }
      glowAlpha += (target - glowAlpha) * (1 - Math.exp(-args.dtMs / 300));
      if (glow) glow.alpha = glowAlpha;
    },

    unmount(): void {
      miracle?.destroy();
      miracle = null;
      // GameCanvas destroys the display tree for us after unmount.
      world = null;
      overlay = null;
      glow = null;
    },
  };
};
