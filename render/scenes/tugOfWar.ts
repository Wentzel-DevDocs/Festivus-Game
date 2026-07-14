/**
 * SCENE — TUG-OF-WAR (render half of lib/game/events/tugOfWar.ts).
 *
 * View contract: { ropePos: -1..1 }. The same number arrives pre-interpolated
 * in args.tugPosition, so that is what we actually read.
 *
 * THE MAPPING — decided once here and used everywhere below:
 *   · Team A stands on the LEFT and wins at ropePos = +1.
 *   · knotX = centerX − ropePos × winOffset      (winOffset = 40% of width)
 *   · So a rising ropePos drags the knot LEFT until it kisses the LEFT win
 *     line (Team A's prize); ropePos = −1 puts it on the RIGHT line (Team B).
 *
 * Justin himself is the midpoint marker, tied to the rope by a knot —
 * whichever team wins, he loses.
 */

import { Container, Graphics, Text } from "pixi.js";
import type { SceneFactory, SceneServices, SceneUpdateArgs } from "../core";
import {
  COLORS,
  makeBody,
  makeJointedLimb,
  makeJustinHead,
  ParticleBurst,
  Shaker,
  springTo,
} from "../toolkit";
import type { SpringState } from "../toolkit";

const ALUMINUM_300 = 0xb8bfc6; // --color-aluminum-300 from globals.css
const GOLD = 0xd9a514;
const ROPE_BROWN = 0x8a5a2b;

const DISPLAY_FONT = ["Arial Narrow", "Helvetica Neue", "Roboto Condensed", "sans-serif"];
const MONO_FONT = ["ui-monospace", "SF Mono", "Cascadia Mono", "Roboto Mono", "Menlo", "monospace"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

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
    // The countdown number comes straight off the server clock so every
    // screen agrees: 3, then 2, then 1 as phaseEndsAt approaches.
    const msLeft = Math.max(0, args.snap.phaseEndsAt - args.snap.serverNow);
    const n = Math.max(1, Math.ceil(msLeft / 1000));
    if (n !== this.lastN) {
      this.lastN = n;
      this.num.text = String(n);
      this.pop.value = 1.8; // each new digit pops in
      this.pop.velocity = 0;
    }
    springTo(this.pop, 1, args.dtMs, 170, 15);
    this.num.scale.set(this.pop.value);
    this.name.text = (args.snap.eventMeta?.name ?? "").toUpperCase();
  }
}

/**
 * Result banner for phase "event_outcome". The winner is read from
 * snap.roundResults — the outcome phase always follows resolve(), so the
 * entry for this event's index exists by the time we're visible.
 */
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
      // Snapshot race (result not written yet) — stay hidden one frame.
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
      this.pop.value = 1.6; // stamped-on entrance
      this.pop.velocity = 0;
    }
    this.root.visible = true;
    springTo(this.pop, 1, args.dtMs, 150, 13);
    this.card.scale.set(this.pop.value);
  }
}

/* ── Figures ──────────────────────────────────────────────────────────────── */

/**
 * A generic gray coworker, feet at (0,0). Leaning is done by rotating the
 * whole container around the feet. `facing` is +1 when the rope is to the
 * figure's RIGHT (left team) and −1 when it is to their LEFT (right team) —
 * it only flips which way the arms reach.
 */
