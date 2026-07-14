/**
 * Persistent, scene-independent cinematic direction for GameCanvas.
 *
 * The director owns two retained Pixi layers: an atmospheric underlay and a
 * finishing overlay. It deliberately knows nothing about individual scene
 * implementations, so scene swaps cannot tear down the fog, dust, vignette,
 * transition card, or impact wash. All display objects are allocated at
 * mount time and then reused; update() only mutates transforms and alpha.
 *
 * No filters are used here. The soft-looking atmosphere is built from
 * overlapping translucent geometry, which keeps the controller view cheap
 * and avoids allocating render textures on every phone.
 */

import { Container, Graphics, Text } from "pixi.js";
import type { FxEvent } from "@/lib/game/engine/types";
import type { Snapshot } from "@/lib/realtime/protocol";

const DISPLAY_FONT = ["Arial Narrow", "Helvetica Neue", "Roboto Condensed", "sans-serif"];
const INK = 0x06090f;
const ALUMINUM = 0xd9dde2;
const GREASE = 0xd9a514;
const GRIEVANCE = 0xd74747;
const SIGNAL = 0x4bc4d5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const mix = (from: number, to: number, t: number) => from + (to - from) * t;
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / Math.max(0.0001, to - from));
  return t * t * (3 - 2 * t);
};

/** Stable pseudo-random values make mount deterministic and QA repeatable. */
function seeded(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 91.173 + salt * 47.771) * 43758.5453;
  return value - Math.floor(value);
}

export interface CinematicDirectorOptions {
  reducedMotion: boolean;
  /** 0..1; GameCanvas currently uses 1 for broadcast and 0.6 for phones. */
  visualDensity: number;
  /** Compact controller stages keep atmosphere/camera but omit title cards. */
  editorialTransitions?: boolean;
}

export interface CinematicTransitionOptions {
  /** Override the automatically derived headline. */
  title?: string;
  /** Override the automatically derived eyebrow/subtitle. */
  subtitle?: string;
  /** RGB number used for the rule, wash, and title edge light. */
  accent?: number;
  /** Full interstitial for a scene change, compact sting for a phase change. */
  kind?: "scene" | "phase";
  /** Replay even if this snapshot has already been directed. */
  force?: boolean;
}

export interface CinematicUpdateArgs {
  snap: Snapshot;
  fx: readonly FxEvent[];
  dtMs: number;
  width: number;
  height: number;
}

export interface CinematicCameraPulse {
  /** Apply around the logical viewport center, not the scene origin. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface CinematicFrame {
  /** A stable object reused on every update; consume its values immediately. */
  camera: CinematicCameraPulse;
  /** True while letterbox/title choreography is visible. */
  transitioning: boolean;
}

interface SmokeWisp {
  graphic: Graphics;
  x: number;
  y: number;
  baseScale: number;
  speedX: number;
  speedY: number;
  phase: number;
  phaseSpeed: number;
  depth: number;
}

interface DustMote {
  graphic: Graphics;
  x: number;
  y: number;
  speedX: number;
  speedY: number;
  phase: number;
  phaseSpeed: number;
  alpha: number;
}

interface ShadowPass {
  graphic: Graphics;
  x: number;
  speed: number;
  phase: number;
}

function phaseTitle(snap: Snapshot): string {
  switch (snap.phase) {
    case "lobby":
      return "THE ARENA AWAITS";
    case "grievance_write":
      return "AIRING OF GRIEVANCES";
    case "grievance_reveal":
      return "THE GRIEVANCES";
    case "event_countdown":
      return snap.eventMeta?.name ?? "FEAT OF STRENGTH";
    case "event_active":
      return "FEAT LIVE";
    case "event_outcome":
      return "FEAT RESOLVED";
    case "finale":
      return "FINAL VERDICT";
    case "splash":
      return "THE FEATS ARE COMPLETE";
    default:
      return "FEATS OF STRENGTH";
  }
}

