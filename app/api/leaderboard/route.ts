/**
 * GET /api/leaderboard → all-time standings + the current Head of Household.
 *
 * The Head of Household is the reigning champion (most match wins) — the
 * person the next session is invited to gang up on. Names and scores only;
 * sides are not stored anywhere, so they cannot be served here.
 */

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { players } from "@/db/schema";
import type { LeaderboardEntry } from "@/lib/realtime/protocol";

export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({
      ok: true,
      leaderboard: [] as LeaderboardEntry[],
      headOfHousehold: null,
      note: "DATABASE_URL not set — leaderboard persistence disabled",
    });
  }

  try {
    const top = await db
      .select()
      .from(players)
      .orderBy(desc(players.totalMashes))
      .limit(20);

    const leaderboard: LeaderboardEntry[] = top.map((p) => ({
      name: p.displayName,
      totalMashes: p.totalMashes,
      wins: p.wins,
      bestScore: p.bestScore,
    }));

    const [champ] = await db
      .select()
      .from(players)
      .orderBy(desc(players.wins), desc(players.lastSeen))
      .limit(1);

    return NextResponse.json({
      ok: true,
      leaderboard,
      headOfHousehold: champ && champ.wins > 0 ? champ.displayName : null,
    });
  } catch (err) {
    console.error("leaderboard read failed", err);
    return NextResponse.json({ ok: false, leaderboard: [], headOfHousehold: null });
  }
}