function makePuller(facing: 1 | -1, accent: number, variant: number): Container {
  const root = new Container();
  const skinTones = [COLORS.skin, 0x8f5d43, 0xe4b281];
  const skinLights = [COLORS.skinLight, 0xbd8465, 0xf2cda5];
  const hairTones = [0x2c2521, 0x14171b, 0x65452d];
  const uniformTones = [0x46525d, 0x3e4d59, 0x52606a];
  const skin = skinTones[variant % skinTones.length];
  const skinLight = skinLights[variant % skinLights.length];
  const hair = hairTones[variant % hairTones.length];
  const uniform = uniformTones[variant % uniformTones.length];
  const shadow = new Graphics().ellipse(0, 1, 16, 4).fill({ color: COLORS.void, alpha: 0.55 });
  const farLeg = makeJointedLimb(
    [[-3, -19], [-8, -9], [-13, -1]],
    { width: 7, color: 0x303943, highlight: COLORS.aluminum },
  );
  const nearLeg = makeJointedLimb(
    [[3, -19], [8, -8], [12, -1]],
    { width: 7.5, color: 0x414c56, highlight: COLORS.aluminumLight },
  );
  const boots = new Graphics()
    .roundRect(-17, -5, 13, 6, 2.5)
    .fill({ color: COLORS.void })
    .roundRect(5, -5, 13, 6, 2.5)
    .fill({ color: COLORS.void })
    .moveTo(-15, -3.5)
    .lineTo(-7, -3.5)
    .moveTo(8, -3.5)
    .lineTo(15, -3.5)
    .stroke({ width: 1, color: COLORS.aluminumLight, alpha: 0.4 });
  const body = new Graphics()
    .roundRect(-12, -54, 24, 38, 7)
    .fill({ color: COLORS.void })
    .roundRect(-10, -52, 20, 34, 6)
    .fill({ color: uniform })
    .poly([-9, -49, 0, -39, -2, -20, -9, -25])
    .fill({ color: 0x71808c, alpha: 0.32 })
    .rect(-9, -24, 18, 4)
    .fill({ color: accent, alpha: 0.82 })
    .circle(0, -35, 2)
    .fill({ color: accent, alpha: 0.68 });
  const rearArm = makeJointedLimb(
    [[-facing * 5, -45], [facing * 10, -40], [facing * 22, -34]],
    { width: 6, color: 0x3b4650, endColor: skin, endHighlight: skinLight, highlight: COLORS.aluminum },
  );
  const leadArm = makeJointedLimb(
    [[facing * 6, -47], [facing * 16, -42], [facing * 27, -34]],
    { width: 6.5, color: uniform, endColor: skin, endHighlight: skinLight, highlight: COLORS.aluminumLight },
  );
  const head = new Graphics()
    .ellipse(facing * -1.5, -64, 11.5, 12.5)
    .fill({ color: COLORS.void })
    .ellipse(facing * -1.5, -64, 9.5, 10.5)
    .fill({ color: skin })
    .ellipse(facing * -4, -67, 4.5, 4)
    .fill({ color: skinLight, alpha: 0.34 })
    .arc(facing * -1.5, -64, 9.7, Math.PI * 1.02, Math.PI * 1.92)
    .stroke({ width: 3, color: hair })
    .circle(facing * 2, -64.5, 1)
    .fill({ color: COLORS.void })
    .moveTo(facing * 1, -60)
    .lineTo(facing * 5, -60.5)
    .stroke({ width: 1.1, color: 0x704633, alpha: 0.7 });
  const collar = new Graphics()
    .poly([-7, -52, 0, -47, 7, -52, 5, -55, -5, -55])
    .fill({ color: COLORS.memo, alpha: 0.8 });
  root.addChild(shadow, farLeg, rearArm, nearLeg, boots, body, collar, leadArm, head);
  return root;
}

