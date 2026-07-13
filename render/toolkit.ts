/**
 * Drawing toolkit shared by every PixiJS scene: Justin's head (photo or
 * placeholder), spring physics, particle bursts, screen shake, and the
 * aluminum pole. Pixi v8 API throughout (g.rect(...).fill(...), app.canvas).
 */

import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";

/* ── Palette (mirrors app/globals.css tokens) ─────────────────────────────── */

export const COLORS = {
  void: 0x070a0f,
  aluminumLight: 0xaebbc4,
  aluminum: 0x87939e,
  aluminumDark: 0x33404b,
  stage: 0x0d1219,
  raised: 0x151d27,
  memo: 0xf4f0e7,
  grievance: 0xd74747,
  support: 0x43c77a,
  grease: 0xe8a941,
  pool: 0x33a8c7,
  skin: 0xd9a071,
  skinLight: 0xf1c59a,
  drownBlue: 0x72a9c4,
} as const;

/* ── Justin's head ────────────────────────────────────────────────────────── */

/**
 * A round head of `size` px. With a photo URL: the photo circle-cropped
 * (loaded async; the placeholder shows until it lands). Without: a deadpan
 * placeholder face — managerial side part, tired eyes, straight mouth.
 */
export function makeJustinHead(size: number, photoUrl: string): Container {
  const root = new Container();
  const r = size / 2;

  // A portrait medallion gives the face a readable silhouette at phone size
  // and a premium steel rim on the broadcast screen.
  const shadow = new Graphics()
    .circle(2, 4, r + 5)
    .fill({ color: 0x000000, alpha: 0.48 });
  const rim = new Graphics()
    .circle(0, 0, r + 4)
    .fill({ color: COLORS.void })
    .circle(0, 0, r + 2)
    .fill({ color: COLORS.aluminumDark })
    .circle(0, 0, r - 1)
    .fill({ color: COLORS.skin });

  const placeholder = new Container();
  const face = new Graphics()
    .circle(0, 0, r - 2)
    .fill({ color: COLORS.skin })
    .ellipse(-r * 0.22, -r * 0.26, r * 0.42, r * 0.28)
    .fill({ color: COLORS.skinLight, alpha: 0.34 })
    .ellipse(r * 0.23, r * 0.27, r * 0.3, r * 0.18)
    .fill({ color: 0x8a5539, alpha: 0.14 });
  const hair = new Graphics()
    .arc(0, -r * 0.08, r * 0.92, Math.PI * 1.04, Math.PI * 1.96)
    .fill({ color: 0x2b211c })
    .ellipse(-r * 0.22, -r * 0.72, r * 0.58, r * 0.22)
    .fill({ color: 0x4d392a, alpha: 0.65 });
  const brows = new Graphics()
    .moveTo(-r * 0.52, -r * 0.28)
    .lineTo(-r * 0.18, -r * 0.24)
    .moveTo(r * 0.18, -r * 0.24)
    .lineTo(r * 0.52, -r * 0.28)
    .stroke({ width: Math.max(2, r * 0.08), color: 0x3b2a21 });
  const eyeL = new Graphics()
    .ellipse(-r * 0.34, -r * 0.08, r * 0.1, r * 0.075)
    .fill({ color: 0x15191d });
  const eyeR = new Graphics()
    .ellipse(r * 0.34, -r * 0.08, r * 0.1, r * 0.075)
    .fill({ color: 0x15191d });
  const nose = new Graphics()
    .moveTo(0, -r * 0.02)
    .lineTo(-r * 0.07, r * 0.24)
    .lineTo(r * 0.06, r * 0.25)
    .stroke({ width: Math.max(1.5, r * 0.055), color: 0x9a6548, alpha: 0.75 });
  const mouth = new Graphics()
    .moveTo(-r * 0.26, r * 0.48)
    .quadraticCurveTo(0, r * 0.42, r * 0.28, r * 0.49)
    .stroke({ width: Math.max(2, r * 0.07), color: 0x694333 });
  placeholder.addChild(face, hair, brows, eyeL, eyeR, nose, mouth);

  const highlight = new Graphics()
    .arc(0, 0, r + 1, Math.PI * 1.08, Math.PI * 1.72)
    .stroke({ width: Math.max(1.5, r * 0.09), color: COLORS.memo, alpha: 0.72 })
    .arc(0, 0, r + 3, Math.PI * 0.08, Math.PI * 0.64)
    .stroke({ width: Math.max(1, r * 0.06), color: COLORS.grease, alpha: 0.52 });
  root.addChild(shadow, rim, placeholder, highlight);

  if (photoUrl) {
    void Assets.load<Texture>({ src: photoUrl, loadParser: "loadTextures" })
      .then((texture) => {
        if (root.destroyed) return;
        const photo = new Sprite(texture);
        const scale = (size - 4) / Math.min(texture.width, texture.height);
        photo.scale.set(scale);
        photo.anchor.set(0.5);
        const mask = new Graphics().circle(0, 0, r - 2).fill({ color: 0xffffff });
        const wrap = new Container();
        wrap.addChild(photo, mask);
        photo.mask = mask;
        placeholder.visible = false;
        root.addChildAt(wrap, 3);
      })
      .catch(() => {
        /* keep the placeholder — never crash the party over a broken URL */
      });
  }

  return root;
}

