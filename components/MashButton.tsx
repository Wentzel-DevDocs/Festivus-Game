"use client";

/**
 * MashButton — the big red button players hammer on their phones.
 *
 * It owns the OVERHEAT meter, which is a purely client-side pacing device:
 * every accepted tap adds a bit of heat, heat drains over time, and when the
 * meter fills the button locks until it cools down. The server has its own
 * hard tap-rate cap (GAME_CONFIG.MAX_COUNTED_TAPS_PER_SEC) — this meter just
 * teaches players the same lesson visibly: rhythm beats raw speed.
 *
 * Desktop players can mash with the SPACEBAR. Phone players get a tiny
 * vibration per tap. Both get a "thunk" sound (throttled so a fast masher
 * doesn't turn the sound board into static).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { GAME_CONFIG } from "@/lib/game/config";
import { sound } from "@/lib/sound";

interface MashButtonProps {
  /** False until the assigned-team event is active and a team exists. */
  enabled: boolean;
  /** Called once per ACCEPTED tap (not called while overheated/disabled). */
  onTap: () => void;
  /** Button text; defaults to "MASH". */
  label?: string;
}

/** Minimum gap between "thunk" sounds so mashing doesn't overload audio. */
const THUNK_GAP_MS = 90;

export default function MashButton({ enabled, onTap, label }: MashButtonProps) {
  // Heat lives in BOTH a ref and state. The ref is the source of truth that
  // the animation loop and tap handler mutate (refs update instantly, with no
  // re-render lag); the state copy just tells React to repaint the meter.
  const heatRef = useRef(0);
  const lockedRef = useRef(false);
  const [heat, setHeat] = useState(0);
  const [locked, setLocked] = useState(false);

  // Mirror the latest props into refs so our stable event handlers always see
  // fresh values without needing to re-subscribe listeners on every render.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const lastThunkAt = useRef(0);

  /**
   * One accepted tap: add heat, maybe lock, then fire all the feedback.
   * Wrapped in useCallback with no deps so the spacebar listener below can
   * subscribe once and never churn.
   */
  const handleTap = useCallback(() => {
    // Rejected taps: team input is not active yet, or the meter overheated.
    if (!enabledRef.current || lockedRef.current) return;

    heatRef.current = Math.min(1, heatRef.current + GAME_CONFIG.OVERHEAT.heatPerTap);
    setHeat(heatRef.current);
    if (heatRef.current >= 1) {
      // Full meter → lock. The cooling loop below unlocks it once heat
      // drops under OVERHEAT.unlockBelow (hysteresis, so it doesn't flicker).
      lockedRef.current = true;
      setLocked(true);
    }

    // Tell the game about the tap FIRST — feedback is decoration.
    onTapRef.current();

    // Tiny haptic tick on phones that support it (optional chaining because
    // desktop browsers don't have navigator.vibrate).
    navigator.vibrate?.(8);

    // Audio must be unlocked inside a user gesture — a tap IS one, so this
    // is the perfect (and free) place to call it. It's a no-op after the
    // first time.
    sound.unlock();
    const now = performance.now();
    if (now - lastThunkAt.current >= THUNK_GAP_MS) {
      lastThunkAt.current = now;
      sound.play("thunk");
    }
  }, []);

  /**
   * The cooling loop: drain heat every animation frame. We use
   * requestAnimationFrame (not setInterval) so the drain is tied to real
   * elapsed time and the meter animates smoothly. This is NOT a decorative
   * animation — the heat value is game-mechanical — so it must keep running
   * even when the user prefers reduced motion.
   */
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dtSec = (now - lastTime) / 1000;
      lastTime = now;

      if (heatRef.current > 0) {
        heatRef.current = Math.max(
          0,
          heatRef.current - GAME_CONFIG.OVERHEAT.coolPerSec * dtSec,
        );
        // Unlock once we've cooled enough (below the unlock threshold,
        // which is lower than 1.0 on purpose — a "cooldown penalty").
        if (lockedRef.current && heatRef.current < GAME_CONFIG.OVERHEAT.unlockBelow) {
          lockedRef.current = false;
          setLocked(false);
        }
        setHeat(heatRef.current);
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, []);

  /**
   * Spacebar support for desktop players. Global listener so they don't have
   * to keep the button focused. We ignore:
   *  - key repeats (holding space should NOT auto-mash),
   *  - keys typed into inputs/textareas (someone writing a grievance!).
   * preventDefault stops the page from scrolling AND stops a focused button
   * from ALSO firing its native space-click (which would double-count).
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      handleTap();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTap]);

  // Meter color shifts as heat rises: calm green → warning yellow → danger red.
  const heatColor =
    heat < 0.5
      ? "var(--color-support)"
      : heat < 0.8
        ? "var(--color-grease)"
        : "var(--color-grievance)";

  // The ring is an SVG circle whose stroke is "dashed" to exactly its own
  // circumference; sliding the dash offset reveals a fraction of the ring.
  // Classic technique for circular progress with zero libraries.
  const RING_RADIUS = 46;
  const circumference = 2 * Math.PI * RING_RADIUS;

  // Three visual states, in priority order: disabled → overheated → ready.
  const stateClasses = !enabled
    ? "mash-core text-aluminum-400 opacity-55"
    : locked
      ? "mash-core text-grease cursor-not-allowed saturate-50"
      : "mash-core text-white";

  return (
    <button
      type="button"
      aria-label="Mash"
      // aria-disabled (instead of the native disabled attribute) keeps the
      // button focusable so screen-reader users can find it and hear WHY it
      // is not usable yet.
      aria-disabled={!enabled || locked}
      // pointerdown fires the instant a finger lands — snappier than click
      // for a mash game. Mouse clicks also start with pointerdown, so we do
      // NOT also handle onClick for pointers (that would double-count)…
      onPointerDown={handleTap}
      // …but a keyboard Enter press only produces a click event. Keyboard
      // clicks arrive with detail === 0, so this line adds Enter support
      // without re-counting mouse clicks. (Space is covered globally above.)
      onClick={(e) => {
        if (e.detail === 0) handleTap();
      }}
      className={`relative aspect-square w-[clamp(168px,50vw,214px)] self-center select-none rounded-full font-display uppercase tracking-wide transition-all duration-75 ${stateClasses}`}
    >
      {/* The overheat ring, drawn around the button's edge. Decorative for
          screen readers (the lock state is announced via the text below). */}
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
      >
        {/* Track (always visible, faint) */}
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(7,10,15,0.82)"
          strokeWidth="4"
        />
        {/* Fill (grows with heat, shifts color) */}
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          stroke={heatColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - heat)}
        />
      </svg>

      {/* Button copy for each of the three states. */}
      {locked ? (
        <span className="flex flex-col items-center gap-1 px-4">
          <span className="eyebrow text-grease">Core overheated</span>
          <span className="display-header text-xl leading-tight">Recover</span>
          <span className="font-mono text-[10px] tracking-widest text-aluminum-300">
            Pace yourself
          </span>
        </span>
      ) : enabled ? (
        <span className="flex flex-col items-center">
          <span className="eyebrow text-aluminum-200">Feats input</span>
          <span className="display-header text-4xl">{label ?? "Mash"}</span>
          <span className="font-mono text-[9px] tracking-[0.2em] text-aluminum-300">
            Strike the seal
          </span>
        </span>
      ) : (
        <span className="flex flex-col items-center gap-1 px-4">
          <span className="eyebrow text-aluminum-400">Input sealed</span>
          <span className="display-header text-3xl">{label ?? "Mash"}</span>
          <span className="font-mono text-[10px] normal-case tracking-normal text-aluminum-400">
            awaiting team signal
          </span>
        </span>
      )}
    </button>
  );
}
