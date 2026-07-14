"use client";

/**
 * DualActionPad — two live, direct inputs for non-team events.
 *
 * There is deliberately no selected side: every accepted strike carries its
 * own HELP/HINDER side, so a player can alternate as fast as they can tap.
 * Both inputs share one heat budget to keep the existing rhythm-over-spam
 * mechanic honest regardless of which side is being pressed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { GAME_CONFIG } from "@/lib/game/config";
import { sound } from "@/lib/sound";

export type DualActionPadState = "active" | "countdown" | "disabled";

export interface DualActionPadProps {
  /** Event-specific action labels, such as "Raise him" / "Hold it down". */
  labels: [string, string];
  /** Only active controls dispatch actions; countdown remains visible/armed. */
  state: DualActionPadState;
  /** Called once per accepted strike with that strike's side. */
  onTap: (side: 0 | 1) => void;
  /** Optional explanation shown while input is unavailable. */
  disabledMessage?: string;
}

const THUNK_GAP_MS = 90;

export default function DualActionPad({
  labels,
  state,
  onTap,
  disabledMessage,
}: DualActionPadProps) {
  const heatRef = useRef(0);
  const lockedRef = useRef(false);
  const [heat, setHeat] = useState(0);
  const [locked, setLocked] = useState(false);
  const stateRef = useRef(state);
  const onTapRef = useRef(onTap);
  const lastThunkAt = useRef(0);

  stateRef.current = state;
  onTapRef.current = onTap;

  const handleTap = useCallback((side: 0 | 1) => {
    if (stateRef.current !== "active" || lockedRef.current) return;

    heatRef.current = Math.min(1, heatRef.current + GAME_CONFIG.OVERHEAT.heatPerTap);
    setHeat(heatRef.current);
    if (heatRef.current >= 1) {
      lockedRef.current = true;
      setLocked(true);
    }

    // Dispatch first. Sound and haptics are intentionally non-critical.
    onTapRef.current(side);
    navigator.vibrate?.(side === 0 ? 8 : [5, 12, 5]);
    sound.unlock();
    const now = performance.now();
    if (now - lastThunkAt.current >= THUNK_GAP_MS) {
      lastThunkAt.current = now;
      sound.play("thunk");
    }
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dtSec = (now - lastTime) / 1_000;
      lastTime = now;

      if (heatRef.current > 0) {
        heatRef.current = Math.max(
          0,
          heatRef.current - GAME_CONFIG.OVERHEAT.coolPerSec * dtSec,
        );
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

  // Desktop fallback: left/1 is HELP, right/2 is HINDER. Native focused
  // button Enter/Space activation is handled independently below.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const side =
        event.code === "Digit1" || event.code === "ArrowLeft"
          ? 0
          : event.code === "Digit2" || event.code === "ArrowRight"
            ? 1
            : null;
      if (side === null) return;
      event.preventDefault();
      handleTap(side);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTap]);

  const unavailable = state !== "active" || locked;
  const heatPercent = Math.round(heat * 100);
  const meterColor =
    heat < 0.5
      ? "var(--color-support)"
      : heat < 0.8
        ? "var(--color-grease)"
        : "var(--color-grievance)";

  const statusCopy = locked
    ? "CORE OVERHEATED — BOTH INPUTS COOLING"
    : state === "active"
      ? "CHANGE SIDES ON ANY STRIKE"
      : state === "countdown"
        ? "INPUTS ARM WHEN THE EVENT GOES LIVE"
        : (disabledMessage ?? "INPUTS SEALED BETWEEN EVENTS");

  const buttonClass = (side: 0 | 1) => {
    const color =
      side === 0
        ? "border-support/70 text-support shadow-[inset_0_1px_0_rgba(255,255,255,0.13),inset_0_-30px_65px_rgba(3,25,15,0.72),0_16px_40px_rgba(0,0,0,0.4),0_0_34px_rgba(67,199,122,0.12)]"
        : "border-grease/70 text-grease shadow-[inset_0_1px_0_rgba(255,255,255,0.13),inset_0_-30px_65px_rgba(35,12,5,0.72),0_16px_40px_rgba(0,0,0,0.4),0_0_34px_rgba(232,169,65,0.12)]";
    const ready = unavailable
      ? "cursor-not-allowed saturate-50 opacity-60"
      : "hover:brightness-110 active:translate-y-1 active:scale-[0.97] active:brightness-125";
    return `relative isolate min-h-[clamp(136px,28dvh,205px)] touch-none select-none overflow-hidden rounded-2xl border bg-aluminum-950 px-2 py-4 transition-[transform,filter,opacity] duration-75 ${color} ${ready}`;
  };

  return (
    <section aria-label="Direct Help or Hinder controls" className="w-full">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <p className="eyebrow text-[9px] text-aluminum-300">Dual action core</p>
        <p
          role="status"
          aria-live="polite"
          className={`truncate text-right font-mono text-[9px] font-bold tracking-[0.12em] ${
            locked ? "text-grievance" : "text-aluminum-400"
          }`}
        >
          {statusCopy}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
        {([0, 1] as const).map((side) => {
          const isHelp = side === 0;
          return (
            <button
              key={side}
              type="button"
              aria-label={`${isHelp ? "Help" : "Hinder"}: ${labels[side]}`}
              aria-disabled={unavailable}
              aria-keyshortcuts={isHelp ? "ArrowLeft 1" : "ArrowRight 2"}
              onPointerDown={() => handleTap(side)}
              onClick={(event) => {
                // Keyboard-synthesized clicks have detail 0. Pointer input is
                // already handled on pointerdown for lower perceived latency.
                if (event.detail === 0) handleTap(side);
              }}
              className={buttonClass(side)}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 -z-10 ${
                  isHelp
                    ? "bg-[radial-gradient(circle_at_50%_15%,rgba(67,199,122,0.28),transparent_47%),linear-gradient(150deg,rgba(20,62,42,0.96),rgba(7,10,15,0.98)_72%)]"
                    : "bg-[radial-gradient(circle_at_50%_15%,rgba(215,71,71,0.26),transparent_47%),linear-gradient(150deg,rgba(63,30,15,0.96),rgba(7,10,15,0.98)_72%)]"
                }`}
              />
              <span className="flex h-full flex-col items-center justify-center gap-1.5">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-current/55 bg-aluminum-950/50 font-mono text-[11px] shadow-[inset_0_0_12px_rgba(255,255,255,0.06)]">
                  {isHelp ? "01" : "02"}
                </span>
                <span className="font-mono text-[9px] font-black tracking-[0.24em] text-aluminum-300">
                  {isHelp ? "HELP" : "HINDER"}
                </span>
                <span className="display-header line-clamp-2 text-[clamp(1rem,4.5vw,1.45rem)] leading-[1.05] text-current">
                  {labels[side]}
                </span>
                <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em] text-aluminum-400">
                  {unavailable
                    ? locked
                      ? "Cooling"
                      : "Stand by"
                    : isHelp
                      ? "Tap · Left · 1"
                      : "Tap · Right · 2"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-full border border-aluminum-700/75 bg-aluminum-950/85 p-1 shadow-inner">
        <div
          role="progressbar"
          aria-label="Shared controller heat"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={heatPercent}
          aria-valuetext={locked ? `${heatPercent}% — overheated` : `${heatPercent}%`}
          className="h-2 overflow-hidden rounded-full bg-aluminum-800"
        >
          <div
            className="h-full rounded-full transition-[width,background-color] duration-75"
            style={{
              width: `${heatPercent}%`,
              backgroundColor: meterColor,
              boxShadow: `0 0 14px ${meterColor}`,
            }}
          />
        </div>
      </div>
      <div className="mt-1 flex justify-between px-1 font-mono text-[8px] uppercase tracking-[0.16em] text-aluminum-500">
        <span>Shared thermal load</span>
        <span>{locked ? "Recover" : `${heatPercent}%`}</span>
      </div>
    </section>
  );
}