function phaseSubtitle(snap: Snapshot): string {
  if (snap.phase === "event_countdown" && snap.eventMeta) {
    return `FEAT ${snap.eventMeta.index + 1} / ${snap.eventMeta.total}`;
  }
  switch (snap.phase) {
    case "event_active":
      return snap.eventMeta?.name ?? "MASH NOW";
    case "event_outcome":
      return "THE ARENA HAS SPOKEN";
    case "finale":
      return "THE DEPLOYMENT IS SEALED";
    case "grievance_write":
      return "ANONYMOUS • UNFILTERED • THREE PER PLAYER";
    case "grievance_reveal":
      return "READ INTO THE RECORD";
    case "splash":
      return "A FESTIVUS MIRACLE";
    default:
      return "JUSTIN'S ALL-HANDS ARENA";
  }
}

function phaseAccent(snap: Snapshot): number {
  switch (snap.phase) {
    case "grievance_write":
    case "grievance_reveal":
      return GRIEVANCE;
    case "event_active":
      return SIGNAL;
    case "event_outcome":
    case "finale":
    case "splash":
      return GREASE;
    default:
      return ALUMINUM;
  }
}

/**
 * Global cinematic layer. Create one for the lifetime of one Pixi Application.
 */
export class CinematicDirector {
  /** Add below scene content. Public for advanced ordering/debug tooling. */
  readonly underlay = new Container();
  /** Add above scene content. Public for advanced ordering/debug tooling. */
  readonly overlay = new Container();

  private readonly fogUnder = new Container();
  private readonly fogOver = new Container();
  private readonly dustLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly vignette = new Container();
  private readonly letterbox = new Container();
  private readonly titleCard = new Container();
  private readonly colorBed = new Graphics();
  private readonly impactWash = new Graphics();
  private readonly topShade = new Graphics();
  private readonly bottomShade = new Graphics();
  private readonly leftShade = new Graphics();
  private readonly rightShade = new Graphics();
  private readonly topBar = new Graphics();
  private readonly bottomBar = new Graphics();
  private readonly titleRule = new Graphics();
  private readonly title = new Text({
    text: "",
    style: {
      fontFamily: DISPLAY_FONT,
      fontSize: 48,
      fontWeight: "800",
      fill: ALUMINUM,
      align: "center",
      letterSpacing: 3,
      dropShadow: {
        color: INK,
        alpha: 0.9,
        blur: 8,
        distance: 3,
      },
    },
  });
  private readonly subtitle = new Text({
    text: "",
    style: {
      fontFamily: DISPLAY_FONT,
      fontSize: 14,
      fontWeight: "700",
      fill: ALUMINUM,
      align: "center",
      letterSpacing: 4,
    },
  });

  private readonly smoke: SmokeWisp[] = [];
  private readonly dust: DustMote[] = [];
  private readonly shadows: ShadowPass[] = [];
  private readonly frame: CinematicFrame = {
    camera: { x: 0, y: 0, scale: 1, rotation: 0 },
    transitioning: false,
  };

  private readonly reducedMotion: boolean;
  private readonly density: number;
  private readonly editorialTransitions: boolean;
  private width = 1;
  private height = 1;
  private laidOut = false;
  private mounted = false;
  private elapsedMs = 0;
  private transitionMs = -1;
  private transitionDurationMs = 0;
  private transitionKind: "scene" | "phase" = "phase";
  private directedPhase: Snapshot["phase"] | null = null;
  private directedEventId: string | null = null;
  private impact = 0;
  private impactColor = ALUMINUM;
  private currentAccent = ALUMINUM;
  private pulse = 0;
  private pulsePhase = 0;

  constructor(options: CinematicDirectorOptions) {
    this.reducedMotion = options.reducedMotion;
    this.density = clamp(options.visualDensity, 0, 1);
    this.editorialTransitions = options.editorialTransitions ?? true;

    this.underlay.label = "cinematic-underlay";
    this.overlay.label = "cinematic-overlay";
    this.fogUnder.label = "cinematic-fog-under";
    this.fogOver.label = "cinematic-fog-over";
    this.overlay.eventMode = "none";
    this.underlay.eventMode = "none";

    this.underlay.addChild(this.colorBed, this.fogUnder);
    this.overlay.addChild(
      this.shadowLayer,
      this.fogOver,
      this.dustLayer,
      this.vignette,
      this.impactWash,
      this.letterbox,
      this.titleCard,
    );
    this.vignette.addChild(this.topShade, this.bottomShade, this.leftShade, this.rightShade);
    this.letterbox.addChild(this.topBar, this.bottomBar);
    this.titleCard.addChild(this.titleRule, this.title, this.subtitle);
    this.title.anchor.set(0.5);
    this.subtitle.anchor.set(0.5);
    this.titleCard.visible = false;
    this.impactWash.alpha = 0;

    this.buildAtmosphere();
  }

