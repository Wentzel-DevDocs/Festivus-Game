/**
 * Headless end-to-end match simulation — `pnpm sim`.
 *
 * Boots the REAL Rivet actor in-process, connects 1 boss + 5 players over
 * real WebSockets, and drives a complete match: grievances → all 5 events
 * (side picks, mashing, tug teams) → finale → splash. Along the way it
 * asserts the game's hard promises:
 *
 *   1. phases auto-advance in order, all 5 events run
 *   2. boss connections cannot tap or pick a side (server-enforced)
 *   3. the server rate cap holds (a 60-taps-in-a-burst cheater counts ≤ cap)
 *   4. tug-of-war assigns everyone a team; solo events don't
 *   5. NO snapshot ever links a player to a help/hinder side
 *   6. the approval verdict matches the aggregate headcount math
 *   7. the champion is the top masher
 *
 * Runs with FESTIVUS_TIME_SCALE=8 (set by this script before imports) so a
 * whole match takes ~40 s. No DB needed: persistence calls no-op gracefully.
 */

process.env.FESTIVUS_TIME_SCALE ??= "8";

import { setTimeout as delay } from "node:timers/promises";

async function main() {
  // Dynamic imports so TIME_SCALE is set before config.ts is evaluated.
  const { registry } = await import("../server/rivet/registry");
  const { createClient } = await import("rivetkit/client");
  const { GAME_CONFIG } = await import("../lib/game/config");
  // Expectations derive from the REGISTRY, so adding a sixth event keeps
  // this sim honest instead of breaking it.
  const { EVENTS } = await import("../lib/game/engine/registry");
  const EVENT_COUNT = EVENTS.length;
  const APPROVAL_WEIGHT = EVENTS.filter((e) => !e.teamBased).reduce((sum, e) => sum + e.weight, 0);
  type Snapshot = import("../lib/realtime/protocol").Snapshot;
  type YouMessage = import("../lib/realtime/protocol").YouMessage;

  registry.start();
  await delay(4000); // give the embedded engine a moment to fully boot

  const client = createClient<typeof registry>("http://127.0.0.1:6420");
  const room = () => client.festivusRoom.getOrCreate([GAME_CONFIG.ROOM_ID]);

  const failures: string[] = [];
  const check = (cond: boolean, label: string) => {
    console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
    if (!cond) failures.push(label);
  };

  /* ── connect 1 boss + 5 players ─────────────────────────────────────── */

  const bossConn = room().connect({
    role: "boss",
    name: "Big Screen",
    stickyId: crypto.randomUUID(),
  });

  const players = Array.from({ length: 5 }, (_, i) => ({
    name: `Player${i + 1}`,
    stickyId: crypto.randomUUID(),
    conn: null as unknown as ReturnType<typeof room> extends { connect(p?: unknown): infer C } ? C : never,
    you: null as YouMessage | null,
  }));
  for (const p of players) {
    p.conn = room().connect({ role: "player", name: p.name, stickyId: p.stickyId }) as never;
    (p.conn as { on(e: string, cb: (m: YouMessage) => void): unknown }).on(
      "you",
      (m: YouMessage) => (p.you = m),
    );
  }

  // Track every snapshot for the anonymity sweep + phase log.
  let latest: Snapshot | null = null;
  const phasesSeen = new Set<string>();
  const eventsSeen = new Set<string>();
  let anonymityViolation: string | null = null;

  bossConn.on("snapshot", (snap: Snapshot) => {
    latest = snap;
    phasesSeen.add(snap.phase);
    if (snap.eventMeta) eventsSeen.add(snap.eventMeta.id);

    // (5) The anonymity sweep: a roster entry may carry name/mashes/team,
    // NEVER a side. And no stray "side"-shaped fields elsewhere.
    for (const p of snap.players) {
      const keys = Object.keys(p).sort().join(",");
      if (keys !== "mashes,name,team") {
        anonymityViolation = `unexpected roster keys: ${keys}`;
      }
      if (p.team !== null && snap.eventMeta && !snap.eventMeta.teamBased) {
        anonymityViolation = `team exposed outside tug-of-war for ${p.name}`;
      }
    }
    // Sweep everything EXCEPT fx: FxEvent.side is a legitimate aggregate
    // side index ("the miracle boosted side 1"), never tied to a player.
    const raw = JSON.stringify({ ...snap, fx: undefined });
    if (/"side":/.test(raw) || /"stickyId":/.test(raw) || /"token/.test(raw)) {
      anonymityViolation = "snapshot contains side/stickyId/token field";
    }
  });

  const until = async (cond: () => boolean, ms: number, label: string) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await delay(50);
    check(cond(), label);
  };

  await until(() => latest !== null, 20_000, "boss receives snapshots");
  check(latest!.phase === "lobby", "room starts in lobby");

  /* ── (2) boss inputs are ignored server-side ─────────────────────────── */

  const bossTap = await (bossConn as { tap(): Promise<{ counted: boolean }> }).tap();
  check(bossTap.counted === false, "boss tap is refused");
  const bossPick = await (bossConn as { pickSide(s: number): Promise<{ ok: boolean }> }).pickSide(0);
  check(bossPick.ok === false, "boss pickSide is refused");

  /* ── start match: grievances ─────────────────────────────────────────── */

  const started = await (bossConn as { hostStart(): Promise<{ ok: boolean }> }).hostStart();
  check(started.ok, "boss (host) can start the match");

  await until(() => latest?.phase === "grievance_write", 5000, "grievance window opens");
  for (const [i, p] of players.entries()) {
    const res = await (p.conn as unknown as {
      submitGrievance(t: string): Promise<{ ok: boolean }>;
    }).submitGrievance(`Grievance number ${i + 1} about the office`);
    if (!res.ok) failures.push(`grievance ${i + 1} rejected`);
  }
  // All 5 submitted → the phase should end early, then reveal.
  await until(() => latest?.phase === "grievance_reveal", 10_000, "reveal follows (early-exit)");
  await until(
    () => (latest?.grievanceFeed.length ?? 0) === 5,
    5000,
    "all 5 grievances revealed (shuffled)",
  );

  /* ── play all 5 events ───────────────────────────────────────────────── */

  // Fixed loyalties: players 1–3 help, players 4–5 hinder.
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
      for (const [i, p] of players.entries()) {
        await (p.conn as unknown as {
          pickSide(s: number): Promise<{ ok: boolean; side: number | null }>;
        }).pickSide(sidePick(i));
      }
    } else {
      // (4) tug: picks refused, teams assigned
      const refused = await (players[0].conn as unknown as {
        pickSide(s: number): Promise<{ ok: boolean }>;
      }).pickSide(0);
      check(!refused.ok, "tug-of-war refuses manual side picks");
      await until(
        () => players.every((p) => p.you?.team === 0 || p.you?.team === 1),
        8000,
        "every player got a tug team",
      );
      const teamA = players.filter((p) => p.you?.team === 0).length;
      check(teamA === 2 || teamA === 3, `teams split 2/3 or 3/2 (A=${teamA})`);
    }

    // Mash through the active window at a legal ~8 taps/sec each.
    await until(() => latest?.phase === "event_active", 15_000, `event ${eventNum + 1} active`);

    // (3) one cheater fires a 60-tap burst exactly once, during event 1.
    if (!cheaterBurstDone) {
      cheaterBurstDone = true;
      const cheater = players[0].conn as unknown as { tap(): Promise<{ counted: boolean }> };
      const results = await Promise.all(Array.from({ length: 60 }, () => cheater.tap()));
      const counted = results.filter((r) => r.counted).length;
      check(
        counted <= GAME_CONFIG.MAX_COUNTED_TAPS_PER_SEC + 1,
        `rate cap held: ${counted}/60 burst taps counted`,
      );
    }

    // (`snap()` instead of `latest` so TS doesn't over-narrow the closure var.)
    const snap = () => latest;
    while (snap()?.phase === "event_active") {
      await Promise.all(
        players.map((p) =>
          (p.conn as unknown as { tap(): Promise<unknown> }).tap().catch(() => {}),
        ),
      );
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
    // (6) approval math: 3 helpers / 2 hinderers on every non-team event,
    // so support = 3 × Σweights and hinder = 2 × Σweights (15/10 with the
    // shipped registry) → beloved.
    const wantSupport = 3 * APPROVAL_WEIGHT;
    const wantHinder = 2 * APPROVAL_WEIGHT;
    check(
      summary.approvalSupport === wantSupport,
      `approval support = ${wantSupport} (got ${summary.approvalSupport})`,
    );
    check(
      summary.approvalHinder === wantHinder,
      `approval hinder = ${wantHinder} (got ${summary.approvalHinder})`,
    );
    check(summary.verdict === "beloved", `verdict beloved (got ${summary.verdict})`);

    // (7) champion = top masher in the final roster.
    const top = [...latest!.players].sort((a, b) => b.mashes - a.mashes)[0];
    check(summary.championName === top?.name, `champion is top masher (${summary.championName})`);
  }

  check(
    eventsSeen.size === EVENT_COUNT,
    `all ${EVENT_COUNT} events ran (${[...eventsSeen].join(", ")})`,
  );
  check(anonymityViolation === null, `anonymity sweep clean${anonymityViolation ? `: ${anonymityViolation}` : ""}`);
  check(
    (latest!.roundResults?.length ?? 0) === EVENT_COUNT,
    `${EVENT_COUNT} round results recorded`,
  );

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
