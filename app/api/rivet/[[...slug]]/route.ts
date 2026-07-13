/**
 * /api/rivet/* — the RivetKit SERVERLESS runner endpoint.
 *
 * This is the alternative to running `pnpm dev:rivet` on an always-on host:
 * the route registers ITSELF with Rivet as the namespace's "default"
 * serverless runner (see server/rivet/provision.ts — no dashboard entry to
 * hand-create), and the Rivet Engine CALLS INTO this route to execute the
 * room actor inside your serverless functions. Browsers still connect to
 * Rivet's gateway (NEXT_PUBLIC_RIVET_ENDPOINT with the pk_ token) — the
 * engine terminates their WebSockets and drives the actor through here
 * over HTTP.
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
import { ensureRunnerConfig, provisionStatus } from "@/server/rivet/provision";

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
    // Debug endpoint: which Rivet API calls may this deployment's tokens
    // make, and what did self-provisioning decide? (No secrets echoed.)
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/api/rivet/provision-status"
    ) {
      return await provisionStatus();
    }
    // Self-register this deployment as the namespace's "default" serverless
    // runner (see provision.ts) — cached per process, so it costs one Rivet
    // API round-trip on the first request only. Skipped for the engine's
    // own calls: the engine reaching us proves a config already exists, and
    // a transient provisioning failure must never 500 live actor traffic.
    if (!(request.headers.get("user-agent") ?? "").startsWith("RivetEngine/")) {
      await ensureRunnerConfig();
    }
    return await registry.handler(request);
  } catch (err) {
    // Surface the real failure in the response body: platform runtime logs
    // are awkward to reach mid-debug, and rivetkit's errors are designed to
    // be shown (no secrets — we only report a BOOLEAN for the env var).
    return Response.json(
      {
        ok: false,
        chain: causeChain(err),
        node: process.version,
        hasRivetEndpoint: Boolean(process.env.RIVET_ENDPOINT),
        wasm: await wasmDiagnostics(),
      },
      { status: 500 },
    );
  }
};

/** Walk err.cause so network/fs failures reveal their target (host, path). */
function causeChain(err: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let c = err as (Error & Record<string, unknown>) | undefined;
  let guard = 0;
  while (c && guard++ < 8) {
    chain.push({
      name: c.name,
      message: c.message,
      code: c.code ?? null,
      syscall: c.syscall ?? null,
      address: c.address ?? null,
      port: c.port ?? null,
      path: c.path ?? null,
      errors: Array.isArray(c.errors)
        ? c.errors.slice(0, 3).map((e: Error & { code?: string }) => `${e?.code ?? ""} ${e?.message ?? e}`)
        : null,
    });
    c = c.cause as typeof c;
  }
  return chain;
}

/** Can the deployed function even find rivetkit's WASM runtime on disk? */
async function wasmDiagnostics(): Promise<Record<string, unknown>> {
  try {
    const { createRequire } = await import("node:module");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const req = createRequire(import.meta.url);
    const rivetkitPath = req.resolve("rivetkit");
    const wasmIndex = createRequire(rivetkitPath).resolve("@rivetkit/rivetkit-wasm");
    const wasmFile = path.join(path.dirname(wasmIndex), "pkg", "rivetkit_wasm_bg.wasm");
    return {
      rivetkitPath,
      wasmIndex,
      wasmFile,
      wasmFileExists: fs.existsSync(wasmFile),
    };
  } catch (err) {
    return { resolveError: (err as Error)?.message ?? String(err) };
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
