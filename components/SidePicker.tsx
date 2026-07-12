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
        className={`display-header rounded-md px-4 py-4 text-center text-xl ${
          team === 0
            ? "bg-support text-white"
            : team === 1
              ? "bg-grease text-aluminum-950"
              : "bg-aluminum-800 text-aluminum-300"
        }`}
        role="status"
      >
        {teamName ? `You're on ${teamName} — PULL!` : "Teams are being assigned…"}
      </div>
    );
  }

  const hasPicked = picked !== null;

  // Shared styles for both buttons. min-h keeps them easy to hit on phones.
  const baseClasses =
    "display-header min-h-16 flex-1 rounded-md border-2 px-3 py-4 text-lg transition-opacity";

  // Per-side coloring. When a pick has been made, the chosen side stays at
  // full strength and the other fades — a clear "locked in" visual.
  const sideClasses = (side: 0 | 1): string => {
    const isChosen = picked === side;
    const color =
      side === 0
        ? "border-support bg-support/15 text-support"
        : "border-grease bg-grease/15 text-grease";
    if (!hasPicked) return `${color} active:opacity-80`;
    return isChosen ? `${color} ring-2 ring-current` : `${color} opacity-30`;
  };

  return (
    <div>
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
          {labels[0]}
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
          {labels[1]}
        </button>
      </div>
      {hasPicked && (
        <p className="mt-2 text-center font-mono text-xs text-aluminum-400" role="status">
          Locked in. Your side is secret.
        </p>
      )}
    </div>
  );
}
