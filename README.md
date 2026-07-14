# Justin's Feats of Strength

**INTEROFFICE MEMORANDUM — RE: MANDATORY FUN**

This is a Jackbox-style all-hands party game. One laptop plugs into the big
screen and becomes **the Boss broadcast**; everyone else opens the same URL on
their phone and their phone becomes **a controller**. The theme is Festivus:
the match opens with an anonymous Airing of Grievances, then five Feats of
Strength in which a cinematic Justin swims, climbs, and gets pinned — powered
(or sabotaged) by the room. During every solo feat, **each press is a direct
choice**: help Justin or hinder him. A player can alternate freely and play
both sides in the same round. No public snapshot, event module, or database
row can link an action side to a player. That promise is enforced by
architecture, not politeness, and `pnpm sim` proves it.

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
 │  VERCEL             │    │  ROOM SERVER*            │
 │  the Next.js app    │◀───│  server/game/server.ts + │
 │  + API routes:      │    │  server/game/core.ts     │
 │   GET /api/config   │    │  ONE live room, ticking  │
 │   GET /api/leaderb. │    │  25 times/sec. The single│
 │   POST /api/results │    │  source of match truth.  │
 └──────────┬──────────┘    └──────────────────────────┘
            │                 │
            │ Drizzle         │  The room calls the API:
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

\* The **room server** is one long-lived Node process that owns the room's live
state in memory and personally handles every message for it — so there is
exactly one copy of the truth and no two servers can disagree. All game logic
lives in `server/game/core.ts` (`RoomCore`, transport-agnostic);
`server/game/server.ts` is just the Socket.IO + tick adapter around it.

**Why the game loop can't run on Vercel:** Vercel serverless functions are
request/response — one wakes up to answer a request, answers it, and dies. It
keeps no memory between requests and can't run a 25-ticks-per-second loop for
five minutes. A live game room needs one long-lived process that holds the
roster, counts the mashes, and steps the simulation continuously. That process
is the room server. Vercel serves the pages and the database API; the room
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

# terminal 2 — the room server (the live game room, on port 1999)
pnpm dev:server
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
2. In `.env.local`, set the room server URL to that IP so phones can reach it
   (the default `127.0.0.1` means "this device," which on a phone is the phone):

   ```
   NEXT_PUBLIC_GAME_SERVER_URL=http://192.168.1.42:1999
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
   `openssl rand -hex 24`). Match **results** are written by the room
   calling `POST /api/results`, and that route *fails closed* without the
   secret — a database with no secret means the leaderboard never fills.
   `pnpm dev` reads `.env.local`; the room server (`pnpm dev:server`) reads
   the same `.env.local` too.
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
| `round_results`      | Per event, per match: force totals per side and public tug-team headcounts — never player-side links. |
| `grievances`         | The aired grievances as bare text, tied to a match.                          |
| `level_config`       | One row per event: the tuning numbers (`params_json`) the room loads at room start. |

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
   | `NEXT_PUBLIC_GAME_SERVER_URL`  | your room server URL (from part c), e.g. `https://festivus-room.up.railway.app` |
   | `NEXT_PUBLIC_JUSTIN_PHOTO_URL` | *(optional)* URL overriding the bundled Justin character portrait  |
   | `NEXT_PUBLIC_BOSS_NAME`        | *(optional)* what everyone calls the protagonist (default: Justin) |

### (c) The room server — the live room

