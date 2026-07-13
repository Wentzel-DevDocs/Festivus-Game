"use client";

/**
 * SidePicker — the secret HELP/HINDER choice at the start of each round.
 *
 * Two big buttons: side 0 (usually "help Justin") in support green, side 1
 * (usually "grease him") in grease yellow. Once the player picks, both
 * buttons lock and we remind them their choice is a secret — the server
 * never tells anyone else which side anyone chose.
 *
 * Tug-of-war is different: there is no choice at all. The server assigns
 * teams publicly, so instead of buttons we show a banner announcing which
 * team you're on.
 */

interface SidePickerProps {
  /** Button text for side 0 and side 1 (comes from the event's metadata). */
  labels: [string, string];
  /** The side this player already picked this round, or null. */
  picked: 0 | 1 | null;
  /** This player's assigned tug-of-war team, or null outside tug-of-war. */
  team: 0 | 1 | null;
  /** True during tug-of-war: no picking, teams are assigned. */
  teamBased: boolean;
  onPick: (side: 0 | 1) => void;
}

export default function SidePicker({
  labels,
  picked,
  team,
  teamBased,
  onPick,
}: SidePickerProps) {
  // ── Team events: nothing to pick, just announce the assignment. ──────────
  if (teamBased) {
    const teamName = team === 0 ? "TEAM A" : team === 1 ? "TEAM B" : null;
    return (
      <div
        // Team A is support-green, Team B grease-yellow — the SAME colors
        // the tug-of-war scene uses for its team labels, so players can
        // find "their" side on the big screen at a glance.
        className={`action-plate display-header border px-4 py-4 text-center text-xl ${
          team === 0
            ? "border-support/70 text-support"
            : team === 1
              ? "border-grease/70 text-grease"
              : "border-aluminum-600 text-aluminum-300"
        }`}
        role="status"
      >
        {teamName ? `You're on ${teamName} — PULL!` : "Teams are being assigned…"}
      </div>
    );
  }

  const hasPicked = picked !== null;

  if (hasPicked) {
    const isSupport = picked === 0;
    return (
      <div
        className={`forge-panel flex min-h-12 items-center justify-between gap-3 border px-4 py-2.5 ${
          isSupport ? "border-support/55" : "border-grease/55"
        }`}
        role="status"
      >
        <div className="min-w-0">
          <p className="eyebrow">Allegiance sealed</p>
          <p
            className={`display-header truncate text-sm ${
              isSupport ? "text-support" : "text-grease"
            }`}
          >
            {labels[picked]}
          </p>
        </div>
        <span className="hud-chip border-aluminum-600/60 text-[9px]">Secret</span>
      </div>
    );
  }

  // Shared styles for both buttons. min-h keeps them easy to hit on phones.
  const baseClasses =
    "action-plate display-header min-h-16 flex-1 border px-3 py-3 text-base transition-all";

  // Per-side coloring. When a pick has been made, the chosen side stays at
  // full strength and the other fades — a clear "locked in" visual.
  const sideClasses = (side: 0 | 1): string => {
    const color =
      side === 0
        ? "border-support/70 text-support hover:bg-support/10"
        : "border-grease/70 text-grease hover:bg-grease/10";
    return `${color} active:scale-[0.98]`;
  };

  return (
    <div>
      <p className="eyebrow mb-2 text-center">Choose your allegiance</p>
      <div className="flex gap-3">
        <button
          type="button"
          // Guard inside the handler because aria-disabled (unlike the native
          // disabled attribute) does not actually block clicks — it only
          // announces the state. We use it so the buttons stay focusable and
          // screen readers can still read the labels after locking.
          onClick={() => {
            if (!hasPicked) onPick(0);
          }}
          aria-disabled={hasPicked}
          aria-pressed={picked === 0}
          className={`${baseClasses} ${sideClasses(0)}`}
        >
          <span className="flex flex-col items-center gap-1">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-current font-mono text-xs">
              I
            </span>
            {labels[0]}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (!hasPicked) onPick(1);
          }}
          aria-disabled={hasPicked}
          aria-pressed={picked === 1}
          className={`${baseClasses} ${sideClasses(1)}`}
        >
          <span className="flex flex-col items-center gap-1">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-current font-mono text-xs">
              II
            </span>
            {labels[1]}
          </span>
        </button>
      </div>
    </div>
  );
}
