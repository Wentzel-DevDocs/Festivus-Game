/**
 * Lazy Drizzle client over Neon's serverless HTTP driver.
 *
 * Returns null when DATABASE_URL isn't set so the whole game degrades
 * gracefully to "no durable storage" instead of crashing — handy for local
 * demos before you've created a Neon project.
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null | undefined;

export function getDb(): Db | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}
