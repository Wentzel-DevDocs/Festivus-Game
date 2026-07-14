import type {
  AcademyCatalog,
  AcademyRoom,
  AcademyRoomSummary,
} from "./types";

const nextRoom: AcademyRoom = {
  slug: "nextjs-react-node",
  order: 1,
  title: "Full-Stack Raid",
  shortTitle: "Next.js · React · Node",
  subtitle:
    "Repair a live SaaS release while learning component state, server boundaries, APIs, authoritative realtime logic, and tenant-safe rooms.",
  status: "playable",
  accent: "#43c77a",
  estimatedMinutes: 95,
  prerequisites: ["Basic JavaScript syntax", "A browser and curiosity"],
  learningOutcomes: [
    "Build accessible interactive React components",
    "Choose deliberate Next.js client and server boundaries",
    "Validate input in a Next.js route handler",
    "Design server-authoritative Node.js realtime actions",
    "Isolate SaaS tenants with room-scoped state",
  ],
  plannedModules: [
    "React state and accessibility",
    "Next.js App Router boundaries",
    "Route handlers and validation",
    "Node.js rate limiting",
    "Socket.IO authority",
    "Multi-tenant room isolation",
  ],
  missions: [
    {
      id: "react-signal-console",
      chapter: 1,
      title: "Restore the Signal Console",
      technology: "React",
      difficulty: "starter",
      xp: 100,
      estimatedMinutes: 12,
      briefing:
        "The deployment counter is frozen. Turn the static panel into an accessible client component that increments without reloading the page.",
      objective:
        "Use React state, connect it to a button, and announce the updated count to assistive technology.",
      aiWorkflow: {
        mentorRole: "Senior React accessibility engineer",
        promptTemplate: `Act as a senior React accessibility engineer. Revise only the DeployCounter component.

Requirements:
- Keep it as a client component.
- Start the counter at zero with React state.
- Use a functional state update on click.
- Announce count changes politely to assistive technology.
- Preserve a semantic button and output.

Return the complete revised file, explain each change, and list the tests I should run. Do not claim any test passed unless I provide its output.`,
        reviewQuestions: [
          "Why does this state belong in a client component?",
          "What race does a functional state update avoid?",
          "What will a screen reader announce when the count changes?",
        ],
      },
      starterCode: `"use client";

import { useState } from "react";

export default function DeployCounter() {
  // TODO: create a count state value starting at 0

  return (
    <section>
      <h2>Deployments recovered</h2>
      <output>{/* show the count here */}</output>
      <button type="button">
        Record recovery
      </button>
    </section>
  );
}`,
      hints: [
        "useState returns the current value and a setter.",
        "An onClick callback can call the setter with the previous value.",
        "aria-live=\"polite\" makes the output announce changes without interrupting the user.",
      ],
      checks: [
        {
          id: "state",
          label: "Creates React state",
          pattern: "useState\\s*(?:<[^>]+>)?\\s*\\(\\s*0\\s*\\)",
          failureMessage: "Create state with useState(0).",
        },
        {
          id: "interaction",
          label: "Wires a button interaction",
          pattern: "onClick\\s*=\\s*\\{",
          failureMessage: "Add an onClick handler to the button.",
        },
        {
          id: "functional-update",
          label: "Uses a safe state update",
          pattern: "set[A-Za-z0-9_]+\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*=>\\s*[A-Za-z_$][\\w$]*\\s*\\+\\s*1\\s*\\)",
          failureMessage: "Use a functional state update such as setCount(current => current + 1).",
        },
        {
          id: "announcement",
          label: "Announces the changing value",
          pattern: "aria-live\\s*=\\s*[\\\"']polite[\\\"']",
          failureMessage: "Add aria-live=\"polite\" to the changing output.",
        },
      ],
    },
    {
      id: "next-boundary-breach",
      chapter: 2,
      title: "Seal the Client Boundary",
      technology: "Next.js + React",
      difficulty: "starter",
      xp: 140,
      estimatedMinutes: 14,
      briefing:
        "A Server Component is importing a browser-only hook and the build has failed. Move interactivity into a small client island while keeping the page server-rendered.",
      objective:
        "Create a client component with an explicit directive and render it from an async server page without turning the whole route into client JavaScript.",
      aiWorkflow: {
        mentorRole: "Next.js App Router architect",
        promptTemplate: `Act as a Next.js App Router architect. Refactor the supplied route into the smallest possible client island.

Constraints:
- StatusPage must remain an async Server Component that loads incidents.
- Hooks and browser interactions must move into IncidentDetails, StatusDetails, or DetailsPanel.
- Pass only serializable props across the server/client boundary.
- Do not add dependencies or convert the entire page to a client component.

Return both files, identify the boundary explicitly, and give me a review checklist. Do not claim the build passes without build output.`,
        reviewQuestions: [
          "Which component is now shipped as client JavaScript?",
          "Are every prop and nested value serializable?",
          "What capability is preserved by keeping the page on the server?",
        ],
      },
      starterCode: `// app/status/page.tsx
import { useState } from "react";

export default async function StatusPage() {
  const incidents = await loadIncidents();
  const [expanded, setExpanded] = useState(false);

  return (
    <main>
      <h1>Release status</h1>
      <button onClick={() => setExpanded(!expanded)}>Details</button>
      {expanded && <pre>{JSON.stringify(incidents, null, 2)}</pre>}
    </main>
  );
}`,
      hints: [
        "Keep StatusPage async and free of hooks.",
        "Create a second component beginning with the exact \"use client\" directive.",
        "Pass serializable incident data into the client component as props.",
      ],
      checks: [
        {
          id: "client-directive",
          label: "Declares a client island",
          pattern: "[\\\"']use client[\\\"'];?",
          failureMessage: "Add a \"use client\" directive to the interactive component.",
        },
        {
          id: "server-page",
          label: "Keeps an async server page",
          pattern: "export\\s+default\\s+async\\s+function\\s+StatusPage",
          failureMessage: "Keep StatusPage as an async Server Component.",
        },
        {
          id: "client-component",
          label: "Extracts an interactive component",
          pattern: "function\\s+(?:IncidentDetails|StatusDetails|DetailsPanel)\\s*\\(",
          failureMessage: "Extract IncidentDetails, StatusDetails, or DetailsPanel as the client component.",
        },
        {
          id: "props",
          label: "Passes server data as props",
          pattern: "<(?:IncidentDetails|StatusDetails|DetailsPanel)[^>]+incidents\\s*=\\s*\\{incidents\\}",
          failureMessage: "Render the client component and pass incidents as a prop.",
        },
      ],
    },
    {
      id: "route-handler-lockdown",
      chapter: 3,
      title: "Lock Down the Provisioning API",
      technology: "Next.js",
      difficulty: "intermediate",
      xp: 180,
      estimatedMinutes: 16,
      briefing:
        "The tenant provisioning endpoint trusts any payload. A malformed request can create nameless workspaces and return a misleading success response.",
      objective:
        "Parse JSON, validate the workspace name, return a 400 response for invalid input, and use 201 for a successful creation.",
      aiWorkflow: {
        mentorRole: "SaaS API security reviewer",
        promptTemplate: `Act as a SaaS API security reviewer. Harden this Next.js route handler while keeping its response shape small.

Acceptance criteria:
- Treat request JSON as untrusted input.
- Require name to be a non-empty string after trimming.
- Return a useful 400 response for invalid input.
- Return 201 for a successfully created workspace.
- Never echo secrets or an unvalidated payload.

Provide the revised route, enumerate failure cases, and propose focused tests. Do not invent authentication that is outside this mission.`,
        reviewQuestions: [
          "What happens when JSON is malformed or name is not a string?",
          "Why is 201 more accurate than the default 200 here?",
          "Which parts still require authentication and authorization later?",
        ],
      },
      starterCode: `// app/api/workspaces/route.ts
export async function POST(request: Request) {
  const body = await request.json();

  const workspace = {
    id: crypto.randomUUID(),
    name: body.name,
  };

  return Response.json({ workspace });
}`,
      hints: [
        "Treat parsed JSON as unknown input rather than a trusted model.",
        "Check typeof body.name and trim whitespace before accepting it.",
        "Response.json accepts a second object containing the HTTP status.",
      ],
      checks: [
        {
          id: "parse",
          label: "Parses the request body",
          pattern: "await\\s+request\\.json\\s*\\(\\s*\\)",
          failureMessage: "Await request.json().",
        },
        {
          id: "type-validation",
          label: "Validates the name type",
          pattern: "typeof\\s+(?:body\\.)?name|typeof\\s+body\\.name",
          failureMessage: "Validate that the supplied name is a string.",
        },
        {
          id: "trim-validation",
          label: "Rejects blank names",
          pattern: "\\.trim\\s*\\(\\s*\\)",
          failureMessage: "Trim the name so whitespace-only values are rejected.",
        },
        {
          id: "bad-request",
          label: "Returns HTTP 400 for invalid input",
          pattern: "status\\s*:\\s*400",
          failureMessage: "Return status 400 for invalid input.",
        },
        {
          id: "created",
          label: "Returns HTTP 201 on success",
          pattern: "status\\s*:\\s*201",
          failureMessage: "Return status 201 when the workspace is created.",
        },
      ],
    },
    {
      id: "node-rate-shield",
      chapter: 4,
      title: "Raise the Node Rate Shield",
      technology: "Node.js",
      difficulty: "intermediate",
      xp: 220,
      estimatedMinutes: 17,
      briefing:
        "One noisy client is flooding the action service. Protect the event loop with a small per-client sliding window limiter.",
      objective:
        "Store timestamps per client, discard expired entries, reject requests over the limit, and retain the new accepted timestamp.",
      aiWorkflow: {
        mentorRole: "Node.js reliability engineer",
        promptTemplate: `Act as a Node.js reliability engineer. Implement the per-client sliding-window limiter in the supplied function.

Constraints:
- Use the existing Map and function signature.
- Filter timestamps older than now - windowMs.
- Reject when the active window already contains limit entries.
- Record only accepted requests.
- Explain memory growth and how production cleanup would differ.

Return the implementation plus table-driven test cases. Do not replace the exercise with a third-party package.`,
        reviewQuestions: [
          "Is the boundary at exactly windowMs handled consistently?",
          "Can rejected requests extend the block window?",
          "How would stale client entries be cleaned in a long-running process?",
        ],
      },
      starterCode: `type WindowState = Map<string, number[]>;

export function createRateLimiter(limit: number, windowMs: number) {
  const windows: WindowState = new Map();

  return function allow(clientId: string, now = Date.now()): boolean {
    // TODO: implement a per-client sliding window
    return true;
  };
}`,
      hints: [
        "Read the existing timestamps with windows.get(clientId) ?? [].",
        "Keep timestamps greater than now - windowMs.",
        "Check the filtered length before pushing now and writing the array back.",
      ],
      checks: [
        {
          id: "client-window",
          label: "Reads state per client",
          pattern: "windows\\.get\\s*\\(\\s*clientId\\s*\\)",
          failureMessage: "Read the current window using clientId.",
        },
        {
          id: "expiry",
          label: "Filters expired timestamps",
          pattern: "\\.filter\\s*\\([^)]*=>[^;]*(?:now\\s*-\\s*windowMs|timestamp\\s*>\\s*now\\s*-\\s*windowMs)",
          failureMessage: "Filter timestamps against now - windowMs.",
        },
        {
          id: "limit",
          label: "Rejects requests at the limit",
          pattern: "\\.length\\s*>=\\s*limit",
          failureMessage: "Reject when the active window length reaches the limit.",
        },
        {
          id: "record",
          label: "Records accepted requests",
          pattern: "\\.push\\s*\\(\\s*now\\s*\\)",
          failureMessage: "Push the accepted timestamp into the active window.",
        },
        {
          id: "persist",
          label: "Stores the updated client window",
          pattern: "windows\\.set\\s*\\(\\s*clientId\\s*,",
          failureMessage: "Store the updated window under clientId.",
        },
      ],
    },
    {
      id: "authoritative-socket",
      chapter: 5,
      title: "Defend the Authoritative Socket",
      technology: "Node.js + Socket.IO",
      difficulty: "advanced",
      xp: 280,
      estimatedMinutes: 18,
      briefing:
        "A prototype trusts score values sent by the browser. Replace it with an intent-only action so the server owns validation and scoring.",
      objective:
        "Accept an action name rather than a score, validate it, call the authoritative core, and acknowledge success or failure.",
      aiWorkflow: {
        mentorRole: "Realtime multiplayer security engineer",
        promptTemplate: `Act as a realtime multiplayer security engineer. Replace the client-authoritative score event with an intent-only action event.

Security contract:
- The payload may contain an action but never trusted points or player identity.
- Validate the action against a narrow allow-list.
- Derive identity from the connected socket.
- Route accepted intent through core.action, core.dispatch, or core.handleAction.
- Acknowledge both success and validation failure.

Return the revised handler, a short threat model, and abuse tests. Never broadcast client-supplied score state.`,
        reviewQuestions: [
          "Which fields are still controlled by the client?",
          "Where are rate limiting and score calculation enforced?",
          "What does the acknowledgement reveal to a malicious client?",
        ],
      },
      starterCode: `io.on("connection", (socket) => {
  socket.on("score", ({ playerId, points }) => {
    scoreboard[playerId] += points;
    io.emit("scoreboard", scoreboard);
  });
});`,
      hints: [
        "Clients should send intent such as { action: \"deploy\" }, never points.",
        "Use a narrow allow-list before calling the game core.",
        "The socket already represents the connected client; do not trust a playerId in the payload.",
      ],
      checks: [
        {
          id: "intent-event",
          label: "Receives an intent action",
          pattern: "socket\\.on\\s*\\(\\s*[\\\"']action[\\\"']",
          failureMessage: "Replace the score event with an action event.",
        },
        {
          id: "validation",
          label: "Validates allowed intent",
          pattern: "(?:includes\\s*\\(|===\\s*[\\\"']deploy[\\\"']|switch\\s*\\()",
          failureMessage: "Validate the action against a narrow allow-list.",
        },
        {
          id: "authority",
          label: "Routes intent through the server core",
          pattern: "core\\.(?:action|dispatch|handleAction)\\s*\\(",
          failureMessage: "Route the validated intent through the authoritative core.",
        },
        {
          id: "ack",
          label: "Acknowledges the result",
          pattern: "ack\\s*\\(\\s*\\{[^}]*ok\\s*:",
          failureMessage: "Acknowledge the action with an { ok: ... } result.",
          flags: "s",
        },
        {
          id: "no-points",
          label: "Does not add client-supplied points",
          pattern: "^(?![\\s\\S]*scoreboard\\s*\\[[^\\]]+\\]\\s*\\+=)[\\s\\S]*$",
          failureMessage: "Remove direct addition of client-supplied points.",
        },
      ],
    },
    {
      id: "tenant-room-forge",
      chapter: 6,
      title: "Forge Tenant-Safe Rooms",
      technology: "SaaS Architecture",
      difficulty: "advanced",
      xp: 360,
      estimatedMinutes: 18,
      briefing:
        "The final production gate: every company currently shares one global room. Isolate live state by validated room code and retire empty rooms.",
      objective:
        "Create a Map of room cores, validate room codes, return an existing or new core, and delete rooms when the last connection leaves.",
      aiWorkflow: {
        mentorRole: "Principal multi-tenant SaaS architect",
        promptTemplate: `Act as a principal multi-tenant SaaS architect. Refactor the single global RoomCore into an in-process room registry.

Requirements:
- Use Map<string, RoomCore>.
- Normalize and strictly validate roomCode before lookup.
- Return an existing core or create exactly one new core.
- Connect each socket only to its selected room.
- Delete that room after its last client leaves.
- Preserve the existing anonymity guarantees; never add player-to-side or grievance-author data.

Return the focused adapter change, explain lifecycle races, and identify the next scaling step without implementing distributed infrastructure.`,
        reviewQuestions: [
          "Can two tenants ever receive the same RoomCore instance?",
          "What survives a process restart, and what should be checkpointed?",
          "Which data must never enter room persistence because of the anonymity promise?",
        ],
      },
      starterCode: `const core = new RoomCore(transport, env);

io.on("connection", (socket) => {
  // Every tenant currently reaches the same core.
  core.connect(socket.id);
});`,
      hints: [
        "Use Map<string, RoomCore> as the in-process room registry.",
        "Normalize and validate the code before using it as a key.",
        "Cleanup should remove only the room whose connection count reached zero.",
      ],
      checks: [
        {
          id: "room-map",
          label: "Stores a core per room",
          pattern: "new\\s+Map\\s*<\\s*string\\s*,\\s*RoomCore\\s*>\\s*\\(",
          failureMessage: "Create a Map<string, RoomCore> room registry.",
        },
        {
          id: "factory",
          label: "Gets or creates room state",
          pattern: "function\\s+(?:getOrCreateRoom|getRoom)\\s*\\(.*roomCode",
          failureMessage: "Add getOrCreateRoom(roomCode) or getRoom(roomCode).",
        },
        {
          id: "validation",
          label: "Validates the room code",
          pattern: "roomCode[^;]*(?:match|test)\\s*\\(",
          failureMessage: "Validate the room code format before using it.",
        },
        {
          id: "lookup",
          label: "Looks up room-specific state",
          pattern: "rooms\\.get\\s*\\(\\s*roomCode\\s*\\)",
          failureMessage: "Look up the room using roomCode.",
        },
        {
          id: "creation",
          label: "Creates missing room state",
          pattern: "rooms\\.set\\s*\\(\\s*roomCode\\s*,\\s*new\\s+RoomCore",
          failureMessage: "Create and store a RoomCore for a missing room.",
        },
        {
          id: "cleanup",
          label: "Retires an empty room",
          pattern: "rooms\\.delete\\s*\\(\\s*roomCode\\s*\\)",
          failureMessage: "Delete the room after its last client leaves.",
        },
      ],
    },
  ],
};