  /**
   * Mounts the persistent layers around contentLayer in one ordered operation.
   * The director never destroys or reparents contentLayer afterward.
   */
  mount(stage: Container, contentLayer: Container, width: number, height: number): void {
    if (this.mounted) return;
    stage.addChild(this.underlay, contentLayer, this.overlay);
    this.mounted = true;
    this.resize(width, height);
  }

  /** Resize retained geometry only when the viewport actually changes. */
  resize(width: number, height: number): void {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (this.laidOut && nextWidth === this.width && nextHeight === this.height) return;

    const scaleX = nextWidth / (this.laidOut ? this.width : 1280);
    const scaleY = nextHeight / (this.laidOut ? this.height : 720);
    this.width = nextWidth;
    this.height = nextHeight;
    this.laidOut = true;

    this.colorBed.clear().rect(0, 0, nextWidth, nextHeight).fill({ color: INK, alpha: 0.16 });
    this.impactWash.clear().rect(0, 0, nextWidth, nextHeight).fill({ color: 0xffffff });

    const vertical = Math.max(34, nextHeight * 0.1);
    const horizontal = Math.max(28, nextWidth * 0.055);
    this.topShade.clear().rect(0, 0, nextWidth, vertical).fill({ color: INK, alpha: 0.5 });
    this.bottomShade
      .clear()
      .rect(0, nextHeight - vertical, nextWidth, vertical)
      .fill({ color: INK, alpha: 0.58 });
    this.leftShade.clear().rect(0, 0, horizontal, nextHeight).fill({ color: INK, alpha: 0.34 });
    this.rightShade
      .clear()
      .rect(nextWidth - horizontal, 0, horizontal, nextHeight)
      .fill({ color: INK, alpha: 0.34 });

    const maxBarHeight = Math.max(42, nextHeight * 0.12);
    this.topBar.clear().rect(0, 0, nextWidth, maxBarHeight).fill({ color: INK, alpha: 0.98 });
    this.bottomBar
      .clear()
      .rect(0, -maxBarHeight, nextWidth, maxBarHeight)
      .fill({ color: INK, alpha: 0.98 });
    this.bottomBar.position.set(0, nextHeight);

    this.title.position.set(nextWidth / 2, nextHeight * 0.46);
    this.subtitle.position.set(nextWidth / 2, nextHeight * 0.46 + 48);
    this.titleCard.pivot.set(nextWidth / 2, nextHeight * 0.46);
    this.titleCard.position.set(nextWidth / 2, nextHeight * 0.46);
    this.title.style.fontSize = clamp(nextWidth * 0.047, 28, 58);
    this.subtitle.style.fontSize = clamp(nextWidth * 0.014, 10, 16);
    this.layoutTitleRule(this.currentAccent);

    if (scaleX !== 1 || scaleY !== 1) {
      for (let i = 0; i < this.smoke.length; i++) {
        this.smoke[i].x *= scaleX;
        this.smoke[i].y *= scaleY;
      }
      for (let i = 0; i < this.dust.length; i++) {
        this.dust[i].x *= scaleX;
        this.dust[i].y *= scaleY;
      }
    }

    this.layoutShadows();
  }

