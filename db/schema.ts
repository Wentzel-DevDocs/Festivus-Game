/**
 * Durable truth in Neon (Postgres) via Drizzle ORM.
 *
 * Written ONLY at boundaries (a player joins, a match ends) — never once
 * per tap. The Rivet actor holds live state in memory and flushes here
 * through /api/results when a match finishes.
 *
 * ANONYMITY IS SCHEMA-DEEP: there is deliberately NO column anywhere that
 * links a player to a HELP/HINDER side, and NO author column on
 * grievances. You cannot leak what the schema cannot store. If a future
 * migration tries to add one, that's a bug — see README → Anonymity.
 */

import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One row per person, keyed by their sticky localStorage uuid.
 * Identifies a NAME and SCORE only — never a side.
 */
export const players = pgTable("players", {
  /** = the sticky id the browser minted on first visit. */
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /** Cumulative counted mashes across every session (all-time leaderboard). */
  totalMashes: integer("total_mashes").notNull().default(0),
  /** Matches won as champion → the "Head of Household" to gang up on. */
  wins: integer("wins").notNull().default(0),
  /** Best single-match mash count. */
  bestScore: integer("best_score").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
});

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at").notNull(),
  /** AGGREGATE weighted headcounts — the beloved/greased verdict inputs. */
  approvalSupport: integer("approval_support").notNull().default(0),
  approvalHinder: integer("approval_hinder").notNull().default(0),
  championPlayerId: uuid("champion_player_id").references(() => players.id),
});

/** Per-match effort per player. Mash totals only — no sides here either. */
export const matchParticipants = pgTable(
  "match_participants",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id),
    mashes: integer("mashes").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.playerId] })],
);

/** AGGREGATE outcome of each event in a match. */
export const roundResults = pgTable("round_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  eventId: text("event_id").notNull(),
  supportForce: integer("support_force").notNull().default(0),
  hinderForce: integer("hinder_force").notNull().default(0),
  supportHead: integer("support_head").notNull().default(0),
  hinderHead: integer("hinder_head").notNull().default(0),
  /** "support" | "hinder" (tug-of-war maps Team A/B onto these slots). */
  winner: text("winner").notNull(),
});

/**
 * The Airing of Grievances. NO author column, ever — grievances are
 * submitted blind, stored blind, and revealed shuffled.
 */
export const grievances = pgTable("grievances", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Data-driven tuning: one row per event, params_json matching EventParams.
 * Retune durations/forces in the DB without redeploying (the actor reads
 * this through /api/config at room start). Seeded by db/seed.ts.
 */
export const levelConfig = pgTable("level_config", {
  eventId: text("event_id").primaryKey(),
  paramsJson: jsonb("params_json").notNull(),
});
