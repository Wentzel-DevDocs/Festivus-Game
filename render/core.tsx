"use client";

/**
 * GameCanvas — the PixiJS stage both the boss broadcast and the phone
 * controller render.
 *
 * It owns exactly three jobs:
 *  1. Boot/destroy a Pixi Application sized to its container.
 *  2. Pick WHICH scene runs from the snapshot (event id / phase), mounting
 *     and unmounting scene modules from render/scenes/.
 *  3. INTERPOLATE between the last two server snapshots each frame so
 *     Justin glides at 60 fps even though truth arrives at ~25 Hz.
 *
 * Scenes are dumb renderers: they get the latest snapshot, a smoothed
 * numeric view, per-frame dt, and any transient fx — and draw.
 */

import { useEffect, useRef } from "react";
import { Application, Container } from "pixi.js";
import type { Snapshot } from "@/lib/realtime/protocol";
import type { EventView, FxEvent } from "@/lib/game/engine/types";
import type { RoomApi } from "@/lib/realtime/useRoom";
import { GAME_CONFIG } from "@/lib/game/config";
import { getSceneFactory } from "./scenes";

/* ── The contract every scene implements ─────────────────────────────────── */

export interface SceneServices {
  photoUrl: string;
  bossName: string;
  /** True when the viewer prefers reduced motion — tone down shakes/particles. */
  reducedMotion: boolean;
}

export interface SceneUpdateArgs {
  /** Latest authoritative snapshot (un-interpolated). */
  snap: Snapshot;
  /** The event view with NUMERIC fields lerped between snapshots. */
  view: EventView | null;
  /** Interpolated headline positions. */
  justinProgress: number;
  tugPosition: number;
  dtMs: number;
  /** Transient fx arrived since last frame (play once). */
  fx: FxEvent[];
  width: number;
  height: number;
}

export interface Scene {
  mount(stage: Container, width: number, height: number, services: SceneServices): void;
  update(args: SceneUpdateArgs): void;
  unmount(): void;
}

export type SceneFactory = () => Scene;

/* ── Which scene for which moment ────────────────────────────────────────── */

function sceneKeyFor(snap: Snapshot | null): string {
  if (!snap) return "backdrop";
  switch (snap.phase) {
    case "event_countdown":
    case "event_active":
    case "event_outcome":
      return snap.eventMeta?.id ?? "backdrop";
    case "finale":
      return "jackInTheBox";
    case "splash":
      return "jackInTheBox"; // hold the popped box behind the splash copy
    default:
      return "backdrop";
  }
}

/* ── Interpolation helpers ───────────────────────────────────────────────── */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpViews(prev: EventView | null, next: EventView | null, t: number): EventView | null {
  if (!next) return null;
  if (!prev) return next;
  const out: EventView = { ...next };
  for (const key of Object.keys(next)) {
    const a = prev[key];
    const b = next[key];
    if (typeof a === "number" && typeof b === "number") out[key] = lerp(a, b, t);
  }
  return out;
}

/* ── The React component ─────────────────────────────────────────────────── */

export default function GameCanvas({
  room,
  className,
}: {
  room: RoomApi;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fxQueue = useRef<FxEvent[]>([]);

  // Collect fx as they arrive; the render loop drains them each frame.
  useEffect(() => room.onFx((fx) => fxQueue.current.push(fx)), [room]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;
    let app: Application | null = null;
    let scene: Scene | null = null;
    let sceneKey = "";

    const services: SceneServices = {
      photoUrl: GAME_CONFIG.JUSTIN_PHOTO_URL,
      bossName: GAME_CONFIG.BOSS_NAME,
      reducedMotion:
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };

    (async () => {
      const a = new Application();
      await a.init({
        background: 0x16191c,
        resizeTo: host,
        antialias: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
      });
      if (destroyed) {
        a.destroy(true);
        return;
      }
      app = a;
      host.appendChild(a.canvas);
      a.canvas.style.width = "100%";
      a.canvas.style.height = "100%";

      const root = new Container();
      a.stage.addChild(root);

      a.ticker.add(() => {
        const buf = room.bufferRef.current;
        const snap = buf.latest;
        const dtMs = a.ticker.deltaMS;

        // Swap scenes when the moment changes.
        const key = sceneKeyFor(snap);
        if (key !== sceneKey) {
          scene?.unmount();
          root.removeChildren().forEach((c) => c.destroy({ children: true }));
          sceneKey = key;
          scene = getSceneFactory(key)();
          scene.mount(root, a.renderer.width / a.renderer.resolution, a.renderer.height / a.renderer.resolution, services);
        }
        if (!scene || !snap) return;

        // Interpolate between the previous and latest snapshots. `alpha`
        // rides the real gap between their arrival times, clamped so a
        // hiccup never extrapolates Justin past the truth.
        const gap = Math.max(1, buf.latestAt - buf.previousAt);
        const alpha = Math.min(1, (performance.now() - buf.latestAt) / gap);
        const prev = buf.previous;

        const fx = fxQueue.current;
        fxQueue.current = [];

        // Never lerp across a round boundary: the previous snapshot's view
        // belongs to a DIFFERENT event (or phase), and blending its
        // same-named numeric keys (progress, etc.) makes Justin teleport
        // through half-blended positions for one frame.
        const sameMoment =
          prev != null &&
          prev.phase === snap.phase &&
          prev.eventMeta?.id === snap.eventMeta?.id;

        scene.update({
          snap,
          view: lerpViews(sameMoment ? (prev?.eventView ?? null) : null, snap.eventView, alpha),
          justinProgress: sameMoment
            ? lerp(prev.justinProgress, snap.justinProgress, alpha)
            : snap.justinProgress,
          tugPosition: sameMoment
            ? lerp(prev.tugPosition, snap.tugPosition, alpha)
            : snap.tugPosition,
          dtMs,
          fx,
          width: a.renderer.width / a.renderer.resolution,
          height: a.renderer.height / a.renderer.resolution,
        });
      });
    })();

    return () => {
      destroyed = true;
      scene?.unmount();
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.bufferRef]);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
