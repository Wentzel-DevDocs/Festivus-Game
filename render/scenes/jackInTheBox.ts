/**
 * SCENE — JACK-IN-THE-BOX (the finale punchline).
 *
 * Unlike the event scenes, this one gets NO event view: it is a pure
 * client-side animation driven by a local clock we accumulate in update(),
 * plus snap.phase. It plays during "finale" and simply holds its popped end
 * pose during "splash" (GameCanvas keeps the same scene mounted for both).
 *
 * The sequence:
 *   0 – 2.5 s   a forged aluminum runtime reliquary; the side crank winds
 *               faster and faster while the box wobbles harder and harder
 *   2.5 s       the LID BURSTS off (up and to the left, spinning), Justin's
 *               head rockets up on a low-damping spring, confetti ×2
 *   after       the head boings and slowly settles on its coil while
 *               "HAPPY FESTIVUS" fades in above
 *
 * This is the ONE deliberately over-the-top moment of the whole game, so
 * the pop is tuned to be unreasonably juicy. Under reducedMotion we skip
 * the shaking and jump to the popped state almost immediately.
 *
 * If a boss screen refreshes mid-finale the wind-up simply replays from
 * zero — harmless. If it arrives during "splash" we jump straight to the
 * settled end pose instead of replaying the pop (see the phase check).
 */

import { Container, Graphics, Text } from "pixi.js";
import type { SceneFactory, SceneServices } from "../core";
import {
  COLORS,
  CONFETTI_COLORS,
  makeJustinHead,
  ParticleBurst,
  Shaker,
  springTo,
} from "../toolkit";
import type { SpringState } from "../toolkit";

const ALUMINUM_300 = 0xb8bfc6; // --color-aluminum-300 from globals.css
const GOLD = 0xd9a514;
const SIGNAL_CYAN = 0x49c7dc;
const SIGNAL_BLUE = 0x4d86d9;
const SIGNAL_GREEN = 0x43c77a;
const CITADEL_BLACK = 0x070b11;
const FORGED_DARK = 0x121a23;
const FORGED_MID = 0x25313c;

