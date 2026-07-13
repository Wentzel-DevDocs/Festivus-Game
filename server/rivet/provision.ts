/**
 * Self-provision this deployment as the Rivet namespace's serverless runner.
 *
 * Why this exists: browsers connect to Rivet's gateway, which places actors
 * on a runner selected BY NAME — rivetkit clients ask for "default". A fresh
 * namespace has no runner config at all, so every connection dies with
 * `actor.no_runner_config_configured` (an error the client treats as fatal,
 * not retryable). Instead of requiring a hand-created dashboard entry that
 * must be named exactly "default", the app registers itself with one
 * `PUT /runner-configs/default` upsert covering every Rivet datacenter,
 * pointing the engine at this deployment's /api/rivet route.
 *
 * Rivet Cloud ACL reality (observed in production): the namespace-scoped
 * `sk_` token may NOT list datacenters (`acl.insufficient_permissions` —
 * it's a global operation), which also breaks rivetkit's own
 * `configurePool` path. So datacenter discovery tries the sk_ token first
 * and falls back to the publishable pk_ token; and if the config already
 * exists (e.g. dashboard-created), provisioning reports success instead
 * of failing requests that would have worked.
 *
 * Guard rails:
 *  - No-op without RIVET_ENDPOINT (local dev) or without a resolvable
 *    runner URL (preview deploys must not repoint the production pool).
 *  - Runs once per process; a failure clears the cache so the next
 *    request retries.
 *  - GET /api/rivet/provision-status (see status()) reports each probe
 *    separately for debugging — names and status codes only, never
 *    config bodies (they embed the engine's callback token).
 */

/** The runner name rivetkit clients request (its `poolName` default). */
const RUNNER_NAME = "default";

/**
 * How long (seconds) the engine may keep one serverless request alive as a
 * runner. Must stay under the route's maxDuration (300 s on Vercel Hobby)
 * with margin for the drain handoff, or Vercel kills runners mid-drain.
 */
const REQUEST_LIFESPAN_S = 280;

export interface ProvisionResult {
  outcome: "created" | "exists" | "skipped";
  detail: string;
}

let inflight: Promise<ProvisionResult> | null = null;

/** Idempotent, process-cached. Throws only when the room cannot work. */
export function ensureRunnerConfig(): Promise<ProvisionResult> {
  if (!inflight) {
    inflight = provision().catch((err) => {
      inflight = null;
      throw new Error("Rivet runner-config self-provisioning failed", { cause: err });
    });
  }
  return inflight;
}

interface Creds {
  endpoint: string;
  namespace: string;
  token: string;
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

/** Rivet connection URLs embed credentials: `https://<ns>:<token>@host`. */
function parseAuthUrl(raw: string | undefined): Creds | null {
  if (!raw) return null;
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

/** Server-side (sk_) credentials — authorized for namespace writes. */
function skCreds(): Creds | null {
  return parseAuthUrl(process.env.RIVET_ENDPOINT);
}

/** Publishable (pk_) credentials — what browsers use; readable fallback. */
function pkCreds(): Creds | null {
  return parseAuthUrl(
    process.env.NEXT_PUBLIC_RIVET_ENDPOINT ?? process.env.RIVET_PUBLIC_ENDPOINT,
  );
}

function apiHeaders(creds: Creds): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.token}`,
    "Content-Type": "application/json",
  };
}

function apiUrl(creds: Creds, path: string): string {
  return `${creds.endpoint}${path}?namespace=${encodeURIComponent(creds.namespace)}`;
}

async function provision(): Promise<ProvisionResult> {
  const sk = skCreds();
  const runnerUrl = resolveRunnerUrl();
  if (!sk || !runnerUrl) {
    return {
      outcome: "skipped",
      detail: !sk
        ? "no RIVET_ENDPOINT credentials (local dev?)"
        : "no runner URL for this deployment (preview? set RIVET_RUNNER_URL to override)",
    };
  }

  const dcErrors: string[] = [];
  const datacenters =
    (await listDatacenters(sk, "sk", dcErrors)) ??
    (await listDatacenters(pkCreds(), "pk", dcErrors));

  if (!datacenters) {
    // Can't upsert without datacenter names — but if a usable config is
    // already registered (dashboard-created), the room works; don't fail.
    if ((await configState(sk)) === "exists") {
      return {
        outcome: "exists",
        detail: `'${RUNNER_NAME}' runner config already registered (couldn't verify its URL: ${dcErrors.join("; ")})`,
      };
    }
    throw new Error(
      `no '${RUNNER_NAME}' runner config exists and datacenters can't be listed to create one (${dcErrors.join("; ")})`,
    );
  }

  try {
    await putConfig(sk, datacenters, runnerUrl);
  } catch (err) {
    // Upsert denied but a config is already there → good enough to play.
    if ((await configState(sk)) === "exists") {
      return {
        outcome: "exists",
        detail: `'${RUNNER_NAME}' runner config already registered (upsert not permitted: ${(err as Error).message})`,
      };
    }
    throw err;
  }
  return {
    outcome: "created",
    detail: `runner config '${RUNNER_NAME}' → ${runnerUrl} in [${datacenters.join(", ")}]`,
  };
}

