/**
 * SCENE — JACK-IN-THE-BOX (the finale punchline).
 *
 * Unlike the event scenes, this one gets NO event view: it is a pure
 * client-side animation driven by a local clock we accumulate in update(),
 * plus snap.phase. It plays during "finale" and simply holds its popped end
 * pose during "splash" (GameCanvas keeps the same scene mounted for both).
 *
 * The sequence:
 *   0 – 2.5 s   a memo-colored box with aluminum trim; the side crank winds
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

  // The box: an outer container carries the position; the INNER container
  // is what the Shaker rattles (Shaker writes .position directly, so its
  // target must rest at (0,0)).
  let boxC: Container | null = null;
  let boxInner: Container | null = null;
  let faceG: Graphics | null = null;
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
    if (!boxC || !faceG || !lidC || !lidG || !crank || !boxLabel || !head || !happy || !happySub) return;

    cx = w / 2;
    boxW = clamp(Math.min(w, h) * 0.3, 120, 210);
    boxH = boxW * 0.9;
    boxBaseY = h * 0.68;
    boxTopY = boxBaseY - boxH;
    headWorldSize = clamp(Math.min(w, h) * 0.3, 84, 132); // "BIG ~120px"
    // The head settles well above the box but never off the top edge.
    restY = Math.max(headWorldSize * 0.75, boxTopY - h * 0.32);

    boxC.position.set(cx, boxBaseY);

    // Box face: memo cardboard with aluminum trim and corner rivets —
    // office supplies pretending to be a toy. Local origin: bottom-center.
    faceG
      .clear()
      .roundRect(-boxW / 2, -boxH, boxW, boxH, 10)
      .fill({ color: COLORS.memo })
      .roundRect(-boxW / 2, -boxH, boxW, boxH, 10)
      .stroke({ width: 4, color: COLORS.aluminumDark })
      .rect(-boxW / 2 + 6, -boxH / 2 - 2, boxW - 12, 4)
      .fill({ color: COLORS.aluminum, alpha: 0.7 })
      .circle(-boxW / 2 + 12, -boxH + 12, 3)
      .fill({ color: COLORS.aluminum })
      .circle(boxW / 2 - 12, -boxH + 12, 3)
      .fill({ color: COLORS.aluminum })
      .circle(-boxW / 2 + 12, -12, 3)
      .fill({ color: COLORS.aluminum })
      .circle(boxW / 2 - 12, -12, 3)
      .fill({ color: COLORS.aluminum });

    boxLabel.style.fontSize = clamp(boxW * 0.075, 9, 13);
    boxLabel.position.set(0, -boxH * 0.28);

    // The lid sits on top until it doesn't. Only redraw while it's still
    // attached — mid-flight resizes can keep the old shape, nobody minds.
    if (!popped) {
      lidC.position.set(0, -boxH);
      lidG
        .clear()
        .roundRect(-boxW / 2 - 5, -14, boxW + 10, 16, 5)
        .fill({ color: COLORS.memo })
        .roundRect(-boxW / 2 - 5, -14, boxW + 10, 16, 5)
        .stroke({ width: 4, color: COLORS.aluminumDark })
        .circle(0, -14, 4)
        .fill({ color: COLORS.aluminum });
    }

    crank.position.set(boxW / 2 + 6, -boxH * 0.45);

    head.scale.set(headWorldSize / 120); // head was built at 120px

    const happySize = Math.min(64, w * 0.09);
    happy.style.fontSize = happySize;
    happy.position.set(cx, h * 0.13);
    happySub.style.fontSize = Math.min(18, w * 0.032);
    happySub.position.set(cx, h * 0.13 + happySize * 0.78);

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
    springG.lineTo(x2, y2).stroke({ width: 4, color: COLORS.aluminum });
  }

  /**
   * The moment. `fanfare = false` is the quiet path used when we mount
   * mid-"splash" and just need the end pose, no fireworks.
   */
  function doPop(fanfare: boolean): void {
    if (!services || !head || !springG || !lidC) return;
    const reduced = services.reducedMotion;
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
        count: reduced ? 24 : 48,
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

      boxC = new Container();
      boxInner = new Container();
      boxC.addChild(boxInner);
      shaker = new Shaker(boxInner); // rattle just the box, not the world

      faceG = new Graphics();
      boxLabel = new Text({
        text: "CONTENTS: MORALE",
        style: { fontFamily: MONO_FONT, fontSize: 12, fill: COLORS.aluminumDark, letterSpacing: 1 },
      });
      boxLabel.anchor.set(0.5);

      // Crank on the side: axle, arm, knob. update() spins the container.
      crank = new Container();
      crank.addChild(
        new Graphics().moveTo(0, 0).lineTo(18, 0).stroke({ width: 5, color: COLORS.aluminum }),
        new Graphics().circle(18, 0, 6).fill({ color: COLORS.aluminumLight }),
        new Graphics().circle(0, 0, 4).fill({ color: COLORS.aluminumDark }),
      );

      lidC = new Container();
      lidG = new Graphics();
      lidC.addChild(lidG);

      boxInner.addChild(faceG, boxLabel, crank, lidC);

      springG = new Graphics();
      springG.visible = false; // hidden until the pop
      head = makeJustinHead(120, svc.photoUrl);
      head.visible = false;
      // Order matters: box behind coil, coil behind head, lid rides the box.
      world.addChild(boxC, springG, head);

      happy = new Text({
        text: "HAPPY FESTIVUS",
        style: { fontFamily: DISPLAY_FONT, fontSize: 64, fontWeight: "700", fill: COLORS.memo, letterSpacing: 8 },
      });
      happy.anchor.set(0.5);
      happy.alpha = 0;
      happySub = new Text({
        text: "FOR THE REST OF US",
        style: { fontFamily: MONO_FONT, fontSize: 18, fill: ALUMINUM_300, letterSpacing: 3 },
      });
      happySub.anchor.set(0.5);
      happySub.alpha = 0;
      world.addChild(happy, happySub);

      confetti = new ParticleBurst(overlay); // confetti flies OVER everything
      miracle = new MiracleFlash(overlay, svc.reducedMotion);

      lastW = width;
      lastH = height;
      layout(width, height);
    },

    update(args): void {
      if (!world || !services || !head || !crank || !lidC || !happy || !happySub) return;
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

      if (!popped) {
        // ── Wind-up: crank accelerates, wobble grows quadratically ──────
        const t = clamp01(elapsed / POP_MS);
        crank.rotation += (dt / 1000) * (4 + 14 * t * t);
        if (!reduced) shaker?.kick(1 + 9 * t * t); // kick() keeps the max
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
              count: reduced ? 16 : 32,
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
      boxC = null;
      boxInner = null;
      faceG = null;
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
