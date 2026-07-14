/**
 * SCENE — BACKDROP (the calm idle stage).
 *
 * Shown during "lobby", "grievance_write", "grievance_reveal" and any phase
 * that has no dedicated scene. The DOM panels layered OVER the canvas do all
 * the talking in those phases, so this scene stays atmospheric rather than
 * informational: a ceremonial runtime chamber made from deployment routes,
 * status runes, a horizon grid and the unadorned aluminum pole in the arena
 * artwork. It suggests a live system without showing any player data.
 *
 * The only life in it is a red "grievance glow" behind the pole:
 *   · grievance_write  → the glow warms up (people are typing complaints)
 *   · grievance_reveal → it pulses gently (complaints being read aloud)
 *   · reducedMotion    → the glow still appears, but holds steady (no pulse)
 */

import { Container, Graphics, Text } from "pixi.js";
import type { SceneFactory, SceneServices } from "../core";
import { COLORS, ParticleBurst, springTo } from "../toolkit";
import type { SpringState } from "../toolkit";
import { CinematicAtmosphere } from "./atmosphere";

/** --color-aluminum-300 from app/globals.css (toolkit only mirrors a few). */
const ALUMINUM_300 = 0xb8bfc6;
/** Grease/gold, used for the Festivus-miracle flash. */
const GOLD = 0xd9a514;
/** Cool system colors used only by this scene's abstract runtime motifs. */
const SIGNAL_CYAN = 0x49c7dc;
const SIGNAL_BLUE = 0x4d86d9;
const SIGNAL_GREEN = 0x43c77a;
const DEEP_NAVY = 0x09101a;

/** Condensed display stack — mirrors --font-display in app/globals.css. */
const DISPLAY_FONT = ["Arial Narrow", "Helvetica Neue", "Roboto Condensed", "sans-serif"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface RoutePoint {
  x: number;
  y: number;
}

/** One decorative packet moving along a fixed, anonymous data route. */
interface RouteSignal {
  glyph: Container;
  points: RoutePoint[];
  segmentLengths: number[];
  totalLength: number;
  offset: number;
  speed: number;
}

interface StatusPip {
  glyph: Graphics;
  phase: number;
}

function routeMetrics(points: RoutePoint[]): { segmentLengths: number[]; totalLength: number } {
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const length = Math.hypot(dx, dy);
    segmentLengths.push(length);
    totalLength += length;
  }
  return { segmentLengths, totalLength };
}

