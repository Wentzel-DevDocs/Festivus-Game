/** Drizzle Kit config: `pnpm db:generate` writes SQL migrations into
 *  db/migrations; `pnpm db:migrate` applies them to DATABASE_URL. */

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js keeps local secrets in .env.local; load it too.
loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
