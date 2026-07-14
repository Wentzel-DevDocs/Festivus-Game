/**
 * Single source of game configuration.
 *
 * Two kinds of values live here:
 *  1. Cosmetics + wiring (boss name, photo, room id, tick rate).
 *  2. DEFAULT tuning numbers for every event.
 *
 * Tuning numbers are also seeded into the `level_config` table in Neon
 * (see db/seed.ts). At room start the room server fetches that table via
 * /api/config and OVERRIDES these defaults — so you can retune the game
 * from the database without redeploying. If the DB is unreachable, these
 * defaults keep the game fully playable.
 */

export const GAME_CONFIG = {
  /** What everyone calls the protagonist. */
  BOSS_NAME: process.env.NEXT_PUBLIC_BOSS_NAME || "Justin",

  /**
   * Portrait used by every animated Justin rig. The bundled original game
   * character keeps the default experience art-directed; a same-origin photo
   * URL can still replace it for a specific company's actual boss.
   */
  JUSTIN_PHOTO_URL:
    process.env.NEXT_PUBLIC_JUSTIN_PHOTO_URL || "/assets/justin-avatar-v2.png",

  /**
   * v1 uses ONE shared room: everyone who opens the site plays together.
   * Multi-room support later = generate this per party instead (e.g. a slug
   * in the URL) and pass it through to the actor key. Nothing else changes.
   */
  ROOM_ID: "festivus-main",

  /** Server simulation rate. 25 Hz = one tick every 40 ms. */
  TICK_HZ: 25,

  /**
   * Test accelerator: every phase duration is divided by this. Leave at 1
   * for real play; scripts/simulate.ts sets FESTIVUS_TIME_SCALE=8 to run a
   * whole match in ~30 seconds. (Server-side env — not NEXT_PUBLIC.)
   */
  TIME_SCALE: Number(process.env.FESTIVUS_TIME_SCALE ?? "") || 1,

  /**
   * Server-side anti-cheat: taps beyond this per-second rate are ignored.
   * ~12/sec is the ceiling of plausible human mashing; it also enforces the
   * "rhythm beats raw speed" feel alongside the client overheat meter.
   */
  MAX_COUNTED_TAPS_PER_SEC: 12,

  /** Phase durations (milliseconds). */
  COUNTDOWN_MS: 4_000, // "get ready" before each event
  OUTCOME_MS: 5_000, // result banner after each event
  GRIEVANCE_WRITE_MS: 45_000, // blind-submission window
  GRIEVANCE_REVEAL_MS: 15_000, // shuffled reveal on the big screen
  FINALE_MS: 9_000, // jack-in-the-box animation

  /** Max grievances one connection may submit per match (spam guard). */
  MAX_GRIEVANCES_PER_PLAYER: 3,
  /** Max grievance length in characters. */
  MAX_GRIEVANCE_LENGTH: 140,

  /** Client overheat meter (UI pacing — the server cap is the real law). */
  OVERHEAT: {
    /** Heat added per tap (meter is 0..1). */
    heatPerTap: 0.09,
    /** Heat drained per second. */
    coolPerSec: 0.35,
    /** At 1.0 the button locks until it cools below this. */
    unlockBelow: 0.55,
  },
} as const;

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Per-event tuning parameters. `tapPower` is the progress one tap adds,
 * divided by the active player count — so a big crowd and a small crowd
 * both move Justin at a human pace. `drift` is Justin trying on his own
 * (progress per second) so the stage never looks frozen.
 */
export interface EventParams {
  durationSec: number;
  drift: number;
  tapPower: number;
  /** Event-specific extras (documented per event below). */
  [key: string]: number;
}

/**
 * Default tuning for each event, keyed by event id.
 * These exact objects are what db/seed.ts writes into `level_config`.
 */
export const DEFAULT_EVENT_PARAMS: Record<string, EventParams> = {
  /** Warmup: raise the bare aluminum pole. */
  poleRaise: {
    durationSec: 20,
    drift: 0.012,
    tapPower: 0.011,
  },

  /**
   * Water-gun swim sprint.
   * sinkThreshold: how negative the smoothed net force must get (progress/sec)
   *   before Justin flails and sinks. sinkMs: how long the drowning gag lasts.
   */
  swimSprint: {
    durationSec: 22,
    drift: 0.014,
    tapPower: 0.011,
    sinkThreshold: 0.03,
    sinkMs: 2_500,
    sinkPenalty: 0.05,
  },

  /**
   * Greased pole climb.
   * slipEverySec: how often the grease check fires.
   * slipShare: hinder's share of recent taps needed to trigger a slip.
   * slipAmount: how far Justin slides back down.
   */
  greasedClimb: {
    durationSec: 24,
    drift: 0.012,
    tapPower: 0.012,
    slipEverySec: 4,
    slipShare: 0.45,
    slipAmount: 0.12,
  },

  /**
   * Tug-of-war (teams). tapPower here moves the rope (-1..1 scale, so it is
   * roughly double the solo events' 0..1 scale).
   */
  tugOfWar: {
    durationSec: 25,
    drift: 0,
    tapPower: 0.02,
  },

  /**
   * Pin the Boss finale (weight 2).
   * springRate: how fast the pin bar springs back upright per second.
   * pinLine: bar position (0..1) past which the hold-count runs.
   * holdCountMs: how long past the line equals one count (3 counts to win).
   */
  pinTheBoss: {
    durationSec: 25,
    drift: 0,
    tapPower: 0.03,
    springRate: 0.22,
    pinLine: 0.78,
    holdCountMs: 1_000,
  },
};

/**
 * Festivus Miracle: once per event a small comeback boost hits the trailing
 * side. Eligible after `afterFrac` of the event has elapsed; expected to fire
 * within ~`expectedDelayMs` of becoming eligible; `boost` is the nudge size.
 */
export const MIRACLE = {
  afterFrac: 0.45,
  expectedDelayMs: 4_000,
  boost: 0.08,
} as const;
