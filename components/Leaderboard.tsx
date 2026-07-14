"use client";

/**
 * Leaderboard — mono-font standings in a brushed-aluminum panel.
 *
 * Two sections:
 *  1. THIS MATCH — the live roster, already sorted by mashes on the server
 *     (so we just render it top to bottom; rank = position + 1).
 *  2. ALL-TIME — durable standings from the database, hidden when empty.
 *
 * Anonymity note: mash counts are public and proud; WHICH SIDE anyone
 * mashed for never appears anywhere. The only public team info is the
 * tug-of-war team chip, because tug-of-war is deliberately a team sport.
 *
 * `compact` is for the phone controller: smaller text, top 5 only.
 */

import type { LeaderboardEntry, PlayerPub } from "@/lib/realtime/protocol";

interface LeaderboardProps {
  /** Live roster, pre-sorted by mashes (server does the sorting). */
  players: PlayerPub[];
  /** All-time standings; empty array when the DB has nothing yet. */
  alltime: LeaderboardEntry[];
  /** Reigning all-time wins leader — the poster target this match. */
  headOfHousehold: string | null;
  /** Phone-sized rendering: smaller, top 5, fewer flourishes. */
  compact?: boolean;
}

export default function Leaderboard({
  players,
  alltime,
  headOfHousehold,
  compact = false,
}: LeaderboardProps) {
  const visiblePlayers = compact ? players.slice(0, 5) : players;
  const visibleAlltime = compact ? alltime.slice(0, 3) : alltime;
  const showAlltime = alltime.length > 0;

  return (
    <div
      className={`forge-panel font-mono ${compact ? "p-3 text-xs" : "p-4 text-sm"}`}
    >
      {headOfHousehold && (
        <div className="mb-3 flex items-center gap-2 border-b border-grease/20 pb-3">
          <span className="brand-sigil h-8 w-8 scale-75" aria-hidden="true" />
          <p className="min-w-0">
            <span className="eyebrow block">Head of Household</span>
            <span className="display-header block truncate text-grease">
              {headOfHousehold}
            </span>
          </p>
        </div>
      )}

      {/* ── Section 1: this match ─────────────────────────────────────────── */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="display-header text-aluminum-200">Battle ranks</h3>
        <span className="eyebrow">This match</span>
      </div>
      {visiblePlayers.length === 0 ? (
        <p className="py-2 text-aluminum-500">Nobody here yet.</p>
      ) : (
        <table className="w-full border-collapse">
          {/* Screen-reader-only header row keeps the table navigable without
              visually cluttering a scoreboard everyone reads at a glance. */}
          <thead className="sr-only">
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Name</th>
              <th scope="col">Mashes</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((p, i) => (
              // Key includes the index so two guests who typed the same name
              // can't trigger React's duplicate-key warning.
              <tr
                key={`${p.name}-${i}`}
                className={`border-b border-aluminum-700/60 ${i === 0 ? "bg-grease/5" : ""}`}
              >
                <td
                  className={`w-9 py-2 pr-2 text-center font-bold ${
                    i === 0 ? "text-grease" : "text-aluminum-500"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className={`py-2 pr-2 ${i === 0 ? "text-aluminum-100" : ""}`}>
                  {p.name}
                  {/* Team chip appears ONLY during tug-of-war (team !== null).
                      A = pool blue, B = grease yellow, matching the rope. */}
                  {p.team !== null && (
                    <span
                      className={`ml-2 rounded px-1.5 text-xs font-bold ${
                        p.team === 0
                          ? "bg-pool text-white"
                          : "bg-grease text-aluminum-950"
                      }`}
                    >
                      {p.team === 0 ? "A" : "B"}
                    </span>
                  )}
                </td>
                <td className={`py-2 text-right tabular-nums ${i === 0 ? "text-grease" : ""}`}>
                  {p.mashes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Section 2: all-time (hidden when there is no history yet) ─────── */}
      {showAlltime && (
        <>
          <h3
            className={`eyebrow mb-1 ${
              compact ? "mt-3" : "mt-5 border-t border-aluminum-600 pt-3"
            }`}
          >
            All-Time
          </h3>
          <table className="w-full border-collapse">
            <thead className="sr-only">
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Total mashes</th>
                <th scope="col">Wins</th>
              </tr>
            </thead>
            <tbody>
              {visibleAlltime.map((entry, i) => (
                // Display names aren't unique (two "Kevin"s are inevitable);
                // include the row index so React keys never collide.
                <tr key={`${entry.name}-${i}`} className="border-b border-aluminum-700/50">
                  <td className="py-1.5 pr-2">{entry.name}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {entry.totalMashes}
                    <span className="ml-1 text-aluminum-500">mashes</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {entry.wins}
                    <span className="ml-1 text-aluminum-500">wins</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
