# Justin's Developer Academy

## Product decision

The existing Festivus multiplayer game remains intact and becomes the academy's
cinematic entrance exam. Unreal Engine supplies the immersive building, lighting,
room portals, transitions, and future character interaction. Next.js remains the
lesson renderer and content delivery system. The standalone Node/Socket.IO service
remains authoritative for live multiplayer.

This separation is deliberate:

- The teaser already works on televisions, laptops, and phones with no install.
- Curriculum can ship continuously from Vercel without rebuilding an Unreal binary.
- A lesson works in a normal browser and inside Unreal's `WebBrowserWidget`.
- Unreal can later add characters, spatial navigation, cinematics, and voice without
  becoming the source of truth for SaaS content or multiplayer scoring.
- SwiftUI, Android, and Expo are curriculum rooms. Native app packaging is deferred.

## Runtime shape

```text
Unreal Academy shell
  procedural academy atrium
  teaser + technology portals
  UAcademyGameInstanceSubsystem
       │
       │ HTTPS catalog + embedded pages
       ▼
Next.js /academy
  GET /api/academy/rooms
  GET /api/academy/rooms/:slug
  room pages + mission workbench
       │
       │ Socket.IO cohort progress intents
       ▼
Standalone Node room server
  room-scoped authoritative state
  aggregate cohort progress
  validates then discards learner code
```

## Room contract

Each technology track is an `AcademyRoom` in `lib/academy/catalog.ts`:

- a stable URL-safe slug;
- room order, visual accent, prerequisites, and learning outcomes;
- a sequenced module plan;
- zero or more playable missions;
- `playable` or `preview` status.

Each mission contains starter code, staged hints, XP, a production-shaped AI brief,
mandatory human review questions, and deterministic source checks. The teaching loop is
**specify → generate → review → validate**: juniors learn to use an LLM as an accelerator
without outsourcing engineering responsibility. The AI mentor improves the prompt and
review plan but never declares code correct or claims tests passed.

The browser never evaluates the learner's code. This first slice validates structure
with regular expressions. A later sandbox service can run real framework tests behind
the same mission contract, with resource limits and no production credentials.

## AI mentor modes

`POST /api/academy/mentor` has two modes:

- **Local coach (default):** no API key, no transmission. It checks whether the brief
  includes a role, constraints, verification, and non-goals, then returns the authored
  review checklist.
- **Live AI mentor (opt-in):** enabled only when `ACADEMY_AI_ENABLED=true` and a
  server-side `OPENAI_API_KEY` exists. It uses the Responses API with a strict JSON
  schema. The key never reaches the browser. Inputs are size-limited, requests are
  rate-limited, responses are not cached, and failures fall back to the local coach.

Live mode sends the learner's current brief and candidate code to the configured OpenAI
model only after the learner presses the clearly labeled review button. Do not enable it
for proprietary source until company data-handling policy and authentication are in place.

## Initial curriculum

Room 01 is playable and teaches:

1. React state and accessible live updates.
2. Next.js Server/Client Component boundaries.
3. Route handlers, untrusted JSON, and HTTP status semantics.
4. Node.js per-client sliding-window rate limiting.
5. Server-authoritative Socket.IO actions.
6. Multi-tenant room isolation and cleanup.

Rooms 02–04 publish full syllabi for SwiftUI, Android/Kotlin, and Expo. They are
sequenced after the web foundation and intentionally do not pretend to be finished.

## Live cohorts

Coding cohorts run beside, but separately from, the current Festivus `RoomCore`.
Academy sockets opt into the `academy` surface during the Socket.IO handshake, while
Festivus broadcasts remain scoped to their original channel. A cohort room holds only:

- room code and selected curriculum track;
- connected learner display names;
- aggregate mission completion and team XP;
- instructor-controlled pacing and hints.

Candidate source crosses the live socket only when the learner chooses to publish a
passing result. `AcademyCohortManager` applies the same deterministic checks on the
server, immediately discards the source parameter, and broadcasts only aggregate
completion and XP. Run `pnpm academy:sim` to prove the transient marker is not retained.
An academy-only random reconnect key stays in local storage and is never broadcast; it
preserves a learner's in-memory completion through a 20-second network grace window.

The existing Festivus anonymity guarantee remains unchanged: no help/hinder affiliation
and no grievance author may be added to snapshots or persistence.

## Content authoring

1. Add or edit a room in `lib/academy/catalog.ts`.
2. Give every mission a specific mentor role, bounded prompt, and human review questions.
3. Keep checks deterministic and never use `eval`, `Function`, or browser code execution.
4. Run `pnpm academy:validate && pnpm academy:sim`.
5. Run `pnpm typecheck && pnpm build && pnpm sim` before merging.
6. Unreal discovers the updated catalog at startup; no Unreal rebuild is required.
