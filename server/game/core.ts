/**
 * RoomCore — the transport-agnostic Festivus room.
 *
 * This holds ALL live truth and game logic that used to live in the Rivet
 * actor: the roster, anonymous aggregate inputs, the event simulation,
 * the fixed tick, and every action. It knows nothing about WebSockets — it
 * talks to the outside world through a small `Transport` (broadcast + send
 * to one connection) injected by whoever hosts it:
 *
 *   - `server/game/server.ts` — the Socket.IO server (production)
 *   - `scripts/simulate.ts`   — an in-memory transport (headless test)
 *
 * The helper functions below are ported verbatim from the old actor; they
 * operate on a Rivet-actor-shaped context object `c` that RoomCore builds,
 * so the anonymity mechanics, freeze logic, and tug assignment are byte-for-
 * byte the same code that passed the audit. See the anonymity notes inline.
 */

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

export { TICK_MS };

/** How RoomCore reaches connected screens. The host implements this. */
export interface Transport {
  /** Send an event to every connection. */
  broadcast(event: string, data: unknown): void;
  /** Send an event to one connection by id (no-op if it's gone). */
  sendTo(connId: string, event: string, data: unknown): void;
}

/** Server-side env the room needs to reach the durable world (Neon via Next). */
export interface RoomEnv {
  appBaseUrl: string;
  internalSecret: string;
}

/** One connected screen (boss or player). Lives in vars, keyed by conn id. */
interface RosterEntry {
  role: Role;
  name: string;
  stickyId: string;
  joinedAt: number;
}

/** Sanitized connection identity, computed once when a screen connects. */
export interface ConnState {
  role: Role;
  name: string;
  stickyId: string;
}

/** Everything ephemeral. Rebuilt from scratch whenever the room wakes. */
interface Vars {
  session: SessionState;
  roster: Map<string, RosterEntry>;
  /** Tug-of-war team per player — PUBLIC by design (it's a team sport). */
  teamBySticky: Map<string, 0 | 1>;
  /** Counted actions per side this round. Aggregate only; never keyed by player. */
  sideActions: [number, number];
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

/**
 * The actor-shaped context the ported helpers expect. RoomCore builds one of
 * these and hands it to every helper, so the bodies below stay identical to
 * the original actor.
 */
interface Ctx {
  vars: Vars;
  state: { matchesPlayed: number };
  conns: Map<string, { id: string; state: ConnState; send(evt: string, data: unknown): void }>;
  conn?: { id: string; state: ConnState };
  env: RoomEnv;
  fetch: typeof fetch;
  broadcast(evt: string, data: unknown): void;
  waitUntil(p: Promise<unknown>): void;
  log: { info(m: string, x?: unknown): void; warn(m: string, x?: unknown): void };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function playerEntries(c: any): [string, RosterEntry][] {
  return [...(c.vars as Vars).roster.entries()].filter(([, r]) => r.role === "player");
}

/**
 * Aggregate public side totals for the current round. Team events need
 * headcounts for balancing; solo events expose counted actions because a
 * player can contribute to either side on every press.
 */
function sideCounts(c: any): [number, number] {
  const v = c.vars as Vars;
  if (currentEvent(c)?.teamBased) {
    const counts: [number, number] = [0, 0];
    for (const [, r] of playerEntries(c)) {
      const team = v.teamBySticky.get(r.stickyId);
      if (team !== undefined) counts[team]++;
    }
    return counts;
  }
  return [...v.sideActions] as [number, number];
}

function currentEvent(c: any) {
  const i = (c.vars as Vars).session.eventIndex;
  return i >= 0 ? EVENTS[i] : null;
}

/** Build the EventTickCtx handed to the current module. */
function eventCtx(c: any): EventTickCtx {
  const v = c.vars as Vars;
  const ev = currentEvent(c);
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
  const scale = GAME_CONFIG.TIME_SCALE;
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
    if (!best || (boss && !best.boss) || (boss === best.boss && r.joinedAt < best.joinedAt)) {
      best = { id, joinedAt: r.joinedAt, boss };
    }
  }
  return best?.id ?? null;
}

/** Private per-connection facts: host flag and own public tug team. */
function sendYou(c: any, connId: string) {
  const v = c.vars as Vars;
  const conn = c.conns.get(connId);
  const entry = v.roster.get(connId);
  if (!conn || !entry) return;
  const msg: YouMessage = {
    isHost: hostConnId(c) === connId,
    role: entry.role,
    name: entry.name,
    team: v.teamBySticky.get(entry.stickyId) ?? null,
    grievancesRemaining: Math.max(
      0,
      GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER -
        (v.grievanceCountBySticky.get(entry.stickyId) ?? 0),
    ),
  };
  conn.send(EVT_YOU, msg);
}

function sendYouToAll(c: any) {
  for (const id of (c.vars as Vars).roster.keys()) sendYou(c, id);
}

/* ── Round + match lifecycle (the SessionHooks implementation) ──────────── */

function onEventStart(c: any, index: number) {
  const v = c.vars as Vars;
  const ev = EVENTS[index];

  // Side actions are aggregate-only and reset for every round.
  v.sideActions = [0, 0];
  v.teamBySticky = new Map();
  v.fx = [];

  // Freeze the public mash counters for the round (see Vars.frozenEffort).
  v.frozenEffort = new Map([...v.effort.entries()].map(([id, e]) => [id, e.mashes]));

  if (ev.teamBased) assignTeams(c);

  v.eventState = ev.init(eventCtx(c));
  sendYouToAll(c);
}

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

function onEventEnd(c: any, index: number) {
  const v = c.vars as Vars;
  const ev = EVENTS[index];
  const ctx = eventCtx(c);
  const result = ev.resolve(v.eventState, ctx);

  v.roundResults.push({ eventId: ev.id, eventName: ev.name, ...result });

  if (!ev.teamBased) {
    // With direct dual controls, players may help and hinder in the same
    // round. Approval therefore follows aggregate action contribution, not
    // an obsolete one-person/one-side headcount.
    v.approval.support += result.supportForce * ev.weight;
    v.approval.hinder += result.hinderForce * ev.weight;
  }

  v.fx.push({ type: result.winner === "support" ? "win" : "lose" });
}

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
  c.waitUntil(persistMatch(c, champion?.stickyId ?? null).then(() => refreshLeaderboard(c)));
  c.state.matchesPlayed++;
}

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
  v.sideActions = [0, 0];
  v.teamBySticky = new Map();
  v.fx = [];
  v.matchStartedAt = now;
}