The realtime room is a small **Socket.IO server** (`server/game/server.ts`, a
thin adapter over `server/game/core.ts`) that holds the room state and runs a
~25 Hz tick — the one thing Vercel functions can't host. It runs on **any
always-on Node host**: [Railway](https://railway.app), Render, Fly, a $5 VPS.
No domain, no special platform features (just WebSockets on `$PORT`).

Using **Railway** (simplest):

1. At [railway.app](https://railway.app), sign in with GitHub → **New Project**
   → **Deploy from GitHub repo** → pick this repo. Railway reads `railway.json`
   and runs `pnpm start:server` (the room server, not Next.js).
2. When it's live, open the service → **Settings → Networking → Generate Domain**.
   Copy the URL, e.g. `https://festivus-room.up.railway.app`.
3. **Point the app at it:** set `NEXT_PUBLIC_GAME_SERVER_URL` on Vercel to that
   full URL (with `https://`) and redeploy the Vercel app.

That's it — the room is live. No CLI required; a `railway up` from the repo
works too if you prefer the terminal.

**Optional (durable leaderboard).** The room plays fine with no extra env, but
to persist match results and load `level_config` tuning it needs to reach your
Next.js API. Set two variables **on the Railway service**:
```
APP_BASE_URL         = your Vercel URL, e.g. https://feats.example.com
INTERNAL_API_SECRET  = the SAME value you set on Vercel
```
Without them, persistence simply no-ops (the game is unaffected). You can also
set `APP_ORIGIN` to your Vercel URL to restrict CORS (defaults to `*`).

> Socket.IO auto-reconnects the client, so a dropped connection heals itself.
> One server hosts the single shared room; when the last person leaves it resets
> to a fresh lobby for the next crowd.

---

## The 5-minute match, phase by phase

Everything auto-advances; the host (the first boss screen) can skip any phase.

1. **Lobby** — people trickle in, pick names. Grievance submissions are
   already open. Host presses start.
2. **Airing of Grievances** (45 s) — every player gets their own quota of up
   to **3 grievances** (not 3 for the room), 140 characters each, **blind**:
   nobody sees them yet, and no author is attached, ever. The window closes
   early only after every connected player has used their full quota.
3. **Shuffled reveal** (15 s) — the grievances hit the big screen in a
   Fisher–Yates-shuffled order, so submission order can't identify anyone.
   The host can hide any that go too far.
4. **Five events**, each one: countdown (4 s, both action buttons arm) →
   **~20–25 s of direct help/hinder strikes** → outcome banner (5 s) → next
   event. Switch sides on any strike or contribute to both. The two buttons
   share one overheat meter, and the server ignores anything past ~12 counted
   taps/sec per person across both. Once per event a **Festivus Miracle** gives
   the trailing side a small comeback nudge.

   | # | Event             | Sides (help / hinder)   | The gimmick |
   | - | ----------------- | ----------------------- | ----------- |
   | 1 | **Pole Raise**    | Support / Grease        | Warmup. Net force raises the aluminum pole before time runs out. |
   | 2 | **Swim Sprint**   | Jet Boost / Face Blast  | Water guns. If the hinder side overwhelms hard enough, Justin flails and *sinks* for a couple of seconds. |
   | 3 | **Greased Climb** | Support / Grease        | Every few seconds a grease check fires; if hinderers own enough of the recent taps, Justin slips back down. |
   | 4 | **Tug-of-War**    | Team A / Team B         | The one **team** event: the server shuffles everyone onto two public teams (no secret picks). With an odd headcount, the smaller team gets a force multiplier so it's still fair. Justin is the ribbon on the rope. |
   | 5 | **Pin the Boss**  | Prop Up / Pile On       | **Double points.** A spring-loaded pin bar: pile-on pushes it past the pin line and must *hold* it there through a 3-count; prop-up can smash the count back to zero. Wrestling rules. |

5. **Jack-in-the-box finale** (9 s) — the crank turns, Justin pops.
6. **Splash verdict** — the weighted aggregate action totals from the four
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
only ever sees a side index (0 or 1). It **cannot** leak who pressed which
action because it never knows.

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
plus generic force numbers (see `eventCtx` in `server/game/core.ts`) — but
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

"Your actions are never linked to you" is the game's one hard rule. It holds
because each layer is *incapable* of telling on you:

- **Identity is stripped before event logic.** Each solo tap carries side 0
  or 1. The room validates it, applies the shared per-player rate cap,
  increments only aggregate counters, then passes just that side index to the
  event. There is no player-to-side map to inspect, persist, or leak.
- **Aggregates only.** Event modules receive a side index, never a player.
  Snapshots broadcast per-side action totals; the roster shows name, mash
  count, and (during tug-of-war only) a public team — never action allegiance.
- **No columns to leak into.** The database schema has no side column and no
  grievance author column. See `db/schema.ts`.
- **Shuffled reveal.** Grievances are stored as bare text and revealed in a
  freshly shuffled order, so timing can't unmask an author.
- **The boss is a spectator.** Boss connections' taps are refused server-side,
  so the big screen cannot probe the room.
- **Server-side rate cap.** ~12 counted taps/sec per *person* (keyed by
  sticky id, so extra tabs don't multiply it), enforced by the room — a
  modified client gains nothing.
- **No motion tells.** During the active window, the public per-player mash
  counters are frozen at their round-start values (they catch up at the
  outcome). Otherwise a snapshot recorder could pair "X's counter ticked up"
  with "the hinder force moved" in the same 40 ms window and infer a press.

One honest caveat, because aggregates are still aggregates: in a tiny room,
someone watching another person press a visibly labeled button can know what
they just did. The network, snapshots, event modules, and database still do
not create or retain that identity link.

Don't take the README's word for it:

```bash
pnpm sim
```

That drives the real room logic (`server/game/core.ts`), plays a full match
with 1 boss + 5 players + one cheater, and **asserts all of the above
end-to-end** — including a sweep of
every single snapshot for any `side`, `stickyId`, or token-shaped field.
If anyone (including you) accidentally breaks the promise, `pnpm sim` fails.

---

## Testing

```bash
pnpm typecheck   # TypeScript strict — no build, just checks the types
pnpm sim         # headless full match against the REAL room logic (~40 s):
                 # phases advance, boss inputs refused, rate cap holds,
                 # tug teams assigned, anonymity sweep, approval math,
                 # champion = top masher. Exits 0 pass / 1 fail. No DB needed.
pnpm build       # production Next.js build — catches anything dev mode forgives
```

Run all three before merging. `pnpm sim` is the one that guards the promises.

---

## Troubleshooting

- **`pnpm dev:server` says port 1999 is busy.** Another copy of the room is
  still running (often a leftover `pnpm dev:all`). Find and stop it:
  `lsof -i :1999` then `kill <pid>`.
- **Phones can't load the page or join the room.** Your laptop's firewall is
  probably blocking inbound connections — allow ports **3000** (pages) and
  **1999** (the room). Also confirm `NEXT_PUBLIC_GAME_SERVER_URL` uses your
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
  it and the room logs `match NOT persisted`. Set both, run
  `pnpm db:migrate && pnpm db:seed`, restart both processes.
- **Room server on Railway won't start / builds the wrong thing.** Confirm the
  service start command is `pnpm start:server` (Railway reads this from
  `railway.json`), not `next start` — the room server is separate from the
  Vercel app. Its logs should print `Festivus room server listening on :<port>`.
- **Set `NEXT_PUBLIC_JUSTIN_PHOTO_URL` but Justin's face didn't change.**
  The URL must allow cross-origin image loading (CORS) — the PixiJS canvas
  loads it as a texture, and browsers block canvas access to images from
  hosts that don't send permissive CORS headers. Host the photo on the same
  domain as the app (drop it in `public/` and use a relative URL like
  `/assets/justin.jpg`) or on a permissive CDN. When unset, the game uses the
  bundled art-directed Justin portrait in `public/assets/justin-avatar-v3.png`.

---

## Repo map

```
app/                      Next.js pages + API routes (this part runs on Vercel)
  page.tsx                landing page — join as player or boss, no room codes
  play/page.tsx           the phone controller (direct HELP/HINDER controls)
  boss/page.tsx           the big-screen broadcast (stage, host controls, feed)
  api/config/route.ts     GET  level_config tuning  → read by the room at start
  api/leaderboard/route.ts GET all-time leaderboard → room + UI
  api/results/route.ts    POST match results ← the room (guarded by INTERNAL_API_SECRET)
  globals.css             Tailwind v4 theme: aluminum, memo paper, stamps
proxy.ts                  Next 16 request proxy: security headers + the v2 multi-room hook
components/               React UI pieces (DualActionPad, MashButton, GrievanceFeed, …)
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
  realtime/protocol.ts    every message shape shared between browser and room
  realtime/useRoom.ts     the React hook that speaks WebSocket to the room
  identity.ts             sticky localStorage id (name + score only, never a side)
  sound.ts                bleeps (WebAudio, respects mute)
render/
  core.tsx                GameCanvas: Pixi boot, scene swapping, 25 Hz → 60 fps interpolation
  scenes/                 one PixiJS scene per event, + backdrop + jack-in-the-box
  toolkit.ts              shared drawing helpers (Justin's head, poles, water)
server/game/
  core.ts                 THE game logic: roster, tick, anonymity tokens, rate cap (transport-agnostic)
  server.ts               Socket.IO room server — WebSocket + 25 Hz tick adapter over core.ts (pnpm start:server)
railway.json              Railway deploy config (runs the room server, not Next.js)
scripts/
  simulate.ts             pnpm sim — headless full-match promise-checker (drives core.ts directly)
public/assets/            static files (justin-placeholder.svg lives here)
```

Happy Festivus. Air your grievances responsibly.
