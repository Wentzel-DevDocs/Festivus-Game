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
  const showAlltime = alltime.length > 0;

  return (
    <div
      className={`aluminum-panel font-mono ${compact ? "p-3 text-xs" : "p-4 text-sm"}`}
    >
      {headOfHousehold && (
        <p className="display-header mb-3 text-grease">
          Head of Household: {headOfHousehold} — gang up accordingly.
        </p>
      )}

      {/* ── Section 1: this match ─────────────────────────────────────────── */}
      <h3 className="display-header mb-1 text-aluminum-400">This Match</h3>
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
              <tr key={`${p.name}-${i}`} className="border-b border-aluminum-700/50">
                <td className="w-8 py-1 pr-2 text-right text-aluminum-500">
                  {i + 1}
                </td>
                <td className="py-1 pr-2">
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
                <td className="py-1 text-right tabular-nums">{p.mashes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Section 2: all-time (hidden when there is no history yet) ─────── */}
      {showAlltime && (
        <>
          <h3
            className={`display-header mb-1 text-aluminum-400 ${
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
              {alltime.map((entry, i) => (
                // Display names aren't unique (two "Kevin"s are inevitable);
                // include the row index so React keys never collide.
                <tr key={`${entry.name}-${i}`} className="border-b border-aluminum-700/50">
                  <td className="py-1 pr-2">{entry.name}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {entry.totalMashes}
                    <span className="ml-1 text-aluminum-500">mashes</span>
                  </td>
                  <td className="py-1 text-right tabular-nums">
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
