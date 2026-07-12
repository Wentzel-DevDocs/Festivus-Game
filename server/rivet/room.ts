/**
 * The Festivus room actor — ONE actor instance per room key, hosting the
 * live match for every connected screen (RivetKit keeps it alive and
 * routes every WebSocket for the key here).
 *
 * LIVE TRUTH lives in `vars` (plain memory, never persisted):
 *   roster, mash counts, the event simulation, and — deliberately —
 *   the per-round side tokens. If this process sleeps, sides evaporate.
 *
 * AUTHORITATIVE MODEL: clients send inputs only. This file counts every
 * mash itself, rate-caps them per connection (anti-cheat + "rhythm beats
 * raw speed"), steps the simulation on a fixed ~25 Hz tick, and broadcasts
 * snapshots. A client-reported total is never trusted because one is never
 * accepted.
 *
 * ANONYMITY MECHANICS (the promise to the team):
 *   pickSide() mints a RANDOM TOKEN, maps token→side in one map and
 *   player→token in another — both in `vars`, both cleared every round,
 *   neither ever serialized. Taps resolve conn → token → side and the tap
 *   lands in an AGGREGATE per-side counter inside the event module. Boss
 *   view, snapshots, logs, and the database only ever see those aggregates.
 *   Grievances are stored as bare text and revealed Fisher–Yates shuffled.
 */

import { actor } from "rivetkit";
import { GAME_CONFIG, DEFAULT_EVENT_PARAMS, type EventParams } from "../../lib/game/config";
import { EVENTS } from "../../lib/game/engine/registry";
import type { EventTickCtx, FxEvent, SideIndex } from "../../lib/game/engine/types";
import { fisherYates } from "../../lib/game/engine/math";
import {
  newSession,
  skipPhase,
  startMatch,
  tickSession,
  type SessionHooks,
  type SessionState,
  type SessionTiming,
} from "../../lib/game/engine/session";
import { cleanGrievance, cleanName } from "../../lib/game/filter";
import type {
  GrievancePub,
  JoinParams,
  LeaderboardEntry,
  MatchSummary,
  PlayerPub,
  Role,
  RoundResultPub,
  Snapshot,
  YouMessage,
} from "../../lib/realtime/protocol";
import { EVT_SNAPSHOT, EVT_YOU } from "../../lib/realtime/protocol";
import type { MatchPersistPayload } from "../../lib/game/persist";

const TICK_MS = Math.round(1000 / GAME_CONFIG.TICK_HZ);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One connected screen (boss or player). Lives in vars, keyed by conn id. */
interface RosterEntry {
  role: Role;
  name: string;
  stickyId: string;
  joinedAt: number;
}

/** Everything ephemeral. Rebuilt from scratch whenever the actor wakes. */
interface Vars {
  session: SessionState;
  roster: Map<string, RosterEntry>;
  /** ── per-round anonymity tokens (cleared in resetRound) ─────────────── */
  sideByToken: Map<string, SideIndex>;
  tokenBySticky: Map<string, string>;
  /** Tug-of-war team per player — PUBLIC by design (it's a team sport). */
  teamBySticky: Map<string, 0 | 1>;
  /** ── live match data ────────────────────────────────────────────────── */
  eventState: unknown;
  eventParams: Record<string, EventParams>;
  fx: FxEvent[];
  grievances: GrievancePub[];
  grievanceCountBySticky: Map<string, number>;
  revealedFeed: GrievancePub[];
  roundResults: RoundResultPub[];
  approval: { support: number; hinder: number };
  effort: Map<string, { name: string; mashes: number }>;
  /**
   * Anti-side-channel: per-player mash counts FROZEN at round start. During
   * event_active the snapshot shows these stale values, so a public
   * per-player counter never moves in the same tick as a secret side's
   * force — otherwise a snapshot recorder could pair "X's counter went up"
   * with "hinder force went up" and unmask X. Live values return at outcome.
   */
  frozenEffort: Map<string, number>;
  /**
   * Rate-cap windows keyed by STICKY id (not connection), so opening five
   * tabs still caps one human at MAX_COUNTED_TAPS_PER_SEC total.
   */
  tapWindows: Map<string, number[]>;
  matchStartedAt: number;
  matchSummary: MatchSummary | null;
  /** ── durable-world caches (refreshed via the Next.js API) ───────────── */
  leaderboard: LeaderboardEntry[];
  headOfHousehold: string | null;
  lastTickAt: number;
}