function pointOnRoute(signal: RouteSignal, distance: number): RoutePoint {
  let remaining = distance;
  for (let i = 0; i < signal.segmentLengths.length; i++) {
    const length = signal.segmentLengths[i];
    if (remaining <= length || i === signal.segmentLengths.length - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      const a = signal.points[i];
      const b = signal.points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return signal.points[signal.points.length - 1];
}

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
  let atmosphere: CinematicAtmosphere | null = null;
  let orbitWheel: Container | null = null;
  let scanLine: Graphics | null = null;
  let phaseReadout: Text | null = null;
  let routeSignals: RouteSignal[] = [];
  let statusPips: StatusPip[] = [];

  let glowAlpha = 0; // smoothed toward a per-phase target
  let elapsedMs = 0; // local clock for the reveal pulse
  let lastW = 0;
  let lastH = 0;

  /**
   * (Re)build the whole static tree for a canvas size. Rebuilding on resize
   * is the simplest correct thing — resizes are rare, and this scene is
   * cheap. Animated packets are retained display objects; update() only moves
   * them, so the extra depth does not mean rebuilding vectors every frame.
   */
  function build(width: number, height: number): void {
    if (!world) return;
    world.removeChildren().forEach((c) => c.destroy({ children: true }));
    routeSignals = [];
    statusPips = [];
    orbitWheel = null;
    scanLine = null;
    phaseReadout = null;

    const cx = width / 2;
    const platformY = height * 0.78;
    const poleH = height * 0.42;
    const compact = width < 620 || height < 360;
    const density = clamp01(services?.visualDensity ?? 1);

    // A translucent navy veil lets the generated arena art remain visible
    // while giving the vector HUD enough contrast to read as a coherent layer.
    const atmosphere = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: DEEP_NAVY, alpha: compact ? 0.12 : 0.2 })
      .poly([0, height, 0, height * 0.56, width * 0.32, height * 0.7, width * 0.4, height])
      .fill({ color: SIGNAL_BLUE, alpha: 0.035 })
      .poly([
        width, height,
        width, height * 0.54,
        width * 0.68, height * 0.69,
        width * 0.6, height,
      ])
      .fill({ color: SIGNAL_CYAN, alpha: 0.03 });
    world.addChild(atmosphere);

    // Deep perspective grid: deployment-control-room depth without a costly
    // mesh or filter. Its horizon sits behind the ceremonial platform.
    const horizonY = height * 0.5;
    const floorY = height * 0.97;
    const grid = new Graphics();
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = horizonY + (floorY - horizonY) * t * t;
      grid.moveTo(width * 0.05, y).lineTo(width * 0.95, y);
    }
    for (let i = -7; i <= 7; i++) {
      grid
        .moveTo(cx + i * width * 0.009, horizonY)
        .lineTo(cx + i * width * 0.073, floorY);
    }
    grid.stroke({ width: 1, color: SIGNAL_BLUE, alpha: compact ? 0.07 : 0.11 });
    world.addChild(grid);

    // Brushed-aluminum wall ruling keeps the game-world material language
    // underneath the developer-system layer.
    const lines = new Graphics();
    for (let y = 13; y < height; y += 26) {
      lines.moveTo(0, y).lineTo(width, y);
    }
    lines.stroke({ width: 1, color: COLORS.aluminumDark, alpha: 0.22 });
    world.addChild(lines);

    // Anonymous deployment routes occupy the side channels, leaving the
    // center clear for the pole and the DOM overlays. They are decorative
    // constants—never derived from roster, sides, taps, or grievances.
    const routeDefs: Array<{ points: RoutePoint[]; color: number }> = [
      {
        color: SIGNAL_CYAN,
        points: [
          { x: width * 0.035, y: height * 0.31 },
          { x: width * 0.19, y: height * 0.31 },
          { x: width * 0.19, y: height * 0.44 },
          { x: width * 0.33, y: height * 0.44 },
        ],
      },
      {
        color: SIGNAL_GREEN,
        points: [
          { x: width * 0.02, y: height * 0.63 },
          { x: width * 0.13, y: height * 0.63 },
          { x: width * 0.13, y: height * 0.53 },
          { x: width * 0.29, y: height * 0.53 },
        ],
      },
      {
        color: SIGNAL_BLUE,
        points: [
          { x: width * 0.965, y: height * 0.29 },
          { x: width * 0.81, y: height * 0.29 },
          { x: width * 0.81, y: height * 0.43 },
          { x: width * 0.67, y: height * 0.43 },
        ],
      },
      {
        color: GOLD,
        points: [
          { x: width * 0.985, y: height * 0.64 },
          { x: width * 0.87, y: height * 0.64 },
          { x: width * 0.87, y: height * 0.54 },
          { x: width * 0.71, y: height * 0.54 },
        ],
      },
    ];

    const routes = new Graphics();
    routeDefs.forEach((route, routeIndex) => {
      routes.moveTo(route.points[0].x, route.points[0].y);
      for (let i = 1; i < route.points.length; i++) {
        routes.lineTo(route.points[i].x, route.points[i].y);
      }
      routes.stroke({ width: 1.5, color: route.color, alpha: compact ? 0.17 : 0.26 });

      // Joint nodes and tiny diamond runes make each line feel authored rather
      // than like a generic circuit-board texture.
      for (let i = 1; i < route.points.length - 1; i++) {
        const p = route.points[i];
        routes
          .circle(p.x, p.y, 4)
          .stroke({ width: 1, color: route.color, alpha: 0.5 })
          .poly([p.x, p.y - 8, p.x + 5, p.y, p.x, p.y + 8, p.x - 5, p.y])
          .stroke({ width: 1, color: route.color, alpha: 0.18 });
      }

      // Controller mode receives half the moving packets; all static structure
      // remains so the composition does not look downgraded.
      const includeSignal = density >= 0.8 || routeIndex % 2 === 0;
      if (includeSignal) {
        const glyph = new Container();
        glyph.addChild(
          new Graphics()
            .circle(0, 0, 8)
            .fill({ color: route.color, alpha: 0.08 })
            .circle(0, 0, 3)
            .fill({ color: route.color, alpha: 0.9 })
            .circle(0, 0, 1)
            .fill({ color: COLORS.memo, alpha: 0.9 }),
        );
        const metrics = routeMetrics(route.points);
        routeSignals.push({
          glyph,
          points: route.points,
          ...metrics,
          offset: metrics.totalLength * ((routeIndex * 0.27) % 1),
          speed: 26 + routeIndex * 5,
        });
        world?.addChild(glyph);
      }
    });
    world.addChildAt(routes, Math.max(0, world.children.length - routeSignals.length));

    // A quiet scanning plane ties both route banks together. It is a retained
    // one-pixel vector that only changes y/alpha during update().
    scanLine = new Graphics()
      .rect(width * 0.04, 0, width * 0.92, 1)
      .fill({ color: SIGNAL_CYAN, alpha: 0.22 })
      .rect(width * 0.48, -1, width * 0.04, 3)
      .fill({ color: SIGNAL_CYAN, alpha: 0.22 });
    world.addChild(scanLine);

    // Two minimal system pods make the environment feel like a live runtime,
    // not a web dashboard. They disappear on narrow/short canvases.
    if (!compact) {
      const podW = Math.min(184, Math.max(132, width * 0.15));
      const podH = 62;
      const addSystemPod = (x: number, label: string, accent: number, cloud: boolean) => {
        const pod = new Container();
        pod.position.set(x, height * 0.2);
        const panel = new Graphics()
          .roundRect(0, 0, podW, podH, 8)
          .fill({ color: COLORS.stage, alpha: 0.52 })
          .roundRect(0, 0, podW, podH, 8)
          .stroke({ width: 1, color: accent, alpha: 0.26 })
          .rect(0, 0, 3, podH)
          .fill({ color: accent, alpha: 0.5 });
        const labelText = new Text({
          text: label,
          style: {
            fontFamily: DISPLAY_FONT,
            fontSize: 11,
            fontWeight: "700",
            fill: ALUMINUM_300,
            letterSpacing: 2,
          },
        });
        labelText.position.set(14, 11);
        const sub = new Text({
          text: cloud ? "REGION MESH" : "BUILD CHANNEL",
          style: { fontFamily: "monospace", fontSize: 8, fill: COLORS.aluminum, letterSpacing: 1 },
        });
        sub.position.set(14, 31);
        pod.addChild(panel, labelText, sub);

        if (cloud) {
          const cloudGlyph = new Graphics()
            .circle(podW - 34, 27, 9)
            .fill({ color: accent, alpha: 0.09 })
            .circle(podW - 24, 25, 12)
            .fill({ color: accent, alpha: 0.09 })
            .circle(podW - 14, 29, 8)
            .fill({ color: accent, alpha: 0.09 })
            .roundRect(podW - 43, 27, 37, 12, 6)
            .stroke({ width: 1.5, color: accent, alpha: 0.48 });
          pod.addChild(cloudGlyph);
        }

        for (let i = 0; i < 3; i++) {
          const pip = new Graphics().circle(0, 0, 2.4).fill({ color: accent });
          pip.position.set(16 + i * 10, podH - 11);
          pod.addChild(pip);
          statusPips.push({ glyph: pip, phase: i * 1.7 + statusPips.length * 0.4 });
        }
        world?.addChild(pod);
      };
      addSystemPod(22, "EDGE ORCHESTRATOR", SIGNAL_CYAN, true);
      addSystemPod(width - podW - 22, "DEPLOYMENT RING", SIGNAL_GREEN, false);
    }

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

    // A slow orbital seal sits behind the pole. Broken arcs and square runes
    // borrow the visual grammar of infrastructure diagrams without copying a
    // product logo or exposing any actual service topology.
    orbitWheel = new Container();
    const orbitR = Math.min(width, height) * (compact ? 0.16 : 0.19);
    const orbitG = new Graphics()
      .arc(0, 0, orbitR, -Math.PI * 0.08, Math.PI * 0.63)
      .stroke({ width: 1.5, color: SIGNAL_CYAN, alpha: 0.28 })
      .arc(0, 0, orbitR, Math.PI * 0.92, Math.PI * 1.68)
      .stroke({ width: 1.5, color: SIGNAL_CYAN, alpha: 0.18 })
      .arc(0, 0, orbitR * 0.74, Math.PI * 0.2, Math.PI * 1.17)
      .stroke({ width: 1, color: SIGNAL_BLUE, alpha: 0.3 })
      .arc(0, 0, orbitR * 0.48, -Math.PI * 0.55, Math.PI * 0.35)
      .stroke({ width: 1, color: GOLD, alpha: 0.2 });
    orbitWheel.addChild(orbitG);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? orbitR : orbitR * 0.74;
      const rune = new Graphics()
        .rect(-2.5, -2.5, 5, 5)
        .fill({ color: i % 3 === 0 ? GOLD : SIGNAL_CYAN, alpha: 0.65 });
      rune.position.set(Math.cos(a) * r, Math.sin(a) * r);
      rune.rotation = a;
      orbitWheel.addChild(rune);
    }
    orbitWheel.position.set(cx, platformY - poleH * 0.52);
    world.addChild(orbitWheel);

    // The generated arena backdrop already contains the ceremonial pole.
    // A few luminous floor rings tie the code-rendered FX into that artwork
    // without drawing a second pole over it.
    const dais = new Graphics()
      .ellipse(cx, platformY + 2, Math.min(width * 0.2, 190), 28)
      .stroke({ width: 2, color: COLORS.aluminumLight, alpha: 0.22 })
      .ellipse(cx, platformY + 2, Math.min(width * 0.13, 125), 18)
      .stroke({ width: 1.5, color: COLORS.grease, alpha: 0.24 });
    world.addChild(dais);

    // Title stack: game-world headline plus a restrained runtime eyebrow and
    // phase-only status. No counts or identity-bearing state enter this scene.
    const titleSize = Math.min(width * 0.064, 56);
    const titleY = height * 0.145;
    const eyebrow = new Text({
      text: "FESTIVUS RUNTIME  /  CEREMONIAL CLUSTER",
      style: {
        fontFamily: "monospace",
        fontSize: Math.min(11, width * 0.015),
        fill: SIGNAL_CYAN,
        letterSpacing: 2,
      },
    });
    eyebrow.anchor.set(0.5);
    eyebrow.position.set(cx, Math.max(16, titleY - titleSize * 0.78));
    eyebrow.alpha = 0.78;
    const title = new Text({
      text: "FEATS OF STRENGTH",
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: titleSize,
        fontWeight: "700",
        fill: ALUMINUM_300,
        letterSpacing: titleSize * 0.14,
      },
    });
    title.anchor.set(0.5);
    title.position.set(cx, titleY);
    phaseReadout = new Text({
      text: "●  ROOM RUNTIME / ONLINE",
      style: {
        fontFamily: "monospace",
        fontSize: Math.min(10, width * 0.014),
        fill: SIGNAL_GREEN,
        letterSpacing: 1.4,
      },
    });
    phaseReadout.anchor.set(0.5);
    phaseReadout.position.set(cx, titleY + titleSize * 0.76);
    world.addChild(eyebrow, title, phaseReadout);
  }

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      world = new Container();
      overlay = new Container();
      atmosphere = new CinematicAtmosphere(
        { light: SIGNAL_CYAN, rim: SIGNAL_BLUE, fog: 0x60768b, ember: SIGNAL_GREEN },
        svc.reducedMotion,
        svc.visualDensity,
      );
      stage.addChild(atmosphere.back, world, atmosphere.front, overlay);
      miracle = new MiracleFlash(overlay, svc.reducedMotion);
      build(width, height);
      atmosphere.layout(width, height, 0.64);
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
        atmosphere?.layout(lastW, lastH, 0.64);
        miracle?.layout(lastW, lastH);
      }

      elapsedMs += args.dtMs;

      // Retained-object motion only: packet positions, one scan plane, and a
      // slow orbital drift. Reduced-motion viewers get the same composition
      // held in a deliberate static pose.
      const seconds = elapsedMs / 1000;
      for (let i = 0; i < routeSignals.length; i++) {
        const signal = routeSignals[i];
        const distance = services.reducedMotion
          ? signal.offset
          : (signal.offset + seconds * signal.speed) % signal.totalLength;
        const point = pointOnRoute(signal, distance);
        signal.glyph.position.set(point.x, point.y);
        if (services.reducedMotion) {
          signal.glyph.alpha = 0.72;
          signal.glyph.scale.set(1);
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(seconds * 4.2 + i * 1.6);
          signal.glyph.alpha = 0.52 + pulse * 0.4;
          signal.glyph.scale.set(0.88 + pulse * 0.22);
        }
      }
      if (orbitWheel) {
        orbitWheel.rotation = services.reducedMotion ? 0.025 : seconds * 0.022;
      }
      if (scanLine) {
        const scanT = services.reducedMotion ? 0.52 : (seconds / 7.5) % 1;
        scanLine.y = lastH * (0.25 + scanT * 0.5);
        scanLine.alpha = services.reducedMotion
          ? 0.2
          : 0.11 + 0.1 * Math.sin(scanT * Math.PI);
      }
      for (const pip of statusPips) {
        pip.glyph.alpha = services.reducedMotion
          ? 0.72
          : 0.48 + 0.42 * (0.5 + 0.5 * Math.sin(seconds * 2.1 + pip.phase));
      }

      // Honor the fx contract even here (see note on MiracleFlash).
      for (const f of args.fx) {
        if (f.type === "miracle") {
          miracle?.trigger();
          atmosphere?.impact(1, GOLD);
        }
      }
      miracle?.update(args.dtMs);

      // Pick the glow's target strength from the phase, then ease toward it
      // so phase changes fade rather than snap.
      const phase = args.snap.phase;
      if (phaseReadout) {
        phaseReadout.text =
          phase === "lobby"
            ? "●  ROOM RUNTIME / STANDBY"
            : phase === "grievance_write"
              ? "●  GRIEVANCE PIPELINE / INGEST"
              : phase === "grievance_reveal"
                ? "●  GRIEVANCE PIPELINE / STREAM"
                : "●  ROOM RUNTIME / ONLINE";
      }
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
      atmosphere?.update(args.dtMs, phase, glowAlpha);
    },

    unmount(): void {
      miracle?.destroy();
      miracle = null;
      atmosphere = null;
      // GameCanvas destroys the display tree for us after unmount.
      world = null;
      overlay = null;
      glow = null;
      orbitWheel = null;
      scanLine = null;
      phaseReadout = null;
      routeSignals = [];
      statusPips = [];
    },
  };
};