  /**
   * Starts a title/letterbox beat. update() invokes this automatically when
   * the phase or event id changes; callers can force editorial moments.
   */
  transition(snap: Snapshot, options?: CinematicTransitionOptions): void {
    const nextEvent = snap.eventMeta?.id ?? null;
    if (
      !options?.force &&
      snap.phase === this.directedPhase &&
      nextEvent === this.directedEventId
    ) {
      return;
    }
    const previousEvent = this.directedEventId;
    this.directedPhase = snap.phase;
    this.directedEventId = nextEvent;

    this.transitionKind =
      options?.kind ??
      (previousEvent !== nextEvent || snap.phase === "event_countdown" ? "scene" : "phase");
    this.transitionDurationMs = this.reducedMotion
      ? 850
      : this.transitionKind === "scene"
        ? 2100
        : 1050;
    this.transitionMs = 0;

    const accent = options?.accent ?? phaseAccent(snap);
    this.currentAccent = accent;
    if (!this.editorialTransitions) {
      this.transitionMs = -1;
      this.titleCard.visible = false;
      this.topBar.scale.y = 0;
      this.bottomBar.scale.y = 0;
      return;
    }

    this.title.text = (options?.title ?? phaseTitle(snap)).toUpperCase();
    this.subtitle.text = (options?.subtitle ?? phaseSubtitle(snap)).toUpperCase();
    this.title.style.fill = accent;
    this.subtitle.style.fill = accent === ALUMINUM ? ALUMINUM : 0xe9edf0;
    this.layoutTitleRule(accent);
    // Event scenes already carry bespoke countdown and result typography.
    // Keep the director's bars/wash/camera beat, but do not stack a second
    // headline over those authored cards. Global match phases still receive
    // the persistent director title treatment.
    this.titleCard.visible = !snap.phase.startsWith("event_");

    // A scene cut gets a soft editorial wash, never a full-screen white pop.
    if (!this.reducedMotion && this.transitionKind === "scene") {
      this.impactColor = accent;
      this.impactWash.tint = accent;
      this.impact = Math.max(this.impact, 0.18);
    }
  }

  /** Update atmosphere, transitions, and impact response; returns camera data. */
  update(args: CinematicUpdateArgs): CinematicFrame {
    if (args.width !== this.width || args.height !== this.height) {
      this.resize(args.width, args.height);
    }
    const eventId = args.snap.eventMeta?.id ?? null;
    if (args.snap.phase !== this.directedPhase || eventId !== this.directedEventId) {
      this.transition(args.snap);
    }

    const dtMs = clamp(args.dtMs, 0, 80);
    const dt = dtMs / 1000;
    this.elapsedMs += dtMs;

    this.consumeFx(args.fx);
    this.updateSmoke(dt);
    this.updateDust(dt);
    this.updateShadows(dt);
    this.updateVignette();
    this.updateTransition(dtMs);
    this.updateImpact(dtMs);
    this.updateCamera(dtMs);
    return this.frame;
  }

  destroy(): void {
    if (this.underlay.parent) this.underlay.parent.removeChild(this.underlay);
    if (this.overlay.parent) this.overlay.parent.removeChild(this.overlay);
    this.underlay.destroy({ children: true });
    this.overlay.destroy({ children: true });
    this.smoke.length = 0;
    this.dust.length = 0;
    this.shadows.length = 0;
    this.mounted = false;
  }

  private buildAtmosphere(): void {
    const smokeCount = Math.round((this.reducedMotion ? 7 : 15) * this.density);
    for (let i = 0; i < smokeCount; i++) {
      const graphic = new Graphics();
      const tone = i % 3 === 0 ? SIGNAL : i % 3 === 1 ? ALUMINUM : GREASE;
      const radius = 62 + seeded(i, 2) * 95;
      // Several overlapping lobes read as soft fog once their alpha is low.
      graphic
        .ellipse(-radius * 0.45, 0, radius, radius * 0.34)
        .fill({ color: tone, alpha: 0.022 })
        .ellipse(radius * 0.35, -radius * 0.08, radius * 0.78, radius * 0.28)
        .fill({ color: tone, alpha: 0.017 })
        .ellipse(0, radius * 0.12, radius * 1.2, radius * 0.25)
        .fill({ color: ALUMINUM, alpha: 0.012 });
      const depth = seeded(i, 4);
      (depth > 0.72 ? this.fogOver : this.fogUnder).addChild(graphic);
      this.smoke.push({
        graphic,
        x: seeded(i, 6) * 1280,
        y: 120 + seeded(i, 7) * 560,
        baseScale: 0.55 + seeded(i, 8) * 0.7,
        speedX: 4 + seeded(i, 9) * 13,
        speedY: -1.5 - seeded(i, 10) * 4,
        phase: seeded(i, 11) * Math.PI * 2,
        phaseSpeed: 0.05 + seeded(i, 12) * 0.11,
        depth,
      });
    }

    const dustCount = Math.round((this.reducedMotion ? 16 : 42) * this.density);
    for (let i = 0; i < dustCount; i++) {
      const graphic = new Graphics()
        .circle(0, 0, 0.8 + seeded(i, 14) * 1.6)
        .fill({ color: i % 5 === 0 ? GREASE : ALUMINUM, alpha: 1 });
      this.dustLayer.addChild(graphic);
      this.dust.push({
        graphic,
        x: seeded(i, 15) * 1280,
        y: seeded(i, 16) * 720,
        speedX: -2 + seeded(i, 17) * 7,
        speedY: -3 - seeded(i, 18) * 10,
        phase: seeded(i, 19) * Math.PI * 2,
        phaseSpeed: 0.5 + seeded(i, 20) * 1.4,
        alpha: 0.08 + seeded(i, 21) * 0.24,
      });
    }

    const shadowCount =
      this.density < 0.05
        ? 0
        : this.reducedMotion
          ? 1
          : Math.max(1, Math.round(3 * this.density));
    for (let i = 0; i < shadowCount; i++) {
      const graphic = new Graphics();
      this.shadowLayer.addChild(graphic);
      this.shadows.push({
        graphic,
        x: seeded(i, 23) * 1280,
        speed: 4 + seeded(i, 24) * 9,
        phase: seeded(i, 25) * Math.PI * 2,
      });
    }
  }

