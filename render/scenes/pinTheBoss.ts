/**
 * SCENE — PIN THE BOSS (render half of lib/game/events/pinTheBoss.ts).
 *
 * View contract: { pinPos: 0..1, count: 0..3, overLine: boolean,
 * pinnedOut: boolean }.
 *
 * Justin is a see-saw plank hinged at his FEET (right side of the mat).
 * pinPos 0 = standing upright, 1 = flat on the mat. In Pixi screen
 * coordinates (y points DOWN, positive rotation is CLOCKWISE) and with the
 * plank drawn extending LEFT from the hinge, "upright" is +80° and "flat"
 * is 0° — that's the same 80° tilt the design sheet calls −80°, just seen
 * from Pixi's flipped y-axis. So:
 *
 *     plank.rotation = UP_ROT × (1 − pinPos)     // UP_ROT = 80° in radians
 *
 * A grease-yellow PIN LINE arc marks pinPos ≈ 0.78 — hold the plank past it
 * for a 1–2–3 count and the people win.
 */

import { Container, Graphics, Text } from "pixi.js";
import type { SceneFactory, SceneServices, SceneUpdateArgs } from "../core";
import type { EventView } from "@/lib/game/engine/types";
import { COLORS, makeBody, makeJustinHead, ParticleBurst, Shaker, springTo } from "../toolkit";
import type { SpringState } from "../toolkit";

const ALUMINUM_300 = 0xb8bfc6; // --color-aluminum-300 from globals.css
const GOLD = 0xd9a514;

