/**
 * proxy.ts — Next.js 16's replacement for middleware.ts.
 *
 * Runs in front of every matched request before it reaches a page or API
 * route. We keep it deliberately small:
 *
 *  1. Security headers on every page. The boss view runs full-screen on a
 *     shared company display — it must never be framable by another site
 *     (clickjacking), and browsers shouldn't content-sniff anything.
 *
 *  2. A marked extension point for v2 multi-room support: private rooms
 *     become a URL prefix (e.g. /r/acme-offsite/play) that this proxy can
 *     rewrite onto the existing pages while the room id flows through to
 *     the actor key. Nothing else in the app would need to move.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function proxy(request: NextRequest) {
  // ── v2 hook: multi-room routing would go here ──────────────────────────
  // e.g. /r/<roomId>/play → rewrite to /play with a x-festivus-room header.
  // For v1 there is exactly ONE shared room (see GAME_CONFIG.ROOM_ID), so
  // every request passes straight through.
  void request;

  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  // Everything except Next's static output and plain asset files.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|wav)$).*)"],
};