  private layoutShadows(): void {
    const shadowWidth = Math.max(180, this.width * 0.23);
    for (let i = 0; i < this.shadows.length; i++) {
      const pass = this.shadows[i];
      pass.graphic
        .clear()
        .poly([
          -shadowWidth,
          0,
          shadowWidth * 0.15,
          0,
          shadowWidth,
          this.height,
          -shadowWidth * 0.2,
          this.height,
        ])
        .fill({ color: INK, alpha: 0.075 });
    }
  }

  private layoutTitleRule(accent: number): void {
    const ruleWidth = clamp(this.width * 0.24, 120, 340);
    this.titleRule
      .clear()
      .rect(this.width / 2 - ruleWidth / 2, this.height * 0.46 + 27, ruleWidth, 2)
      .fill({ color: accent, alpha: 0.9 });
  }

  private consumeFx(fxEvents: readonly FxEvent[]): void {
    for (let i = 0; i < fxEvents.length; i++) {
      let strength = 0;
      let color = ALUMINUM;
      switch (fxEvents[i].type) {
        case "miracle":
          strength = 0.95;
          color = GREASE;
          break;
        case "pinned":
          strength = 1;
          color = GRIEVANCE;
          break;
        case "win":
          strength = 0.85;
          color = GREASE;
          break;
        case "lose":
          strength = 0.72;
          color = GRIEVANCE;
          break;
        case "sink":
          strength = 0.62;
          color = SIGNAL;
          break;
        case "countBroken":
          strength = 0.55;
          break;
        case "slip":
          strength = 0.38;
          color = GREASE;
          break;
        case "count":
          strength = 0.2;
          break;
      }
      if (strength <= 0) continue;
      this.pulse = Math.max(this.pulse, strength);
      if (!this.reducedMotion) {
        this.impact = Math.max(this.impact, strength);
        this.impactColor = color;
        this.impactWash.tint = color;
      }
    }
  }

  private updateSmoke(dt: number): void {
    const time = this.elapsedMs / 1000;
    for (let i = 0; i < this.smoke.length; i++) {
      const wisp = this.smoke[i];
      if (!this.reducedMotion) {
        wisp.x += wisp.speedX * dt;
        wisp.y += wisp.speedY * dt;
        if (wisp.x > this.width + 190) wisp.x = -190;
        if (wisp.y < -100) wisp.y = this.height + 100;
      }
      const breathe = this.reducedMotion ? 1 : 1 + Math.sin(time * wisp.phaseSpeed + wisp.phase) * 0.09;
      const viewportScale = clamp(this.width / 1280, 0.7, 1.25);
      wisp.graphic.position.set(wisp.x, wisp.y);
      wisp.graphic.scale.set(wisp.baseScale * breathe * viewportScale);
      wisp.graphic.rotation = this.reducedMotion ? 0 : Math.sin(time * 0.025 + wisp.phase) * 0.12;
      wisp.graphic.alpha = (0.5 + wisp.depth * 0.5) * this.density;
    }
  }

