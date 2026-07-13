# Justin's Feats of Strength

**INTEROFFICE MEMORANDUM — RE: MANDATORY FUN**

This is a Jackbox-style all-hands party game. One laptop plugs into the big
screen and becomes **the Boss broadcast**; everyone else opens the same URL on
their phone and their phone becomes **a controller**. The theme is Festivus:
the match opens with an anonymous Airing of Grievances, then five Feats of
Strength in which a cartoon Justin swims, climbs, and gets pinned — powered
(or sabotaged) by the room. Every round, each player **secretly** picks a side:
help Justin or hinder him. Nobody — not the boss, not the database, not even
the game code — can find out who picked what. That promise is enforced by
architecture, not politeness, and there's a test that proves it (`pnpm sim`).

---

## How it's put together

Three layers. Each one does the only job it's good at.

```
                 EVERYONE'S BROWSERS
        (Next.js pages + a PixiJS canvas)
   boss screen at /boss          phones at /play
    (everyone starts at / and picks a door)
          │                           │
          │ normal HTTPS              │ WebSocket*
          │ (pages, API)              │ (the live game)
          ▼                           ▼
 ┌─────────────────────┐    ┌──────────────────────────┐
 │  VERCEL             │    │  RIVET ACTOR*            │
 │  the Next.js app    │◀───│  server/rivet/room.ts    │
 │  + API routes:      │    │  ONE live room per key,  │
 │   GET /api/config   │    │  ticking 25 times/sec.   │
 │   GET /api/leaderb. │    │  The single source of    │
 │   POST /api/results │    │  truth for the match.    │
 └──────────┬──────────┘    └──────────────────────────┘
            │                 │
            │ Drizzle         │  The actor calls the API:
            ▼                 │  · /api/config at room start
 ┌─────────────────────┐      │  · /api/leaderboard at room start
 │  NEON POSTGRES      │      │    and after each match
 │  durable data only: │      │  · /api/results ONCE, at match
 │  leaderboard, match │◀─────┘    end (never per tap)
 │  history, tuning    │
 └─────────────────────┘
```

\* A **WebSocket** is a connection between a browser and a server that stays
open, so messages flow instantly in both directions — unlike a normal page
load, which asks one question, gets one answer, and hangs up.

\* An **actor** is one long-lived server object that owns a room's live state
in memory and personally handles every message for that room — so there is
exactly one copy of the truth and no two servers can disagree.

**Why the game loop can't run on Vercel:** Vercel serverless functions are
request/response — one wakes up to answer a request, answers it, and dies. It
keeps no memory between requests and can't run a 25-ticks-per-second loop for
five minutes. A live game room needs one long-lived process that holds the
roster, counts the mashes, and steps the simulation continuously. That process
is the Rivet actor. Vercel serves the pages and the database API; the actor
serves the match; Neon remembers what's worth remembering.

---

## Run it locally in 3 minutes

You need **Node 24+** and pnpm. (The app is built on Next.js 16, which
bundles with **Turbopack** by default — `pnpm dev` and `pnpm build` just use
it; nothing to configure.)

```bash
pnpm install
cp .env.example .env.local
```

You can leave **everything in `.env.local` blank**. No database is needed for
a demo — the game is fully playable; leaderboards just won't persist between
restarts.

Two processes, two terminals:

```bash
# terminal 1 — the Next.js app (pages + API)
pnpm dev

# terminal 2 — the Rivet actor (the live game room, on port 6420)
pnpm dev:rivet
```

Or the one-terminal shortcut that runs both:

```bash
pnpm dev:all
```

Open **http://localhost:3000** on your laptop and click **Join as Boss** —
that's the big screen.

**To get phones in on it** (same wifi):

1. Find your laptop's LAN IP (macOS: `ipconfig getifaddr en0`, Linux:
   `hostname -I`, Windows: `ipconfig`). Say it's `192.168.1.42`.
2. In `.env.local`, set the realtime endpoint to that IP so phones can reach
   the actor (the default `127.0.0.1` means "this device," which on a phone
   is the phone):

   ```
   NEXT_PUBLIC_RIVET_ENDPOINT=http://192.168.1.42:6420
   ```
3. Restart `pnpm dev` (Next.js bakes `NEXT_PUBLIC_` values in at startup).
4. Phones open `http://192.168.1.42:3000`, type a name, **Join as Team
   Player**. Everyone lands in the same room automatically — no room codes.