/** Justin tied to the rope: head + shirt + a knot of rope coils at (0,0). */
function makeRopeJustin(photoUrl: string): Container {
  const root = new Container();
  const rearArm = makeJointedLimb(
    [[-10, -8], [-16, -1], [-7, 1]],
    { width: 5.5, color: 0x26313b, endColor: COLORS.skin, highlight: COLORS.aluminum },
  );
  const body = makeBody(34, 46);
  body.position.set(0, -16); // rope crosses his chest, roughly tie height
  const rearLeg = makeJointedLimb(
    [[-6, 26], [-11, 35], [-9, 45]],
    { width: 6, color: 0x172029, highlight: COLORS.aluminum },
  );
  const leadLeg = makeJointedLimb(
    [[6, 26], [12, 35], [10, 45]],
    { width: 6.5, color: 0x26313b, highlight: COLORS.aluminumLight },
  );
  const boots = new Graphics()
    .roundRect(-14, 41, 11, 7, 3)
    .fill({ color: COLORS.void })
    .roundRect(4, 41, 12, 7, 3)
    .fill({ color: COLORS.void });
  const leadArm = makeJointedLimb(
    [[10, -8], [16, -2], [7, 2]],
    { width: 6, color: 0x33404b, endColor: COLORS.skin, highlight: COLORS.aluminumLight },
  );
  const head = makeJustinHead(38, photoUrl);
  head.position.set(0, -35);
  // The knot: three rope coils cinched around him at rope height (y = 0).
  const knot = new Graphics()
    .roundRect(-18, -6, 36, 12, 6)
    .fill({ color: COLORS.void, alpha: 0.78 })
    .circle(-8, 0, 5)
    .fill({ color: ROPE_BROWN })
    .circle(0, 0, 5)
    .fill({ color: ROPE_BROWN })
    .circle(8, 0, 5)
    .fill({ color: ROPE_BROWN })
    .arc(-8, -1, 3.5, Math.PI * 1.1, Math.PI * 1.75)
    .arc(0, -1, 3.5, Math.PI * 1.1, Math.PI * 1.75)
    .arc(8, -1, 3.5, Math.PI * 1.1, Math.PI * 1.75)
    .stroke({ width: 1.2, color: 0xd3a166, alpha: 0.55 })
    .moveTo(8, 4)
    .quadraticCurveTo(16, 10, 11, 17)
    .stroke({ width: 4, color: ROPE_BROWN });
  root.addChild(rearLeg, rearArm, body, leadLeg, boots, leadArm, knot, head);
  return root;
}

/* ── The scene ────────────────────────────────────────────────────────────── */

