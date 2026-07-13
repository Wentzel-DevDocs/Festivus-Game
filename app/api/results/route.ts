/**
 * POST /api/results → persist a finished match.
 *
 * Called by the room server ONLY (authenticated with INTERNAL_API_SECRET),
 * exactly once per match — never per tap. Writes, in order:
 *   1. the match row (aggregate approval + champion),
 *   2. player upserts (name, total_mashes +=, best_score, wins for champion),
 *   3. match_participants (per-match effort),
 *   4. round_results (aggregates only),
 *   5. grievances (text only — the table has no author column).
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  grievances,
  matches,
  matchParticipants,
  players,
  roundResults,
} from "@/db/schema";
import type { MatchPersistPayload } from "@/lib/game/persist";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  // Fail closed: without a configured secret, nobody can write results.
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    // No DB configured: acknowledge and drop — the live game must not care.
    return NextResponse.json({ ok: false, reason: "no-db" });
  }

  let payload: MatchPersistPayload;
  try {
    payload = (await req.json()) as MatchPersistPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // Keep only participants with a valid sticky uuid (junk ids would break FKs).
  const participants = (payload.participants ?? []).filter((p) =>
    UUID_RE.test(p.stickyId),
  );

  try {
    const [match] = await db
      .insert(matches)
      .values({
        startedAt: new Date(payload.startedAt),
        endedAt: new Date(payload.endedAt),
        approvalSupport: payload.approvalSupport ?? 0,
        approvalHinder: payload.approvalHinder ?? 0,
        // Set after the players are upserted (FK must exist first).
        championPlayerId: null,
      })
      .returning({ id: matches.id });

    for (const p of participants) {
      const isChampion = p.stickyId === payload.championStickyId;
      await db
        .insert(players)
        .values({
          id: p.stickyId,
          displayName: p.name.slice(0, 24),
          totalMashes: p.mashes,
          bestScore: p.mashes,
          wins: isChampion ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: players.id,
          set: {
            displayName: p.name.slice(0, 24),
            totalMashes: sql`${players.totalMashes} + ${p.mashes}`,
            bestScore: sql`greatest(${players.bestScore}, ${p.mashes})`,
            wins: isChampion ? sql`${players.wins} + 1` : sql`${players.wins}`,
            lastSeen: new Date(),
          },
        });

      await db.insert(matchParticipants).values({
        matchId: match.id,
        playerId: p.stickyId,
        mashes: p.mashes,
      });
    }

    if (payload.championStickyId && UUID_RE.test(payload.championStickyId)) {
      await db
        .update(matches)
        .set({ championPlayerId: payload.championStickyId })
        .where(sql`${matches.id} = ${match.id}`);
    }

    for (const r of payload.roundResults ?? []) {
      await db.insert(roundResults).values({
        matchId: match.id,
        eventId: String(r.eventId).slice(0, 64),
        supportForce: r.supportForce ?? 0,
        hinderForce: r.hinderForce ?? 0,
        supportHead: r.supportHead ?? 0,
        hinderHead: r.hinderHead ?? 0,
        winner: r.winner === "hinder" ? "hinder" : "support",
      });
    }

    for (const text of payload.grievances ?? []) {
      if (typeof text !== "string" || !text.trim()) continue;
      await db.insert(grievances).values({
        matchId: match.id,
        text: text.slice(0, 140),
      });
    }

    return NextResponse.json({ ok: true, matchId: match.id });
  } catch (err) {
    console.error("match persist failed", err);
    return NextResponse.json({ ok: false, error: "db write failed" }, { status: 500 });
  }
}
