/**
 * /api/rivet/* — the RivetKit SERVERLESS runner endpoint.
 *
 * This is the alternative to running `pnpm dev:rivet` on an always-on host:
 * in the Rivet Cloud dashboard you register this URL (e.g.
 * https://your-app.vercel.app/api/rivet) as a serverless runner, and the
 * Rivet Engine CALLS INTO this route to execute the room actor inside your
 * serverless functions. Browsers still connect to Rivet's gateway
 * (NEXT_PUBLIC_RIVET_ENDPOINT with the pk_ token) — the engine terminates
 * their WebSockets and drives the actor through here over HTTP.
 *
 * Required env on this deployment (server-side, NOT NEXT_PUBLIC):
 *   RIVET_ENDPOINT = https://<namespace>:<sk_token>@api.rivet.dev
 * plus the usual APP_BASE_URL / INTERNAL_API_SECRET / DATABASE_URL for
 * match persistence.
 *
 * Local dev is unchanged: `pnpm dev:rivet` runs the embedded engine and
 * this route sits idle.
 */

import { registry } from "@/server/rivet/registry";

// The engine's requests must never be served from any cache, and the actor
// needs the Node.js runtime (not edge).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Let one invocation host the actor for as long as the platform allows —
// the engine re-invokes as needed, but fewer handoffs = smoother ticking.
// 300 s is the Vercel Hobby (fluid compute) ceiling; raise to 800 on Pro.
export const maxDuration = 300;

const handler = async (request: Request) => {
  try {
    return await registry.handler(request);
  } catch (err) {
    // Surface the real failure in the response body: platform runtime logs
    // are awkward to reach mid-debug, and rivetkit's errors are designed to
    // be shown (no secrets — we only report a BOOLEAN for the env var).
    const e = err as Error & { code?: string; group?: string };
    return Response.json(
      {
        ok: false,
        error: e?.message ?? String(err),
        code: e?.code ?? null,
        group: e?.group ?? null,
        node: process.version,
        hasRivetEndpoint: Boolean(process.env.RIVET_ENDPOINT),
      },
      { status: 500 },
    );
  }
};

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