/* ── Talking to the durable world (Next.js API → Neon) ──────────────────── */

function apiBase(c: any): string {
  return (c.env.appBaseUrl || "http://localhost:3000").replace(/\/$/, "");
}

async function loadEventParams(c: any) {
  try {
    const res = await c.fetch(`${apiBase(c)}/api/config`);
    const body = await res.json();
    if (body?.params) (c.vars as Vars).eventParams = body.params;
    c.log.info("loaded level config");
  } catch {
    c.log.warn("could not reach /api/config — using default tuning");
  }
}

async function refreshLeaderboard(c: any) {
  try {
    const res = await c.fetch(`${apiBase(c)}/api/leaderboard`);
    const body = await res.json();
    const v = c.vars as Vars;
    v.leaderboard = body?.leaderboard ?? [];
    v.headOfHousehold = body?.headOfHousehold ?? null;
  } catch {
    c.log.warn("could not reach /api/leaderboard");
  }
}

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
    grievances: v.revealedFeed.map((g) => g.text),
  };
  try {
    const res = await c.fetch(`${apiBase(c)}/api/results`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": c.env.internalSecret ?? "",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) {
      c.log.info("match persisted");
    } else {
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

  return {
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
}

function freshVars(): Vars {
  return {
    session: newSession(),
    roster: new Map(),
    teamBySticky: new Map(),
    sideActions: [0, 0],
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
  };
}

/** Sanitize the raw join params a client presents on connect. */
export function sanitizeJoin(
  params: { role?: string; name?: string; stickyId?: string } | null | undefined,
): ConnState {
  return {
    role: params?.role === "boss" ? "boss" : "player",
    name: cleanName(params?.name ?? ""),
    stickyId: UUID_RE.test(params?.stickyId ?? "") ? params!.stickyId! : crypto.randomUUID(),
  };
}

/** Result envelope for an action call (mirrors the old actor return types). */
type ActionResult = unknown;

/**
 * The room. Host it with any Transport. Call connect/disconnect/tick and the
 * action methods; it emits EVT_SNAPSHOT / EVT_YOU through the transport.
 */
export class RoomCore {
  private c: Ctx;
  private hooks: SessionHooks;
  private started = false;

  constructor(transport: Transport, env: RoomEnv, fetchImpl: typeof fetch = fetch) {
    const vars = freshVars();
    this.c = {
      vars,
      state: { matchesPlayed: 0 },
      conns: new Map(),
      conn: undefined,
      env,
      fetch: fetchImpl,
      broadcast: (evt, data) => transport.broadcast(evt, data),
      waitUntil: (p) => void p.catch(() => {}),
      log: {
        info: () => {},
        warn: () => {},
      },
    };
    // sendTo routing: each conn carries a send() bound to the transport.
    this.transport = transport;
    this.hooks = {
      onEventStart: (i) => onEventStart(this.c, i),
      onEventEnd: (i) => onEventEnd(this.c, i),
      onMatchEnd: () => onMatchEnd(this.c),
      isEventComplete: (i) => EVENTS[i].isComplete(this.c.vars.eventState, eventCtx(this.c)),
      allGrievancesIn: () => {
        const players = playerEntries(this.c);
        return (
          players.length > 0 &&
          players.every(
            ([, r]) =>
              (this.c.vars.grievanceCountBySticky.get(r.stickyId) ?? 0) >=
              GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER,
          )
        );
      },
    };
  }

  private transport: Transport;

  /** Load durable tuning + standings. Call once before the first tick. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await Promise.all([loadEventParams(this.c), refreshLeaderboard(this.c)]);
    this.c.vars.lastTickAt = Date.now();
  }

  get playerCount(): number {
    return playerEntries(this.c).length;
  }

  get connectionCount(): number {
    return this.c.conns.size;
  }

  /** A screen connected. `state` is the sanitized identity. */
  connect(connId: string, state: ConnState): void {
    const v = this.c.vars;
    this.c.conns.set(connId, {
      id: connId,
      state,
      send: (evt, data) => this.transport.sendTo(connId, evt, data),
    });
    v.roster.set(connId, {
      role: state.role,
      name: state.name,
      stickyId: state.stickyId,
      joinedAt: Date.now(),
    });

    // Late joiner during tug-of-war: drop onto the smaller team.
    const ev = currentEvent(this.c);
    if (
      state.role === "player" &&
      ev?.teamBased &&
      (v.session.phase === "event_countdown" || v.session.phase === "event_active") &&
      !v.teamBySticky.has(state.stickyId)
    ) {
      const counts = sideCounts(this.c);
      v.teamBySticky.set(state.stickyId, counts[0] <= counts[1] ? 0 : 1);
    }

    sendYouToAll(this.c);
    this.transport.sendTo(connId, EVT_SNAPSHOT, buildSnapshot(this.c, Date.now()));
  }

  /** A screen disconnected. */
  disconnect(connId: string): void {
    this.c.conns.delete(connId);
    this.c.vars.roster.delete(connId);
    sendYouToAll(this.c);
  }

  /**
   * One fixed tick: advance the phase machine, step the event sim, broadcast
   * a snapshot. Call at ~TICK_MS. `now` lets tests drive a fake clock.
   */
  tick(now: number = Date.now()): void {
    const v = this.c.vars;
    const dtMs = Math.min(250, Math.max(0, now - v.lastTickAt));
    v.lastTickAt = now;

    const prevPhase = v.session.phase;
    tickSession(v.session, now, timing(this.c), this.hooks);

    const ev = currentEvent(this.c);
    if (v.session.phase === "event_active" && ev && v.eventState) {
      ev.tick(v.eventState, dtMs, eventCtx(this.c));
    }

    if (prevPhase !== "grievance_reveal" && v.session.phase === "grievance_reveal") {
      v.revealedFeed = fisherYates(v.grievances);
    }

    this.c.broadcast(EVT_SNAPSHOT, buildSnapshot(this.c, now));
    v.fx = [];
  }

  /**
   * Dispatch a client action by name. Returns the same shapes the old actor
   * actions returned (so the client RPC layer is a pass-through).
   */
  action(connId: string, method: string, arg?: unknown): ActionResult {
    const conn = this.c.conns.get(connId);
    if (!conn) return { ok: false };
    this.c.conn = { id: connId, state: conn.state };
    try {
      switch (method) {
        case "hello":
          return this.hello();
        case "tap":
          return this.tap(arg == null ? undefined : Number(arg));
        case "pickSide":
          // Backward-compatible refusal for stale clients. Solo play now
          // chooses a side on every tap and never records a player-side map.
          return { ok: false, side: null, reason: "direct actions only" };
        case "submitGrievance":
          return this.submitGrievance(String(arg ?? ""));
        case "hostStart":
          return this.hostStart();
        case "hostSkip":
          return this.hostSkip();
        case "hostHideGrievance":
          return this.hostHideGrievance(String(arg ?? ""));
        case "switchToPlayer":
          return this.switchToPlayer(arg == null ? undefined : String(arg));
        default:
          return { ok: false, reason: "unknown action" };
      }
    } finally {
      this.c.conn = undefined;
    }
  }

  /* ── actions (ported verbatim from the actor) ─────────────────────────── */

  private hello(): YouMessage {
    const c = this.c;
    const v = c.vars;
    const entry = v.roster.get(c.conn!.id);
    return {
      isHost: hostConnId(c) === c.conn!.id,
      role: entry?.role ?? "player",
      name: entry?.name ?? "",
      team: entry ? (v.teamBySticky.get(entry.stickyId) ?? null) : null,
      grievancesRemaining: entry
        ? Math.max(
            0,
            GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER -
              (v.grievanceCountBySticky.get(entry.stickyId) ?? 0),
          )
        : 0,
    };
  }

  private tap(sideIndex?: number): { counted: boolean; side?: SideIndex } {
    const c = this.c;
    const v = c.vars;
    const entry = v.roster.get(c.conn!.id);
    const ev = currentEvent(c);
    if (
      !entry ||
      entry.role !== "player" ||
      !ev ||
      !v.eventState ||
      v.session.phase !== "event_active"
    ) {
      return { counted: false };
    }

    let side: SideIndex | undefined;
    if (ev.teamBased) {
      // Assigned teams are authoritative. Any client-supplied side is
      // ignored, preventing a player from acting for the opposing team.
      side = v.teamBySticky.get(entry.stickyId);
    } else {
      // Solo events choose help/hinder on every press. Validate strictly so
      // missing or malformed input never silently becomes a side.
      side = sideIndex === 0 || sideIndex === 1 ? sideIndex : undefined;
    }
    if (side === undefined) return { counted: false };

    const now = Date.now();
    const window = (v.tapWindows.get(entry.stickyId) ?? []).filter((t) => now - t < 1000);
    if (window.length >= GAME_CONFIG.MAX_COUNTED_TAPS_PER_SEC) {
      v.tapWindows.set(entry.stickyId, window);
      return { counted: false, side };
    }
    window.push(now);
    v.tapWindows.set(entry.stickyId, window);

    ev.onInput(v.eventState, side, { kind: "tap" }, eventCtx(c));
    v.sideActions[side]++;

    const e = v.effort.get(entry.stickyId) ?? { name: entry.name, mashes: 0 };
    e.mashes++;
    e.name = entry.name;
    v.effort.set(entry.stickyId, e);
    return { counted: true, side };
  }

  private submitGrievance(text: string): { ok: boolean; reason?: string } {
    const c = this.c;
    const v = c.vars;
    const entry = v.roster.get(c.conn!.id);
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

    v.grievances.push({ id: crypto.randomUUID(), text: clean });
    v.grievanceCountBySticky.set(entry.stickyId, used + 1);
    sendYou(c, c.conn!.id);
    return { ok: true };
  }

  private hostStart(): { ok: boolean } {
    const c = this.c;
    const v = c.vars;
    if (hostConnId(c) !== c.conn!.id) return { ok: false };
    const phase = v.session.phase;
    if (phase !== "lobby" && phase !== "splash") return { ok: false };
    // Pick up any level_config retuning done since the room woke.
    c.waitUntil(loadEventParams(c));
    const now = Date.now();
    resetMatch(c, now, phase === "lobby");
    sendYouToAll(c);
    startMatch(v.session, now, timing(c));
    return { ok: true };
  }

  private hostSkip(): { ok: boolean } {
    const c = this.c;
    if (hostConnId(c) !== c.conn!.id) return { ok: false };
    skipPhase(c.vars.session);
    return { ok: true };
  }

  private hostHideGrievance(id: string): { ok: boolean } {
    const c = this.c;
    const v = c.vars;
    if (hostConnId(c) !== c.conn!.id) return { ok: false };
    v.grievances = v.grievances.filter((g) => g.id !== id);
    v.revealedFeed = v.revealedFeed.filter((g) => g.id !== id);
    return { ok: true };
  }

  private switchToPlayer(name?: string): { ok: boolean } {
    const c = this.c;
    const v = c.vars;
    const entry = v.roster.get(c.conn!.id);
    if (!entry) return { ok: false };
    entry.role = "player";
    if (name) entry.name = cleanName(name);
    sendYouToAll(c);
    return { ok: true };
  }
}
