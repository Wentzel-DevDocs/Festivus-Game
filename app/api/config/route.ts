/**
 * GET /api/config → per-event tuning parameters.
 *
 * Defaults from lib/game/config, overridden by any rows in level_config
 * (Neon). The Rivet actor calls this once at room start, so you can retune
 * the game from the database without redeploying anything.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { levelConfig } from "@/db/schema";
import { DEFAULT_EVENT_PARAMS, type EventParams } from "@/lib/game/config";

export async function GET() {
  // Start from code defaults so the game never breaks on a missing row.
  const params: Record<string, EventParams> = JSON.parse(
    JSON.stringify(DEFAULT_EVENT_PARAMS),
  );

  const db = getDb();
  if (db) {
    try {
      const rows = await db.select().from(levelConfig);
      for (const row of rows) {
        // Merge over defaults: a row may override just one number.
        params[row.eventId] = {
          ...params[row.eventId],
          ...(row.paramsJson as Record<string, number>),
        };
      }
    } catch (err) {
      console.error("level_config read failed; serving defaults", err);
    }
  }

  return NextResponse.json({ ok: true, params });
}