/* ── Small helpers (ctx is the actor context; typed loose to keep the
      lifecycle readable — Vars above is the real contract) ─────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

function playerEntries(c: any): [string, RosterEntry][] {
  return [...(c.vars as Vars).roster.entries()].filter(([, r]) => r.role === "player");
}

/** Aggregate headcounts per side for the current round. */
function sideCounts(c: any): [number, number] {
  const v = c.vars as Vars;
  const counts: [number, number] = [0, 0];
  if (currentEvent(c)?.teamBased) {
    // Count CONNECTED players per team.
    for (const [, r] of playerEntries(c)) {
      const team = v.teamBySticky.get(r.stickyId);
      if (team !== undefined) counts[team]++;
    }
  } else {
    for (const side of v.sideByToken.values()) counts[side]++;
  }
  return counts;
}

function currentEvent(c: any) {
  const i = (c.vars as Vars).session.eventIndex;
  return i >= 0 ? EVENTS[i] : null;
}

/** Build the EventTickCtx handed to the current module. */
function eventCtx(c: any): EventTickCtx {
  const v = c.vars as Vars;
  const ev = currentEvent(c);
  // Fall back sanely for event ids with no level_config row AND no entry in
  // DEFAULT_EVENT_PARAMS (a brand-new module someone forgot to tune): use
  // the module's own duration plus generic force numbers.
  const params = ev
    ? (v.eventParams[ev.id] ??
      DEFAULT_EVENT_PARAMS[ev.id] ?? {
        durationSec: ev.durationSec,
        drift: 0.012,
        tapPower: 0.011,
      })
    : DEFAULT_EVENT_PARAMS.poleRaise;
  return {
    playerCount: playerEntries(c).length,
    sideCounts: sideCounts(c),
    params,
    fx: v.fx,
    rng: Math.random,
  };
}

function timing(c: any): SessionTiming {
  const v = c.vars as Vars;
  const scale = GAME_CONFIG.TIME_SCALE; // 1 in real play; >1 only in tests
  return {
    grievanceWriteMs: GAME_CONFIG.GRIEVANCE_WRITE_MS / scale,
    grievanceRevealMs: GAME_CONFIG.GRIEVANCE_REVEAL_MS / scale,
    countdownMs: GAME_CONFIG.COUNTDOWN_MS / scale,
    outcomeMs: GAME_CONFIG.OUTCOME_MS / scale,
    finaleMs: GAME_CONFIG.FINALE_MS / scale,
    eventCount: EVENTS.length,
    eventDurationMs: (i) =>
      ((v.eventParams[EVENTS[i].id]?.durationSec ?? EVENTS[i].durationSec) * 1000) / scale,
  };
}

/** The host = the earliest-joined boss connection, else the earliest player. */
function hostConnId(c: any): string | null {
  const v = c.vars as Vars;
  let best: { id: string; joinedAt: number; boss: boolean } | null = null;
  for (const [id, r] of v.roster.entries()) {
    const boss = r.role === "boss";
    if (
      !best ||
      (boss && !best.boss) ||
      (boss === best.boss && r.joinedAt < best.joinedAt)
    ) {
      best = { id, joinedAt: r.joinedAt, boss };
    }
  }
  return best?.id ?? null;
}

/** Private per-connection facts: host flag, own team, own secret side. */
function sendYou(c: any, connId: string) {
  const v = c.vars as Vars;
  const conn = c.conns.get(connId);
  const entry = v.roster.get(connId);
  if (!conn || !entry) return;
  const token = v.tokenBySticky.get(entry.stickyId);
  const msg: YouMessage = {
    isHost: hostConnId(c) === connId,
    role: entry.role,
    name: entry.name,
    team: v.teamBySticky.get(entry.stickyId) ?? null,
    side: token !== undefined ? (v.sideByToken.get(token) ?? null) : null,
  };
  conn.send(EVT_YOU, msg);
}

