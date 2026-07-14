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

  // A forged collar/mount turns the portrait into part of the character rig,
  // not a sticker floating above it. It remains useful in the finale, where
  // the head appears without makeBody().
  const mount = new Graphics()
    .poly([
      -r * 0.72, r * 0.62,
      -r * 0.94, r * 1.12,
      0, r * 1.34,
      r * 0.94, r * 1.12,
      r * 0.72, r * 0.62,
    ])
    .fill({ color: COLORS.void })
    .poly([
      -r * 0.56, r * 0.68,
      -r * 0.7, r * 1.04,
      0, r * 1.19,
      r * 0.7, r * 1.04,
      r * 0.56, r * 0.68,
    ])
    .fill({ color: COLORS.aluminumDark })
    .moveTo(-r * 0.58, r * 0.78)
    .lineTo(0, r * 1.08)
    .lineTo(r * 0.58, r * 0.78)
    .stroke({ width: Math.max(1, r * 0.055), color: COLORS.aluminumLight, alpha: 0.46 })
    .circle(0, r * 1.11, Math.max(1.4, r * 0.075))
    .fill({ color: COLORS.grease, alpha: 0.78 });

  // The layered portrait medallion keeps the silhouette readable at 38px on
  // a phone and gives it forged depth on the broadcast screen.
  const shadow = new Graphics()
    .ellipse(2, 4, r + 6, r + 7)
    .fill({ color: 0x000000, alpha: 0.48 });
  const rim = new Graphics()
    .circle(0, 0, r + 5)
    .fill({ color: COLORS.void })
    .circle(0, 0, r + 3)
    .fill({ color: COLORS.aluminumDark })
    .circle(0, 0, r + 0.5)
    .fill({ color: COLORS.aluminum })
    .circle(0, 0, r - 2)
    .fill({ color: COLORS.skin });

  const portraitLayer = new Container();
  const placeholder = new Container();
  const ears = new Graphics()
    .ellipse(-r * 0.82, r * 0.04, r * 0.17, r * 0.27)
    .fill({ color: 0xb87855 })
    .ellipse(r * 0.82, r * 0.04, r * 0.17, r * 0.27)
    .fill({ color: 0xb87855 });
  const face = new Graphics()
    .ellipse(0, -r * 0.04, r * 0.79, r * 0.91)
    .fill({ color: COLORS.skin })
    // broad forehead/key light
    .ellipse(-r * 0.2, -r * 0.31, r * 0.42, r * 0.3)
    .fill({ color: COLORS.skinLight, alpha: 0.42 })
    // temple + jaw shadow gives a face plane instead of a flat circle
    .ellipse(r * 0.47, r * 0.02, r * 0.24, r * 0.6)
    .fill({ color: 0x8a5539, alpha: 0.18 })
    .ellipse(r * 0.16, r * 0.58, r * 0.43, r * 0.18)
    .fill({ color: 0x7d4b35, alpha: 0.12 });
  const hair = new Graphics()
    .arc(0, -r * 0.07, r * 0.9, Math.PI * 1.03, Math.PI * 1.97)
    .fill({ color: 0x2b211c })
    .ellipse(-r * 0.24, -r * 0.72, r * 0.57, r * 0.23)
    .fill({ color: 0x4d392a, alpha: 0.78 })
    .poly([
      -r * 0.68, -r * 0.48,
      -r * 0.82, -r * 0.03,
      -r * 0.68, r * 0.2,
      -r * 0.58, -r * 0.24,
    ])
    .fill({ color: 0x2b211c });
  const brows = new Graphics()
    // one brow rides slightly higher: determined, dry, not generic-happy
    .moveTo(-r * 0.54, -r * 0.27)
    .lineTo(-r * 0.17, -r * 0.21)
    .moveTo(r * 0.17, -r * 0.19)
    .lineTo(r * 0.54, -r * 0.29)
    .stroke({ width: Math.max(2, r * 0.085), color: 0x3b2a21 });
  const eyes = new Graphics()
    .ellipse(-r * 0.34, -r * 0.055, r * 0.15, r * 0.105)
    .fill({ color: 0xf2dfc9 })
    .ellipse(r * 0.34, -r * 0.055, r * 0.15, r * 0.105)
    .fill({ color: 0xf2dfc9 })
    .circle(-r * 0.315, -r * 0.04, Math.max(1.2, r * 0.065))
    .fill({ color: 0x18212a })
    .circle(r * 0.315, -r * 0.04, Math.max(1.2, r * 0.065))
    .fill({ color: 0x18212a })
    .circle(-r * 0.29, -r * 0.07, Math.max(0.65, r * 0.023))
    .fill({ color: COLORS.memo })
    .circle(r * 0.34, -r * 0.07, Math.max(0.65, r * 0.023))
    .fill({ color: COLORS.memo });
  const lids = new Graphics()
    .moveTo(-r * 0.5, -r * 0.09)
    .quadraticCurveTo(-r * 0.34, -r * 0.18, -r * 0.18, -r * 0.08)
    .moveTo(r * 0.18, -r * 0.08)
    .quadraticCurveTo(r * 0.34, -r * 0.17, r * 0.5, -r * 0.09)
    .stroke({ width: Math.max(1, r * 0.045), color: 0x7a4f3a, alpha: 0.7 });
  const nose = new Graphics()
    .moveTo(-r * 0.015, -r * 0.01)
    .lineTo(-r * 0.08, r * 0.27)
    .quadraticCurveTo(0, r * 0.34, r * 0.11, r * 0.27)
    .stroke({ width: Math.max(1.5, r * 0.055), color: 0x915d43, alpha: 0.82 })
    .moveTo(r * 0.08, r * 0.27)
    .lineTo(r * 0.22, r * 0.24)
    .stroke({ width: Math.max(1, r * 0.035), color: COLORS.skinLight, alpha: 0.42 });
  const mouth = new Graphics()
    .moveTo(-r * 0.29, r * 0.49)
    .quadraticCurveTo(-r * 0.04, r * 0.43, r * 0.3, r * 0.5)
    .stroke({ width: Math.max(2, r * 0.07), color: 0x684233 })
    .moveTo(r * 0.08, r * 0.54)
    .quadraticCurveTo(r * 0.21, r * 0.57, r * 0.31, r * 0.51)
    .stroke({ width: Math.max(1, r * 0.038), color: COLORS.skinLight, alpha: 0.4 });
  const jaw = new Graphics()
    .arc(0, -r * 0.04, r * 0.79, Math.PI * 0.18, Math.PI * 0.82)
    .stroke({ width: Math.max(1, r * 0.04), color: 0x754631, alpha: 0.28 });
  placeholder.addChild(ears, face, hair, brows, eyes, lids, nose, mouth, jaw);
  portraitLayer.addChild(placeholder);

  // Forged rim lighting plus tiny status runes make the boss read as belonging
  // to the same runtime world as the arena without borrowing an external IP.
  const frame = new Graphics()
    .arc(0, 0, r + 1, Math.PI * 1.07, Math.PI * 1.7)
    .stroke({ width: Math.max(1.5, r * 0.09), color: COLORS.memo, alpha: 0.74 })
    .arc(0, 0, r + 3, -Math.PI * 0.18, Math.PI * 0.38)
    .stroke({ width: Math.max(1, r * 0.065), color: COLORS.grease, alpha: 0.64 })
    .arc(0, 0, r + 3, Math.PI * 0.46, Math.PI * 0.86)
    .stroke({ width: Math.max(1, r * 0.055), color: COLORS.pool, alpha: 0.58 })
    .rect(-r - 5, -r * 0.18, Math.max(2, r * 0.12), r * 0.36)
    .fill({ color: COLORS.pool, alpha: 0.72 })
    .rect(r + 2, -r * 0.18, Math.max(2, r * 0.12), r * 0.36)
    .fill({ color: COLORS.grease, alpha: 0.72 })
    .circle(-r * 0.34, r + 3, Math.max(1, r * 0.04))
    .fill({ color: COLORS.support })
    .circle(0, r + 4, Math.max(1, r * 0.04))
    .fill({ color: COLORS.pool })
    .circle(r * 0.34, r + 3, Math.max(1, r * 0.04))
    .fill({ color: COLORS.grease });
  root.addChild(mount, shadow, rim, portraitLayer, frame);

  if (photoUrl) {
    void Assets.load<Texture>({ src: photoUrl, parser: "loadTextures" })
      .then((texture) => {
        if (root.destroyed) return;
        const photo = new Sprite(texture);
        // The bundled key art is a head-and-shoulders portrait, so crop it
        // tighter inside the medallion. User-supplied overrides retain the
        // neutral fit that works for conventional face photos.
        const isBundledPortrait =
          photoUrl === "/assets/justin-avatar-v2.png" ||
          photoUrl === "/assets/justin-avatar-v3.png";
        const cropZoom = isBundledPortrait ? 1.42 : 1;
        const scale = ((size - 4) * cropZoom) / Math.min(texture.width, texture.height);
        photo.scale.set(scale);
        photo.anchor.set(0.5);
        photo.y = isBundledPortrait ? r * 0.18 : 0;
        const mask = new Graphics().circle(0, 0, r - 2).fill({ color: 0xffffff });
        const wrap = new Container();
        wrap.addChild(photo, mask);
        photo.mask = mask;
        placeholder.visible = false;
        portraitLayer.addChild(wrap);
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
  const mount = new Graphics()
    .poly([
      -r * 0.68, r * 0.6,
      -r * 0.88, r * 1.08,
      0, r * 1.25,
      r * 0.88, r * 1.08,
      r * 0.68, r * 0.6,
    ])
    .fill({ color: COLORS.void })
    .poly([-r * 0.5, r * 0.7, 0, r * 1.1, r * 0.5, r * 0.7])
    .fill({ color: COLORS.aluminumDark });
  const rim = new Graphics()
    .circle(2, 4, r + 5)
    .fill({ color: 0x000000, alpha: 0.44 })
    .circle(0, 0, r + 4)
    .fill({ color: COLORS.void })
    .circle(0, 0, r + 2)
    .fill({ color: COLORS.aluminumDark })
    .circle(0, 0, r - 1)
    .fill({ color: COLORS.drownBlue })
    .ellipse(-r * 0.22, -r * 0.28, r * 0.36, r * 0.24)
    .fill({ color: 0xb7d5e3, alpha: 0.25 })
    .ellipse(r * 0.35, r * 0.15, r * 0.28, r * 0.52)
    .fill({ color: 0x37637c, alpha: 0.18 });
  const x = (cx: number) =>
    new Graphics()
      .moveTo(cx - r * 0.12, -r * 0.22)
      .lineTo(cx + r * 0.12, r * 0.02)
      .moveTo(cx + r * 0.12, -r * 0.22)
      .lineTo(cx - r * 0.12, r * 0.02)
      .stroke({ width: Math.max(2, r * 0.08), color: 0x1d3a52 });
  const mouth = new Graphics()
    .circle(0, r * 0.45, r * 0.14)
    .fill({ color: 0x1d3a52 })
    .circle(r * 0.04, r * 0.4, r * 0.035)
    .fill({ color: 0xb7d5e3, alpha: 0.55 });
  const frame = new Graphics()
    .arc(0, 0, r + 2, Math.PI * 1.07, Math.PI * 1.68)
    .stroke({ width: Math.max(1.5, r * 0.08), color: COLORS.memo, alpha: 0.58 })
    .arc(0, 0, r + 3, -Math.PI * 0.14, Math.PI * 0.36)
    .stroke({ width: Math.max(1, r * 0.06), color: COLORS.pool, alpha: 0.72 });
  root.addChild(mount, rim, x(-r * 0.35), x(r * 0.35), mouth, frame);
  return root;
}

/* ── Character anatomy ────────────────────────────────────────────────────── */

export interface JointedLimbOptions {
  width: number;
  color: number;
  /** Optional exposed hand/boot at the final point. Pass 0 to omit it. */
  endColor?: number;
  endHighlight?: number;
  /** Thin material highlight painted inside the main limb stroke. */
  highlight?: number;
  outline?: number;
}

/**
 * A retained, jointed character limb. The broad dark under-stroke supplies a
 * strong action-game silhouette, the inset stroke supplies the material, and
 * joint caps keep sharp two-segment poses from reading as wire-frame elbows.
 * Every layer is built once at scene mount; calling this has no frame cost.
 */
export function makeJointedLimb(
  points: ReadonlyArray<readonly [number, number]>,
  options: JointedLimbOptions,
): Container {
  const root = new Container();
  if (points.length < 2) return root;

  const outlineWidth = options.width + Math.max(2, options.width * 0.42);
  const drawPath = (g: Graphics): Graphics => {
    g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
    return g;
  };

  const outline = drawPath(new Graphics()).stroke({
    width: outlineWidth,
    color: options.outline ?? COLORS.void,
    cap: "round",
    join: "round",
  });
  const material = drawPath(new Graphics()).stroke({
    width: options.width,
    color: options.color,
    cap: "round",
    join: "round",
  });
  const sheen = drawPath(new Graphics()).stroke({
    width: Math.max(1, options.width * 0.22),
    color: options.highlight ?? COLORS.aluminumLight,
    alpha: 0.44,
    cap: "round",
    join: "round",
  });
  const joints = new Graphics();
  for (let i = 1; i < points.length - 1; i++) {
    joints
      .circle(points[i][0], points[i][1], options.width * 0.64)
      .fill({ color: options.outline ?? COLORS.void })
      .circle(points[i][0], points[i][1], options.width * 0.42)
      .fill({ color: options.color });
  }

  root.addChild(outline, material, sheen, joints);
  if (options.endColor) {
    const [x, y] = points[points.length - 1];
    root.addChild(
      new Graphics()
        .circle(x + 1, y + 2, options.width * 0.76)
        .fill({ color: COLORS.void, alpha: 0.86 })
        .circle(x, y, options.width * 0.59)
        .fill({ color: options.endColor })
        .arc(x - options.width * 0.1, y - options.width * 0.08, options.width * 0.43, Math.PI * 1.05, Math.PI * 1.7)
        .stroke({
          width: Math.max(1, options.width * 0.12),
          color: options.endHighlight ?? COLORS.skinLight,
          alpha: 0.48,
        }),
    );
  }
  return root;
}

/* ── Justin's full-body rig ───────────────────────────────────────────────── */

/**
 * Justin's forged executive rig. The public API and local coordinate contract
 * stay unchanged: normal scenes get a torso from y=0..height, while the very
 * long pin-the-boss plank is detected by aspect ratio and lays its torso near
 * the head end. Everything is static Graphics, so the richer silhouette adds
 * no per-frame work.
 */
export function makeBody(width: number, height: number): Container {
  const root = new Container();
  const longRig = height > width * 2.2; // only pin-the-boss uses the body as a long plank
  const chestH = longRig ? Math.min(height * 0.42, width * 1.62) : height * 0.72;
  const chestY = longRig ? height - chestH : 0;
  const beltY = chestY + chestH * 0.7;
  const bootH = Math.max(6, Math.min(width * 0.3, height * 0.2));
  const bootY = longRig ? 0 : height - bootH;

  // The full-body shadow is intentionally a single strong shape: it survives
  // phone-scale downsampling and keeps the character readable over any scene.
  const silhouette = new Graphics()
    .roundRect(-width / 2 - 2, -2, width + 4, height + 5, width * 0.27)
    .fill({ color: COLORS.void })
    .roundRect(-width * 0.72, chestY + 1, width * 1.44, chestH * 0.24, width * 0.16)
    .fill({ color: COLORS.void });

  // Lower rig: split armored trousers. On the long pin plank this stretches
  // from the hinge boots to the chest near the head, correcting the old giant
  // stretched-lapel look without changing scene code.
  const lowerEnd = longRig ? chestY + chestH * 0.18 : height - bootH * 0.62;
  const lowerStart = longRig ? bootH * 0.56 : beltY - 1;
  const lowerH = Math.max(2, lowerEnd - lowerStart);
  const lowerRig = new Graphics()
    .roundRect(-width * 0.43, lowerStart, width * 0.39, lowerH, width * 0.1)
    .fill({ color: 0x111820 })
    .roundRect(width * 0.04, lowerStart, width * 0.39, lowerH, width * 0.1)
    .fill({ color: 0x1b252e })
    .moveTo(0, lowerStart + 2)
    .lineTo(0, lowerStart + lowerH - 2)
    .stroke({ width: Math.max(1, width * 0.035), color: COLORS.aluminumDark, alpha: 0.72 });

  // Articulated knee plates break the long trouser shapes into believable
  // upper/lower leg masses, especially in the pin and swim rotations.
  const kneeY = lowerStart + lowerH * 0.54;
  const knees = new Graphics()
    .roundRect(-width * 0.44, kneeY - width * 0.08, width * 0.4, width * 0.22, width * 0.07)
    .fill({ color: COLORS.aluminumDark, alpha: 0.92 })
    .roundRect(width * 0.04, kneeY - width * 0.08, width * 0.4, width * 0.22, width * 0.07)
    .fill({ color: 0x3b4853, alpha: 0.9 })
    .moveTo(-width * 0.39, kneeY - width * 0.02)
    .lineTo(-width * 0.1, kneeY - width * 0.02)
    .moveTo(width * 0.1, kneeY - width * 0.02)
    .lineTo(width * 0.39, kneeY - width * 0.02)
    .stroke({ width: Math.max(1, width * 0.03), color: COLORS.aluminumLight, alpha: 0.42 });

  // Forged boots stay inside the original y bounds. Toe plates extend sideways
  // for a readable stance but do not alter any scene's feet/origin math.
  const boots = new Graphics()
    .roundRect(-width * 0.52, bootY, width * 0.43, bootH, width * 0.1)
    .fill({ color: COLORS.void })
    .roundRect(width * 0.09, bootY, width * 0.43, bootH, width * 0.1)
    .fill({ color: COLORS.void })
    .rect(-width * 0.47, bootY + 1, width * 0.32, Math.max(2, bootH * 0.35))
    .fill({ color: COLORS.aluminumDark })
    .rect(width * 0.15, bootY + 1, width * 0.32, Math.max(2, bootH * 0.35))
    .fill({ color: COLORS.aluminumDark })
    .moveTo(-width * 0.48, bootY + bootH - 1)
    .lineTo(-width * 0.11, bootY + bootH - 1)
    .moveTo(width * 0.11, bootY + bootH - 1)
    .lineTo(width * 0.48, bootY + bootH - 1)
    .stroke({ width: Math.max(1, width * 0.045), color: COLORS.aluminumLight, alpha: 0.48 });

  // Main executive cuirass: dark SaaS-runtime armor built out of layered
  // blazer language rather than medieval costume.
  const coat = new Graphics()
    .roundRect(-width / 2, chestY, width, chestH, width * 0.25)
    .fill({ color: 0x26313b })
    .roundRect(-width / 2 + 3, chestY + 3, width - 6, Math.max(3, chestH - 6), width * 0.18)
    .fill({ color: 0x151d27 })
    .roundRect(-width * 0.42, chestY + chestH * 0.56, width * 0.84, chestH * 0.35, width * 0.12)
    .fill({ color: 0x10171e, alpha: 0.82 });
  const coatPlanes = new Graphics()
    // cool key-light plane on the near lapel/oblique
    .poly([
      -width * 0.43, chestY + chestH * 0.2,
      -width * 0.08, chestY + chestH * 0.44,
      -width * 0.16, chestY + chestH * 0.87,
      -width * 0.43, chestY + chestH * 0.7,
    ])
    .fill({ color: 0x52606b, alpha: 0.24 })
    // warm reflected arena light on the far flank
    .poly([
      width * 0.34, chestY + chestH * 0.2,
      width * 0.46, chestY + chestH * 0.3,
      width * 0.4, chestY + chestH * 0.74,
      width * 0.22, chestY + chestH * 0.84,
    ])
    .fill({ color: COLORS.grease, alpha: 0.075 })
    // lower coat seam / armored waist articulation
    .moveTo(-width * 0.39, chestY + chestH * 0.68)
    .quadraticCurveTo(0, chestY + chestH * 0.76, width * 0.39, chestY + chestH * 0.68)
    .stroke({ width: Math.max(1, width * 0.035), color: COLORS.aluminum, alpha: 0.36 });
  const shoulders = new Graphics()
    .roundRect(-width * 0.7, chestY + 2, width * 0.38, chestH * 0.2, width * 0.12)
    .fill({ color: COLORS.void })
    .roundRect(width * 0.32, chestY + 2, width * 0.38, chestH * 0.2, width * 0.12)
    .fill({ color: COLORS.void })
    .roundRect(-width * 0.66, chestY + 3, width * 0.31, chestH * 0.13, width * 0.09)
    .fill({ color: COLORS.aluminumDark })
    .roundRect(width * 0.35, chestY + 3, width * 0.31, chestH * 0.13, width * 0.09)
    .fill({ color: COLORS.aluminumDark })
    .moveTo(-width * 0.62, chestY + 5)
    .lineTo(-width * 0.39, chestY + 5)
    .moveTo(width * 0.39, chestY + 5)
    .lineTo(width * 0.62, chestY + 5)
    .stroke({ width: Math.max(1, width * 0.045), color: COLORS.aluminumLight, alpha: 0.45 });

  const collar = new Graphics()
    .poly([
      -width * 0.32, chestY + 2,
      -width * 0.06, chestY + chestH * 0.2,
      0, chestY + 2,
    ])
    .fill({ color: COLORS.memo, alpha: 0.9 })
    .poly([
      width * 0.32, chestY + 2,
      width * 0.06, chestY + chestH * 0.2,
      0, chestY + 2,
    ])
    .fill({ color: COLORS.aluminumLight, alpha: 0.8 });
  const lapels = new Graphics()
    .poly([
      -width * 0.41, chestY + 4,
      -width * 0.08, chestY + chestH * 0.43,
      0, chestY + 3,
    ])
    .fill({ color: 0x3b4853 })
    .poly([
      width * 0.41, chestY + 4,
      width * 0.08, chestY + chestH * 0.43,
      0, chestY + 3,
    ])
    .fill({ color: 0x3b4853 });
  const tie = new Graphics()
    .poly([
      0, chestY + chestH * 0.12,
      width * 0.1, chestY + chestH * 0.35,
      0, chestY + chestH * 0.58,
      -width * 0.1, chestY + chestH * 0.35,
    ])
    .fill({ color: COLORS.grievance })
    .circle(0, chestY + chestH * 0.72, Math.max(1.5, width * 0.045))
    .fill({ color: COLORS.grease, alpha: 0.82 });

  // A neck guard connects portrait and torso, avoiding the paper-doll gap
  // that becomes obvious when the character leans or rotates in event poses.
  const neckGuard = new Graphics()
    .roundRect(-width * 0.22, chestY - width * 0.08, width * 0.44, width * 0.24, width * 0.08)
    .fill({ color: COLORS.void })
    .roundRect(-width * 0.15, chestY - width * 0.045, width * 0.3, width * 0.14, width * 0.05)
    .fill({ color: COLORS.skin })
    .moveTo(-width * 0.12, chestY - width * 0.015)
    .lineTo(width * 0.08, chestY - width * 0.015)
    .stroke({ width: Math.max(1, width * 0.028), color: COLORS.skinLight, alpha: 0.5 });

  // A tiny abstract deployment core and route line: readable as a badge at
  // phone size, richer status detail at TV size, and never tied to live data.
  const runtimeBadge = new Graphics()
    .poly([
      width * 0.24, chestY + chestH * 0.23,
      width * 0.34, chestY + chestH * 0.29,
      width * 0.34, chestY + chestH * 0.4,
      width * 0.24, chestY + chestH * 0.46,
      width * 0.14, chestY + chestH * 0.4,
      width * 0.14, chestY + chestH * 0.29,
    ])
    .stroke({ width: Math.max(1, width * 0.035), color: COLORS.pool, alpha: 0.7 })
    .circle(width * 0.24, chestY + chestH * 0.345, Math.max(1, width * 0.03))
    .fill({ color: COLORS.support })
    .moveTo(width * 0.14, chestY + chestH * 0.345)
    .lineTo(-width * 0.16, chestY + chestH * 0.345)
    .lineTo(-width * 0.16, chestY + chestH * 0.52)
    .stroke({ width: Math.max(1, width * 0.025), color: COLORS.pool, alpha: 0.32 });

  // Hands are armored cuffs with a warm fingertip core. Scene-specific arms
  // draw over them, so pole pushing, climbing, swimming, and rope poses still
  // connect naturally without changing any scene builder.
  const handY = chestY + chestH * 0.46;
  const hands = new Graphics()
    .roundRect(-width * 0.69, handY - width * 0.11, width * 0.27, width * 0.24, width * 0.08)
    .fill({ color: COLORS.aluminumDark })
    .circle(-width * 0.63, handY, Math.max(2.2, width * 0.095))
    .fill({ color: COLORS.skin })
    .roundRect(width * 0.42, handY - width * 0.11, width * 0.27, width * 0.24, width * 0.08)
    .fill({ color: COLORS.aluminumDark })
    .circle(width * 0.63, handY, Math.max(2.2, width * 0.095))
    .fill({ color: COLORS.skin })
    .moveTo(-width * 0.67, handY - width * 0.08)
    .lineTo(-width * 0.48, handY - width * 0.08)
    .moveTo(width * 0.48, handY - width * 0.08)
    .lineTo(width * 0.67, handY - width * 0.08)
    .stroke({ width: Math.max(1, width * 0.035), color: COLORS.aluminumLight, alpha: 0.52 });

  const rimLight = new Graphics()
    .moveTo(-width / 2 + 2, chestY + chestH * 0.19)
    .lineTo(-width / 2 + 2, chestY + chestH * 0.78)
    .stroke({ width: Math.max(1, width * 0.05), color: COLORS.aluminumLight, alpha: 0.48 })
    .moveTo(width / 2 - 2, chestY + chestH * 0.25)
    .lineTo(width / 2 - 2, chestY + chestH * 0.64)
    .stroke({ width: Math.max(1, width * 0.035), color: COLORS.grease, alpha: 0.32 });
  root.addChild(
    silhouette,
    lowerRig,
    knees,
    boots,
    shoulders,
    coat,
    coatPlanes,
    neckGuard,
    collar,
    lapels,
    tie,
    runtimeBadge,
    hands,
    rimLight,
  );
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
