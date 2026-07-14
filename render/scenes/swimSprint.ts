/**
 * SCENE — SWIM SPRINT (the render half of lib/game/events/swimSprint.ts).
 *
 * Side view of the company pool. Justin swims left→right driven by the
 * server's `progress` (0 = start block, 1 = far wall). Coworkers on the
 * gantry hose him with water guns — pure flavor, not data. When the server
 * says `sinking`, we play the drowning gag: blue face, X eyes, ~30px lower,
 * bubbles. When fx "sink" fires we add the big splash and a screen kick.
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
  makeDrownedHead,
  makeJointedLimb,
  makeJustinHead,
  springTo,
} from "../toolkit";
import type { SpringState } from "../toolkit";

/* Fonts mirror the CSS tokens in app/globals.css — Pixi draws to canvas and
 * can't read CSS variables, so we repeat the font stacks here. */
const DISPLAY_FONT = '"Arial Narrow", "Helvetica Neue", "Roboto Condensed", sans-serif';
const MONO_FONT = '"SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, monospace';

/* Water shades derived from the pool token (no CSS equivalents exist). */
const WATER_SURFACE = 0xa9d6ef; // sunlight on the surface line
const POOL_DEEP = 0x225f8a; // the deep end reads darker
const BUBBLE = 0xcfe8f7; // drowning-gag bubbles
const EDGE_GREY = 0x4b535b; // aluminum-600
const INK_DARK = 0x101214; // aluminum-950

const HALF_PI = Math.PI / 2;
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const WIN_TEXT = "TOUCHED THE WALL";
const LOSE_TEXT = "SOAKED AND SUNK";

/** One tiny water-gun coworker on the gantry, with a personal fire timer. */
interface Gunner {
  fig: Container;
  cooldownMs: number;
}

