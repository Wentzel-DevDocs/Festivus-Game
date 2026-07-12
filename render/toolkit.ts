/**
 * Drawing toolkit shared by every PixiJS scene: Justin's head (photo or
 * placeholder), spring physics, particle bursts, screen shake, and the
 * aluminum pole. Pixi v8 API throughout (g.rect(...).fill(...), app.canvas).
 */

import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";

/* ── Palette (mirrors app/globals.css tokens) ─────────────────────────────── */

export const COLORS = {
  aluminumLight: 0xd4d9dd,
  aluminum: 0x929ba3,
  aluminumDark: 0x33393f,
  stage: 0x16191c,
  memo: 0xf4f2ec,
  grievance: 0xc62f2f,
  support: 0x3f9142,
  grease: 0xd9a514,
  pool: 0x2e7fb8,
  skin: 0xe8b98c,
  drownBlue: 0x7ea6c9,
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

  const placeholder = new Container();
  const face = new Graphics().circle(0, 0, r).fill({ color: COLORS.skin });
  const hair = new Graphics()
    .arc(0, -r * 0.15, r * 0.98, Math.PI * 1.05, Math.PI * 1.95)
    .fill({ color: 0x4a3b2a });
  const eyeL = new Graphics().circle(-r * 0.35, -r * 0.1, r * 0.09).fill({ color: 0x222222 });
  const eyeR = new Graphics().circle(r * 0.35, -r * 0.1, r * 0.09).fill({ color: 0x222222 });
  const mouth = new Graphics()
    .moveTo(-r * 0.3, r * 0.45)
    .lineTo(r * 0.3, r * 0.45)
    .stroke({ width: Math.max(2, r * 0.08), color: 0x5a4632 });
  placeholder.addChild(face, hair, eyeL, eyeR, mouth);
  root.addChild(placeholder);

  if (photoUrl) {
    void Assets.load<Texture>({ src: photoUrl, loadParser: "loadTextures" })
      .then((texture) => {
        if (root.destroyed) return;
        const photo = new Sprite(texture);
        const scale = size / Math.min(texture.width, texture.height);
        photo.scale.set(scale);
        photo.anchor.set(0.5);
        const mask = new Graphics().circle(0, 0, r).fill({ color: 0xffffff });
        const wrap = new Container();
        wrap.addChild(photo, mask);
        photo.mask = mask;
        placeholder.visible = false;
        root.addChild(wrap);
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
  const shirt = new Graphics()
    .roundRect(-width / 2, 0, width, height, width * 0.25)
    .fill({ color: COLORS.memo });
  const tie = new Graphics()
    .poly([0, 2, width * 0.09, height * 0.36, 0, height * 0.5, -width * 0.09, height * 0.36])
    .fill({ color: COLORS.grievance });
  root.addChild(shirt, tie);
  return root;
}

/* ── The aluminum pole (very high strength-to-weight ratio) ──────────────── */

export function makePole(height: number, width = 10): Container {
  const root = new Container();
  const pole = new Graphics().roundRect(-width / 2, -height, width, height, width / 2);
  pole.fill({ color: COLORS.aluminum });
  const sheen = new Graphics()
    .roundRect(-width / 6, -height, width / 3, height, width / 6)
    .fill({ color: COLORS.aluminumLight, alpha: 0.7 });
  root.addChild(pole, sheen);
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

export const CONFETTI_COLORS = [0xc62f2f, 0x3f9142, 0xd9a514, 0xd4d9dd, 0x2e7fb8];

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