function sendYouToAll(c: any) {
  for (const id of (c.vars as Vars).roster.keys()) sendYou(c, id);
}

/* ── Round + match lifecycle (the SessionHooks implementation) ──────────── */

/** Countdown start: clear round tokens, assign tug teams, init the module. */
function onEventStart(c: any, index: number) {
  const v = c.vars as Vars;
  const ev = EVENTS[index];

  // The anonymity reset: every round starts with fresh, empty token maps.
  v.sideByToken = new Map();
  v.tokenBySticky = new Map();
  v.teamBySticky = new Map();
  v.fx = [];

  // Freeze the public mash counters for the round (see Vars.frozenEffort).
  v.frozenEffort = new Map([...v.effort.entries()].map(([id, e]) => [id, e.mashes]));

  if (ev.teamBased) assignTeams(c);

  v.eventState = ev.init(eventCtx(c));
  sendYouToAll(c); // everyone learns their (cleared or assigned) team/side
}

/**
 * Tug-of-war team assignment: proper Fisher–Yates shuffle of the live
 * players, split in half; a coin flip decides which team gets the odd
 * player. Late joiners are placed onto the smaller team in onConnect.
 */
function assignTeams(c: any) {
  const v = c.vars as Vars;
  const stickies = playerEntries(c).map(([, r]) => r.stickyId);
  const shuffled = fisherYates(stickies);
  const half = Math.floor(shuffled.length / 2);
  const oddToA = Math.random() < 0.5;
  const sizeA = shuffled.length % 2 === 0 ? half : oddToA ? half + 1 : half;
  shuffled.forEach((stickyId, i) => {
    v.teamBySticky.set(stickyId, i < sizeA ? 0 : 1);
  });
}

/** Active window closed (timeout or early finish): resolve + record. */
function onEventEnd(c: any, index: number) {
  const v = c.vars as Vars;
  const ev = EVENTS[index];
  const ctx = eventCtx(c);
  const result = ev.resolve(v.eventState, ctx);

  v.roundResults.push({
    eventId: ev.id,
    eventName: ev.name,
    ...result,
  });

  // The approval read: WEIGHTED AGGREGATE HEADCOUNTS from help/hinder
  // events only (tug teams say nothing about how anyone feels about Justin).
  if (!ev.teamBased) {
    v.approval.support += result.supportHead * ev.weight;
    v.approval.hinder += result.hinderHead * ev.weight;
  }

  v.fx.push({ type: result.winner === "support" ? "win" : "lose" });
}

/** All five events done: crown the champion, seal the verdict, persist. */
function onMatchEnd(c: any) {
  const v = c.vars as Vars;

  let champion: { stickyId: string; name: string; mashes: number } | null = null;
  for (const [stickyId, e] of v.effort.entries()) {
    if (!champion || e.mashes > champion.mashes) champion = { stickyId, ...e };
  }

  const { support, hinder } = v.approval;
  v.matchSummary = {
    verdict: support > hinder ? "beloved" : hinder > support ? "greased" : "divided",
    approvalSupport: support,
    approvalHinder: hinder,
    championName: champion?.name ?? null,
    championMashes: champion?.mashes ?? 0,
    headOfHousehold: v.headOfHousehold,
  };

  // Durable writes happen HERE — one POST per match, never per tap.
  // waitUntil lets the write finish even if everyone disconnects right away.
  c.waitUntil(persistMatch(c, champion?.stickyId ?? null).then(() => refreshLeaderboard(c)));
  c.state.matchesPlayed++;
}

/**
 * Wipe per-match data. Called by hostStart (new match from lobby/splash).
 * keepGrievances: starting from the LOBBY must preserve the head-start
 * grievances players were invited to submit there; only a splash restart
 * (a genuinely new match) wipes them.
 */