/** Swap the eyes to X's and tint the face drowning-blue (swim gag). */
export function makeDrownedHead(size: number): Container {
  const root = new Container();
  const r = size / 2;
  root.addChild(new Graphics().circle(0, 0, r).fill({ color: COLORS.drownBlue }));
  const x = (cx: number) =>
    new Graphics()
      .moveTo(cx - r * 0.12, -r * 0.22)
      .lineTo(cx + r * 0.12, r * 0.02)
      .moveTo(cx + r * 0.12, -r * 0.22)
      .lineTo(cx - r * 0.12, r * 0.02)
      .stroke({ width: Math.max(2, r * 0.07), color: 0x1d3a52 });
  const mouth = new Graphics().circle(0, r * 0.45, r * 0.14).fill({ color: 0x1d3a52 });
  root.addChild(x(-r * 0.35), x(r * 0.35), mouth);
  return root;
}

/* ── Stick body ───────────────────────────────────────────────────────────── */

/**
 * A simple office-Justin body (shirt + tie) below a head you attach at
 * (0, -headOffset). Scenes rotate/squash the returned container for effort.
 */
export function makeBody(width: number, height: number): Container {
  const root = new Container();
  const silhouette = new Graphics()
    .roundRect(-width / 2 - 2, -2, width + 4, height + 5, width * 0.27)
    .fill({ color: COLORS.void });
  const coat = new Graphics()
    .roundRect(-width / 2, 0, width, height, width * 0.25)
    .fill({ color: 0x26313b })
    .roundRect(-width / 2 + 3, 3, width - 6, height - 6, width * 0.18)
    .fill({ color: 0x151d27 });
  const shoulders = new Graphics()
    .roundRect(-width * 0.68, 2, width * 0.34, height * 0.2, width * 0.12)
    .fill({ color: COLORS.aluminumDark })
    .roundRect(width * 0.34, 2, width * 0.34, height * 0.2, width * 0.12)
    .fill({ color: COLORS.aluminumDark });
  const lapels = new Graphics()
    .poly([-width * 0.39, 4, -width * 0.06, height * 0.42, 0, 3])
    .fill({ color: 0x3b4853 })
    .poly([width * 0.39, 4, width * 0.06, height * 0.42, 0, 3])
    .fill({ color: 0x3b4853 });
  const tie = new Graphics()
    .poly([0, 5, width * 0.1, height * 0.35, 0, height * 0.58, -width * 0.1, height * 0.35])
    .fill({ color: COLORS.grievance })
    .circle(0, height * 0.72, Math.max(1.5, width * 0.045))
    .fill({ color: COLORS.grease, alpha: 0.7 });
  const rimLight = new Graphics()
    .moveTo(-width / 2 + 2, height * 0.2)
    .lineTo(-width / 2 + 2, height * 0.76)
    .stroke({ width: Math.max(1, width * 0.04), color: COLORS.aluminumLight, alpha: 0.35 });
  root.addChild(silhouette, shoulders, coat, lapels, tie, rimLight);
  return root;
}

