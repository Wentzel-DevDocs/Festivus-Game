/**
 * Headless end-to-end match simulation — `pnpm sim`.
 *
 * Drives the REAL room logic (server/game/core.ts) through an in-memory
 * transport: 1 boss + 5 players, a complete match — grievances → all 5
 * events (side picks, mashing, tug teams) → finale → splash — asserting the
 * game's hard promises:
 *
 *   1. phases auto-advance in order, all 5 events run
 *   2. boss connections cannot tap or pick a side (server-enforced)
 *   3. the server rate cap holds (a 60-taps-in-a-burst cheater counts ≤ cap)
 *   4. tug-of-war assigns everyone a team; solo events don't
 *   5. NO snapshot ever links a player to a help/hinder side
 *   6. the approval verdict matches the aggregate headcount math
 *   7. the champion is the top masher
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
  const { GAME_CONFIG } = await import("../lib/game/config");
  const { EVENTS } = await import("../lib/game/engine/registry");
  const { EVT_SNAPSHOT, EVT_YOU } = await import("../lib/realtime/protocol");
  const EVENT_COUNT = EVENTS.length;
  const APPROVAL_WEIGHT = EVENTS.filter((e) => !e.teamBased).reduce((s, e) => s + e.weight, 0);
  type Snapshot = import("../lib/realtime/protocol").Snapshot;
  type YouMessage = import("../lib/realtime/protocol").YouMessage;

  const failures: string[] = [];
  const check = (cond: boolean, label: string) => {
    console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
    if (!cond) failures.push(label);
  };

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
    name: `Player${i + 1}`,
    you: null as YouMessage | null,
  }));
  for (const p of players) {
    conns.set(p.id, { onYou: (m) => (p.you = m) });
    core.connect(p.id, sanitizeJoin({ role: "player", name: p.name, stickyId: crypto.randomUUID() }));
  }

  /** Call an action and get its result synchronously (RoomCore is in-proc). */
  const act = <T,>(id: string, method: string, arg?: unknown): T => core.action(id, method, arg) as T;

  const until = async (cond: () => boolean, ms: number, label: string) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await delay(50);
    check(cond(), label);
  };

  await until(() => latest !== null, 20_000, "boss receives snapshots");
  check(latest!.phase === "lobby", "room starts in lobby");

  /* ── (2) boss inputs are ignored server-side ─────────────────────────── */

  check(act<{ counted: boolean }>(bossId, "tap").counted === false, "boss tap is refused");
  check(act<{ ok: boolean }>(bossId, "pickSide", 0).ok === false, "boss pickSide is refused");

  /* ── start match: grievances ─────────────────────────────────────────── */

  check(act<{ ok: boolean }>(bossId, "hostStart").ok, "boss (host) can start the match");

  await until(() => latest?.phase === "grievance_write", 5000, "grievance window opens");
  for (const [i, p] of players.entries()) {
    const res = act<{ ok: boolean }>(p.id, "submitGrievance", `Grievance number ${i + 1} about the office`);
    if (!res.ok) failures.push(`grievance ${i + 1} rejected`);
  }
  await until(() => latest?.phase === "grievance_reveal", 10_000, "reveal follows (early-exit)");
  await until(() => (latest?.grievanceFeed.length ?? 0) === 5, 5000, "all 5 grievances revealed (shuffled)");

  /* ── play all 5 events ───────────────────────────────────────────────── */

  const sidePick = (i: number): 0 | 1 => (i < 3 ? 0 : 1);
  let cheaterBurstDone = false;

  for (let eventNum = 0; eventNum < EVENT_COUNT; eventNum++) {
    await until(
      () => latest?.phase === "event_countdown" || latest?.phase === "event_active",
      30_000,
      `event ${eventNum + 1} begins`,
    );
    const meta = latest!.eventMeta!;
    console.log(`    — ${meta.name} (${meta.teamBased ? "teams" : "pick sides"})`);

    if (!meta.teamBased) {
      for (const [i, p] of players.entries()) act(p.id, "pickSide", sidePick(i));
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
    }

    await until(() => latest?.phase === "event_active", 15_000, `event ${eventNum + 1} active`);

    // (3) one cheater fires a 60-tap burst exactly once, during event 1.
    if (!cheaterBurstDone) {
      cheaterBurstDone = true;
      const counted = Array.from({ length: 60 }, () => act<{ counted: boolean }>(players[0].id, "tap"))
        .filter((r) => r.counted).length;
      check(
        counted <= GAME_CONFIG.MAX_COUNTED_TAPS_PER_SEC + 1,
        `rate cap held: ${counted}/60 burst taps counted`,
      );
    }

    const snap = () => latest;
    while (snap()?.phase === "event_active") {
      for (const p of players) act(p.id, "tap");
      await delay(125);
    }
    const after = snap()?.phase;
    check(after === "event_outcome" || after === "finale", `event ${eventNum + 1} resolved`);
  }

  /* ── finale + splash ─────────────────────────────────────────────────── */

  await until(() => latest?.phase === "finale", 20_000, "jack-in-the-box finale plays");
  await until(() => latest?.phase === "splash", 20_000, "splash screen reached");

  const summary = latest!.matchSummary;
  check(!!summary, "match summary exists");
  if (summary) {
    // (6) 3 helpers / 2 hinderers on every non-team event.
    const wantSupport = 3 * APPROVAL_WEIGHT;
    const wantHinder = 2 * APPROVAL_WEIGHT;
    check(summary.approvalSupport === wantSupport, `approval support = ${wantSupport} (got ${summary.approvalSupport})`);
    check(summary.approvalHinder === wantHinder, `approval hinder = ${wantHinder} (got ${summary.approvalHinder})`);
    check(summary.verdict === "beloved", `verdict beloved (got ${summary.verdict})`);

    // (7) champion = top masher in the final roster.
    const top = [...latest!.players].sort((a, b) => b.mashes - a.mashes)[0];
    check(summary.championName === top?.name, `champion is top masher (${summary.championName})`);
  }

  check(eventsSeen.size === EVENT_COUNT, `all ${EVENT_COUNT} events ran (${[...eventsSeen].join(", ")})`);
  check(anonymityViolation === null, `anonymity sweep clean${anonymityViolation ? `: ${anonymityViolation}` : ""}`);
  check((latest!.roundResults?.length ?? 0) === EVENT_COUNT, `${EVENT_COUNT} round results recorded`);
  check(phasesSeen.has("lobby") && phasesSeen.has("finale"), "phase machine ran lobby → finale");

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