async function listDatacenters(
  creds: Creds | null,
  label: string,
  errors: string[],
): Promise<string[] | null> {
  if (!creds) {
    errors.push(`${label}: no credentials`);
    return null;
  }
  try {
    const res = await fetch(apiUrl(creds, "/datacenters"), {
      headers: apiHeaders(creds),
      cache: "no-store",
    });
    if (!res.ok) {
      errors.push(`${label}: GET /datacenters → ${res.status}: ${await errBody(res)}`);
      return null;
    }
    const { datacenters } = (await res.json()) as { datacenters: { name: string }[] };
    if (!datacenters?.length) {
      errors.push(`${label}: GET /datacenters returned none`);
      return null;
    }
    return datacenters.map((dc) => dc.name);
  } catch (err) {
    errors.push(`${label}: GET /datacenters threw: ${(err as Error).message}`);
    return null;
  }
}

/** Does a runner config named RUNNER_NAME already exist? */
async function configState(sk: Creds): Promise<"exists" | "missing" | "unknown"> {
  try {
    const res = await fetch(apiUrl(sk, `/runner-configs/${RUNNER_NAME}`), {
      headers: apiHeaders(sk),
      cache: "no-store",
    });
    if (res.ok) return "exists";
    if (res.status === 404) return "missing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function putConfig(sk: Creds, datacenters: string[], runnerUrl: string): Promise<void> {
  // Field-for-field what rivetkit's configureServerlessPool sends, with a
  // Vercel-safe lifespan. x-rivet-token is the header the ENGINE presents
  // when it calls back into /api/rivet.
  const serverless = {
    url: runnerUrl,
    headers: { "x-rivet-token": sk.token },
    request_lifespan: REQUEST_LIFESPAN_S,
    metadata_poll_interval: 1000,
    max_runners: 100_000,
    min_runners: 0,
    runners_margin: 0,
    slots_per_runner: 1,
  };
  const body = {
    datacenters: Object.fromEntries(
      datacenters.map((name) => [
        name,
        { serverless, metadata: {}, drain_on_version_upgrade: true },
      ]),
    ),
  };
  const res = await fetch(apiUrl(sk, `/runner-configs/${RUNNER_NAME}`), {
    method: "PUT",
    headers: apiHeaders(sk),
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT /runner-configs/${RUNNER_NAME} → ${res.status}: ${await errBody(res)}`);
  }
}

/**
 * GET /api/rivet/provision-status — every probe separately, so one curl
 * shows exactly which Rivet API calls this deployment's tokens may make.
 * Never echoes tokens or config bodies (configs embed the callback token);
 * Rivet's error bodies are included (they name ACL roles, not secrets).
 */
export async function provisionStatus(): Promise<Response> {
  const sk = skCreds();
  const pk = pkCreds();

  const probe = async (creds: Creds | null, path: string): Promise<string> => {
    if (!creds) return "no credentials";
    try {
      const res = await fetch(apiUrl(creds, path), {
        headers: apiHeaders(creds),
        cache: "no-store",
      });
      if (res.ok) return "200 ok";
      return `${res.status}: ${await errBody(res)}`;
    } catch (err) {
      return `threw: ${(err as Error).message}`;
    }
  };

  /** List probe returns config NAMES only — bodies embed the engine token. */
  const configNames = async (): Promise<string> => {
    if (!sk) return "no credentials";
    try {
      const res = await fetch(apiUrl(sk, "/runner-configs"), {
        headers: apiHeaders(sk),
        cache: "no-store",
      });
      if (!res.ok) return `${res.status}: ${await errBody(res)}`;
      const parsed = (await res.json()) as {
        runner_configs?: Record<string, unknown> | { name?: string }[];
      };
      const rc = parsed.runner_configs;
      if (Array.isArray(rc)) return `200: [${rc.map((r) => r?.name ?? "?").join(", ")}]`;
      if (rc && typeof rc === "object") return `200: [${Object.keys(rc).join(", ")}]`;
      return "200 (unrecognized shape)";
    } catch (err) {
      return `threw: ${(err as Error).message}`;
    }
  };

  let provisionOutcome: string;
  try {
    const r = await ensureRunnerConfig();
    provisionOutcome = `${r.outcome}: ${r.detail}`;
  } catch (err) {
    const chain: string[] = [];
    let c: unknown = err;
    while (c instanceof Error && chain.length < 5) {
      chain.push(c.message);
      c = c.cause;
    }
    provisionOutcome = `failed: ${chain.join(" ← ")}`;
  }

  return Response.json({
    runnerName: RUNNER_NAME,
    runnerUrl: resolveRunnerUrl(),
    hasSkCreds: Boolean(sk),
    hasPkCreds: Boolean(pk),
    provision: provisionOutcome,
    probes: {
      "sk GET /datacenters": await probe(sk, "/datacenters"),
      "pk GET /datacenters": await probe(pk, "/datacenters"),
      [`sk GET /runner-configs/${RUNNER_NAME}`]: await probe(sk, `/runner-configs/${RUNNER_NAME}`),
      "sk GET /runner-configs (names)": await configNames(),
    },
  });
}

/** First few hundred bytes of an error response — enough to name the cause. */
async function errBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<unreadable body>";
  }
}
