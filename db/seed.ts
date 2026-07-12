/**
 * Seed script: writes the default tuning numbers for every event into
 * level_config. Run with `pnpm db:seed` (after `pnpm db:migrate`).
 *
 * Safe to re-run: it upserts, so existing hand-tuned rows are OVERWRITTEN
 * back to defaults — that's the point of a reset script.
 */

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { levelConfig } from "./schema";
import { DEFAULT_EVENT_PARAMS } from "../lib/game/config";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const db = drizzle(neon(url));

  for (const [eventId, params] of Object.entries(DEFAULT_EVENT_PARAMS)) {
    await db
      .insert(levelConfig)
      .values({ eventId, paramsJson: params })
      .onConflictDoUpdate({
        target: levelConfig.eventId,
        set: { paramsJson: sql`excluded.params_json` },
      });
    console.log(`seeded level_config: ${eventId}`);
  }

  console.log("Done. Retune numbers directly in the level_config table any time.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