  private updateDust(dt: number): void {
    const time = this.elapsedMs / 1000;
    for (let i = 0; i < this.dust.length; i++) {
      const mote = this.dust[i];
      if (!this.reducedMotion) {
        mote.x += mote.speedX * dt;
        mote.y += mote.speedY * dt;
        if (mote.y < -8) {
          mote.y = this.height + 8;
          mote.x += this.width * 0.19;
          if (mote.x > this.width) mote.x -= this.width;
        }
        if (mote.x > this.width + 8) mote.x = -8;
        if (mote.x < -8) mote.x = this.width + 8;
      }
      mote.graphic.position.set(mote.x, mote.y);
      mote.graphic.alpha = this.reducedMotion
        ? mote.alpha * 0.45
        : mote.alpha * (0.55 + Math.sin(time * mote.phaseSpeed + mote.phase) * 0.45);
    }
  }

  private updateShadows(dt: number): void {
    const time = this.elapsedMs / 1000;
    for (let i = 0; i < this.shadows.length; i++) {
      const pass = this.shadows[i];
      if (!this.reducedMotion) {
        pass.x += pass.speed * dt;
        if (pass.x > this.width * 1.4) pass.x = -this.width * 0.45;
      }
      pass.graphic.x = pass.x;
      pass.graphic.alpha = this.reducedMotion ? 0.18 : 0.22 + Math.sin(time * 0.12 + pass.phase) * 0.1;
    }
  }

  private updateVignette(): void {
    const time = this.elapsedMs / 1000;
    this.vignette.alpha = this.reducedMotion ? 0.72 : 0.69 + Math.sin(time * 0.34) * 0.055;
  }

  private updateTransition(dtMs: number): void {
    if (this.transitionMs < 0) {
      this.frame.transitioning = false;
      return;
    }
    this.transitionMs += dtMs;
    const progress = clamp01(this.transitionMs / Math.max(1, this.transitionDurationMs));
    const full = this.transitionKind === "scene";
    const barIn = smoothstep(0, full ? 0.16 : 0.1, progress);
    const barOut = 1 - smoothstep(full ? 0.72 : 0.56, 1, progress);
    const bar = this.reducedMotion ? 0 : barIn * barOut * (full ? 1 : 0.48);
    this.topBar.scale.y = bar;
    this.bottomBar.scale.y = bar;

    const titleIn = smoothstep(full ? 0.1 : 0.04, full ? 0.24 : 0.16, progress);
    const titleOut = 1 - smoothstep(full ? 0.66 : 0.5, full ? 0.88 : 0.78, progress);
    const titleAlpha = titleIn * titleOut;
    this.titleCard.alpha = titleAlpha;
    this.titleCard.scale.set(
      this.reducedMotion ? 1 : mix(full ? 0.94 : 0.98, 1, smoothstep(0.08, 0.34, progress)),
    );
    this.titleCard.position.set(
      this.width / 2 + (this.reducedMotion ? 0 : Math.sin(progress * Math.PI) * -3),
      this.height * 0.46,
    );
    this.frame.transitioning = progress < 1;

    if (progress >= 1) {
      this.transitionMs = -1;
      this.titleCard.visible = false;
      this.topBar.scale.y = 0;
      this.bottomBar.scale.y = 0;
    }
  }

  private updateImpact(dtMs: number): void {
    this.impact *= Math.pow(0.005, dtMs / 1000);
    if (this.impact < 0.004) this.impact = 0;
    this.impactWash.alpha = this.reducedMotion ? 0 : Math.min(0.2, this.impact * 0.2);
    this.impactWash.tint = this.impactColor;
  }

  private updateCamera(dtMs: number): void {
    const camera = this.frame.camera;
    this.pulse *= Math.pow(0.008, dtMs / 1000);
    if (this.pulse < 0.004) this.pulse = 0;
    this.pulsePhase += dtMs * 0.043;

    if (this.reducedMotion || this.pulse === 0) {
      camera.x = 0;
      camera.y = 0;
      camera.scale = 1;
      camera.rotation = 0;
      return;
    }
    const wave = Math.sin(this.pulsePhase);
    const counterWave = Math.sin(this.pulsePhase * 1.71 + 1.1);
    camera.x = wave * this.pulse * 5.5;
    camera.y = counterWave * this.pulse * 3.5;
    camera.scale = 1 + Math.abs(wave) * this.pulse * 0.009;
    camera.rotation = counterWave * this.pulse * 0.0018;
  }
}

export function createCinematicDirector(options: CinematicDirectorOptions): CinematicDirector {
  return new CinematicDirector(options);
}