const DISPLAY_FONT = ["Arial Narrow", "Helvetica Neue", "Roboto Condensed", "sans-serif"];
const MONO_FONT = ["ui-monospace", "SF Mono", "Cascadia Mono", "Roboto Mono", "Menlo", "monospace"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Upright tilt of the plank (radians). See the header for the sign story. */
const UP_ROT = (80 * Math.PI) / 180;
/** Default pin-line travel fraction — overridden by the server's view. */
const PIN_LINE_FRAC = 0.78;

/** Safe reads from the loosely-typed EventView bag. */
function num(view: EventView | null, key: string, fallback: number): number {
  const v = view?.[key];
  return typeof v === "number" ? v : fallback;
}
function flag(view: EventView | null, key: string, fallback: boolean): boolean {
  const v = view?.[key];
  return typeof v === "boolean" ? v : fallback;
}

/* ── Small overlay kit ─────────────────────────────────────────────────────
 * Scenes are self-contained by design (no shared scene-helper module), so
 * each event scene carries its own copy of these three overlays.          */

/** One-shot "FESTIVUS MIRACLE!" flash + golden confetti. */
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
      style: { fontFamily: DISPLAY_FONT, fontSize: 44, fontWeight: "700", fill: GOLD, letterSpacing: 4 },
    });
    this.text.anchor.set(0.5);
    this.text.visible = false;
    layer.addChild(this.text);
  }

  layout(width: number, height: number): void {
    this.cx = width / 2;
    this.cy = height * 0.3;
    this.text.position.set(this.cx, this.cy);
    this.text.style.fontSize = Math.min(44, width * 0.06);
  }

  trigger(): void {
    this.msLeft = 1600;
    this.pop.value = 1.7;
    this.pop.velocity = 0;
    this.burst.burst({
      x: this.cx,
      y: this.cy + 30,
      count: this.reducedMotion ? 20 : 40,
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
    this.text.alpha = clamp01(this.msLeft / 600);
    springTo(this.pop, 1, dtMs, 160, 14);
    this.text.scale.set(this.pop.value);
  }

  destroy(): void {
    this.burst.destroy();
  }
}

/** Big 3…2…1 + event name shown during phase "event_countdown". */
class CountdownOverlay {
  private root = new Container();
  private scrim = new Graphics();
  private num: Text;
  private name: Text;
  private lastN = -1;
  private pop: SpringState = { value: 1, velocity: 0 };

  constructor(layer: Container) {
    this.num = new Text({
      text: "3",
      style: { fontFamily: MONO_FONT, fontSize: 130, fontWeight: "700", fill: COLORS.memo },
    });
    this.num.anchor.set(0.5);
    this.name = new Text({
      text: "",
      style: { fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: "700", fill: ALUMINUM_300, letterSpacing: 5 },
    });
    this.name.anchor.set(0.5);
    this.root.addChild(this.scrim, this.num, this.name);
    this.root.visible = false;
    layer.addChild(this.root);
  }

  layout(w: number, h: number): void {
    this.scrim.clear().rect(0, 0, w, h).fill({ color: 0x101214, alpha: 0.45 });
    const size = Math.min(150, h * 0.28);
    this.num.style.fontSize = size;
    this.num.position.set(w / 2, h * 0.42);
    this.name.style.fontSize = Math.min(32, w * 0.045);
    this.name.position.set(w / 2, h * 0.42 + size * 0.75);
  }

  update(args: SceneUpdateArgs): void {
    if (args.snap.phase !== "event_countdown") {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const msLeft = Math.max(0, args.snap.phaseEndsAt - args.snap.serverNow);
    const n = Math.max(1, Math.ceil(msLeft / 1000));
    if (n !== this.lastN) {
      this.lastN = n;
      this.num.text = String(n);
      this.pop.value = 1.8;
      this.pop.velocity = 0;
    }
    springTo(this.pop, 1, args.dtMs, 170, 15);
    this.num.scale.set(this.pop.value);
    this.name.text = (args.snap.eventMeta?.name ?? "").toUpperCase();
  }
}

/** Result banner for phase "event_outcome" (winner from snap.roundResults). */
class OutcomeBanner {
  private root = new Container();
  private scrim = new Graphics();
  private card = new Container();
  private band = new Graphics();
  private label: Text;
  private pop: SpringState = { value: 1, velocity: 0 };
  private wasShown = false;

  constructor(
    layer: Container,
    private line: (winner: "support" | "hinder") => { label: string; color: number },
  ) {
    this.label = new Text({
      text: "",
      style: { fontFamily: DISPLAY_FONT, fontSize: 42, fontWeight: "700", fill: COLORS.memo, letterSpacing: 3 },
    });
    this.label.anchor.set(0.5);
    this.card.addChild(this.band, this.label);
    this.root.addChild(this.scrim, this.card);
    this.root.visible = false;
    layer.addChild(this.root);
  }

  layout(w: number, h: number): void {
    this.scrim.clear().rect(0, 0, w, h).fill({ color: 0x101214, alpha: 0.35 });
    this.card.position.set(w / 2, h * 0.42);
    this.label.style.fontSize = Math.min(46, w * 0.055);
  }

  update(args: SceneUpdateArgs): void {
    if (args.snap.phase !== "event_outcome") {
      this.root.visible = false;
      this.wasShown = false;
      return;
    }
    const meta = args.snap.eventMeta;
    const result = meta ? args.snap.roundResults[meta.index] : undefined;
    if (!result) {
      this.root.visible = false;
      return;
    }
    if (!this.wasShown) {
      this.wasShown = true;
      const { label, color } = this.line(result.winner);
      this.label.text = label;
      this.label.style.fill = color;
      const bw = this.label.width + 72;
      const bh = this.label.height + 36;
      this.band
        .clear()
        .roundRect(-bw / 2, -bh / 2, bw, bh, 8)
        .fill({ color: 0x101214, alpha: 0.92 })
        .stroke({ width: 3, color });
      this.pop.value = 1.6;
      this.pop.velocity = 0;
    }
    this.root.visible = true;
    springTo(this.pop, 1, args.dtMs, 150, 13);
    this.card.scale.set(this.pop.value);
  }
}

/* ── Figures ──────────────────────────────────────────────────────────────── */

/**
 * The referee: kneeling, striped shirt, one big slapping arm. Fixed-size
 * shapes; the scene scales/positions the whole container. Returns both the
 * figure and the arm container so update() can animate the slap.
 */
function makeReferee(): { root: Container; arm: Container } {
  const root = new Container();
  // Kneeling legs: a low block along the mat.
  const legs = new Graphics().roundRect(-12, -10, 30, 12, 5).fill({ color: 0x4b535b });
  // Torso leans over the action.
  const torso = new Container();
  torso.position.set(0, -8);
  torso.rotation = 0.35;
  const shirt = new Graphics().roundRect(-9, -44, 20, 40, 7).fill({ color: COLORS.aluminumLight });
  const stripes = new Graphics()
    .rect(-5, -44, 4, 40)
    .fill({ color: 0x33393f })
    .rect(3, -44, 4, 40)
    .fill({ color: 0x33393f });
  const head = new Graphics().circle(1, -52, 9).fill({ color: COLORS.skin });
  torso.addChild(shirt, stripes, head);
  // The slapping arm hangs off the shoulder; update() rotates it.
  const arm = new Container();
  arm.position.set(6, -40);
  const limb = new Graphics()
    .moveTo(0, 0)
    .lineTo(24, 14)
    .stroke({ width: 6, color: COLORS.aluminumLight })
    .circle(26, 16, 5)
    .fill({ color: COLORS.skin });
  arm.addChild(limb);
  torso.addChild(arm);
  root.addChild(legs, torso);
  return { root, arm };
}

/* ── The scene ────────────────────────────────────────────────────────────── */

export const pinTheBossScene: SceneFactory = () => {
  let services: SceneServices | null = null;
  let world: Container | null = null; // shaken on impacts
  let overlay: Container | null = null;

  let matG: Graphics | null = null;
  let pinLineG: Graphics | null = null;
  let pinLabel: Text | null = null;
  let plank: Container | null = null; // Justin, hinged at his feet
  let referee: Container | null = null;
  let refArm: Container | null = null;
  let digits: Text[] = [];
  let digitSprings: SpringState[] = [];
  let stamp: Container | null = null;
  let stampShown = false;
  let stampSpring: SpringState = { value: 1, velocity: 0 };

  let dust: ParticleBurst | null = null;
  let shaker: Shaker | null = null;
  let miracle: MiracleFlash | null = null;
  let countdown: CountdownOverlay | null = null;
  let banner: OutcomeBanner | null = null;

  // Layout facts.
  let matX = 0;
  let matY = 0;
  let hingeX = 0;
  let hingeY = 0;
  let headDist = 0; // hinge → head-center distance along the plank
  let lastW = 0;
  let lastH = 0;

  // Animation state — we keep our own last-known copies of the view fields
  // because eventView can be null during countdown/outcome and we must not
  // let the plank snap back to defaults when that happens.
  let tSec = 0;
  const pinSpring: SpringState = { value: 0, velocity: 0 };
  let pinTarget = 0;
  let shownCount = 0;
  let overLine = false;
  let pinnedOut = false;
  let pinLineFrac = PIN_LINE_FRAC;

  /** Direction (radians) from the hinge to the head at a given pinPos. */
  function angleAt(p: number): number {
    // The plank points LEFT (angle π) when flat, and rotates up by UP_ROT
    // as pinPos falls to 0. Screen-clockwise angles, like Graphics.arc().
    return Math.PI + UP_ROT * (1 - p);
  }

  /** Rebuild Justin-the-plank at the current size. Feet/hinge at (0,0). */
  function buildPlank(bodyLen: number, headSize: number): void {
    if (!plank || !services) return;
    plank.removeChildren().forEach((c) => c.destroy({ children: true }));

    // Shoes + a visible hinge bolt, so the pivot reads as a pivot.
    const feet = new Graphics()
      .roundRect(-6, -10, 16, 20, 5)
      .fill({ color: COLORS.aluminumDark })
      .circle(0, 0, 5)
      .fill({ color: COLORS.aluminum });

    // makeBody draws a shirt hanging DOWNWARD from (0,0). Rotating it +90°
    // (clockwise, in Pixi's y-down world) lays it along our −x axis.
    const body = makeBody(30, bodyLen - 18);
    body.rotation = Math.PI / 2;
    body.position.set(-12, 0);

    const head = makeJustinHead(headSize, services.photoUrl);
    head.position.set(-headDist, 0);

    plank.addChild(body, feet, head);
  }

  function layout(w: number, h: number): void {
    if (!matG || !pinLineG || !plank || !referee || !pinLabel || !stamp) return;

    matX = w / 2;
    matY = h * 0.62;
    const rx = Math.min(w * 0.36, 330); // mat half-width
    const ry = rx * 0.34;
    hingeX = matX + rx * 0.45; // hinge on the RIGHT side of the mat
    hingeY = matY - 4;
    const bodyLen = rx * 0.85;
    const headSize = clamp(rx * 0.34, 34, 64);
    headDist = 12 + (bodyLen - 18) + headSize * 0.42;

    // The wrestling mat: memo-paper colored, grievance-red border.
    matG
      .clear()
      .ellipse(matX, matY, rx, ry)
      .fill({ color: COLORS.memo })
      .ellipse(matX, matY, rx, ry)
      .stroke({ width: 6, color: COLORS.grievance })
      .ellipse(matX, matY, rx * 0.55, ry * 0.55)
      .stroke({ width: 2, color: COLORS.grievance, alpha: 0.35 });

    plank.position.set(hingeX, hingeY);
    buildPlank(bodyLen, headSize);

    // Travel guide (faint) + the grease-yellow PIN LINE marker arc.
    // The line position comes from the server's view (data-driven via
    // level_config), falling back to the shipped default.
    const aLine = angleAt(pinLineFrac);
    pinLineG
      .clear()
      .arc(hingeX, hingeY, headDist, Math.PI, Math.PI + UP_ROT)
      .stroke({ width: 2, color: COLORS.aluminum, alpha: 0.25 })
      .arc(hingeX, hingeY, headDist, aLine - 0.07, aLine + 0.07)
      .stroke({ width: 7, color: COLORS.grease });
    pinLabel.style.fontSize = Math.min(14, w * 0.02);
    pinLabel.position.set(
      hingeX + Math.cos(aLine) * (headDist + 26),
      hingeY + Math.sin(aLine) * (headDist + 26),
    );

    // Referee kneels on the far (left) side of the mat.
    const figScale = clamp(w / 900, 0.7, 1.2);
    referee.scale.set(figScale);
    referee.position.set(matX - rx * 0.8, matY + ry * 0.25);

    // The 1-2-3 digits march across the top of the mat.
    const spacing = Math.min(110, w * 0.14);
    for (let i = 0; i < digits.length; i++) {
      digits[i].style.fontSize = Math.min(96, w * 0.12);
      digits[i].position.set(matX + (i - 1) * spacing, h * 0.2);
    }

    stamp.position.set(matX, h * 0.36);

    miracle?.layout(w, h);
    countdown?.layout(w, h);
    banner?.layout(w, h);
  }

  /** Show digits 1..n (popping any newly revealed one), hide the rest. */
  function syncCount(n: number): void {
    const target = clamp(Math.round(n), 0, 3);
    for (let i = 0; i < digits.length; i++) {
      const shouldShow = i < target;
      if (shouldShow && !digits[i].visible) {
        // New digit: pop in with a 2 → 1 scale spring.
        digitSprings[i].value = 2;
        digitSprings[i].velocity = 0;
      }
      digits[i].visible = shouldShow;
    }
    shownCount = target;
  }

  /** The count got smashed back to zero — break the digits apart. */
  function breakCount(): void {
    if (!services) return;
    for (let i = 0; i < digits.length; i++) {
      if (!digits[i].visible) continue;
      dust?.burst({
        x: digits[i].x,
        y: digits[i].y,
        count: services.reducedMotion ? 6 : 12,
        color: [COLORS.aluminum, 0x6b747d, COLORS.aluminumLight],
        spread: Math.PI * 2,
        speed: 160,
        gravity: 300,
        size: 3,
      });
    }
    syncCount(0);
  }

  /** Mat-dust where Justin lands. */
  function dustAtJustin(): void {
    if (!services) return;
    const a = angleAt(clamp01(pinSpring.value));
    dust?.burst({
      x: hingeX + Math.cos(a) * headDist,
      y: hingeY + Math.sin(a) * headDist,
      count: services.reducedMotion ? 12 : 26,
      color: [COLORS.aluminum, 0x6b747d, COLORS.memo],
      angle: -Math.PI / 2,
      spread: Math.PI,
      speed: 180,
      gravity: 240,
    });
  }

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      world = new Container();
      overlay = new Container();
      stage.addChild(world, overlay);
      shaker = new Shaker(world);

      matG = new Graphics();
      pinLineG = new Graphics();
      pinLabel = new Text({
        text: "PIN LINE",
        style: { fontFamily: MONO_FONT, fontSize: 14, fontWeight: "700", fill: COLORS.grease, letterSpacing: 2 },
      });
      pinLabel.anchor.set(0.5);
      plank = new Container();
      const ref = makeReferee();
      referee = ref.root;
      refArm = ref.arm;
      referee.visible = false; // only appears while the count is live
      world.addChild(matG, pinLineG, pinLabel, plank, referee);

      // Digits live in `world` so impact shakes rattle them too.
      digits = [];
      digitSprings = [];
      for (let i = 0; i < 3; i++) {
        const d = new Text({
          text: String(i + 1),
          style: { fontFamily: MONO_FONT, fontSize: 96, fontWeight: "700", fill: COLORS.memo },
        });
        d.anchor.set(0.5);
        d.visible = false;
        digits.push(d);
        digitSprings.push({ value: 1, velocity: 0 });
        world.addChild(d);
      }

      // "PINNED!" — a rubber-stamp verdict, rotated like a careless clerk.
      stamp = new Container();
      const stampText = new Text({
        text: "PINNED!",
        style: {
          fontFamily: DISPLAY_FONT,
          fontSize: Math.min(110, width * 0.14),
          fontWeight: "700",
          fill: COLORS.grievance,
          letterSpacing: 6,
        },
      });
      stampText.anchor.set(0.5);
      const border = new Graphics()
        .roundRect(-stampText.width / 2 - 24, -stampText.height / 2 - 10, stampText.width + 48, stampText.height + 20, 8)
        .stroke({ width: 5, color: COLORS.grievance });
      stamp.addChild(border, stampText);
      stamp.rotation = -0.16;
      stamp.visible = false;
      world.addChild(stamp);

      dust = new ParticleBurst(world);
      miracle = new MiracleFlash(overlay, svc.reducedMotion);
      countdown = new CountdownOverlay(overlay);
      banner = new OutcomeBanner(overlay, (winner) =>
        winner === "hinder"
          ? { label: "THE PEOPLE PINNED HIM", color: COLORS.grievance }
          : { label: "JUSTIN SURVIVES THE COUNT", color: COLORS.support },
      );

      lastW = width;
      lastH = height;
      layout(width, height);
    },

    update(args): void {
      if (!world || !services || !plank || !referee || !refArm || !stamp) return;
      if (args.width !== lastW || args.height !== lastH) {
        lastW = args.width;
        lastH = args.height;
        layout(lastW, lastH);
      }

      tSec += args.dtMs / 1000;
      const reduced = services.reducedMotion;
      const phase = args.snap.phase;

      // Read fresh truth only while the event is live; during countdown and
      // outcome we hold whatever we last saw (outcome = frozen action).
      if (phase === "event_active" && args.view) {
        pinTarget = num(args.view, "pinPos", pinTarget);
        overLine = flag(args.view, "overLine", overLine);
        pinnedOut = flag(args.view, "pinnedOut", pinnedOut);
        // The 1-2-3 count is DISCRETE: read it from the un-lerped latest
        // snapshot — interpolating it produces 0.5, 1.7… and flickering
        // digits between snapshots.
        syncCount(num(args.snap.eventView, "count", shownCount));
        // Draw the pin line where the SERVER says it is (level_config).
        const serverLine = num(args.snap.eventView, "pinLine", pinLineFrac);
        if (Math.abs(serverLine - pinLineFrac) > 0.001) {
          pinLineFrac = serverLine;
          layout(lastW, lastH);
        }
      }
      if (pinnedOut) pinTarget = 1; // hold him flat once the 3-count lands

      // The plank chases pinPos on a spring — server ticks are chunky,
      // springs make them look like wrestling.
      springTo(pinSpring, pinTarget, args.dtMs, 130, 12);
      // Allow a little overshoot (squash into the mat / rear past upright)
      // but never enough to clip through the floor.
      plank.rotation = UP_ROT * (1 - clamp(pinSpring.value, -0.1, 1.06));

      // Referee shows up whenever the bar is past the line.
      referee.visible = overLine || pinnedOut;
      if (pinnedOut) {
        refArm.rotation = 0.55; // final slap, held
      } else if (reduced) {
        refArm.rotation = 0.2; // present but still
      } else {
        refArm.rotation = Math.sin(tSec * 13) * 0.55; // slap-slap-slap
      }

      // Digit pop springs.
      for (let i = 0; i < digits.length; i++) {
        springTo(digitSprings[i], 1, args.dtMs, 170, 13);
        digits[i].scale.set(digitSprings[i].value);
      }

      // Transient fx.
      for (const f of args.fx) {
        switch (f.type) {
          case "count":
            // The referee's palm hits the mat: jolt + make sure the digit
            // is showing (the view will confirm on the next snapshot).
            if (!reduced) shaker?.kick(6);
            syncCount(typeof f.value === "number" ? f.value : shownCount + 1);
            break;
          case "countBroken":
            breakCount();
            break;
          case "pinned":
            // The bar just crossed the line — Justin hit the mat.
            if (!reduced) shaker?.kick(10);
            dustAtJustin();
            break;
          case "miracle":
            miracle?.trigger();
            if (!reduced) shaker?.kick(8);
            break;
          default:
            break;
        }
      }

      // "PINNED!" stamp.
      if (pinnedOut && !stampShown) {
        stampShown = true;
        stamp.visible = true;
        stampSpring = { value: 2.2, velocity: 0 }; // slams down onto the screen
      }
      if (stampShown) {
        springTo(stampSpring, 1, args.dtMs, 170, 12);
        stamp.scale.set(stampSpring.value);
      }

      dust?.update(args.dtMs);
      shaker?.update(args.dtMs);
      miracle?.update(args.dtMs);
      countdown?.update(args);
      banner?.update(args);
    },

    unmount(): void {
      dust?.destroy();
      dust = null;
      miracle?.destroy();
      miracle = null;
      // GameCanvas destroys the display tree after unmount.
      world = null;
      overlay = null;
      matG = null;
      pinLineG = null;
      pinLabel = null;
      plank = null;
      referee = null;
      refArm = null;
      digits = [];
      digitSprings = [];
      stamp = null;
      shaker = null;
      countdown = null;
      banner = null;
    },
  };
};
