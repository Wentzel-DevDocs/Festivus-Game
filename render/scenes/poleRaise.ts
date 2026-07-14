/**
 * SCENE — POLE RAISE (the render half of lib/game/events/poleRaise.ts).
 *
 * The team's taps raise a bare aluminum pole from flat-on-the-floor to
 * fully upright. This file only DRAWS that story: the authoritative
 * `progress` (0 = flat, 1 = upright) arrives pre-interpolated in
 * args.view, and we spring toward it so the pole feels heavy and alive
 * instead of teleporting between server snapshots.
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

/* Extra greys that exist as CSS tokens but not in toolkit COLORS. */
const PANEL_DARK = 0x23272b; // aluminum-800
const EDGE_GREY = 0x4b535b; // aluminum-600
const TICK_GREY = 0x6b747d; // aluminum-500
const INK_DARK = 0x101214; // aluminum-950

const HALF_PI = Math.PI / 2;
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const WIN_TEXT = "POLE RAISED";
const LOSE_TEXT = "STILL HORIZONTAL";

export const poleRaiseScene: SceneFactory = () => {
  /* ── refs shared between mount() and update() ─────────────────────────── */
  let services: SceneServices;
  let w = 0;
  let h = 0;

  // Display objects
  let bg: Graphics; // memo rules + floor + pivot base (redrawn on resize)
  let pole: Container;
  let justin: Container;
  let gaugeG: Graphics; // gauge track + ticks (redrawn on resize)
  let gaugeFill: Graphics; // redrawn every frame
  let gaugeTitle: Text;
  let gaugeLabel: Text;
  let fxLayer: Container;
  let particles: ParticleBurst;
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
  let floorY = 0;
  let pivotX = 0;
  let poleLen = 0;
  let justinBaseX = 0;
  let justinBaseY = 0;
  let gaugeX = 0;
  let gaugeTop = 0;
  let gaugeBottom = 0;

  // Animation state. Springs start with the pole FLAT so frame one is honest.
  const poleAngle: SpringState = { value: -HALF_PI, velocity: 0 };
  const lean: SpringState = { value: -0.1, velocity: 0 };
  const countScale: SpringState = { value: 1, velocity: 0 };
  const bannerScale: SpringState = { value: 1, velocity: 0 };
  const miracleScale: SpringState = { value: 1, velocity: 0 };
  let lastProgress = 0; // last authoritative progress we saw (also outcome fallback)
  let strain = 0; // 0..1 — how hard Justin is visibly working
  let lastCount = -1;
  let outcomeShown = false;
  let lastAccent: number = COLORS.support;
  let miracleTimer = 0;

  /* ── builders ─────────────────────────────────────────────────────────── */

  function buildJustin(): Container {
    // Origin is at his FEET so leaning rotates around the floor contact
    // point, like a person actually pushing something heavy.
    const c = new Container();
    const rearArm = makeJointedLimb(
      [[7, -45], [-9, -48], [-27, -50]],
      { width: 6, color: 0x26313b, endColor: COLORS.skin, highlight: COLORS.aluminum },
    );
    const leadArm = makeJointedLimb(
      [[-7, -46], [-18, -57], [-31, -61]],
      { width: 6.5, color: 0x33404b, endColor: COLORS.skin, highlight: COLORS.aluminumLight },
    );
    const body = makeBody(34, 52);
    body.position.set(0, -52); // shirt spans y -52..0, feet at 0
    const head = makeJustinHead(46, services.photoUrl);
    head.position.set(0, -74); // just above the shirt collar
    // Rear arm, torso, lead arm gives the pose real overlap and depth while
    // keeping both gloved hands visibly planted on the pole.
    c.addChild(rearArm, body, leadArm, head);
    return c;
  }

  function buildOverlay(): void {
    overlay = new Container();

    // Countdown: dim the stage, show a big number and the event name.
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

    // Result banner: a memo panel with a double rule — rubber-stamp energy.
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
    banner.rotation = -0.035; // stamped slightly crooked, as all stamps are
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
    floorY = h * 0.82;
    pivotX = w * 0.44;
    // Upright must fit the height AND, when flat, the tip must stay onscreen
    // to the left of the pivot — that clamp is what saves phone portrait.
    poleLen = Math.min(h * 0.55, pivotX - 12);

    // The pole was built at 100px; stretching scale.y keeps its width crisp.
    pole.position.set(pivotX, floorY - 10);
    pole.scale.y = poleLen / 100;

    // Feet remain the transform origin, so scaling adds broadcast presence
    // without changing the floor contact or the lean physics. The x offset
    // scales with his reaching arm, keeping both hands planted on the pole.
    const justinScale = w < 560 || h < 300 ? 1.2 : 1.3;
    justin.scale.set(justinScale);
    justinBaseX = pivotX + 44 * justinScale;
    justinBaseY = floorY;
    justin.position.set(justinBaseX, justinBaseY);

    // Background: faint memo rules, the under-floor, the floor, a pivot base.
    bg.clear();
    for (let i = 0; i < 4; i++) {
      bg.rect(0, h * (0.12 + i * 0.15), w, 1).fill({ color: COLORS.aluminumDark, alpha: 0.55 });
    }
    bg.rect(0, floorY, w, h - floorY).fill({ color: INK_DARK });
    bg.moveTo(0, floorY).lineTo(w, floorY).stroke({ width: 3, color: COLORS.aluminumDark });
    bg.poly([
      pivotX - 30, floorY,
      pivotX + 30, floorY,
      pivotX + 18, floorY - 14,
      pivotX - 18, floorY - 14,
    ])
      .fill({ color: COLORS.aluminumDark })
      .stroke({ width: 1, color: EDGE_GREY });

    // Right-edge progress gauge with mono tick marks.
    gaugeX = w - 30;
    gaugeTop = h * 0.18;
    gaugeBottom = h * 0.76;
    gaugeG
      .clear()
      .roundRect(gaugeX - 7, gaugeTop - 4, 14, gaugeBottom - gaugeTop + 8, 7)
      .fill({ color: PANEL_DARK })
      .stroke({ width: 1, color: EDGE_GREY });
    for (let i = 0; i <= 10; i++) {
      const y = lerp(gaugeBottom, gaugeTop, i / 10);
      const len = i % 5 === 0 ? 10 : 6; // longer tick every 50%
      gaugeG.moveTo(gaugeX - 11 - len, y).lineTo(gaugeX - 11, y).stroke({ width: 1, color: TICK_GREY });
    }
    gaugeTitle.position.set(gaugeX, gaugeTop - 18);
    gaugeLabel.position.set(gaugeX, gaugeBottom + 18);

    // Overlay positions + font sizes scale with the canvas.
    scrim.clear().rect(0, 0, w, h).fill({ color: INK_DARK, alpha: 0.55 });
    countNum.style.fontSize = clampNum(h * 0.28, 64, 200);
    countNum.position.set(w / 2, h * 0.38);
    countName.style.fontSize = clampNum(h * 0.055, 18, 40);
    countName.position.set(w / 2, h * 0.58);
    countSub.position.set(w / 2, h * 0.66);
    bannerText.style.fontSize = clampNum(h * 0.07, 22, 52);
    banner.position.set(w / 2, h * 0.34);
    if (banner.visible) redrawBanner(lastAccent); // keep the panel fitting its text
    miracleText.style.fontSize = clampNum(h * 0.07, 20, 48);
    miracleText.position.set(w / 2, h * 0.2);
    atmosphere.layout(w, h, floorY / h);
  }

  /* ── overlay behaviors ────────────────────────────────────────────────── */

  function updateCountdownOverlay(args: SceneUpdateArgs): void {
    const on = args.snap.phase === "event_countdown";
    countdown.visible = on;
    if (!on) {
      lastCount = -1;
      return;
    }
    // The big 3..2..1 comes from the server clock, not a local timer, so
    // every screen in the room counts in unison.
    const msLeft = Math.max(0, args.snap.phaseEndsAt - args.snap.serverNow);
    const count = Math.max(1, Math.ceil(msLeft / 1000));
    if (count !== lastCount) {
      lastCount = count;
      countNum.text = String(count);
      // Pop each new digit in with a spring; reduced motion gets no pop.
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
    // The authoritative result for THIS event lives in roundResults at the
    // event's own index. If the list hasn't caught up yet (a snapshot race,
    // not an error) fall back to the last progress we rendered.
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
      .stroke({ width: 2, color: accent });
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
      // First outcome frame: pick the verdict once, then just let it sit.
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
      x: pivotX,
      y: h * 0.4,
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
    miracleText.alpha = clampNum(miracleTimer / 500, 0, 1); // fade the last half-second
  }

  /* ── the Scene object ─────────────────────────────────────────────────── */

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      w = width;
      h = height;

      bg = new Graphics();
      pole = makePole(100, 10); // built at 100px, stretched to size in layout()
      justin = buildJustin();
      gaugeG = new Graphics();
      gaugeFill = new Graphics();
      gaugeTitle = new Text({
        text: "RAISE",
        style: { fontFamily: MONO_FONT, fontSize: 10, fill: TICK_GREY, letterSpacing: 2 },
      });
      gaugeTitle.anchor.set(0.5);
      gaugeLabel = new Text({
        text: "000%",
        style: { fontFamily: MONO_FONT, fontSize: 13, fill: COLORS.memo },
      });
      gaugeLabel.anchor.set(0.5);
      fxLayer = new Container();
      particles = new ParticleBurst(fxLayer);
      atmosphere = new CinematicAtmosphere(
        { light: 0xf2c96d, rim: COLORS.support, fog: 0x71808c, ember: COLORS.grease },
        svc.reducedMotion,
        svc.visualDensity,
      );
      buildOverlay();

      stage.addChild(
        bg,
        atmosphere.back,
        pole,
        justin,
        gaugeG,
        gaugeFill,
        gaugeTitle,
        gaugeLabel,
        atmosphere.front,
        fxLayer,
        overlay,
      );
      layout();
    },

    update(args: SceneUpdateArgs): void {
      if (args.width !== w || args.height !== h) {
        w = args.width;
        h = args.height;
        layout();
      }

      const frozen = args.snap.phase === "event_outcome"; // hold the pose under the banner

      // Play one-shot effects that arrived since last frame.
      for (const f of args.fx) {
        if (f.type === "miracle") {
          playMiracle();
          atmosphere.impact(1, COLORS.grease);
        }
      }

      // 1. Read the authoritative progress — unless the result banner is up,
      //    in which case we freeze on whatever we showed last.
      const target =
        !frozen && typeof args.view?.progress === "number" ? args.view.progress : lastProgress;

      // 2. Strain is proportional to how FAST progress is moving right now.
      //    (instSpeed is progress-per-second; ~0.25/s is a hard team push.)
      const instSpeed = args.dtMs > 0 ? Math.abs(target - lastProgress) / (args.dtMs / 1000) : 0;
      lastProgress = target;
      strain = strain * 0.9 + clampNum(instSpeed * 4, 0, 1) * 0.1;

      // 3. The pole springs toward its target angle: -90° flat → 0° upright.
      springTo(poleAngle, (lastProgress - 1) * HALF_PI, args.dtMs, 90, 12);
      pole.rotation = poleAngle.value;

      // 4. Justin leans harder the harder the team pushes, plus a 2px effort
      //    jitter (skipped entirely for reduced motion).
      springTo(lean, -(0.1 + strain * 0.35), args.dtMs, 120, 14);
      justin.rotation = lean.value;
      if (!services.reducedMotion && strain > 0.02) {
        justin.position.set(
          justinBaseX + (Math.random() - 0.5) * 4 * strain,
          justinBaseY + (Math.random() - 0.5) * 2 * strain,
        );
      } else {
        justin.position.set(justinBaseX, justinBaseY);
      }

      // 5. Gauge fill mirrors the DISPLAYED pole angle (not the raw target)
      //    so the two never disagree on screen.
      const shown = clampNum(poleAngle.value / HALF_PI + 1, 0, 1);
      gaugeFill.clear();
      const fillH = (gaugeBottom - gaugeTop) * shown;
      if (fillH > 1) {
        gaugeFill
          .roundRect(gaugeX - 4, gaugeBottom - fillH, 8, fillH, Math.min(4, fillH / 2))
          .fill({ color: COLORS.support });
      }
      gaugeLabel.text = `${String(Math.round(shown * 100)).padStart(3, "0")}%`;

      // 6. Overlays + particles.
      updateCountdownOverlay(args);
      updateOutcomeOverlay(args);
      updateMiracleOverlay(args.dtMs);
      atmosphere.update(args.dtMs, args.snap.phase, strain);
      particles.update(args.dtMs);
    },

    unmount(): void {
      // GameCanvas destroys our stage children for us; particles keep their
      // own pool, so they are the one thing we must release by hand.
      particles.destroy();
    },
  };
};
