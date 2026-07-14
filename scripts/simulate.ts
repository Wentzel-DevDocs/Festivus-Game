/**
 * Headless end-to-end match simulation — `pnpm sim`.
 *
 * Drives the REAL room logic (server/game/core.ts) through an in-memory
 * transport: 1 boss + 5 players, a complete match — grievances → all 5
 * events (direct dual-side actions, tug teams) → finale → splash — asserting
 * the
 * game's hard promises:
 *
 *   1. phases auto-advance in order, all 5 events run
 *   2. boss connections cannot tap; stale side picks are refused
 *   3. the shared rate cap holds across alternating help/hinder taps
 *   4. tug-of-war assigns everyone a team; solo events don't
 *   5. NO snapshot ever links a player to a help/hinder action
 *   6. the approval verdict matches weighted aggregate action contribution
 *   7. the champion is the top masher
 *   8. the grievance limit is three per player, independently
 *   9. players can escape idle rooms without stale-host access
 *  10. duplicate tabs remain one logical player with one shared quota/team
 *  11. empty-room reconnect grace preserves, then eventually resets, state
 *
 * RoomCore is transport-agnostic, so this needs no server, no WebSockets, and
 * no DB — the fetch stub makes tuning/persistence no-op to defaults. The
 * ~25 Hz tick is driven here; FESTIVUS_TIME_SCALE=8 compresses a match to ~40 s.
 */

process.env.FESTIVUS_TIME_SCALE ??= "8";

import { setTimeout as delay } from "node:timers/promises";
// Type-only (erased at runtime, so it doesn't evaluate config.ts early).
import type { Transport } from "../server/game/core";