---

## Set up the database (Neon)

Optional for playing; required for a persistent all-time leaderboard and
database-driven tuning.

1. Create a free project at [console.neon.tech](https://console.neon.tech).
2. On the project page, click **Connect** and copy the connection string.
3. Paste it into `.env.local` as `DATABASE_URL=postgres://...`.
4. Also set `INTERNAL_API_SECRET` in `.env.local` (generate one with
   `openssl rand -hex 24`). Match **results** are written by the actor
   calling `POST /api/results`, and that route *fails closed* without the
   secret — a database with no secret means the leaderboard never fills.
   Both `pnpm dev` and `pnpm dev:rivet` read `.env.local`, so one line
   covers both processes.
5. Apply the migrations, then seed the tuning table:

```bash
pnpm db:migrate
pnpm db:seed
```

(A **migration** is a saved SQL script that changes the database's table
shapes, so every copy of the database ends up matching `db/schema.ts`.)

What each table stores, one line each:

| Table                | What's in it                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `players`            | One row per person (their sticky browser id): display name, all-time mashes, wins, best score. |
| `matches`            | One row per finished match: timestamps, the aggregate approval totals, who was champion. |
| `match_participants` | Per match, per player: how many mashes they landed. Effort only.             |
| `round_results`      | Per event, per match: force totals and headcounts **per side** — aggregates, never people. |
| `grievances`         | The aired grievances as bare text, tied to a match.                          |
| `level_config`       | One row per event: the tuning numbers (`params_json`) the actor loads at room start. |

> **Deliberate hole in the schema — do not fill it.** The `grievances` table
> has **no author column**, and nothing anywhere in the database stores who
> picked help or hinder. This is the anonymity promise made structural: you
> cannot leak what the schema cannot store. If a future migration adds an
> author or side column, that migration is a bug. See
> [The anonymity promise](#the-anonymity-promise-and-how-to-check-it).

If you later edit `db/schema.ts`, run `pnpm db:generate` to write a new
migration file, then `pnpm db:migrate` to apply it.

---

## Deploy

Three parts, matching the three layers of the diagram.

### (a) Neon — already done

If you did the database section above, production uses the same project.
(Optionally make a separate Neon branch or project for prod; either way, you
just need a connection string.)

### (b) Vercel — the Next.js app

1. Import this repo at [vercel.com/new](https://vercel.com/new). The defaults
   detect Next.js; no build settings to change.
2. Set these Environment Variables in the Vercel project:

   | Variable                       | Value                                                              |
   | ------------------------------ | ------------------------------------------------------------------ |
   | `DATABASE_URL`                 | your Neon connection string                                        |
   | `INTERNAL_API_SECRET`          | a random secret — generate with `openssl rand -hex 24`             |
   | `APP_BASE_URL`                 | your Vercel URL, e.g. `https://feats.example.com`                  |
   | `NEXT_PUBLIC_RIVET_ENDPOINT`   | where browsers reach your Rivet actor (from part c)                |
   | `NEXT_PUBLIC_RIVET_TOKEN`      | *(optional)* publishable client token, if your Rivet namespace needs one |
   | `NEXT_PUBLIC_JUSTIN_PHOTO_URL` | *(optional)* URL of the boss's face photo                          |
   | `NEXT_PUBLIC_BOSS_NAME`        | *(optional)* what everyone calls the protagonist (default: Justin) |

### (c) Rivet Cloud — the live room

Two ways to host the actor. **Serverless is the simplest** — no extra
infrastructure at all.

#### Serverless (recommended): the actor runs inside your Vercel app

The app exposes a RivetKit **serverless runner** at `/api/rivet`
(`app/api/rivet/[[...slug]]/route.ts`). In this mode the Rivet Engine calls
INTO your Vercel deployment to execute the room actor; browsers still
connect to Rivet's gateway with the publishable token, and Rivet holds the
WebSockets (which Vercel functions can't).

1. In the [Rivet Cloud](https://rivet.dev) dashboard, create a project +
   namespace.
2. Copy the two connection URLs the dashboard gives you and set on Vercel:
   - `RIVET_ENDPOINT` = the **secret** (`sk_…`) URL — server-side env,
     never `NEXT_PUBLIC_`.
   - `NEXT_PUBLIC_RIVET_ENDPOINT` = the **publishable** (`pk_…`) URL —
     this ships to browsers by design. Don't also set
     `NEXT_PUBLIC_RIVET_TOKEN`; the token is already inside the URL.
3. In the dashboard, create a **serverless runner config** for the
   namespace: name it exactly **`default`** (that's the pool name rivetkit
   clients request), URL `https://<your-app>.vercel.app/api/rivet`,
   request lifespan ≤ 300 s (the route's `maxDuration`). Rivet Cloud's
   connection-URL tokens are data-plane only, so the app cannot create
   this entry for you — the dashboard is the only writer.
4. Redeploy, then open the game. If it doesn't connect, curl
   `https://<your-app>.vercel.app/api/rivet/provision-status` — it probes
   every Rivet API call this deployment's tokens may make and names
   exactly what's missing (`no 'default' runner config…` means step 3).

On deployments whose tokens DO have management permissions (self-hosted
engine, broader tokens), the route **registers the runner config itself**
on first contact (`server/rivet/provision.ts`) and step 3 becomes
unnecessary. Only the **production** deployment self-registers (a poked
preview deploy must not repoint the live pool); set `RIVET_RUNNER_URL`
to your `/api/rivet` URL on non-Vercel hosts or custom domains.

Note: one function invocation hosts the room for up to `maxDuration`
(300 s in the route file — the Vercel Hobby ceiling; raise it to 800 on
Pro so a whole match never spans a handoff).

#### Serverful (fallback): run the actor as its own process

The `server/rivet` process runs on **any always-on Node host** — a machine
that keeps one process alive around the clock. Vercel functions can't do
this (see "How it's put together"), but Railway, Fly.io, or a $5 VPS can.

1. Create a project + namespace in the Rivet dashboard.
2. Give the actor its environment: `APP_BASE_URL` (your Vercel URL) and
   `INTERNAL_API_SECRET` (the **same** value as on Vercel — this is how the
   actor proves it's allowed to POST match results), plus the
   `RIVET_ENDPOINT` / `RIVET_TOKEN` / `RIVET_NAMESPACE` values from your
   Rivet dashboard.
3. Deploy the actor and point `NEXT_PUBLIC_RIVET_ENDPOINT` (on Vercel) at the
   endpoint Rivet gives you, then redeploy the Vercel app so browsers pick it
   up.

> Rivet's CLI and deploy flow are actively evolving, so follow
> [rivet.gg/docs](https://rivet.gg/docs) for the current deploy command rather
> than trusting a README snapshot.

Run the same thing `pnpm dev:rivet` runs (`tsx server/rivet/index.ts`, or
compile it first) with the env vars above. Because RivetKit embeds its own
engine you can even skip Rivet Cloud entirely: expose the port and point
`NEXT_PUBLIC_RIVET_ENDPOINT` straight at your host.

---

## The 5-minute match, phase by phase

Everything auto-advances; the host (the first boss screen) can skip any phase.

1. **Lobby** — people trickle in, pick names. Grievance submissions are
   already open. Host presses start.
2. **Airing of Grievances** (45 s) — everyone types up to 3 grievances,
   140 characters each, **blind**: nobody sees them yet, and no author is
   attached, ever. The window closes early once every player has aired at
   least one.
3. **Shuffled reveal** (15 s) — the grievances hit the big screen in a
   Fisher–Yates-shuffled order, so submission order can't identify anyone.
   The host can hide any that go too far.
4. **Five events**, each one: countdown (4 s, secretly pick your side) →
   **~20–25 s of mashing** → outcome banner (5 s) → next event. Pace your
   taps: the client shows an overheat meter, and the server ignores anything
   past ~12 taps/sec anyway. Once per event a **Festivus Miracle** gives the
   trailing side a small comeback nudge.

   | # | Event             | Sides (help / hinder)   | The gimmick |
   | - | ----------------- | ----------------------- | ----------- |
   | 1 | **Pole Raise**    | Support / Grease        | Warmup. Net force raises the aluminum pole before time runs out. |
   | 2 | **Swim Sprint**   | Jet Boost / Face Blast  | Water guns. If the hinder side overwhelms hard enough, Justin flails and *sinks* for a couple of seconds. |
   | 3 | **Greased Climb** | Support / Grease        | Every few seconds a grease check fires; if hinderers own enough of the recent taps, Justin slips back down. |
   | 4 | **Tug-of-War**    | Team A / Team B         | The one **team** event: the server shuffles everyone onto two public teams (no secret picks). With an odd headcount, the smaller team gets a force multiplier so it's still fair. Justin is the ribbon on the rope. |
   | 5 | **Pin the Boss**  | Prop Up / Pile On       | **Double points.** A spring-loaded pin bar: pile-on pushes it past the pin line and must *hold* it there through a 3-count; prop-up can smash the count back to zero. Wrestling rules. |

5. **Jack-in-the-box finale** (9 s) — the crank turns, Justin pops.
6. **Splash verdict** — the weighted headcounts from the four
   help/hinder events (tug teams say nothing about feelings) decide whether
   Justin is **BELOVED**, **GREASED**, or the office is **DIVIDED**. The top
   masher is crowned champion and their win persists to Neon. The **Head of
   Household** on the poster is the *all-time wins leader* — win enough
   matches and the person everyone gangs up on becomes you.

---

## Add your own event in 4 steps

An event is one server file + one renderer file. The contract is deliberately
small — this is the whole interface, from
[`lib/game/engine/types.ts`](lib/game/engine/types.ts):

```ts
export interface EventModule<S = unknown> {
  id: string;                       // keys the scene + the level_config row
  name: string;                     // countdown banner
  sideLabels: [string, string];     // [help label, hinder label]
  weight: number;                   // finale = 2, everything else = 1
  teamBased: boolean;               // true only for tug-of-war-style events
  durationSec: number;              // default window; level_config overrides

  init(ctx: EventInitCtx): S;                                       // fresh round state
  onInput(state: S, side: SideIndex, input: EventInput,
          ctx: EventTickCtx): void;                                 // one tap landed
  tick(state: S, dtMs: number, ctx: EventTickCtx): void;            // every ~40 ms
  isComplete(state: S, ctx: EventTickCtx): boolean;                 // early finish?
  resolve(state: S, ctx: EventTickCtx): EventResult;                // final aggregates
  view(state: S): EventView;                                        // numbers for Pixi
}
```

Note what's *not* in there: no player ids, names, or connections. Your module
only ever sees a side index (0 or 1). It **cannot** leak who picked what,
because it never knows.

**Step 1 — the server half.** Copy
[`lib/game/events/poleRaise.ts`](lib/game/events/poleRaise.ts) (the simplest
one) into a new file and implement the contract. Minimal skeleton:

```ts
// lib/game/events/snowShovel.ts
import type { EventModule, SideIndex } from "../engine/types";
import { clamp01, progressStep } from "../engine/math";

interface SnowShovelState {
  progress: number;            // 0 = buried, 1 = driveway clear
  pending: [number, number];   // taps since last tick, per side
  force: [number, number];     // cumulative counted taps, per side
}

export const snowShovel: EventModule<SnowShovelState> = {
  id: "snowShovel",
  name: "Snow Shovel",
  sideLabels: ["Shovel", "Snow Machine"],
  weight: 1,
  teamBased: false,
  durationSec: 20,

  init: () => ({ progress: 0, pending: [0, 0], force: [0, 0] }),

  onInput(state, side: SideIndex) {
    state.pending[side]++;
    state.force[side]++;
  },

  tick(state, dtMs, ctx) {
    // progressStep: net taps → progress, scaled by crowd size + tuning.
    state.progress = clamp01(state.progress + progressStep(state.pending, dtMs, ctx));
    state.pending = [0, 0];
  },

  isComplete: (state) => state.progress >= 1,

  resolve: (state, ctx) => ({
    winner: state.progress >= 1 ? "support" : "hinder",
    supportForce: state.force[0],
    hinderForce: state.force[1],
    supportHead: ctx.sideCounts[0],
    hinderHead: ctx.sideCounts[1],
  }),

  view: (state) => ({ progress: state.progress }),
};
```

**Step 2 — register it.** In
[`lib/game/engine/registry.ts`](lib/game/engine/registry.ts), import your
module and add it to the `EVENTS` array. The session runner walks that list in
order — position in the array is position in the match.

**Step 3 — the renderer half.** Add a PixiJS scene in `render/scenes/`
(copy `render/scenes/poleRaise.ts`) that draws from your module's `view()`
output, and register it in
[`render/scenes/index.ts`](render/scenes/index.ts) under the **same id**.

**Step 4 (optional) — tuning row.** Add your defaults to
`DEFAULT_EVENT_PARAMS` in [`lib/game/config.ts`](lib/game/config.ts) and run
`pnpm db:seed` so a `level_config` row exists to tune later. Skippable: an
event with no entry anywhere falls back to its module's own `durationSec`
plus generic force numbers (see `eventCtx` in `server/rivet/room.ts`) — but
add the entry if your event reads custom params like `slipAmount`, because
the generic fallback only carries the common three.

Run `pnpm sim` afterwards. It plays the whole match, including your event, and
sweeps every snapshot for anonymity leaks — the fastest way to find out your
new event broke a promise.

---

## Tuning without redeploying

Every event's feel — duration, tap power, drift, slip rate, sink threshold —
lives as numbers in the `level_config` table. The actor fetches
`GET /api/config` when it wakes **and again every time the host presses
Start**, overriding the compiled-in defaults from `lib/game/config.ts` with
whatever's in the table. (Values are validated on the way in: non-numbers and
zero/negative durations are ignored rather than trusted.) So:

- Game too easy at the office party? Edit the row in the Neon console.
  The **next match** picks it up. No deploy.
- Made a mess? `pnpm db:seed` overwrites every row back to the defaults.
- Database unreachable? The actor logs a warning and uses the compiled
  defaults — the game never blocks on Neon.

---

## The anonymity promise (and how to check it)

"Your side stays secret" is the game's one hard rule. It holds because each
layer is *incapable* of telling on you:

- **Ephemeral tokens.** When you pick a side, the actor mints a random token
  and keeps `token → side` and `player → token` in two in-memory maps
  (`vars`), which are **cleared every round and never written anywhere**. If
  the process sleeps, sides evaporate.
- **Aggregates only.** Event modules receive a side index, never a player.
  Snapshots broadcast per-side totals and headcounts; the roster shows name,
  mash count, and (during tug-of-war only) your public team — never a side.
- **No columns to leak into.** The database schema has no side column and no
  grievance author column. See `db/schema.ts`.
- **Shuffled reveal.** Grievances are stored as bare text and revealed in a
  freshly shuffled order, so timing can't unmask an author.
- **The boss is a spectator.** Boss connections' taps and side-picks are
  refused server-side, so the big screen can't probe the room.
- **Server-side rate cap.** ~12 counted taps/sec per *person* (keyed by
  sticky id, so extra tabs don't multiply it), enforced by the actor — a
  modified client gains nothing.
- **No motion tells.** During the active window, the public per-player mash
  counters are frozen at their round-start values (they catch up at the
  outcome). Otherwise a snapshot recorder could pair "X's counter ticked up"
  with "the hinder force moved" in the same 40 ms window and unmask X.

One honest caveat, because aggregates are still aggregates: in a **tiny or
unanimous** room, headcounts alone can be revealing — if all 3 of you helped,
everyone knows how all 3 of you voted. That's arithmetic, not a leak; with an
office-sized crowd it disappears.

Don't take the README's word for it:

```bash
pnpm sim
```

That boots the real actor, plays a full match with 1 boss + 5 players + one
cheater, and **asserts all of the above end-to-end** — including a sweep of
every single snapshot for any `side`, `stickyId`, or token-shaped field.
If anyone (including you) accidentally breaks the promise, `pnpm sim` fails.

---

## Testing

```bash
pnpm typecheck   # TypeScript strict — no build, just checks the types
pnpm sim         # headless full match against the REAL actor (~40 s):
                 # phases advance, boss inputs refused, rate cap holds,
                 # tug teams assigned, anonymity sweep, approval math,
                 # champion = top masher. Exits 0 pass / 1 fail. No DB needed.
pnpm build       # production Next.js build — catches anything dev mode forgives
```

Run all three before merging. `pnpm sim` is the one that guards the promises.

---

## Troubleshooting

- **`pnpm dev:rivet` says port 6420 is busy.** Another copy of the actor is
  still running (often a leftover `pnpm dev:all` or a `pnpm sim` that didn't
  exit). Find and stop it: `lsof -i :6420` then `kill <pid>`.
- **Phones can't load the page or join the room.** Your laptop's firewall is
  probably blocking inbound connections — allow ports **3000** (pages) and
  **6420** (the actor). Also confirm `NEXT_PUBLIC_RIVET_ENDPOINT` uses your
  LAN IP, not `127.0.0.1`, and that you restarted `pnpm dev` after changing
  it. Phone and laptop must be on the same network (guest wifi often isolates
  devices from each other).
- **"localStorage unavailable" warnings.** Only happens in sandboxed preview
  iframes (some code-hosting previews block storage). The game falls back to
  a per-tab identity and keeps working; on a real deployment or plain
  localhost this never appears.
- **Leaderboard is blank / nothing persists.** Either no `DATABASE_URL`
  (that's the supported demo mode — matches still play), **or** the DB is
  set but `INTERNAL_API_SECRET` isn't: `/api/results` refuses writes without
  it and the actor logs `match NOT persisted`. Set both, run
  `pnpm db:migrate && pnpm db:seed`, restart both processes.
- **Port 6420 acts haunted — connects hang, phases frozen.** A previous
  `rivet-engine` child process outlived its parent. `pkill -f rivet-engine`,
  delete the `.rivetkit/` folder, and start `pnpm dev:rivet` again.
- **Set `NEXT_PUBLIC_JUSTIN_PHOTO_URL` but Justin's face didn't change.**
  The URL must allow cross-origin image loading (CORS) — the PixiJS canvas
  loads it as a texture, and browsers block canvas access to images from
  hosts that don't send permissive CORS headers. Host the photo on the same
  domain as the app (drop it in `public/` and use a relative URL like
  `/assets/justin.jpg`) or on a permissive CDN. There's a placeholder at
  `public/assets/justin-placeholder.svg` to test the wiring.

---

## Repo map

```
app/                      Next.js pages + API routes (this part runs on Vercel)
  page.tsx                landing page — join as player or boss, no room codes
  play/page.tsx           the phone controller (side picker + MASH button)
  boss/page.tsx           the big-screen broadcast (stage, host controls, feed)
  api/config/route.ts     GET  level_config tuning  → read by the actor at room start
  api/leaderboard/route.ts GET all-time leaderboard → actor + UI
  api/results/route.ts    POST match results ← the actor (guarded by INTERNAL_API_SECRET)
  globals.css             Tailwind v4 theme: aluminum, memo paper, stamps
proxy.ts                  Next 16 request proxy: security headers + the v2 multi-room hook
components/               React UI pieces (MashButton, SidePicker, GrievanceFeed, …)
db/
  schema.ts               the Postgres tables (Drizzle) — note what's deliberately absent
  seed.ts                 writes default tuning into level_config (pnpm db:seed)
  migrations/             generated SQL migrations (pnpm db:generate / db:migrate)
lib/
  game/config.ts          every tunable number in one place, with the why
  game/engine/types.ts    the EventModule contract — start reading here
  game/engine/registry.ts the ordered list of events in a match
  game/engine/session.ts  the phase state machine (lobby → … → splash)
  game/engine/math.ts     shared helpers: progress steps, miracles, shuffles
  game/events/            the five feats of strength — one small file each
  game/filter.ts          name + grievance text cleanup
  game/persist.ts         the shape of the one durable write per match
  realtime/protocol.ts    every message shape shared between browser and actor
  realtime/useRoom.ts     the React hook that speaks WebSocket to the room
  identity.ts             sticky localStorage id (name + score only, never a side)
  sound.ts                bleeps (WebAudio, respects mute)
render/
  core.tsx                GameCanvas: Pixi boot, scene swapping, 25 Hz → 60 fps interpolation
  scenes/                 one PixiJS scene per event, + backdrop + jack-in-the-box
  toolkit.ts              shared drawing helpers (Justin's head, poles, water)
server/rivet/
  index.ts                actor process entry point (pnpm dev:rivet)
  registry.ts             RivetKit setup — which actors this server hosts
  room.ts                 THE game server: roster, tick loop, anonymity tokens, rate cap
scripts/
  simulate.ts             pnpm sim — the headless full-match promise-checker
public/assets/            static files (justin-placeholder.svg lives here)
```

Happy Festivus. Air your grievances responsibly.
