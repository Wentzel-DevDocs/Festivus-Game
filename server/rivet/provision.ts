/**
 * Self-provision this deployment as the Rivet namespace's serverless runner.
 *
 * Why this exists: browsers connect to Rivet's gateway, which places actors
 * on a runner selected BY NAME — rivetkit clients ask for "default". A fresh
 * namespace has no runner config at all, so every connection dies with
 * `actor.no_runner_config_configured` (an error the client treats as fatal,
 * not retryable). Instead of requiring a hand-created dashboard entry that
 * must be named exactly "default", the app registers itself: one
 * `PUT /runner-configs/default` upsert covering every Rivet datacenter,
 * pointing the engine at this deployment's /api/rivet route.
 *
 * This mirrors what rivetkit's own `configurePool` option does on a
 * serverless start request — which is a catch-22 for bootstrapping: the
 * engine only sends start requests to runners it already has a config for.
 * So we run the same upsert ourselves, triggered by ANY request to
 * /api/rivet (the game page pokes /api/rivet/health before connecting).
 *
 * Guard rails:
 *  - No-op without RIVET_ENDPOINT (local dev) or without a resolvable
 *    runner URL (preview deploys must not repoint the production pool).
 *  - Runs once per process; a failure clears the cache so the next
 *    request retries.
 */

/** The runner name rivetkit clients request (its `poolName` default). */
const RUNNER_NAME = "default";

/**
 * How long (seconds) the engine may keep one serverless request alive as a
 * runner. Must stay under the route's maxDuration (300 s on Vercel Hobby)
 * with margin for the drain handoff, or Vercel kills runners mid-drain.
 */
const REQUEST_LIFESPAN_S = 280;

let inflight: Promise<void> | null = null;

/** Idempotent, process-cached. Throws only on a real provisioning failure. */
export function ensureRunnerConfig(): Promise<void> {
  if (!inflight) {
    inflight = provision().catch((err) => {
      inflight = null;
      throw new Error("Rivet runner-config self-provisioning failed", { cause: err });
    });
  }
  return inflight;
}

/**
 * The URL the Rivet Engine should call to run actors here. Explicit
 * RIVET_RUNNER_URL wins (non-Vercel hosts, custom domains); otherwise use
 * Vercel's own production-domain env — and ONLY on the production
 * deployment, so a poked preview deploy can't hijack the live pool.
 */
function resolveRunnerUrl(): string | null {
  if (process.env.RIVET_RUNNER_URL) return process.env.RIVET_RUNNER_URL;
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && prodHost) {
    return `https://${prodHost}/api/rivet`;
  }
  return null;
}

/** RIVET_ENDPOINT is `https://<namespace>:<sk_token>@api.rivet.dev`. */
function parseRivetEndpoint(
  raw: string,
): { endpoint: string; namespace: string; token: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const namespace = decodeURIComponent(url.username) || process.env.RIVET_NAMESPACE || "";
  const token = decodeURIComponent(url.password) || process.env.RIVET_TOKEN || "";
  if (!namespace || !token) return null;
  return { endpoint: `${url.protocol}//${url.host}`, namespace, token };
}

async function provision(): Promise<void> {
  const raw = process.env.RIVET_ENDPOINT;
  const runnerUrl = resolveRunnerUrl();
  if (!raw || !runnerUrl) return;
  const creds = parseRivetEndpoint(raw);
  if (!creds) return;
  const { endpoint, namespace, token } = creds;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const ns = `namespace=${encodeURIComponent(namespace)}`;

  const dcRes = await fetch(`${endpoint}/datacenters?${ns}`, { headers, cache: "no-store" });
  if (!dcRes.ok) {
    throw new Error(`GET /datacenters → ${dcRes.status}: ${await errBody(dcRes)}`);
  }
  const { datacenters } = (await dcRes.json()) as { datacenters: { name: string }[] };

  // Field-for-field what rivetkit's configureServerlessPool sends, with a
  // Vercel-safe lifespan. x-rivet-token is the header the ENGINE presents
  // when it calls back into /api/rivet.
  const serverless = {
    url: runnerUrl,
    headers: { "x-rivet-token": token },
    request_lifespan: REQUEST_LIFESPAN_S,
    metadata_poll_interval: 1000,
    max_runners: 100_000,
    min_runners: 0,
    runners_margin: 0,
    slots_per_runner: 1,
  };
  const body = {
    datacenters: Object.fromEntries(
      datacenters.map((dc) => [
        dc.name,
        { serverless, metadata: {}, drain_on_version_upgrade: true },
      ]),
    ),
  };

  const putRes = await fetch(`${endpoint}/runner-configs/${RUNNER_NAME}?${ns}`, {
    method: "PUT",
    headers,
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    throw new Error(`PUT /runner-configs/${RUNNER_NAME} → ${putRes.status}: ${await errBody(putRes)}`);
  }
}

/** First few hundred bytes of an error response — enough to name the cause. */
async function errBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<unreadable body>";
  }
}