/* ── The aluminum pole (very high strength-to-weight ratio) ──────────────── */

export function makePole(height: number, width = 10): Container {
  const root = new Container();
  const pole = new Graphics().roundRect(-width / 2, -height, width, height, width / 2);
  pole.fill({ color: COLORS.aluminumDark });
  const mid = new Graphics()
    .roundRect(-width * 0.34, -height, width * 0.68, height, width / 3)
    .fill({ color: COLORS.aluminum });
  const sheen = new Graphics()
    .roundRect(-width * 0.12, -height, width * 0.22, height, width / 8)
    .fill({ color: COLORS.memo, alpha: 0.78 });
  const shadowLine = new Graphics()
    .roundRect(width * 0.25, -height, width * 0.16, height, width / 10)
    .fill({ color: COLORS.void, alpha: 0.42 });
  root.addChild(pole, mid, sheen, shadowLine);
  return root;
}

/* ── Spring physics (the "juice") ─────────────────────────────────────────── */

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Critically-tweakable damped spring. Mutates and returns `s`.
 * stiffness ~120 + damping ~14 feels snappy; lower damping = more wobble.
 */
export function springTo(
  s: SpringState,
  target: number,
  dtMs: number,
  stiffness = 120,
  damping = 14,
): SpringState {
  const dt = Math.min(0.064, dtMs / 1000); // clamp: springs explode on huge dt
  const accel = (target - s.value) * stiffness - s.velocity * damping;
  s.velocity += accel * dt;
  s.value += s.velocity * dt;
  return s;
}

/* ── Particles: water spray, confetti, grease drips ──────────────────────── */

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
}

/** A self-contained particle pool. Call update(dtMs) every frame. */
export class ParticleBurst {
  private particles: Particle[] = [];
  constructor(private parent: Container) {}

  /** Spray `count` dots from (x,y) in a fan around `angle` (radians). */
  burst(opts: {
    x: number;
    y: number;
    count: number;
    color: number | number[];
    angle?: number;
    spread?: number;
    speed?: number;
    gravity?: number;
    size?: number;
    lifeMs?: number;
  }): void {
    const {
      x, y, count, color,
      angle = -Math.PI / 2, spread = Math.PI / 3,
      speed = 220, gravity = 500, size = 4, lifeMs = 900,
    } = opts;
    const colors = Array.isArray(color) ? color : [color];
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.5 + Math.random() * 0.8);
      const g = new Graphics()
        .circle(0, 0, size * (0.6 + Math.random() * 0.8))
        .fill({ color: colors[i % colors.length] });
      g.position.set(x, y);
      this.parent.addChild(g);
      this.particles.push({
        g,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: lifeMs,
        maxLife: lifeMs,
        gravity,
      });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtMs;
      if (p.life <= 0) {
        p.g.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.alpha = p.life / p.maxLife;
    }
  }

  destroy(): void {
    for (const p of this.particles) p.g.destroy();
    this.particles = [];
  }
}

export const CONFETTI_COLORS = [0xd74747, 0x43c77a, 0xe8a941, 0xaebbc4, 0x33a8c7];

/* ── Screen shake ─────────────────────────────────────────────────────────── */

export class Shaker {
  private magnitude = 0;
  constructor(private target: Container) {}

  /** Kick the shake (e.g. on the pin hitting the mat). */
  kick(mag = 12): void {
    this.magnitude = Math.max(this.magnitude, mag);
  }

  update(dtMs: number): void {
    if (this.magnitude < 0.3) {
      this.magnitude = 0;
      this.target.position.set(0, 0);
      return;
    }
    this.target.position.set(
      (Math.random() - 0.5) * this.magnitude,
      (Math.random() - 0.5) * this.magnitude,
    );
    this.magnitude *= Math.pow(0.0025, dtMs / 1000); // fast exponential decay
  }
}