function resetMatch(c: any, now: number, keepGrievances: boolean) {
  const v = c.vars as Vars;
  if (!keepGrievances) {
    v.grievances = [];
    v.grievanceCountBySticky = new Map();
  }
  v.revealedFeed = [];
  v.roundResults = [];
  v.approval = { support: 0, hinder: 0 };
  v.effort = new Map();
  v.frozenEffort = new Map();
  v.tapWindows = new Map();
  v.matchSummary = null;
  v.eventState = null;
  v.sideByToken = new Map();
  v.tokenBySticky = new Map();
  v.teamBySticky = new Map();
  v.fx = [];
  v.matchStartedAt = now;
}

/* ── Talking to the durable world (Next.js API → Neon) ──────────────────── */

function apiBase(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Pull level_config tuning (defaults if the API/DB is unreachable). */
async function loadEventParams(c: any) {
  try {
    const res = await fetch(`${apiBase()}/api/config`);
    const body = await res.json();
    if (body?.params) (c.vars as Vars).eventParams = body.params;
    c.log.info("loaded level config");
  } catch {
    c.log.warn("could not reach /api/config — using default tuning");
  }
}

async function refreshLeaderboard(c: any) {
  try {
    const res = await fetch(`${apiBase()}/api/leaderboard`);
    const body = await res.json();
    const v = c.vars as Vars;
    v.leaderboard = body?.leaderboard ?? [];
    v.headOfHousehold = body?.headOfHousehold ?? null;
  } catch {
    c.log.warn("could not reach /api/leaderboard");
  }
}

/** The single durable write per match. Aggregates + names/mash counts only. */
async function persistMatch(c: any, championStickyId: string | null) {
  const v = c.vars as Vars;
  const payload: MatchPersistPayload = {
    startedAt: v.matchStartedAt,
    endedAt: Date.now(),
    approvalSupport: v.approval.support,
    approvalHinder: v.approval.hinder,
    championStickyId,
    participants: [...v.effort.entries()].map(([stickyId, e]) => ({
      stickyId,
      name: e.name,
      mashes: e.mashes,
    })),
    roundResults: v.roundResults,
    // Only grievances still visible (host hides are respected forever).
    grievances: v.revealedFeed.map((g) => g.text),
  };
  try {
    const res = await fetch(`${apiBase()}/api/results`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) {
      c.log.info("match persisted");
    } else {
      // 401 = INTERNAL_API_SECRET mismatch; "no-db" = DATABASE_URL unset.
      c.log.warn("match NOT persisted (game unaffected)", {
        status: res.status,
        reason: body?.reason ?? body?.error ?? "unknown",
      });
    }
  } catch (err) {
    c.log.warn("match persist failed (game unaffected)", { err: String(err) });
  }
}

/* ── The snapshot: everything any screen is allowed to know ─────────────── */

function buildSnapshot(c: any, now: number): Snapshot {
  const v = c.vars as Vars;
  const ev = currentEvent(c);
  const view = ev && v.eventState ? ev.view(v.eventState) : null;

  // Normalize each event's headline number into "how far is Justin" 0..1.
  let justinProgress = 0.5;
  let tugPosition = 0;
  if (view) {
    if (typeof view.progress === "number") justinProgress = view.progress;
    if (typeof view.ropePos === "number") {
      tugPosition = view.ropePos;
      justinProgress = (view.ropePos + 1) / 2;
    }
    if (typeof view.pinPos === "number") justinProgress = 1 - view.pinPos;
  }

  // During the active window, public per-player counters are FROZEN at
  // their round-start values (see Vars.frozenEffort for why). Live values
  // come back the moment the round resolves.
  const active = v.session.phase === "event_active";
  const players: PlayerPub[] = playerEntries(c)
    .map(([, r]) => ({
      name: r.name,
      mashes: active
        ? (v.frozenEffort.get(r.stickyId) ?? 0)
        : (v.effort.get(r.stickyId)?.mashes ?? 0),
      team: ev?.teamBased ? (v.teamBySticky.get(r.stickyId) ?? null) : null,
    }))
    .sort((a, b) => b.mashes - a.mashes);

  const inEvent =
    v.session.phase === "event_countdown" ||
    v.session.phase === "event_active" ||
    v.session.phase === "event_outcome";

  const snapshot: Snapshot = {
    serverNow: now,
    phase: v.session.phase,
    phaseEndsAt: Number.isFinite(v.session.phaseEndsAt) ? v.session.phaseEndsAt : 0,
    eventMeta:
      ev && inEvent
        ? {
            id: ev.id,
            name: ev.name,
            sideLabels: ev.sideLabels,
            teamBased: ev.teamBased,
            durationSec: v.eventParams[ev.id]?.durationSec ?? ev.durationSec,
            index: v.session.eventIndex,
            total: EVENTS.length,
            weight: ev.weight,
          }
        : null,
    eventView: view,
    justinProgress,
    tugPosition,
    fx: v.fx,
    players,
    playerCount: players.length,
    bossCount: v.roster.size - players.length,
    sideCounts: ev && inEvent ? sideCounts(c) : null,
    grievanceFeed: v.revealedFeed,
    grievanceCount: v.grievances.length,
    leaderboard: v.leaderboard,
    approvalHidden: v.session.phase !== "finale" && v.session.phase !== "splash",
    matchSummary: v.matchSummary,
    roundResults: v.roundResults,
  };
  return snapshot;
}

/* ── The actor ───────────────────────────────────────────────────────────── */

export const festivusRoom = actor({
  /** Persisted (survives sleep). Tiny on purpose — Neon is durable truth. */
  state: { matchesPlayed: 0 },

  /** Ephemeral memory — where all live truth (and every secret) lives. */
  createVars: (): Vars => ({
    session: newSession(),
    roster: new Map(),
    sideByToken: new Map(),
    tokenBySticky: new Map(),
    teamBySticky: new Map(),
    eventState: null,
    eventParams: JSON.parse(JSON.stringify(DEFAULT_EVENT_PARAMS)),
    fx: [],
    grievances: [],
    grievanceCountBySticky: new Map(),
    revealedFeed: [],
    roundResults: [],
    approval: { support: 0, hinder: 0 },
    effort: new Map(),
    frozenEffort: new Map(),
    tapWindows: new Map(),
    matchStartedAt: 0,
    matchSummary: null,
    leaderboard: [],
    headOfHousehold: null,
    lastTickAt: 0,
  }),

  /** Connection params (role/name/stickyId), sanitized server-side. */
  createConnState: (_c, params: JoinParams) => ({
    role: params?.role === "boss" ? ("boss" as Role) : ("player" as Role),
    name: cleanName(params?.name),
    stickyId: UUID_RE.test(params?.stickyId ?? "") ? params.stickyId : crypto.randomUUID(),
  }),

  onConnect: (c, conn) => {
    const v = c.vars as Vars;
    v.roster.set(conn.id, {
      role: conn.state.role,
      name: conn.state.name,
      stickyId: conn.state.stickyId,
      joinedAt: Date.now(),
    });

    // Late joiner during tug-of-war: drop onto the smaller team; the
    // handicap recomputes automatically from live headcounts next tick.
    const ev = currentEvent(c);
    if (
      conn.state.role === "player" &&
      ev?.teamBased &&
      (v.session.phase === "event_countdown" || v.session.phase === "event_active") &&
      !v.teamBySticky.has(conn.state.stickyId)
    ) {
      const counts = sideCounts(c);
      v.teamBySticky.set(conn.state.stickyId, counts[0] <= counts[1] ? 0 : 1);
    }

    sendYouToAll(c); // host flag may have moved; everyone re-learns their facts
    conn.send(EVT_SNAPSHOT, buildSnapshot(c, Date.now()));
  },

  onDisconnect: (c, conn) => {
    (c.vars as Vars).roster.delete(conn.id);
    sendYouToAll(c);
  },

  /**
   * The fixed tick loop (~25 Hz): advance the phase machine, step the
   * event simulation, broadcast one snapshot. RivetKit may sleep the actor
   * when the room is empty; on wake, vars rebuild and the room is back in
   * the lobby — correct behavior for "everyone went home mid-match".
   */
  run: async (c) => {
    await Promise.all([loadEventParams(c), refreshLeaderboard(c)]);
    const v = c.vars as Vars;
    v.lastTickAt = Date.now();

    const hooks: SessionHooks = {
      onEventStart: (i) => onEventStart(c, i),
      onEventEnd: (i) => onEventEnd(c, i),
      onMatchEnd: () => onMatchEnd(c),
      isEventComplete: (i) => EVENTS[i].isComplete(v.eventState, eventCtx(c)),
      // Auto-advance the grievance window once every player has aired ≥ 1.
      allGrievancesIn: () => {
        const players = playerEntries(c);
        return (
          players.length > 0 &&
          players.every(([, r]) => (v.grievanceCountBySticky.get(r.stickyId) ?? 0) > 0)
        );
      },
    };

    while (!c.aborted) {
      const now = Date.now();
      // Clamp dt so a paused process doesn't teleport the simulation.
      const dtMs = Math.min(250, Math.max(0, now - v.lastTickAt));
      v.lastTickAt = now;

      const prevPhase = v.session.phase;
      tickSession(v.session, now, timing(c), hooks);

      const ev = currentEvent(c);
      if (v.session.phase === "event_active" && ev && v.eventState) {
        ev.tick(v.eventState, dtMs, eventCtx(c));
        // isComplete may flip mid-window; the runner closes it next pass.
      }

      // Shuffled reveal: the moment we enter the reveal phase, fix a random
      // order once (Fisher–Yates) — submission order never leaks.
      if (prevPhase !== "grievance_reveal" && v.session.phase === "grievance_reveal") {
        v.revealedFeed = fisherYates(v.grievances);
      }

      c.broadcast(EVT_SNAPSHOT, buildSnapshot(c, now));
      v.fx = []; // fx are one-snapshot transients

      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  },

  actions: {
    /** Refetch your private connection facts (host flag, team, own side). */
    hello: (c): YouMessage => {
      const v = c.vars as Vars;
      const entry = v.roster.get(c.conn.id);
      const token = entry ? v.tokenBySticky.get(entry.stickyId) : undefined;
      return {
        isHost: hostConnId(c) === c.conn.id,
        role: entry?.role ?? "player",
        name: entry?.name ?? "",
        team: entry ? (v.teamBySticky.get(entry.stickyId) ?? null) : null,
        side: token !== undefined ? ((c.vars as Vars).sideByToken.get(token) ?? null) : null,
      };
    },

    /**
     * Secretly pick help(0)/hinder(1) for this round. Mints the ephemeral
     * token that is the ONLY thing linking you to a side — in memory,
     * for one round. One pick per round; bosses are ignored server-side.
     */
    pickSide: (c, sideIndex: number): { ok: boolean; side: SideIndex | null } => {
      const v = c.vars as Vars;
      const entry = v.roster.get(c.conn.id);
      const ev = currentEvent(c);
      const phaseOk =
        v.session.phase === "event_countdown" || v.session.phase === "event_active";
      if (!entry || entry.role !== "player" || !ev || ev.teamBased || !phaseOk) {
        return { ok: false, side: null };
      }
      const existing = v.tokenBySticky.get(entry.stickyId);
      if (existing !== undefined) {
        // Already picked this round — picks are final until the next event.
        return { ok: false, side: v.sideByToken.get(existing) ?? null };
      }
      const side: SideIndex = sideIndex === 1 ? 1 : 0;
      const token = crypto.randomUUID();
      v.sideByToken.set(token, side);
      v.tokenBySticky.set(entry.stickyId, token);
      sendYou(c, c.conn.id);
      return { ok: true, side };
    },

    /**
     * One mash. The server decides whether it counts: player role, active
     * phase, a picked side/team, and under the human-plausible rate cap.
     */
    tap: (c): { counted: boolean } => {
      const v = c.vars as Vars;
      const entry = v.roster.get(c.conn.id);
      const ev = currentEvent(c);
      if (
        !entry ||
        entry.role !== "player" || // boss connections are spectators, enforced HERE
        !ev ||
        !v.eventState ||
        v.session.phase !== "event_active"
      ) {
        return { counted: false };
      }

      // Which side does this tap belong to? (team, or secret token → side)
      let side: SideIndex | undefined;
      if (ev.teamBased) {
        side = v.teamBySticky.get(entry.stickyId);
      } else {
        const token = v.tokenBySticky.get(entry.stickyId);
        side = token !== undefined ? v.sideByToken.get(token) : undefined;
      }
      if (side === undefined) return { counted: false }; // no side picked yet

      // Server-side rate cap: sliding 1s window per PERSON (sticky id).
      // Keying by sticky id — not connection — means opening extra tabs
      // does not multiply anyone's ceiling.
      const now = Date.now();
      const window = (v.tapWindows.get(entry.stickyId) ?? []).filter((t) => now - t < 1000);
      if (window.length >= GAME_CONFIG.MAX_COUNTED_TAPS_PER_SEC) {
        v.tapWindows.set(entry.stickyId, window);
        return { counted: false };
      }
      window.push(now);
      v.tapWindows.set(entry.stickyId, window);

      ev.onInput(v.eventState, side, { kind: "tap" }, eventCtx(c));

      // Leaderboard effort — keyed by sticky id so a refresh keeps your score.
      const e = v.effort.get(entry.stickyId) ?? { name: entry.name, mashes: 0 };
      e.mashes++;
      e.name = entry.name;
      v.effort.set(entry.stickyId, e);
      return { counted: true };
    },

    /** Blind-submit a grievance (lobby or the writing window). */
    submitGrievance: (c, text: string): { ok: boolean; reason?: string } => {
      const v = c.vars as Vars;
      const entry = v.roster.get(c.conn.id);
      const phaseOk = v.session.phase === "lobby" || v.session.phase === "grievance_write";
      if (!entry || entry.role !== "player" || !phaseOk) {
        return { ok: false, reason: "not now" };
      }
      const used = v.grievanceCountBySticky.get(entry.stickyId) ?? 0;
      if (used >= GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER) {
        return { ok: false, reason: "limit reached" };
      }
      const clean = cleanGrievance(String(text ?? ""), GAME_CONFIG.MAX_GRIEVANCE_LENGTH);
      if (!clean) return { ok: false, reason: "empty" };

      // Stored WITHOUT any author reference — only a quota counter is kept,
      // and that counter never touches the text.
      v.grievances.push({ id: crypto.randomUUID(), text: clean });
      v.grievanceCountBySticky.set(entry.stickyId, used + 1);
      return { ok: true };
    },

    /** Host: start the match from the lobby (or restart from the splash). */
    hostStart: async (c): Promise<{ ok: boolean }> => {
      const v = c.vars as Vars;
      if (hostConnId(c) !== c.conn.id) return { ok: false };
      const phase = v.session.phase;
      if (phase !== "lobby" && phase !== "splash") return { ok: false };
      // Pick up any level_config retuning done since the actor woke — this
      // is what makes "edit the DB row, next match uses it" actually true.
      await loadEventParams(c);
      const now = Date.now();
      // Lobby starts keep the head-start grievances; splash restarts wipe.
      resetMatch(c, now, phase === "lobby");
      startMatch(v.session, now, timing(c));
      return { ok: true };
    },

    /** Host: end the current phase immediately (auto-advance handles the rest). */
    hostSkip: (c): { ok: boolean } => {
      if (hostConnId(c) !== c.conn.id) return { ok: false };
      skipPhase((c.vars as Vars).session);
      return { ok: true };
    },

    /** Host: pull a grievance from the feed (and from eventual persistence). */
    hostHideGrievance: (c, id: string): { ok: boolean } => {
      const v = c.vars as Vars;
      if (hostConnId(c) !== c.conn.id) return { ok: false };
      v.grievances = v.grievances.filter((g) => g.id !== id);
      v.revealedFeed = v.revealedFeed.filter((g) => g.id !== id);
      return { ok: true };
    },

    /** A boss screen jumping in to play (the "jump in" link). */
    switchToPlayer: (c, name?: string): { ok: boolean } => {
      const v = c.vars as Vars;
      const entry = v.roster.get(c.conn.id);
      if (!entry) return { ok: false };
      entry.role = "player";
      if (name) entry.name = cleanName(name);
      sendYouToAll(c); // host may move to another connection
      return { ok: true };
    },
  },
});
