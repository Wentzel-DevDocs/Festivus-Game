/**
 * SCENE — GREASED CLIMB (the render half of lib/game/events/greasedClimb.ts).
 *
 * Justin hugs the tall aluminum pole and shinnies toward the star at the
 * top, driven by the server's `progress` (0 = ground, 1 = top). We spring
 * his y toward the target with a SOFT spring on purpose: when the server
 * knocks progress down on a grease check, the spring turns that jump into
 * a visible slide down the pole rather than a teleport.
 *
 * Scene lifecycle (see render/core.tsx):
 *   mount()   build the display tree once, keep refs in this closure
 *   update()  runs every frame (~60fps) — all movement happens here
 *   unmount() release what Pixi won't clean up for us (particles)
 */

import { Container, Graphics, Text } from "pixi.js";
import type { SceneFactory, SceneServices, SceneUpdateArgs } from "../core";
import type { Snapshot } from "@/lib/realtime/protocol";
import {
  COLORS,
  CONFETTI_COLORS,
  ParticleBurst,
  Shaker,
  makeBody,
  makeJointedLimb,
  makeJustinHead,
  makePole,
  springTo,
} from "../toolkit";
import type { SpringState } from "../toolkit";
import { CinematicAtmosphere } from "./atmosphere";

/* Fonts mirror the CSS tokens in app/globals.css — Pixi draws to canvas and
 * can't read CSS variables, so we repeat the font stacks here. */
const DISPLAY_FONT = '"Arial Narrow", "Helvetica Neue", "Roboto Condensed", sans-serif';
const MONO_FONT = '"SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, monospace';

const EDGE_GREY = 0x4b535b; // aluminum-600
const INK_DARK = 0x101214; // aluminum-950
const TROUSER_GREY = 0x3a3f45; // office slacks

const HALF_PI = Math.PI / 2;
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const WIN_TEXT = "REACHED THE TOP";
const LOSE_TEXT = "GREASED TO THE FLOOR";

/** One grease glint on the pole — position picked once, then fixed. */
interface Glint {
  frac: number; // 0..1 height up the pole
  dx: number; // small horizontal offset so they aren't in a razor line
  rx: number; // ellipse half-width
}