export const swimSprintScene: SceneFactory = () => {
  /* ── refs shared between mount() and update() ─────────────────────────── */
  let services: SceneServices;
  let w = 0;
  let h = 0;

  // Display objects. `world` holds everything the Shaker rattles; the
  // overlay sits outside it so text stays steady during impacts.
  let world: Container;
  let stageBack: Graphics; // water, deck, block, wall, pad (redrawn on resize)
  let ropes: Graphics; // dashed lane ropes (redrawn on resize)
  let surface: Graphics; // wavy surface line (redrawn every frame)
  let crowd: Container;
  let gunners: Gunner[] = [];
  let swimmer: Container;
  let headNormal: Container;
  let headDrowned: Container;
  let fxLayer: Container;
  let particles: ParticleBurst;
  let shaker: Shaker;

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
  let surfaceY = 0;
  let deckY = 0;
  let startX = 0;
  let endX = 0;

  // Animation state
  const xSpring: SpringState = { value: 0, velocity: 0 };
  const sinkOffset: SpringState = { value: 0, velocity: 0 }; // extra depth while drowning
  const tilt: SpringState = { value: 0, velocity: 0 }; // head-down tilt while drowning
  const countScale: SpringState = { value: 1, velocity: 0 };
  const bannerScale: SpringState = { value: 1, velocity: 0 };
  const miracleScale: SpringState = { value: 1, velocity: 0 };
  let lastProgress = 0;
  let sinkingShown = false; // last `sinking` the server told us (held while frozen)
  let bobPhase = 0;
  let wavePhase = 0;
  let prevX = 0;
  let smoothedSpeed = 0; // px/sec, drives splash intensity
  let splashCooldownMs = 0;
  let bubbleCooldownMs = 0;
  let armFlip = false; // alternating stroke splashes
  let lastCount = -1;
  let outcomeShown = false;
  let lastAccent: number = COLORS.support;
  let miracleTimer = 0;

  /* ── builders ─────────────────────────────────────────────────────────── */

  function buildSwimmer(): void {
    swimmer = new Container();
    const rearLeg = makeJointedLimb(
      [[-35, 4], [-50, -1], [-64, 3]],
      { width: 6, color: 0x18212a, highlight: COLORS.aluminum },
    );
    const leadLeg = makeJointedLimb(
      [[-34, 8], [-49, 14], [-63, 10]],
      { width: 6.5, color: 0x26313b, highlight: COLORS.aluminumLight },
    );
    const rearArm = makeJointedLimb(
      [[-6, 5], [-20, 15], [-33, 11]],
      { width: 6, color: 0x26313b, endColor: COLORS.skin, highlight: COLORS.aluminum },
    );
    // The office torso is drawn upright by makeBody, so we lie it flat:
    // rotating +90° makes it trail LEFT behind the head (he swims right).
    const body = makeBody(30, 46);
    body.rotation = HALF_PI;
    body.position.set(-8, 4);
    const leadArm = makeJointedLimb(
      [[-1, -4], [9, -13], [22, -9]],
      { width: 6.5, color: 0x33404b, endColor: COLORS.skin, highlight: COLORS.aluminumLight },
    );
    headNormal = makeJustinHead(40, services.photoUrl);
    headNormal.position.set(12, -2);
    headDrowned = makeDrownedHead(40); // blue face + X eyes, shown while sinking
    headDrowned.position.set(12, -2);
    headDrowned.visible = false;
    swimmer.addChild(rearLeg, leadLeg, rearArm, body, leadArm, headNormal, headDrowned);
  }

  function makeGunnerFigure(variant: number): Container {
    // Compact but fully modeled arena crew: planted boots, layered uniform,
    // a lit face plane and both hands controlling the water cannon.
    const fig = new Container();
    const skinTones = [COLORS.skin, 0x8f5d43, 0xe4b281, 0xc78964];
    const skinLights = [COLORS.skinLight, 0xbd8465, 0xf2cda5, 0xe6af87];
    const hairTones = [0x2b211c, 0x15191d, 0x6a4930, 0x403129];
    const skin = skinTones[variant % skinTones.length];
    const skinLight = skinLights[variant % skinLights.length];
    const hair = hairTones[variant % hairTones.length];
    const shadow = new Graphics().ellipse(0, 5, 11, 2.5).fill({ color: COLORS.void, alpha: 0.55 });
    const legs = new Graphics()
      .roundRect(-6, -2, 5, 8, 2)
      .fill({ color: 0x1b252e })
      .roundRect(1, -2, 5, 8, 2)
      .fill({ color: 0x26313b })
      .roundRect(-7, 3, 7, 3, 1.5)
      .fill({ color: COLORS.void })
      .roundRect(1, 3, 7, 3, 1.5)
      .fill({ color: COLORS.void });
    const shirt = new Graphics()
      .roundRect(-7, -14, 14, 15, 4)
      .fill({ color: COLORS.void })
      .roundRect(-5.5, -13, 11, 13, 3)
      .fill({ color: COLORS.memo })
      .poly([-5, -13, 0, -8, 0, 0, -5, -2])
      .fill({ color: COLORS.aluminum, alpha: 0.48 })
      .rect(-5, -1, 10, 2)
      .fill({ color: COLORS.pool, alpha: 0.7 });
    const head = new Graphics()
      .circle(0, -20, 6.5)
      .fill({ color: COLORS.void })
      .ellipse(0, -20, 5.2, 6)
      .fill({ color: skin })
      .ellipse(-1.8, -22, 2.6, 2.1)
      .fill({ color: skinLight, alpha: 0.4 })
      .arc(0, -20, 5.3, Math.PI * 1.02, Math.PI * 1.94)
      .stroke({ width: 2.2, color: hair })
      .circle(1.8, -20.5, 0.65)
      .fill({ color: COLORS.void });
    const arm = makeJointedLimb(
      [[3, -11], [8, -8], [10, -6]],
      {
        width: 3.2,
        color: COLORS.aluminumDark,
        endColor: skin,
        endHighlight: skinLight,
        highlight: COLORS.aluminumLight,
      },
    );
    const gun = new Graphics()
      .roundRect(0, -2.5, 14, 5, 2.5)
      .fill({ color: COLORS.void })
      .roundRect(1, -1.5, 12, 3, 1.5)
      .fill({ color: COLORS.pool })
      .circle(11, 0, 1.2)
      .fill({ color: WATER_SURFACE })
      .rect(2, 1.5, 4, 5)
      .fill({ color: COLORS.aluminumDark });
    gun.position.set(2, -8);
    gun.rotation = 0.7; // aimed down into the pool
    fig.addChild(shadow, legs, shirt, head, arm, gun);
    return fig;
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
    surfaceY = h * 0.52;
    deckY = surfaceY - 34;
    const justinScale = w < 560 || h < 300 ? 1.2 : 1.25;
    swimmer.scale.set(justinScale);
    // Scaling is centered on the swimmer's motion origin. Narrow canvases get
    // a compensated starting inset so the longer trailing kick stays visible.
    startX = Math.max(justinScale === 1.2 ? 86 : 70, w * 0.12);
    endX = w - 48; // stops just short of the touch pad

    // Static pool furniture, redrawn from scratch on resize.
    stageBack.clear();
    // Water body + a darker deep-end band.
    stageBack.rect(0, surfaceY, w, h - surfaceY).fill({ color: COLORS.pool, alpha: 0.85 });
    stageBack.rect(0, h * 0.82, w, h * 0.18).fill({ color: POOL_DEEP, alpha: 0.6 });
    // The gantry the water-gun crowd stands on.
    stageBack.moveTo(0, deckY).lineTo(w, deckY).stroke({ width: 2, color: COLORS.aluminumDark });
    // Start block (left) — a small aluminum trapezoid on the pool edge.
    stageBack
      .poly([12, surfaceY, 56, surfaceY, 50, surfaceY - 24, 18, surfaceY - 24])
      .fill({ color: COLORS.aluminum })
      .moveTo(18, surfaceY - 24)
      .lineTo(50, surfaceY - 24)
      .stroke({ width: 2, color: COLORS.aluminumLight });
    // Far wall (right).
    stageBack.rect(w - 24, surfaceY - 34, 24, h - surfaceY + 34).fill({ color: COLORS.aluminumDark });
    // Checkered touch pad on the wall face — the finish line.
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 2; col++) {
        const dark = (row + col) % 2 === 0;
        stageBack
          .rect(w - 33 + col * 9, surfaceY + 2 + row * 9, 9, 9)
          .fill({ color: dark ? INK_DARK : COLORS.memo });
      }
    }

    // Lane ropes: dashed lines, alternating memo/grievance like real lane
    // floats. Each dash is its own stroke so the colors can alternate.
    ropes.clear();
    const ropeYs = [surfaceY + (h - surfaceY) * 0.4, surfaceY + (h - surfaceY) * 0.75];
    for (const y of ropeYs) {
      for (let x = 0, i = 0; x < w; x += 24, i++) {
        ropes
          .moveTo(x, y)
          .lineTo(x + 12, y)
          .stroke({ width: 3, color: i % 2 ? COLORS.grievance : COLORS.memo, alpha: 0.4 });
      }
    }

    // Spread the crowd along the gantry; their feet (+5 local) sit on it.
    const fracs = [0.26, 0.42, 0.58, 0.72];
    gunners.forEach((g, i) => g.fig.position.set(w * (fracs[i] ?? 0.5), deckY - 5));

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
  }

  /** Wavy surface line — the ONE thing we redraw every frame. Cheap. */
  function drawSurface(): void {
    surface.clear();
    surface.moveTo(0, surfaceY + Math.sin(wavePhase) * 3);
    for (let x = 8; x <= w + 8; x += 8) {
      surface.lineTo(x, surfaceY + Math.sin(wavePhase + x * 0.045) * 3);
    }
    surface.stroke({ width: 3, color: WATER_SURFACE, alpha: 0.9 });
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
          y: h * 0.3,
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
      x: swimmer.x,
      y: swimmer.y - 20,
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

  /** The fx "sink" moment: one big splash and a screen kick. */
  function playSinkImpact(): void {
    particles.burst({
      x: swimmer.x,
      y: surfaceY,
      count: services.reducedMotion ? 18 : 36,
      color: [COLORS.memo, COLORS.drownBlue, COLORS.pool],
      angle: -HALF_PI,
      spread: Math.PI * 0.9,
      speed: 300,
      gravity: 600,
      size: 4,
      lifeMs: 800,
    });
    if (!services.reducedMotion) shaker.kick(8);
  }

  /* ── the Scene object ─────────────────────────────────────────────────── */

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      w = width;
      h = height;

      world = new Container();
      stageBack = new Graphics();
      ropes = new Graphics();
      surface = new Graphics();
      crowd = new Container();
      gunners = [];
      for (let i = 0; i < 4; i++) {
        const fig = makeGunnerFigure(i);
        crowd.addChild(fig);
        // Staggered start times so they never fire in perfect sync.
        gunners.push({ fig, cooldownMs: 250 + i * 180 });
      }
      buildSwimmer();
      fxLayer = new Container();
      particles = new ParticleBurst(fxLayer);
      shaker = new Shaker(world);
      buildOverlay();

      // Draw order: pool → ropes → crowd → swimmer → surface line (in FRONT
      // of the swimmer, so he reads as half-submerged) → particles.
      world.addChild(stageBack, ropes, crowd, swimmer, surface, fxLayer);
      stage.addChild(world, overlay);

      layout();
      xSpring.value = startX;
      prevX = startX;
      swimmer.position.set(startX, surfaceY + 6);
      drawSurface();
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
        if (f.type === "miracle") playMiracle();
        if (f.type === "sink") playSinkImpact();
      }

      // 1. Read the authoritative view — unless the result banner is up.
      if (!frozen && args.view) {
        if (typeof args.view.progress === "number") lastProgress = args.view.progress;
        sinkingShown = args.view.sinking === true;
      }

      // 2. Glide toward the progress-mapped x. The spring makes the sink
      //    penalty (a sudden progress drop) look like being knocked back.
      springTo(xSpring, lerp(startX, endX, lastProgress), args.dtMs, 110, 16);
      const instSpeed = args.dtMs > 0 ? ((xSpring.value - prevX) / args.dtMs) * 1000 : 0;
      prevX = xSpring.value;
      smoothedSpeed = smoothedSpeed * 0.9 + Math.max(0, instSpeed) * 0.1;

      // 3. Vertical: gentle surface bob (frozen for reduced motion), plus a
      //    sprung ~30px sink and a head-down tilt while drowning.
      if (active && !services.reducedMotion) bobPhase += args.dtMs * 0.004;
      springTo(sinkOffset, sinkingShown ? 30 : 0, args.dtMs, 100, 14);
      springTo(tilt, sinkingShown ? 0.45 : 0, args.dtMs, 100, 14);
      swimmer.position.set(
        xSpring.value,
        surfaceY + 6 + Math.sin(bobPhase) * 3 + sinkOffset.value,
      );
      swimmer.rotation = tilt.value;
      headNormal.visible = !sinkingShown;
      headDrowned.visible = sinkingShown;

      // 4. The water surface drifts slowly; it stays still for reduced
      //    motion and while the outcome is frozen.
      if (!frozen && !services.reducedMotion) wavePhase += args.dtMs * 0.0018;
      drawSurface();

      // 5. Stroke splashes behind him, sized by how fast he's really moving.
      if (active && !sinkingShown) {
        splashCooldownMs -= args.dtMs;
        if (splashCooldownMs <= 0 && smoothedSpeed > 6) {
          splashCooldownMs = 150;
          armFlip = !armFlip; // alternate arms, alternate splash spots
          const count = 1 + Math.round(clampNum(smoothedSpeed / 60, 0, 3));
          particles.burst({
            x: swimmer.x - (armFlip ? 8 : 28),
            y: surfaceY,
            count: services.reducedMotion ? Math.max(1, Math.round(count / 2)) : count,
            color: COLORS.memo,
            angle: -HALF_PI - 0.6, // up and back
            spread: 0.8,
            speed: 130,
            gravity: 420,
            size: 3,
            lifeMs: 500,
          });
        }
      }

      // 6. Bubbles rise off him while he's under (negative gravity = float).
      if (sinkingShown && !frozen) {
        bubbleCooldownMs -= args.dtMs;
        if (bubbleCooldownMs <= 0) {
          bubbleCooldownMs = 170;
          particles.burst({
            x: swimmer.x + 10,
            y: swimmer.y - 6,
            count: services.reducedMotion ? 1 : 2,
            color: [BUBBLE, COLORS.drownBlue],
            angle: -HALF_PI,
            spread: 0.5,
            speed: 70,
            gravity: -60,
            size: 3,
            lifeMs: 900,
          });
        }
      }

      // 7. The crowd hoses him on a lazy ~700ms cycle. Flavor only — the
      //    server never tells us who is squirting whom.
      if (active) {
        for (const g of gunners) {
          g.cooldownMs -= args.dtMs;
          if (g.cooldownMs > 0) continue;
          g.cooldownMs = 700 + Math.random() * 150;
          const muzzleX = g.fig.x + 12;
          const muzzleY = g.fig.y - 6;
          const aim = Math.atan2(swimmer.y - muzzleY, swimmer.x - muzzleX);
          particles.burst({
            x: muzzleX,
            y: muzzleY,
            count: services.reducedMotion ? 3 : 6,
            color: [COLORS.pool, WATER_SURFACE],
            angle: aim,
            spread: 0.25,
            speed: 280,
            gravity: 300,
            size: 2.5,
            lifeMs: 450,
          });
        }
      }

      // 8. Overlays, particles, shake.
      updateCountdownOverlay(args);
      updateOutcomeOverlay(args);
      updateMiracleOverlay(args.dtMs);
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