const previewRooms: AcademyRoom[] = [
  {
    slug: "swiftui",
    order: 2,
    title: "SwiftUI Command Deck",
    shortTitle: "SwiftUI",
    subtitle:
      "Move from declarative views and state to navigation, structured concurrency, API clients, testing, and production architecture.",
    status: "preview",
    accent: "#6eb8ff",
    estimatedMinutes: 110,
    prerequisites: ["Complete Full-Stack Raid", "Basic Swift syntax"],
    learningOutcomes: [
      "Compose accessible SwiftUI views",
      "Model state and observation intentionally",
      "Use async/await for resilient API work",
      "Separate features for testing and scale",
    ],
    plannedModules: [
      "Views, modifiers, and identity",
      "State, binding, and observation",
      "Navigation and deep links",
      "Structured concurrency",
      "Networking and Codable",
      "Testing and app architecture",
    ],
    missions: [],
  },
  {
    slug: "android-kotlin",
    order: 3,
    title: "Android Systems Lab",
    shortTitle: "Android · Kotlin",
    subtitle:
      "Build a modern Kotlin and Jetpack Compose client with lifecycle-aware state, coroutines, networking, persistence, and tests.",
    status: "preview",
    accent: "#a4d65e",
    estimatedMinutes: 120,
    prerequisites: ["Complete Full-Stack Raid", "Basic Kotlin syntax"],
    learningOutcomes: [
      "Build Compose UI with unidirectional data flow",
      "Manage lifecycle-aware state",
      "Use coroutines and Flow",
      "Test repositories and presentation logic",
    ],
    plannedModules: [
      "Kotlin foundations",
      "Compose layouts and semantics",
      "ViewModels and StateFlow",
      "Coroutines and cancellation",
      "Networking and persistence",
      "Testing and release builds",
    ],
    missions: [],
  },
  {
    slug: "expo",
    order: 4,
    title: "Expo Launch Bay",
    shortTitle: "Expo · React Native",
    subtitle:
      "Apply React knowledge to a production Expo application with native-feeling navigation, device capabilities, offline state, and updates.",
    status: "preview",
    accent: "#c8b6ff",
    estimatedMinutes: 105,
    prerequisites: ["Complete Full-Stack Raid", "Comfort with React"],
    learningOutcomes: [
      "Translate web React concepts to React Native",
      "Build accessible cross-platform navigation",
      "Use device APIs through Expo modules",
      "Design offline-first data and safe updates",
    ],
    plannedModules: [
      "React Native primitives",
      "Expo Router",
      "Platform-aware design",
      "Device capabilities",
      "Offline data and synchronization",
      "Testing, EAS Build, and updates",
    ],
    missions: [],
  },
];

export const ACADEMY_CATALOG: AcademyCatalog = {
  schemaVersion: 1,
  title: "Justin's Developer Academy",
  teaserPath: "/",
  rooms: [nextRoom, ...previewRooms],
};

export function getAcademyRoom(slug: string): AcademyRoom | undefined {
  return ACADEMY_CATALOG.rooms.find((room) => room.slug === slug);
}

export function getAcademyRoomSummaries(): AcademyRoomSummary[] {
  return ACADEMY_CATALOG.rooms.map(({ missions, ...room }) => ({
    ...room,
    missionCount: missions.length,
  }));
}