export const greasedClimbScene: SceneFactory = () => {
  /* ── refs shared between mount() and update() ─────────────────────────── */
  let services: SceneServices;
  let w = 0;
  let h = 0;

  // Random glint spots, chosen once per scene mount so they never dance.
  const glints: Glint[] = [];
  for (let i = 0; i < 7; i++) {
    glints.push({
      frac: 0.08 + Math.random() * 0.84,
      dx: (Math.random() - 0.5) * 6,
      rx: 6 + Math.random() * 3,
    });
  }

  // Display objects. `world` holds everything the Shaker rattles.
  let world: Container;
  let bg: Graphics; // memo rules + floor + base plate (redrawn on resize)
  let pole: Container;
  let glintsG: Graphics; // grease shine on the pole (redrawn on resize)
  let flag: Container; // the goal at the top
  let justin: Container;
  let smear: Graphics; // brief grease streak left behind by a slip
  let fxLayer: Container;
  let particles: ParticleBurst;
  let shaker: Shaker;
  let atmosphere: CinematicAtmosphere;

  // Overlay (countdown / result banner / miracle flash)
  let overlay: Container;
  let countdown: Container;
  let scrim: Graphics;
  let countNum: Text;
  let countName: Text;
  let countSub: Text;
  let banner: Container;
  let bannerPanel: Graphics;
  let bannerSub: Text;
  let bannerText: Text;
  let miracleText: Text;

  // Layout numbers recomputed whenever the canvas resizes
  let poleX = 0;
  let baseY = 0;
  let poleLen = 0;
  let bottomY = 0; // Justin's torso y at progress 0
  let topY = 0; // Justin's torso y at progress 1

  // Animation state
  const ySpring: SpringState = { value: 0, velocity: 0 }; // SOFT — slips read as slides
  const tilt: SpringState = { value: 0, velocity: 0 };
  const countScale: SpringState = { value: 1, velocity: 0 };
  const bannerScale: SpringState = { value: 1, velocity: 0 };
  const miracleScale: SpringState = { value: 1, velocity: 0 };
  let lastProgress = 0;
  let wobblePhase = 0; // tiny climb sway (skipped for reduced motion)
  let slipTiltMs = 0; // while > 0, Justin tilts in mild alarm
  let smearMs = 0; // while > 0, the grease streak is fading out
  let lastCount = -1;
  let outcomeShown = false;
  let lastAccent: number = COLORS.support;
  let miracleTimer = 0;

  /* ── builders ─────────────────────────────────────────────────────────── */

  function buildJustin(): Container {
    // Origin at his torso center, ON the pole. Alternating near/far limbs
    // wrap around the shaft, creating a readable three-quarter climbing pose.
    const c = new Container();
    const rearLeg = makeJointedLimb(
      [[7, 7], [17, 15], [7, 23]],
      { width: 6, color: TROUSER_GREY, highlight: COLORS.aluminum },
    );
    const rearArm = makeJointedLimb(
      [[8, -18], [19, -11], [3, -3]],
      { width: 6, color: 0x26313b, endColor: COLORS.skin, highlight: COLORS.aluminum },
    );
    const body = makeBody(30, 44);
    body.position.set(0, -24); // shirt spans y -24..20
    const leadLeg = makeJointedLimb(
      [[-7, 8], [-18, 17], [-6, 24]],
      { width: 6.5, color: 0x1b252e, highlight: COLORS.aluminumLight },
    );
    const boots = new Graphics()
      .roundRect(-11, 19, 12, 7, 3)
      .fill({ color: COLORS.void })
      .roundRect(1, 19, 12, 7, 3)
      .fill({ color: COLORS.void })
      .moveTo(-9, 20)
      .lineTo(-2, 20)
      .moveTo(3, 20)
      .lineTo(10, 20)
      .stroke({ width: 1, color: COLORS.aluminumLight, alpha: 0.45 });
    const leadArm = makeJointedLimb(
      [[-8, -20], [-20, -14], [-3, -8]],
      { width: 6.5, color: 0x33404b, endColor: COLORS.skin, highlight: COLORS.aluminumLight },
    );
    const head = makeJustinHead(40, services.photoUrl);
    head.position.set(0, -44);
    c.addChild(rearLeg, rearArm, body, leadLeg, boots, leadArm, head);
    return c;
  }

  function buildFlag(): Container {
    // A grievance-red pennant with a little gold finial — the goal.
    const c = new Container();
    const finial = new Graphics().circle(0, 0, 5).fill({ color: COLORS.grease });
    const pennant = new Graphics()
      .poly([2, 2, 30, 10, 2, 18])
      .fill({ color: COLORS.grievance })
      .stroke({ width: 1, color: COLORS.memo, alpha: 0.6 });
    c.addChild(pennant, finial);
    return c;
  }

  function buildOverlay(): void {
    overlay = new Container();

    countdown = new Container();
    scrim = new Graphics();
    countNum = new Text({
      text: "3",
      style: { fontFamily: DISPLAY_FONT, fontSize: 96, fontWeight: "700", fill: COLORS.memo },
    });
    countNum.anchor.set(0.5);
    countName = new Text({
      text: "",
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: 28,
        fontWeight: "700",
        fill: COLORS.aluminumLight,
        letterSpacing: 4,
      },
    });
    countName.anchor.set(0.5);
    countSub = new Text({
      text: "",
      style: { fontFamily: MONO_FONT, fontSize: 13, fill: COLORS.aluminum, letterSpacing: 2 },
    });
    countSub.anchor.set(0.5);
    countdown.addChild(scrim, countNum, countName, countSub);
    countdown.visible = false;

    banner = new Container();
    bannerPanel = new Graphics();
    bannerText = new Text({
      text: WIN_TEXT,
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: 40,
        fontWeight: "700",
        fill: COLORS.support,
        letterSpacing: 3,
      },
    });
    bannerText.anchor.set(0.5);
    bannerSub = new Text({
      text: "OFFICIAL RESULT",
      style: { fontFamily: MONO_FONT, fontSize: 12, fill: EDGE_GREY, letterSpacing: 3 },
    });
    bannerSub.anchor.set(0.5);
    banner.addChild(bannerPanel, bannerSub, bannerText);
    banner.rotation = -0.035;
    banner.visible = false;

    miracleText = new Text({
      text: "FESTIVUS MIRACLE!",
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: 40,
        fontWeight: "700",
        fill: COLORS.grease,
        letterSpacing: 2,
        stroke: { color: INK_DARK, width: 5 },
      },
    });
    miracleText.anchor.set(0.5);
    miracleText.visible = false;

    overlay.addChild(countdown, banner, miracleText);
  }

  /* ── layout: everything that depends on canvas size ──────────────────── */

  function layout(): void {
    poleX = w / 2;
    baseY = h * 0.88;
    poleLen = h * 0.8; // a properly tall pole — ~80% of the screen
    const justinScale = w < 560 || h < 300 ? 1.2 : 1.25;
    justin.scale.set(justinScale);
    bottomY = baseY - 36;
    // Compensate the top endpoint by the enlarged portrait radius. Progress
    // still maps to the same pole range, while his head clears the pennant.
    topY = baseY - poleLen + 26 + (justinScale - 1) * 64;

    // The pole was built at 100px; stretching scale.y keeps its width crisp.
    pole.position.set(poleX, baseY);
    pole.scale.y = poleLen / 100;
    flag.position.set(poleX, baseY - poleLen - 4);

    // Background: faint memo rules, floor line, base plate, grease puddle.
    bg.clear();
    for (let i = 0; i < 3; i++) {
      bg.rect(0, h * (0.14 + i * 0.2), w, 1).fill({ color: COLORS.aluminumDark, alpha: 0.55 });
    }
    bg.rect(0, baseY + 10, w, h - baseY - 10).fill({ color: INK_DARK });
    bg.moveTo(0, baseY + 10).lineTo(w, baseY + 10).stroke({ width: 3, color: COLORS.aluminumDark });
    bg.roundRect(poleX - 42, baseY - 2, 84, 12, 4)
      .fill({ color: COLORS.aluminumDark })
      .stroke({ width: 1, color: EDGE_GREY });
    // Where does the grease come from? Best not to ask. The puddle knows.
    bg.ellipse(poleX + 30, baseY + 14, 26, 5).fill({ color: COLORS.grease, alpha: 0.25 });

    // Grease glints at their fixed fractional heights.
    glintsG.clear();
    for (const g of glints) {
      glintsG
        .ellipse(poleX + g.dx, baseY - g.frac * poleLen, g.rx, 3)
        .fill({ color: COLORS.grease, alpha: 0.5 });
    }

    // Overlay positions + font sizes scale with the canvas.
    scrim.clear().rect(0, 0, w, h).fill({ color: INK_DARK, alpha: 0.55 });
    countNum.style.fontSize = clampNum(h * 0.28, 64, 200);
    countNum.position.set(w / 2, h * 0.38);
    countName.style.fontSize = clampNum(h * 0.055, 18, 40);
    countName.position.set(w / 2, h * 0.58);
    countSub.position.set(w / 2, h * 0.66);
    bannerText.style.fontSize = clampNum(h * 0.07, 22, 52);
    banner.position.set(w / 2, h * 0.3);
    if (banner.visible) redrawBanner(lastAccent);
    miracleText.style.fontSize = clampNum(h * 0.07, 20, 48);
    miracleText.position.set(w / 2, h * 0.18);
    atmosphere.layout(w, h, baseY / h);
  }

  /* ── overlay behaviors ────────────────────────────────────────────────── */

  function updateCountdownOverlay(args: SceneUpdateArgs): void {
    const on = args.snap.phase === "event_countdown";
    countdown.visible = on;
    if (!on) {
      lastCount = -1;
      return;
    }
    // Server clock drives the 3..2..1 so every screen counts in unison.
    const msLeft = Math.max(0, args.snap.phaseEndsAt - args.snap.serverNow);
    const count = Math.max(1, Math.ceil(msLeft / 1000));
    if (count !== lastCount) {
      lastCount = count;
      countNum.text = String(count);
      countScale.value = services.reducedMotion ? 1 : 1.5;
      countScale.velocity = 0;
    }
    springTo(countScale, 1, args.dtMs, 170, 15);
    countNum.scale.set(countScale.value);
    const meta = args.snap.eventMeta;
    countName.text = (meta?.name ?? "").toUpperCase();
    countSub.text = meta ? `FEAT ${meta.index + 1} OF ${meta.total} · ATTENDANCE MANDATORY` : "";
  }

  function winnerFor(snap: Snapshot): "support" | "hinder" {
    // Authoritative result lives in roundResults at this event's index;
    // fall back to the last progress we rendered if it hasn't landed yet.
    const idx = snap.eventMeta?.index ?? -1;
    const result = idx >= 0 ? snap.roundResults[idx] : undefined;
    if (result) return result.winner;
    return lastProgress >= 1 ? "support" : "hinder";
  }

  function redrawBanner(accent: number): void {
    const pw = Math.max(bannerText.width, bannerSub.width) + 72;
    const ph = bannerText.height + 64;
    bannerPanel
      .clear()
      .roundRect(-pw / 2, -ph / 2, pw, ph, 4)
      .fill({ color: COLORS.memo })
      .stroke({ width: 2, color: accent })
      .roundRect(-pw / 2 + 5, -ph / 2 + 5, pw - 10, ph - 10, 3)
      .stroke({ width: 2, color: accent }); // double rule = rubber-stamp energy
    bannerSub.position.set(0, -ph / 2 + 18);
    bannerText.position.set(0, 8);
  }

  function updateOutcomeOverlay(args: SceneUpdateArgs): void {
    const on = args.snap.phase === "event_outcome";
    banner.visible = on;
    if (!on) {
      outcomeShown = false;
      return;
    }
    if (!outcomeShown) {
      outcomeShown = true;
      const supportWon = winnerFor(args.snap) === "support";
      lastAccent = supportWon ? COLORS.support : COLORS.grievance;
      bannerText.text = supportWon ? WIN_TEXT : LOSE_TEXT;
      bannerText.style.fill = lastAccent;
      redrawBanner(lastAccent);
      bannerScale.value = services.reducedMotion ? 1 : 0.6;
      bannerScale.velocity = 0;
      if (supportWon) {
        particles.burst({
          x: w / 2,
          y: h * 0.25,
          count: services.reducedMotion ? 24 : 48,
          color: CONFETTI_COLORS,
          angle: -HALF_PI,
          spread: Math.PI * 0.9,
          speed: 360,
          gravity: 640,
          size: 4,
          lifeMs: 1400,
        });
      }
    }
    springTo(bannerScale, 1, args.dtMs, 140, 13);
    banner.scale.set(bannerScale.value);
  }

  function playMiracle(): void {
    miracleTimer = 1500;
    miracleText.visible = true;
    miracleScale.value = services.reducedMotion ? 1 : 0.4;
    miracleScale.velocity = 0;
    particles.burst({
      x: justin.x,
      y: justin.y,
      count: services.reducedMotion ? 18 : 40,
      color: [COLORS.grease, 0xf0c94a, COLORS.memo],
      angle: -HALF_PI,
      spread: Math.PI * 2, // a full golden halo
      speed: 300,
      gravity: 220,
      size: 4,
      lifeMs: 1100,
    });
  }

  function updateMiracleOverlay(dtMs: number): void {
    if (miracleTimer <= 0) {
      miracleText.visible = false;
      return;
    }
    miracleTimer -= dtMs;
    springTo(miracleScale, 1, dtMs, 150, 12);
    miracleText.scale.set(miracleScale.value);
    miracleText.alpha = clampNum(miracleTimer / 500, 0, 1);
  }

  /** The fx "slip" moment: drips, a fading streak, a small screen kick. */
  function playSlip(): void {
    particles.burst({
      x: justin.x,
      y: justin.y + 18,
      count: services.reducedMotion ? 7 : 14,
      color: COLORS.grease,
      angle: HALF_PI, // straight down — grease obeys gravity, unlike Justin
      spread: 0.6,
      speed: 130,
      gravity: 420,
      size: 3.5,
      lifeMs: 700,
    });
    // Park the streak where the slip started; update() fades it out.
    smear.position.set(poleX, justin.y);
    smearMs = 400;
    slipTiltMs = 500;
    if (!services.reducedMotion) shaker.kick(5);
  }

  /* ── the Scene object ─────────────────────────────────────────────────── */

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      w = width;
      h = height;

      world = new Container();
      bg = new Graphics();
      pole = makePole(100, 12); // built at 100px, stretched to size in layout()
      glintsG = new Graphics();
      flag = buildFlag();
      justin = buildJustin();
      // The slip streak: a grease-colored vertical smudge, hidden until used.
      smear = new Graphics().roundRect(-3, -56, 6, 56, 3).fill({ color: COLORS.grease });
      smear.visible = false;
      fxLayer = new Container();
      particles = new ParticleBurst(fxLayer);
      shaker = new Shaker(world);
      atmosphere = new CinematicAtmosphere(
        { light: 0xf5d479, rim: COLORS.grease, fog: 0x7b858d, ember: 0xffc54f },
        svc.reducedMotion,
        svc.visualDensity,
      );
      buildOverlay();

      // Draw order: bg → pole → glints → smear → Justin (in front, hugging)
      // → flag → particles. Overlay stays outside the shaken world.
      world.addChild(
        bg,
        atmosphere.back,
        pole,
        glintsG,
        smear,
        justin,
        flag,
        atmosphere.front,
        fxLayer,
      );
      stage.addChild(world, overlay);

      layout();
      ySpring.value = bottomY; // start honestly at the bottom of the pole
      justin.position.set(poleX, bottomY);
    },

    update(args: SceneUpdateArgs): void {
      if (args.width !== w || args.height !== h) {
        w = args.width;
        h = args.height;
        layout();
      }

      const active = args.snap.phase === "event_active";
      const frozen = args.snap.phase === "event_outcome"; // hold the pose under the banner

      // Play one-shot effects that arrived since last frame.
      for (const f of args.fx) {
        if (f.type === "miracle") {
          playMiracle();
          atmosphere.impact(1, COLORS.grease);
        }
        if (f.type === "slip") {
          playSlip();
          atmosphere.impact(0.85, COLORS.grease);
        }
      }

      // 1. Read the authoritative view — unless the result banner is up.
      if (!frozen && args.view) {
        if (typeof args.view.progress === "number") lastProgress = args.view.progress;
        // Belt-and-braces: the view's slipping flag backs up the fx event,
        // in case a snapshot beat the fx to our screen.
        if (args.view.slipping === true) slipTiltMs = Math.max(slipTiltMs, 350);
      }

      // 2. Climb. Stiffness 70 is deliberately mushy: when the server yanks
      //    progress down on a slip, this spring turns it into a slide.
      springTo(ySpring, lerp(bottomY, topY, lastProgress), args.dtMs, 70, 12);

      // 3. Tiny climbing sway (skipped for reduced motion) + slip alarm tilt.
      if (active && !services.reducedMotion) wobblePhase += args.dtMs * 0.006;
      slipTiltMs = Math.max(0, slipTiltMs - args.dtMs);
      springTo(tilt, slipTiltMs > 0 ? 0.22 : 0, args.dtMs, 120, 12);
      justin.position.set(poleX + Math.sin(wobblePhase) * 1.5, ySpring.value);
      justin.rotation = tilt.value;

      // 4. Fade the slip streak out over 400ms.
      if (smearMs > 0) {
        smearMs = Math.max(0, smearMs - args.dtMs);
        smear.visible = true;
        smear.alpha = 0.5 * (smearMs / 400);
      } else {
        smear.visible = false;
      }

      // 5. Overlays, particles, shake.
      updateCountdownOverlay(args);
      updateOutcomeOverlay(args);
      updateMiracleOverlay(args.dtMs);
      atmosphere.update(
        args.dtMs,
        args.snap.phase,
        clampNum(Math.abs(ySpring.velocity) / 500 + (slipTiltMs > 0 ? 0.4 : 0), 0, 1),
      );
      particles.update(args.dtMs);
      shaker.update(args.dtMs);
    },

    unmount(): void {
      // GameCanvas destroys our stage children for us; particles keep their
      // own pool, so they are the one thing we must release by hand.
      particles.destroy();
    },
  };
};