export const tugOfWarScene: SceneFactory = () => {
  let services: SceneServices | null = null;
  let world: Container | null = null; // shaken by the Shaker
  let overlay: Container | null = null;

  let fieldG: Graphics | null = null; // floor + center/win lines (layout-time)
  let ropeG: Graphics | null = null; // the rope (redrawn every frame)
  let justin: Container | null = null;
  let teamA: Container[] = [];
  let teamB: Container[] = [];
  let labelA: Text | null = null;
  let labelB: Text | null = null;

  let shaker: Shaker | null = null;
  let miracle: MiracleFlash | null = null;
  let countdown: CountdownOverlay | null = null;
  let banner: OutcomeBanner | null = null;

  // Layout facts recomputed whenever the canvas size changes.
  let cx = 0;
  let winOff = 0;
  let ropeY = 0;
  let leftRopeX = 0;
  let rightRopeX = 0;
  let figScale = 1;
  let lastW = 0;
  let lastH = 0;

  // Animation state.
  let tSec = 0;
  let shownRope = 0; // the rope position we are currently drawing
  let prevRope = 0; // last frame's value — its delta drives the lean effort
  let energyA = 0; // 0..1 "how hard is Team A visibly heaving right now"
  let energyB = 0;

  function layout(w: number, h: number): void {
    if (!fieldG || !justin || !labelA || !labelB) return;

    cx = w / 2;
    winOff = w * 0.4; // win lines at ±40% of width, per the event's rules
    const groundY = h * 0.72;
    figScale = clamp(w / 900, 0.55, 1.1); // shrink figures on phone portrait
    ropeY = groundY - 34 * figScale;

    // Static field furniture.
    fieldG
      .clear()
      // floor
      .rect(0, groundY, w, h - groundY)
      .fill({ color: 0x1b1f23 })
      .moveTo(0, groundY)
      .lineTo(w, groundY)
      .stroke({ width: 2, color: COLORS.aluminumDark })
      // center line in grievance red — cross it and someone airs a grievance
      .moveTo(cx, h * 0.3)
      .lineTo(cx, groundY + 24)
      .stroke({ width: 3, color: COLORS.grievance, alpha: 0.9 })
      // win lines: LEFT is Team A's (support green), RIGHT is Team B's (grease)
      .moveTo(cx - winOff, h * 0.38)
      .lineTo(cx - winOff, groundY + 16)
      .stroke({ width: 3, color: COLORS.support, alpha: 0.8 })
      .moveTo(cx + winOff, h * 0.38)
      .lineTo(cx + winOff, groundY + 16)
      .stroke({ width: 3, color: COLORS.grease, alpha: 0.8 });

    // Teams stand just OUTSIDE their own win line on the broadcast. On narrow
    // phone canvases there is not enough edge gutter for three bodies, so the
    // formation steps inside the markers and compresses toward each edge.
    const compactFormation = w < 560;
    const compactLeadInset = Math.max(42, w * 0.14);
    const compactSpacing = 40 * figScale;
    for (let i = 0; i < teamA.length; i++) {
      const a = teamA[i];
      a.scale.set(figScale);
      const b = teamB[i];
      b.scale.set(figScale);
      if (compactFormation) {
        a.position.set(cx - winOff + compactLeadInset - i * compactSpacing, groundY);
        b.position.set(cx + winOff - compactLeadInset + i * compactSpacing, groundY);
      } else {
        a.position.set(cx - winOff - (30 + i * 46) * figScale, groundY);
        b.position.set(cx + winOff + (30 + i * 46) * figScale, groundY);
      }
    }
    // Rope ends anchor near the lead pullers' hands.
    leftRopeX = compactFormation ? teamA[0].x + 25 * figScale : cx - winOff - 6 * figScale;
    rightRopeX = compactFormation ? teamB[0].x - 25 * figScale : cx + winOff + 6 * figScale;

    // Justin is the focal rope marker, not another squad member. Scale around
    // the knot at (0,0) so rope math stays exact as his portrait grows.
    const heroMultiplier = w < 560 ? 1.22 : 1.3;
    justin.scale.set(figScale * heroMultiplier);

    // Team labels sit above each squad (clamped so phones keep them on-screen).
    const labelSize = Math.min(26, w * 0.035);
    labelA.style.fontSize = labelSize;
    labelB.style.fontSize = labelSize;
    labelA.position.set(clamp(cx - winOff - 75 * figScale, 60, w - 60), groundY - 100 * figScale);
    labelB.position.set(clamp(cx + winOff + 75 * figScale, 60, w - 60), groundY - 100 * figScale);

    miracle?.layout(w, h);
    countdown?.layout(w, h);
    banner?.layout(w, h);
  }

  /** Redraw the rope through the knot. Two sagging quadratic segments. */
  function drawRope(knotX: number): void {
    if (!ropeG) return;
    const sag = 14 * figScale;
    ropeG
      .clear()
      .moveTo(leftRopeX, ropeY)
      .quadraticCurveTo((leftRopeX + knotX) / 2, ropeY + sag, knotX, ropeY)
      .quadraticCurveTo((knotX + rightRopeX) / 2, ropeY + sag, rightRopeX, ropeY)
      .stroke({ width: 7 * figScale, color: ROPE_BROWN });
  }

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      world = new Container();
      overlay = new Container();
      stage.addChild(world, overlay);
      shaker = new Shaker(world);

      fieldG = new Graphics();
      ropeG = new Graphics();
      world.addChild(fieldG, ropeG);

      // Three pullers per team. Left team's arms reach right (+1), and
      // vice versa.
      teamA = [
        makePuller(1, COLORS.support, 0),
        makePuller(1, COLORS.support, 1),
        makePuller(1, COLORS.support, 2),
      ];
      teamB = [
        makePuller(-1, COLORS.grease, 2),
        makePuller(-1, COLORS.grease, 1),
        makePuller(-1, COLORS.grease, 0),
      ];
      for (const p of [...teamA, ...teamB]) world.addChild(p);

      justin = makeRopeJustin(svc.photoUrl);
      world.addChild(justin); // above the rope so the knot reads as tied on

      labelA = new Text({
        text: "TEAM A",
        style: { fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: "700", fill: COLORS.support, letterSpacing: 4 },
      });
      labelA.anchor.set(0.5);
      labelB = new Text({
        text: "TEAM B",
        style: { fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: "700", fill: COLORS.grease, letterSpacing: 4 },
      });
      labelB.anchor.set(0.5);
      world.addChild(labelA, labelB);

      miracle = new MiracleFlash(overlay, svc.reducedMotion);
      countdown = new CountdownOverlay(overlay);
      banner = new OutcomeBanner(overlay, (winner) =>
        winner === "support"
          ? { label: "TEAM A TAKES IT", color: COLORS.support } // support slot = Team A
          : { label: "TEAM B TAKES IT", color: COLORS.grease },
      );

      lastW = width;
      lastH = height;
      layout(width, height);
    },

    update(args): void {
      if (!world || !services || !justin) return;
      if (args.width !== lastW || args.height !== lastH) {
        lastW = args.width;
        lastH = args.height;
        layout(lastW, lastH);
      }

      tSec += args.dtMs / 1000;
      const reduced = services.reducedMotion;
      const phase = args.snap.phase;
      // During the outcome we freeze the action (the banner does the talking).
      // tugPosition also resets to 0 once the event ends, so reading it then
      // would visibly yank the rope back to center — hence the guard.
      const frozen = phase === "event_outcome";
      if (!frozen) shownRope = clamp(args.tugPosition, -1, 1);

      // Lean "energy": rope movement toward a team means that team is
      // winning the heave right now, so they get the big animated lean.
      const delta = shownRope - prevRope;
      prevRope = shownRope;
      if (delta > 0) energyA = Math.min(1, energyA + delta * 60);
      else energyB = Math.min(1, energyB - delta * 60);
      const decay = Math.exp(-args.dtMs / 450);
      energyA *= decay;
      energyB *= decay;

      // THE MAPPING (see file header): +ropePos moves the knot LEFT.
      const knotX = cx - shownRope * winOff;
      justin.position.set(knotX, ropeY);
      justin.rotation = reduced || frozen ? 0 : Math.sin(tSec * 1.7) * 0.06; // helpless dangle
      drawRope(knotX);

      // Pullers lean back from the feet; alternate phases per figure so the
      // squad heaves in a wave rather than in lockstep.
      for (let i = 0; i < teamA.length; i++) {
        const base = 0.12; // everyone leans back a little at rest
        let rotA = base;
        let rotB = base;
        if (!reduced && !frozen) {
          rotA = base + Math.max(0, Math.sin(tSec * 8 + i * 2.1)) * 0.35 * energyA;
          rotB = base + Math.max(0, Math.sin(tSec * 8 + i * 2.1 + 1.05)) * 0.35 * energyB;
        }
        teamA[i].rotation = -rotA; // left team leans left (counter-clockwise)
        teamB[i].rotation = rotB; // right team leans right
      }

      // Transient fx.
      for (const f of args.fx) {
        if (f.type === "miracle") {
          miracle?.trigger();
          if (!reduced) shaker?.kick(8);
        }
      }

      shaker?.update(args.dtMs);
      miracle?.update(args.dtMs);
      countdown?.update(args);
      banner?.update(args);
    },

    unmount(): void {
      miracle?.destroy();
      miracle = null;
      // GameCanvas destroys the display tree after unmount.
      world = null;
      overlay = null;
      fieldG = null;
      ropeG = null;
      justin = null;
      teamA = [];
      teamB = [];
      labelA = null;
      labelB = null;
      shaker = null;
      countdown = null;
      banner = null;
    },
  };
};
