/**
 * Entry point for the realtime server: `pnpm dev:rivet` (tsx watch).
 *
 * Local dev: RivetKit boots an embedded engine on http://127.0.0.1:6420
 * (state under .rivetkit/) — no cloud account needed.
 * Production: point this same process at Rivet Cloud with RIVET_ENDPOINT /
 * RIVET_TOKEN / RIVET_NAMESPACE (see README → Deploy).
 *
 * This process is the AUTHORITATIVE game host. It must NOT run on Vercel
 * serverless functions — they cannot hold a persistent room. Vercel serves
 * the Next.js app; this actor serves the live match.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv(); // .env fallback

import { registry } from "./registry";

registry.start();