async function main() {
  // Dynamic imports so TIME_SCALE is set before config.ts is evaluated.
  const { RoomCore, sanitizeJoin, TICK_MS } = await import("../server/game/core");
  const { EmptyRoomLifecycle } = await import("../server/game/roomLifecycle");
  const { GAME_CONFIG } = await import("../lib/game/config");
  const { EVENTS } = await import("../lib/game/engine/registry");
  const { EVT_SNAPSHOT, EVT_YOU } = await import("../lib/realtime/protocol");
  const EVENT_COUNT = EVENTS.length;
  type Snapshot = import("../lib/realtime/protocol").Snapshot;
  type YouMessage = import("../lib/realtime/protocol").YouMessage;

  const failures: string[] = [];
  const check = (cond: boolean, label: string) => {
    console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
    if (!cond) failures.push(label);
  };

  /* ── empty-room lifecycle policy (deterministic fake timers) ────────── */

  let timerId = 0;
  const pendingTimers = new Map<number, () => void>();
  const createdRooms: Array<{ connectionCount: number; generation: number }> = [];
  const lifecycle = new EmptyRoomLifecycle(
    () => {
      const room = { connectionCount: 0, generation: createdRooms.length + 1 };
      createdRooms.push(room);
      return room;
    },
    20_000,
    {
      schedule(callback) {
        const id = ++timerId;
        pendingTimers.set(id, callback);
        return id;
      },
      cancel(handle) {
        pendingTimers.delete(handle as number);
      },
    },
  );
  const firstRoom = lifecycle.current;
  lifecycle.releaseIfEmpty(firstRoom);
  const staleExpiry = [...pendingTimers.values()][0];
  firstRoom.connectionCount = 1;
  check(lifecycle.acquire() === firstRoom, "reconnect inside grace preserves the live room");
  check(pendingTimers.size === 0, "reconnect cancels the pending empty-room reset");
  firstRoom.connectionCount = 0;
  lifecycle.releaseIfEmpty(firstRoom);
  const expiry = [...pendingTimers.values()][0];
  staleExpiry?.();
  check(lifecycle.current === firstRoom, "a stale reset callback cannot replace a repopulated room");
  expiry?.();
  check(lifecycle.current !== firstRoom, "room resets after the empty reconnect grace expires");

  /* ── in-memory transport: fan messages out to per-conn handlers ───────── */

  interface Handlers {
    onSnapshot?: (s: Snapshot) => void;
    onYou?: (y: YouMessage) => void;
  }
  const conns = new Map<string, Handlers>();
  const deliver = (id: string, evt: string, data: unknown) => {
    const h = conns.get(id);
    if (!h) return;
    if (evt === EVT_SNAPSHOT) h.onSnapshot?.(data as Snapshot);
    else if (evt === EVT_YOU) h.onYou?.(data as YouMessage);
  };
  const transport: Transport = {
    broadcast: (evt, data) => {
      for (const id of conns.keys()) deliver(id, evt, data);
    },
    sendTo: (id, evt, data) => deliver(id, evt, data),
  };

  // No API/DB in the sim — every durable call rejects fast → defaults used.
  const noApi: typeof fetch = () => Promise.reject(new Error("no api in sim"));
  const core = new RoomCore(transport, { appBaseUrl: "", internalSecret: "" }, noApi);
  await core.start();

  // The fixed tick, driven here (RoomCore has no loop of its own).
  const ticker = setInterval(() => core.tick(), TICK_MS);

  /* ── connect 1 boss + 5 players ─────────────────────────────────────── */

  let latest: Snapshot | null = null;
  const phasesSeen = new Set<string>();
  const eventsSeen = new Set<string>();
  let anonymityViolation: string | null = null;

  const bossId = "boss";
  conns.set(bossId, {
    onSnapshot: (snap) => {
      latest = snap;
      phasesSeen.add(snap.phase);
      if (snap.eventMeta) eventsSeen.add(snap.eventMeta.id);

      // (5) The anonymity sweep: a roster entry may carry name/mashes/team,
      // NEVER a side. And no stray "side"-shaped fields elsewhere.
      for (const p of snap.players) {
        const keys = Object.keys(p).sort().join(",");
        if (keys !== "mashes,name,team") anonymityViolation = `unexpected roster keys: ${keys}`;
        if (p.team !== null && snap.eventMeta && !snap.eventMeta.teamBased) {
          anonymityViolation = `team exposed outside tug-of-war for ${p.name}`;
        }
      }
      // Sweep everything EXCEPT fx: FxEvent.side is a legitimate aggregate.
      const raw = JSON.stringify({ ...snap, fx: undefined });
      if (/"side":/.test(raw) || /"stickyId":/.test(raw) || /"token/.test(raw)) {
        anonymityViolation = "snapshot contains side/stickyId/token field";
      }
    },
  });
  core.connect(bossId, sanitizeJoin({ role: "boss", name: "Big Screen", stickyId: crypto.randomUUID() }));

  const players = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    // Two distinct people deliberately share a display name. Private `you`
    // messages, not a public name lookup, must identify their own effort.
    name: i === 1 ? "Player1" : `Player${i + 1}`,
    stickyId: crypto.randomUUID(),
    you: null as YouMessage | null,
  }));
  for (const p of players) {
    conns.set(p.id, { onYou: (m) => (p.you = m) });
    core.connect(p.id, sanitizeJoin({ role: "player", name: p.name, stickyId: p.stickyId }));
  }

  const duplicateId = "p0-second-tab";
  let duplicateYou: YouMessage | null = null;
  conns.set(duplicateId, { onYou: (message) => (duplicateYou = message) });
  core.connect(
    duplicateId,
    sanitizeJoin({ role: "player", name: players[0].name, stickyId: players[0].stickyId }),
  );

  /** Call an action and get its result synchronously (RoomCore is in-proc). */
  const act = <T,>(id: string, method: string, arg?: unknown): T => core.action(id, method, arg) as T;

  const until = async (cond: () => boolean, ms: number, label: string) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await delay(50);
    check(cond(), label);
  };

  await until(() => latest !== null, 20_000, "boss receives snapshots");
  check(latest!.phase === "lobby", "room starts in lobby");
  await until(() => latest?.playerCount === 5, 2_000, "duplicate tab remains one logical player");
  check(core.playerCount === 5, "core player count deduplicates sticky identities");
  check(latest!.players.length === 5, "public roster deduplicates the second tab");

  /* ── (2) boss inputs are ignored server-side ─────────────────────────── */

  check(act<{ counted: boolean }>(bossId, "tap", 0).counted === false, "boss tap is refused");
  check(act<{ ok: boolean }>(bossId, "pickSide", 0).ok === false, "boss pickSide is refused");
  check(
    !act<{ ok: boolean }>(players[0].id, "hostStart").ok,
    "non-host player cannot start the lobby",
  );
  check(
    act<{ ok: boolean }>(players[0].id, "submitGrievance", "Retain this lobby grievance").ok,
    "player can prewrite a lobby grievance",
  );
  check(
    act<{ ok: boolean }>(players[0].id, "startNextMatch").ok,
    "player can start a fresh lobby even while a stale boss owns host",
  );
  check(
    !act<{ ok: boolean }>(players[0].id, "startNextMatch").ok,
    "player lobby start is single-use once the phase advances",
  );

  /* ── start match: grievances ─────────────────────────────────────────── */

  await until(() => latest?.phase === "grievance_write", 5000, "grievance window opens");
  check(
    (latest as Snapshot | null)?.grievanceCount === 1,
    "player lobby start retains prewritten grievances",
  );
  // (8) Quotas belong to each player, not the room. Two players can each
  // submit all three while their fourth is rejected independently.
  for (const i of [2, 3]) {
    check(
      act<{ ok: boolean }>(players[0].id, "submitGrievance", `Player one grievance ${i}`).ok,
      `player 1 grievance ${i}/3 accepted`,
    );
  }
  check(
    !act<{ ok: boolean }>(players[0].id, "submitGrievance", "Player one grievance four").ok,
    "player 1 fourth grievance refused",
  );
  for (const i of [1, 2, 3]) {
    check(
      act<{ ok: boolean }>(players[1].id, "submitGrievance", `Player two grievance ${i}`).ok,
      `player 2 grievance ${i}/3 accepted independently`,
    );
  }
  check(
    !act<{ ok: boolean }>(players[1].id, "submitGrievance", "Player two grievance four").ok,
    "player 2 fourth grievance refused",
  );
  for (const [i, p] of players.slice(2).entries()) {
    for (const n of [1, 2, 3]) {
      const res = act<{ ok: boolean }>(p.id, "submitGrievance", `Player ${i + 3} grievance ${n}`);
      if (!res.ok) failures.push(`player ${i + 3} grievance ${n}/3 rejected`);
    }
  }
  await until(() => latest?.phase === "grievance_reveal", 10_000, "reveal follows (early-exit)");
  await until(() => (latest?.grievanceFeed.length ?? 0) === 15, 5000, "all 15 grievances revealed (3 per player)");

  /* ── play all 5 events ───────────────────────────────────────────────── */

  let cheaterBurstDone = false;
  let actionCycle = 0;
  const soloResults: Snapshot["roundResults"] = [];

  for (let eventNum = 0; eventNum < EVENT_COUNT; eventNum++) {
    await until(
      () => latest?.phase === "event_countdown" || latest?.phase === "event_active",
      30_000,
      `event ${eventNum + 1} begins`,
    );
    const meta = latest!.eventMeta!;
    console.log(`    — ${meta.name} (${meta.teamBased ? "assigned teams" : "dual direct actions"})`);

    if (!meta.teamBased) {
      check(
        !act<{ ok: boolean }>(players[0].id, "pickSide", 0).ok,
        "solo event refuses obsolete side picks",
      );
    } else {
      // (4) tug: picks refused, teams assigned
      check(!act<{ ok: boolean }>(players[0].id, "pickSide", 0).ok, "tug-of-war refuses manual side picks");
      await until(
        () => players.every((p) => p.you?.team === 0 || p.you?.team === 1),
        8000,
        "every player got a tug team",
      );
      const teamA = players.filter((p) => p.you?.team === 0).length;
      check(teamA === 2 || teamA === 3, `teams split 2/3 or 3/2 (A=${teamA})`);
      check(
        ((latest as Snapshot | null)?.sideCounts?.[0] ?? 0) +
          ((latest as Snapshot | null)?.sideCounts?.[1] ?? 0) ===
          5,
        "duplicate tab does not inflate public tug headcounts",
      );
    }

    await until(() => latest?.phase === "event_active", 15_000, `event ${eventNum + 1} active`);

    if (!meta.teamBased) {
      check(
        !act<{ counted: boolean }>(players[0].id, "tap").counted,
        "solo tap without a direct side is refused",
      );
      const help = act<{ counted: boolean; side?: 0 | 1 }>(players[0].id, "tap", 0);
      const hinder = act<{ counted: boolean; side?: 0 | 1 }>(players[0].id, "tap", 1);
      check(help.counted && help.side === 0, "player can help on a direct action");
      check(hinder.counted && hinder.side === 1, "same player can immediately hinder");
      if (eventNum === 0) {
        check(players[0].you?.mashes === 2, "private own effort updates for the acting player");
        check(
          (duplicateYou as YouMessage | null)?.mashes === 2,
          "same-sticky tabs share the private effort total",
        );
        check(players[1].you?.mashes === 0, "same-name player retains a distinct private effort total");
      }
    } else {
      const assigned = players[0].you?.team;
      const spoofed = act<{ counted: boolean; side?: 0 | 1 }>(
        players[0].id,
        "tap",
        assigned === 0 ? 1 : 0,
      );
      check(
        spoofed.counted && spoofed.side === assigned,
        "tug ignores a spoofed side and uses the assigned team",
      );
    }

    // (3) one cheater fires a 60-tap burst exactly once, during event 1.
    if (!cheaterBurstDone) {
      cheaterBurstDone = true;
      const counted = Array.from({ length: 60 }, (_, i) =>
        act<{ counted: boolean }>(players[0].id, "tap", (i % 2) as 0 | 1),
      ).filter((r) => r.counted).length;
      check(
        counted <= GAME_CONFIG.MAX_COUNTED_TAPS_PER_SEC - 2,
        `shared dual-side rate cap held: ${counted}/60 burst taps counted after two direct taps`,
      );
    }

    const snap = () => latest;
    while (snap()?.phase === "event_active") {
      for (const [i, p] of players.entries()) {
        if (meta.teamBased) act(p.id, "tap");
        else act(p.id, "tap", ((i + actionCycle) % 2) as 0 | 1);
      }
      actionCycle++;
      await delay(125);
    }
    const after = snap()?.phase;
    check(after === "event_outcome" || after === "finale", `event ${eventNum + 1} resolved`);
    if (!meta.teamBased) {
      const result = snap()?.roundResults.find((r) => r.eventId === meta.id);
      if (result) soloResults.push(result);
      check(
        !!result && result.supportForce > 0 && result.hinderForce > 0,
        `${meta.name} records aggregate contribution on both sides`,
      );
    }
  }

  /* ── finale + splash ─────────────────────────────────────────────────── */

  await until(() => latest?.phase === "finale", 20_000, "jack-in-the-box finale plays");
  await until(() => latest?.phase === "splash", 20_000, "splash screen reached");

  const summary = latest!.matchSummary;
  check(!!summary, "match summary exists");
  if (summary) {
    // (6) Approval is weighted aggregate input, so one player may appear in
    // both totals without any identity-side record.
    const weightById = new Map(EVENTS.map((e) => [e.id, e.weight]));
    const wantSupport = soloResults.reduce(
      (sum, r) => sum + r.supportForce * (weightById.get(r.eventId) ?? 0),
      0,
    );
    const wantHinder = soloResults.reduce(
      (sum, r) => sum + r.hinderForce * (weightById.get(r.eventId) ?? 0),
      0,
    );
    check(summary.approvalSupport === wantSupport, `approval support = ${wantSupport} (got ${summary.approvalSupport})`);
    check(summary.approvalHinder === wantHinder, `approval hinder = ${wantHinder} (got ${summary.approvalHinder})`);
    const wantVerdict =
      wantSupport > wantHinder ? "beloved" : wantHinder > wantSupport ? "greased" : "divided";
    check(summary.verdict === wantVerdict, `verdict ${wantVerdict} (got ${summary.verdict})`);

    // (7) champion = top masher in the final roster.
    const top = [...latest!.players].sort((a, b) => b.mashes - a.mashes)[0];
    check(summary.championName === top?.name, `champion is top masher (${summary.championName})`);
  }

  check(eventsSeen.size === EVENT_COUNT, `all ${EVENT_COUNT} events ran (${[...eventsSeen].join(", ")})`);
  check(anonymityViolation === null, `anonymity sweep clean${anonymityViolation ? `: ${anonymityViolation}` : ""}`);
  check((latest!.roundResults?.length ?? 0) === EVENT_COUNT, `${EVENT_COUNT} round results recorded`);
  check(phasesSeen.has("lobby") && phasesSeen.has("finale"), "phase machine ran lobby → finale");

  /* ── completed-room recovery ───────────────────────────────────────── */

  const late = { you: null as YouMessage | null };
  const lateId = "late-player";
  conns.set(lateId, { onYou: (message) => (late.you = message) });
  core.connect(
    lateId,
    sanitizeJoin({ role: "player", name: "Late Joiner", stickyId: crypto.randomUUID() }),
  );
  check(late.you?.isHost === false, "late player remains non-host while boss display is connected");
  check(
    act<{ ok: boolean }>(lateId, "startNextMatch").ok,
    "late player can start a fresh match from completed splash",
  );
  check(
    !act<{ ok: boolean }>(lateId, "startNextMatch").ok,
    "fresh-game action is single-use once splash has ended",
  );
  await until(() => latest?.phase === "grievance_write", 5000, "fresh match leaves stale splash");
  const freshSnapshot = latest as Snapshot | null;
  check(freshSnapshot?.matchSummary === null, "fresh match clears the previous summary");
  check(freshSnapshot?.roundResults.length === 0, "fresh match clears previous round results");
  check(freshSnapshot?.grievanceCount === 0, "fresh match clears previous grievances");
  check(
    players[0].you?.grievancesRemaining === GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER,
    "fresh match restores an exhausted player's grievance quota",
  );
  check(
    late.you?.grievancesRemaining === GAME_CONFIG.MAX_GRIEVANCES_PER_PLAYER,
    "fresh match gives the late player a full grievance quota",
  );
  check(freshSnapshot?.approvalHidden === true, "fresh match reseals aggregate approval");
  core.disconnect(duplicateId);
  check(core.playerCount === 6, "closing one duplicate tab keeps its logical player connected");

  clearInterval(ticker);

  /* ── verdict ─────────────────────────────────────────────────────────── */

  console.log("");
  if (failures.length === 0) {
    console.log("SIMULATION PASSED — full match played end-to-end.");
    process.exit(0);
  } else {
    console.log(`SIMULATION FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("simulation crashed:", err);
  process.exit(1);
});