const DISPLAY_FONT = ["Arial Narrow", "Helvetica Neue", "Roboto Condensed", "sans-serif"];
const MONO_FONT = ["ui-monospace", "SF Mono", "Cascadia Mono", "Roboto Mono", "Menlo", "monospace"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/* ── Festivus-miracle flash ────────────────────────────────────────────────
 * Miracles are an event-phase thing and never fire during the finale, but
 * every scene honors the fx contract; each carries its own small copy.    */
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
    this.cy = height * 0.34;
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

/* ── The scene ────────────────────────────────────────────────────────────── */

export const jackInTheBoxScene: SceneFactory = () => {
  let services: SceneServices | null = null;
  let world: Container | null = null;
  let overlay: Container | null = null;

  // Aluminum Citadel environment. Everything here is decorative and local;
  // the finale never reads roster, side, tap, or event-view data.
  let environmentG: Graphics | null = null;
  let auraG: Graphics | null = null;
  let runeWheel: Container | null = null;
  let runeG: Graphics | null = null;
  let foregroundG: Graphics | null = null;
  let statusPips: Graphics[] = [];
  let finaleStatus: Text | null = null;

  // The box: an outer container carries the position; the INNER container
  // is what the Shaker rattles (Shaker writes .position directly, so its
  // target must rest at (0,0)).
  let boxC: Container | null = null;
  let boxInner: Container | null = null;
  let faceG: Graphics | null = null;
  let corePulseG: Graphics | null = null;
  let boxLabel: Text | null = null;
  let crank: Container | null = null;
  let lidC: Container | null = null;
  let lidG: Graphics | null = null;

  let springG: Graphics | null = null; // the coil, redrawn every frame
  let head: Container | null = null; // Justin, BIG
  let happy: Text | null = null;
  let happySub: Text | null = null;

  let confetti: ParticleBurst | null = null;
  let shaker: Shaker | null = null;
  let miracle: MiracleFlash | null = null;

  // Layout facts.
  let cx = 0;
  let boxW = 0;
  let boxH = 0;
  let boxBaseY = 0;
  let boxTopY = 0;
  let restY = 0; // where the head hangs once the spring settles
  let headWorldSize = 120;
  let lastW = 0;
  let lastH = 0;

  // Animation state.
  let elapsed = 0; // our local clock (ms) — the whole scene runs on this
  let popped = false;
  let popAt = 0; // `elapsed` at the moment of the pop
  let secondBurstIn = -1; // countdown to the staggered second confetti burst
  const headSpring: SpringState = { value: 0, velocity: 0 };
  let lidVel: { vx: number; vy: number; spin: number } | null = null;

  function layout(w: number, h: number): void {
    if (
      !boxC ||
      !faceG ||
      !corePulseG ||
      !lidC ||
      !lidG ||
      !crank ||
      !boxLabel ||
      !head ||
      !happy ||
      !happySub ||
      !environmentG ||
      !auraG ||
      !runeWheel ||
      !runeG ||
      !foregroundG ||
      !finaleStatus
    ) {
      return;
    }

    cx = w / 2;
    boxW = clamp(Math.min(w, h) * 0.3, 120, 210);
    boxH = boxW * 0.9;
    boxBaseY = h * 0.68;
    boxTopY = boxBaseY - boxH;
    headWorldSize = clamp(Math.min(w, h) * 0.3, 84, 132); // "BIG ~120px"
    // The head settles well above the box but never off the top edge.
    restY = Math.max(headWorldSize * 0.75, boxTopY - h * 0.32);

    // Citadel chamber: carved side pylons, abstract deployment traces and a
    // perspective floor. All vectors are rebuilt only on resize.
    const horizonY = h * 0.58;
    const floorY = h * 0.79;
    environmentG
      .clear()
      .rect(0, 0, w, h)
      .fill({ color: CITADEL_BLACK, alpha: 0.24 })
      .rect(0, floorY, w, h - floorY)
      .fill({ color: CITADEL_BLACK, alpha: 0.56 })
      .moveTo(0, floorY)
      .lineTo(w, floorY)
      .stroke({ width: 2, color: COLORS.aluminumDark, alpha: 0.48 });

    for (let i = 0; i < 3; i++) {
      const inset = i * w * 0.055;
      const top = h * (0.1 + i * 0.055);
      const innerX = w * (0.18 + i * 0.045);
      environmentG
        .poly([inset, 0, innerX, 0, innerX - w * 0.035, h, inset, h])
        .fill({ color: FORGED_DARK, alpha: 0.18 + i * 0.05 })
        .poly([w - inset, 0, w - innerX, 0, w - innerX + w * 0.035, h, w - inset, h])
        .fill({ color: FORGED_DARK, alpha: 0.18 + i * 0.05 })
        .moveTo(innerX, top)
        .lineTo(innerX - w * 0.025, h)
        .moveTo(w - innerX, top)
        .lineTo(w - innerX + w * 0.025, h)
        .stroke({ width: 1, color: COLORS.aluminum, alpha: 0.12 + i * 0.04 });
    }

    // Floor grid converges behind the reliquary and gives the pop real depth.
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const y = floorY + (h - floorY) * t * t;
      environmentG.moveTo(w * 0.04, y).lineTo(w * 0.96, y);
    }
    for (let i = -6; i <= 6; i++) {
      environmentG
        .moveTo(cx + i * w * 0.012, horizonY)
        .lineTo(cx + i * w * 0.09, h);
    }
    environmentG.stroke({ width: 1, color: SIGNAL_BLUE, alpha: 0.12 });

    // Side-channel deployment traces terminate at the central seal. They are
    // fixed runes, not visualizations of real services or people.
    const traceY = [h * 0.3, h * 0.42, h * 0.55];
    for (let i = 0; i < traceY.length; i++) {
      const y = traceY[i];
      const accent = i === 0 ? SIGNAL_CYAN : i === 1 ? SIGNAL_GREEN : GOLD;
      const stop = cx - boxW * (0.78 + i * 0.08);
      environmentG
        .moveTo(w * 0.035, y)
        .lineTo(stop - 24, y)
        .lineTo(stop, y + (i - 1) * 18)
        .moveTo(w * 0.965, y)
        .lineTo(w - stop + 24, y)
        .lineTo(w - stop, y + (i - 1) * 18)
        .stroke({ width: 1.5, color: accent, alpha: 0.25 })
        .circle(w * 0.035, y, 3)
        .fill({ color: accent, alpha: 0.72 })
        .circle(w * 0.965, y, 3)
        .fill({ color: accent, alpha: 0.72 });
    }

    // Layered light behind the box and eventual portrait—fake bloom with
    // translucent geometry, avoiding filters on controller GPUs.
    auraG
      .clear()
      .ellipse(cx, boxTopY + boxH * 0.28, boxW * 1.15, boxH * 1.05)
      .fill({ color: SIGNAL_BLUE, alpha: 0.035 })
      .ellipse(cx, boxTopY + boxH * 0.26, boxW * 0.82, boxH * 0.76)
      .fill({ color: SIGNAL_CYAN, alpha: 0.045 })
      .poly([
        cx - boxW * 0.16, 0,
        cx + boxW * 0.16, 0,
        cx + boxW * 0.54, boxBaseY,
        cx - boxW * 0.54, boxBaseY,
      ])
      .fill({ color: GOLD, alpha: 0.018 });

    // Broken orbital seal: the reliquary is the final node in the ceremonial
    // runtime. Pips are separate retained objects so update() can pulse them.
    const runeR = boxW * 0.77;
    runeWheel.position.set(cx, boxTopY + boxH * 0.34);
    runeG
      .clear()
      .arc(0, 0, runeR, -Math.PI * 0.12, Math.PI * 0.54)
      .stroke({ width: 1.5, color: SIGNAL_CYAN, alpha: 0.3 })
      .arc(0, 0, runeR, Math.PI * 0.76, Math.PI * 1.48)
      .stroke({ width: 1.5, color: SIGNAL_CYAN, alpha: 0.2 })
      .arc(0, 0, runeR * 0.77, Math.PI * 0.15, Math.PI * 1.12)
      .stroke({ width: 1, color: SIGNAL_BLUE, alpha: 0.28 })
      .arc(0, 0, runeR * 0.55, -Math.PI * 0.48, Math.PI * 0.28)
      .stroke({ width: 1, color: GOLD, alpha: 0.2 });
    statusPips.forEach((pip, i) => {
      const a = (i / statusPips.length) * Math.PI * 2;
      const r = i % 2 === 0 ? runeR : runeR * 0.77;
      pip.position.set(Math.cos(a) * r, Math.sin(a) * r);
      pip.rotation = a;
    });

    // Forged foreground buttresses frame the action without covering the box.
    foregroundG
      .clear()
      .poly([0, h, 0, h * 0.82, w * 0.17, h * 0.77, w * 0.29, h])
      .fill({ color: CITADEL_BLACK, alpha: 0.74 })
      .poly([w, h, w, h * 0.82, w * 0.83, h * 0.77, w * 0.71, h])
      .fill({ color: CITADEL_BLACK, alpha: 0.74 })
      .moveTo(0, h * 0.82)
      .lineTo(w * 0.17, h * 0.77)
      .lineTo(w * 0.29, h)
      .moveTo(w, h * 0.82)
      .lineTo(w * 0.83, h * 0.77)
      .lineTo(w * 0.71, h)
      .stroke({ width: 3, color: COLORS.aluminumDark, alpha: 0.58 });

    boxC.position.set(cx, boxBaseY);

    // Ceremonial forged reliquary: dimensional side extrusion, inset steel
    // face, reinforced corners, data slots and a central morale-core rune.
    faceG
      .clear()
      .roundRect(-boxW / 2 + 8, -boxH + 10, boxW, boxH, 12)
      .fill({ color: 0x000000, alpha: 0.5 })
      .poly([
        boxW / 2 - 2, -boxH + 4,
        boxW / 2 + 15, -boxH + 14,
        boxW / 2 + 15, 5,
        boxW / 2 - 2, 0,
      ])
      .fill({ color: CITADEL_BLACK, alpha: 0.96 })
      .roundRect(-boxW / 2, -boxH, boxW, boxH, 11)
      .fill({ color: FORGED_MID })
      .roundRect(-boxW / 2 + 5, -boxH + 5, boxW - 10, boxH - 10, 8)
      .fill({ color: FORGED_DARK })
      .roundRect(-boxW / 2, -boxH, boxW, boxH, 11)
      .stroke({ width: 4, color: COLORS.aluminum })
      .roundRect(-boxW / 2 + 7, -boxH + 7, boxW - 14, boxH - 14, 7)
      .stroke({ width: 1.5, color: COLORS.aluminumLight, alpha: 0.4 })
      .rect(-boxW / 2 + 8, -boxH + 9, boxW - 16, boxH * 0.16)
      .fill({ color: CITADEL_BLACK, alpha: 0.74 })
      .rect(-boxW / 2 + 10, -boxH + 11, boxW - 20, 2)
      .fill({ color: SIGNAL_CYAN, alpha: 0.36 })
      .rect(-boxW / 2 + 14, -boxH * 0.27, boxW * 0.28, 3)
      .fill({ color: SIGNAL_BLUE, alpha: 0.42 })
      .rect(-boxW / 2 + 14, -boxH * 0.2, boxW * 0.18, 2)
      .fill({ color: SIGNAL_CYAN, alpha: 0.34 })
      .circle(boxW / 2 - 29, -boxH * 0.22, 3)
      .fill({ color: SIGNAL_GREEN, alpha: 0.9 })
      .circle(boxW / 2 - 19, -boxH * 0.22, 3)
      .fill({ color: GOLD, alpha: 0.82 })
      .circle(-boxW / 2 + 12, -boxH + 12, 3)
      .fill({ color: COLORS.aluminumLight })
      .circle(boxW / 2 - 12, -boxH + 12, 3)
      .fill({ color: COLORS.aluminumLight })
      .circle(-boxW / 2 + 12, -12, 3)
      .fill({ color: COLORS.aluminum })
      .circle(boxW / 2 - 12, -12, 3)
      .fill({ color: COLORS.aluminum });

    corePulseG
      .clear()
      .circle(0, 0, boxW * 0.14)
      .fill({ color: SIGNAL_CYAN, alpha: 0.035 })
      .circle(0, 0, boxW * 0.1)
      .stroke({ width: 1.5, color: SIGNAL_CYAN, alpha: 0.52 })
      .poly([
        0, -boxW * 0.075,
        boxW * 0.065, -boxW * 0.037,
        boxW * 0.065, boxW * 0.037,
        0, boxW * 0.075,
        -boxW * 0.065, boxW * 0.037,
        -boxW * 0.065, -boxW * 0.037,
      ])
      .stroke({ width: 2, color: GOLD, alpha: 0.68 })
      .circle(0, 0, boxW * 0.018)
      .fill({ color: COLORS.memo, alpha: 0.9 });
    corePulseG.position.set(0, -boxH * 0.61);

    boxLabel.style.fontSize = clamp(boxW * 0.068, 8, 12);
    boxLabel.position.set(0, -boxH * 0.3);

    // The lid sits on top until it doesn't. Only redraw while it's still
    // attached — mid-flight resizes can keep the old shape, nobody minds.
    if (!popped) {
      lidC.position.set(0, -boxH);
      lidG
        .clear()
        .roundRect(-boxW / 2 - 2, -10, boxW + 16, 17, 5)
        .fill({ color: 0x000000, alpha: 0.42 })
        .roundRect(-boxW / 2 - 7, -17, boxW + 14, 17, 5)
        .fill({ color: FORGED_MID })
        .roundRect(-boxW / 2 - 4, -14, boxW + 8, 11, 4)
        .fill({ color: FORGED_DARK })
        .roundRect(-boxW / 2 - 7, -17, boxW + 14, 17, 5)
        .stroke({ width: 3, color: COLORS.aluminum })
        .rect(-boxW * 0.22, -19, boxW * 0.44, 5)
        .fill({ color: CITADEL_BLACK })
        .rect(-boxW * 0.16, -18, boxW * 0.32, 2)
        .fill({ color: SIGNAL_CYAN, alpha: 0.5 })
        .circle(0, -17, 4)
        .fill({ color: GOLD });
    }

    crank.position.set(boxW / 2 + 11, -boxH * 0.44);

    head.scale.set(headWorldSize / 120); // head was built at 120px

    const happySize = Math.min(64, w * 0.09);
    happy.style.fontSize = happySize;
    happy.position.set(cx, h * 0.13);
    happySub.style.fontSize = Math.min(18, w * 0.032);
    happySub.position.set(cx, h * 0.13 + happySize * 0.78);
    finaleStatus.style.fontSize = Math.min(12, w * 0.017);
    finaleStatus.position.set(cx, Math.max(18, h * 0.065));

    miracle?.layout(w, h);
  }

  /** Redraw the coil between the box mouth and the head as a zigzag. */
  function drawSpring(x1: number, y1: number, x2: number, y2: number): void {
    if (!springG) return;
    const SEGS = 7;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.max(1, Math.hypot(dx, dy));
    // A real coil bulges when compressed: zigzag amplitude grows as the
    // spring gets shorter than its natural (settled) length.
    const naturalLen = Math.abs(boxTopY - restY);
    const squish = clamp(naturalLen / len, 0.6, 2.4);
    const amp = 9 * squish;
    // Unit vector perpendicular to the spring's axis.
    const px = -dy / len;
    const py = dx / len;
    springG.clear().moveTo(x1, y1);
    for (let k = 1; k < SEGS; k++) {
      const t = k / SEGS;
      const side = k % 2 === 0 ? 1 : -1;
      springG.lineTo(x1 + dx * t + px * amp * side, y1 + dy * t + py * amp * side);
    }
    springG.lineTo(x2, y2).stroke({ width: 9, color: SIGNAL_CYAN, alpha: 0.08 });

    // Crisp forged-steel pass over the faint runtime glow.
    springG.moveTo(x1, y1);
    for (let k = 1; k < SEGS; k++) {
      const t = k / SEGS;
      const side = k % 2 === 0 ? 1 : -1;
      springG.lineTo(x1 + dx * t + px * amp * side, y1 + dy * t + py * amp * side);
    }
    springG.lineTo(x2, y2).stroke({ width: 4, color: COLORS.aluminumLight });
  }

  /**
   * The moment. `fanfare = false` is the quiet path used when we mount
   * mid-"splash" and just need the end pose, no fireworks.
   */
  function doPop(fanfare: boolean): void {
    if (!services || !head || !springG || !lidC) return;
    const reduced = services.reducedMotion;
    const density = clamp(services.visualDensity ?? 1, 0.45, 1);
    popped = true;
    // Backdating popAt makes every "time since pop" curve (bobbing, text
    // fades) start already settled on the quiet path.
    popAt = fanfare ? elapsed : elapsed - 10_000;
    head.visible = true;
    springG.visible = true;

    if (fanfare) {
      // Launch: start the head just inside the box with a huge upward
      // velocity; the low-damping spring turns that into hard boinging.
      headSpring.value = boxTopY + 10;
      headSpring.velocity = -Math.max(700, lastH * 1.7);
      // The lid exits up-left, spinning. Velocities are box-local px/s.
      lidVel = { vx: -260, vy: -600, spin: -7.5 };
      confetti?.burst({
        x: cx,
        y: boxTopY,
        count: Math.round((reduced ? 24 : 48) * density),
        color: CONFETTI_COLORS,
        angle: -Math.PI / 2,
        spread: Math.PI * 0.9,
        speed: 430,
        gravity: 420,
        size: 5,
        lifeMs: 1400,
      });
      secondBurstIn = 240; // the staggered second burst
      if (!reduced) shaker?.kick(16);
    } else {
      headSpring.value = restY;
      headSpring.velocity = 0;
      lidC.visible = false;
      lidVel = null;
    }
  }

  return {
    mount(stage: Container, width: number, height: number, svc: SceneServices): void {
      services = svc;
      world = new Container();
      overlay = new Container();
      stage.addChild(world, overlay);

      environmentG = new Graphics();
      auraG = new Graphics();
      runeWheel = new Container();
      runeG = new Graphics();
      runeWheel.addChild(runeG);
      statusPips = [];
      const density = clamp(svc.visualDensity ?? 1, 0.45, 1);
      const pipCount = Math.max(4, Math.round(8 * density));
      for (let i = 0; i < pipCount; i++) {
        const accent = i % 3 === 0 ? GOLD : i % 2 === 0 ? SIGNAL_CYAN : SIGNAL_BLUE;
        const pip = new Graphics()
          .poly([0, -4, 4, 0, 0, 4, -4, 0])
          .fill({ color: accent, alpha: 0.74 })
          .circle(0, 0, 1.2)
          .fill({ color: COLORS.memo, alpha: 0.9 });
        runeWheel.addChild(pip);
        statusPips.push(pip);
      }
      foregroundG = new Graphics();
      world.addChild(environmentG, auraG, runeWheel);

      boxC = new Container();
      boxInner = new Container();
      boxC.addChild(boxInner);
      shaker = new Shaker(boxInner); // rattle just the box, not the world

      faceG = new Graphics();
      corePulseG = new Graphics();
      boxLabel = new Text({
        text: "RELIQUARY // MORALE CORE",
        style: { fontFamily: MONO_FONT, fontSize: 12, fill: ALUMINUM_300, letterSpacing: 1.2 },
      });
      boxLabel.anchor.set(0.5);

      // Crank on the side: axle, arm, knob. update() spins the container.
      crank = new Container();
      crank.addChild(
        new Graphics()
          .circle(0, 0, 9)
          .fill({ color: CITADEL_BLACK })
          .circle(0, 0, 7)
          .stroke({ width: 2, color: COLORS.aluminum }),
        new Graphics()
          .moveTo(0, 0)
          .lineTo(22, 0)
          .stroke({ width: 7, color: CITADEL_BLACK })
          .moveTo(0, 0)
          .lineTo(22, 0)
          .stroke({ width: 4, color: COLORS.aluminumLight }),
        new Graphics()
          .circle(22, 0, 8)
          .fill({ color: FORGED_MID })
          .circle(22, 0, 8)
          .stroke({ width: 2, color: GOLD })
          .circle(22, 0, 2)
          .fill({ color: SIGNAL_CYAN }),
      );

      lidC = new Container();
      lidG = new Graphics();
      lidC.addChild(lidG);

      boxInner.addChild(faceG, corePulseG, boxLabel, crank, lidC);

      springG = new Graphics();
      springG.visible = false; // hidden until the pop
      head = makeJustinHead(120, svc.photoUrl);
      head.visible = false;
      // Order matters: environment → box → coil → head → forged foreground.
      world.addChild(boxC, springG, head, foregroundG);

      happy = new Text({
        text: "HAPPY FESTIVUS",
        style: {
          fontFamily: DISPLAY_FONT,
          fontSize: 64,
          fontWeight: "700",
          fill: COLORS.memo,
          letterSpacing: 8,
          stroke: { color: CITADEL_BLACK, width: 6 },
        },
      });
      happy.anchor.set(0.5);
      happy.alpha = 0;
      happySub = new Text({
        text: "FOR THE REST OF US  //  RUNTIME RESTORED",
        style: { fontFamily: MONO_FONT, fontSize: 18, fill: SIGNAL_CYAN, letterSpacing: 3 },
      });
      happySub.anchor.set(0.5);
      happySub.alpha = 0;
      finaleStatus = new Text({
        text: "●  FINAL DEPLOYMENT / STAGING",
        style: { fontFamily: MONO_FONT, fontSize: 12, fill: SIGNAL_GREEN, letterSpacing: 2 },
      });
      finaleStatus.anchor.set(0.5);
      world.addChild(happy, happySub, finaleStatus);

      confetti = new ParticleBurst(overlay); // confetti flies OVER everything
      miracle = new MiracleFlash(overlay, svc.reducedMotion);

      lastW = width;
      lastH = height;
      layout(width, height);
    },

    update(args): void {
      if (
        !world ||
        !services ||
        !head ||
        !crank ||
        !lidC ||
        !happy ||
        !happySub ||
        !corePulseG ||
        !auraG ||
        !runeWheel ||
        !finaleStatus
      ) {
        return;
      }
      if (args.width !== lastW || args.height !== lastH) {
        lastW = args.width;
        lastH = args.height;
        layout(lastW, lastH);
      }

      const dt = args.dtMs;
      const reduced = services.reducedMotion;
      elapsed += dt;

      // Mounted straight into "splash" (page refresh after the finale)?
      // Skip the theatrics and hold the end pose.
      if (!popped && args.snap.phase === "splash") doPop(false);

      // Reduced motion: no wobble build-up, pop almost immediately.
      const POP_MS = reduced ? 450 : 2500;
      const windT = clamp01(elapsed / POP_MS);

      // Runtime ambience shares the finale clock but remains decorative.
      // Controller density is handled at mount (fewer pips) and in burst
      // counts; frame work stays to simple retained-object transforms.
      if (reduced) {
        runeWheel.rotation = 0.025;
        corePulseG.rotation = 0;
        corePulseG.alpha = 0.74;
        corePulseG.scale.set(1);
        auraG.alpha = 0.72;
      } else {
        runeWheel.rotation = (elapsed / 1000) * (popped ? 0.07 : 0.025 + windT * 0.08);
        corePulseG.rotation = (elapsed / 1000) * (0.18 + windT * 0.42);
        const coreBeat = 0.5 + 0.5 * Math.sin((elapsed / 1000) * (2.4 + windT * 5));
        corePulseG.alpha = 0.58 + coreBeat * 0.4;
        corePulseG.scale.set(0.92 + coreBeat * 0.12);
        auraG.alpha = 0.56 + windT * 0.28 + coreBeat * 0.12;
      }
      statusPips.forEach((pip, i) => {
        pip.alpha = reduced
          ? 0.72
          : 0.42 + 0.5 * (0.5 + 0.5 * Math.sin((elapsed / 1000) * 2.3 + i * 1.4));
      });

      if (!popped) {
        finaleStatus.text =
          windT < 0.4
            ? "●  FINAL DEPLOYMENT / STAGING"
            : windT < 0.78
              ? "●  MORALE CORE / VERIFYING"
              : "●  MORALE CORE / ARMED";
        finaleStatus.alpha = reduced ? 0.76 : 0.62 + 0.28 * Math.sin(elapsed / 180);
      } else {
        finaleStatus.text = "●  CEREMONIAL RUNTIME / DEPLOYED";
        finaleStatus.alpha = 0.72;
      }

      if (!popped) {
        // ── Wind-up: crank accelerates, wobble grows quadratically ──────
        crank.rotation += (dt / 1000) * (4 + 14 * windT * windT);
        if (!reduced) shaker?.kick(1 + 9 * windT * windT); // kick() keeps the max
        if (elapsed >= POP_MS) doPop(true);
      }

      if (popped) {
        const sincePop = elapsed - popAt;

        // Lid ballistics (box-local coordinates; gravity pulls it back down
        // but it exits stage-left long before that matters).
        if (lidVel && lidC.visible) {
          const dts = dt / 1000;
          lidC.x += lidVel.vx * dts;
          lidC.y += lidVel.vy * dts;
          lidVel.vy += 900 * dts;
          lidC.rotation += lidVel.spin * dts;
          const worldX = cx + lidC.x;
          const worldY = boxBaseY + lidC.y;
          if (worldX < -160 || worldY > lastH + 160) {
            lidC.visible = false;
            lidVel = null;
          }
        }

        // The head chases a gently bobbing target on a LOW-damping spring —
        // damping 6 is what makes it boing so hard right after launch. The
        // bob amplitude decays over a few seconds: the slow settle.
        const bobAmp = reduced ? 0 : 5 + 24 * Math.exp(-sincePop / 3500);
        const target = restY + Math.sin((sincePop / 1000) * 2.2) * bobAmp;
        springTo(headSpring, target, dt, 80, reduced ? 12 : 6);

        // Soft ceiling: if the launch overshoots the top edge, bounce off
        // it instead of disappearing — an extra "boing" for free.
        const ceiling = headWorldSize * 0.6;
        if (headSpring.value < ceiling) {
          headSpring.value = ceiling;
          headSpring.velocity = Math.abs(headSpring.velocity) * 0.5;
        }

        const sway = reduced ? 0 : Math.sin((sincePop / 1000) * 1.5) * 10;
        head.position.set(cx + sway, headSpring.value);
        head.rotation = sway * 0.008;

        drawSpring(cx, boxTopY - 4, head.x, head.y + headWorldSize * 0.55);

        // The staggered second confetti burst (~80 total across both).
        if (secondBurstIn > 0) {
          secondBurstIn -= dt;
          if (secondBurstIn <= 0) {
            confetti?.burst({
              x: cx,
              y: boxTopY,
              count: Math.round(
                (reduced ? 16 : 32) * clamp(services.visualDensity ?? 1, 0.45, 1),
              ),
              color: CONFETTI_COLORS,
              angle: -Math.PI / 2,
              spread: Math.PI * 1.1,
              speed: 340,
              gravity: 420,
              size: 4,
              lifeMs: 1600,
            });
          }
        }

        // The greeting fades in once the chaos peaks.
        happy.alpha = clamp01((sincePop - (reduced ? 100 : 700)) / 900);
        happySub.alpha = clamp01((sincePop - (reduced ? 250 : 1500)) / 900);
      }

      // fx contract (miracles can't occur here, but never say never).
      for (const f of args.fx) {
        if (f.type === "miracle") miracle?.trigger();
      }

      confetti?.update(dt);
      shaker?.update(dt);
      miracle?.update(dt);
    },

    unmount(): void {
      confetti?.destroy();
      confetti = null;
      miracle?.destroy();
      miracle = null;
      // GameCanvas destroys the display tree after unmount.
      world = null;
      overlay = null;
      environmentG = null;
      auraG = null;
      runeWheel = null;
      runeG = null;
      foregroundG = null;
      statusPips = [];
      finaleStatus = null;
      boxC = null;
      boxInner = null;
      faceG = null;
      corePulseG = null;
      boxLabel = null;
      crank = null;
      lidC = null;
      lidG = null;
      springG = null;
      head = null;
      happy = null;
      happySub = null;
      shaker = null;
    },
  };
};
