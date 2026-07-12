"use client";

/**
 * The landing page — one shared URL, no login, no QR codes.
 *
 * Everyone at the party opens the same address. From here you either:
 *  - type a name and JOIN AS TEAM PLAYER (your phone becomes a controller), or
 *  - JOIN AS BOSS (BIG SCREEN) — no name needed, it's just a spectator
 *    broadcast for the TV.
 *
 * Both buttons lead into the SAME single room (see GAME_CONFIG.ROOM_ID),
 * so there is nothing to coordinate: share the URL, pick a button, play.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSavedName, saveName } from "@/lib/identity";
import Stamp from "@/components/Stamp";

/** The five quick rules, verbatim — the whole game in one memo. */
const QUICK_RULES = [
  "Each round, secretly pick a side — help Justin or hinder him",
  "Mash to pump your side; pace yourself or you overheat",
  "The team's net effort decides how far Justin gets",
  "Hardest masher tops the leaderboard — your side stays secret",
  "Pin the Boss is double points: it crowns the champion and decides whether Justin's beloved or greased",
];

export default function LandingPage() {
  const router = useRouter();

  // The name field is controlled state. We start empty and load the saved
  // name in an effect (not in useState's initializer) because localStorage
  // only exists in the browser — reading it during the server render would
  // make the server's HTML disagree with the client's ("hydration mismatch").
  const [name, setName] = useState("");
  useEffect(() => {
    setName(getSavedName());
  }, []);

  // Whitespace-only names don't count as "having a name".
  const trimmedName = name.trim();

  /** Player path: remember the name, then head to the phone controller. */
  function joinAsPlayer() {
    if (!trimmedName) return;
    saveName(trimmedName);
    router.push("/play");
  }

  /** Boss path: no name required — the big screen is anonymous furniture. */
  function joinAsBoss() {
    router.push("/boss");
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-4">
      {/* ── The memo card ──────────────────────────────────────────────── */}
      {/* `relative` so the stamp can sit absolutely over the top corner.  */}
      <div className="relative w-full max-w-md memo-panel p-6 pt-8">
        {/* Rubber stamp, slapped over the corner like a real memo. */}
        <div className="absolute -top-3 -right-2">
          <Stamp>MANDATORY ATTENDANCE</Stamp>
        </div>

        <h1 className="display-header text-3xl tracking-wide leading-tight">
          Justin&apos;s Feats of Strength
        </h1>
        <p className="mt-1 text-sm text-aluminum-600 italic">
          A Festivus for the rest of us.
        </p>

        {/* ── Name + join buttons ──────────────────────────────────────── */}
        <div className="mt-6 flex flex-col gap-3">
          <label
            htmlFor="player-name"
            className="display-header text-xs tracking-widest text-aluminum-700"
          >
            Your name
          </label>
          <input
            id="player-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="off"
            placeholder="e.g. Frank"
            // Pressing Enter in the field should join, same as the button.
            onKeyDown={(e) => {
              if (e.key === "Enter") joinAsPlayer();
            }}
            className="w-full rounded border border-memo-line bg-white px-3 py-3 text-lg text-aluminum-900 placeholder:text-aluminum-400"
          />

          {/* Primary: player. Disabled until a real name is typed, because
              the leaderboard and the roster need something to call you. */}
          <button
            type="button"
            onClick={joinAsPlayer}
            disabled={!trimmedName}
            className="display-header w-full min-h-12 rounded bg-grievance px-4 py-3 text-lg tracking-widest text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            Join as team player
          </button>

          {/* Secondary: the big screen. Aluminum, understated, no name. */}
          <button
            type="button"
            onClick={joinAsBoss}
            className="display-header aluminum-panel w-full min-h-12 px-4 py-3 text-lg tracking-widest text-aluminum-100"
          >
            Join as boss (big screen)
          </button>
        </div>

        {/* ── Quick rules memo ─────────────────────────────────────────── */}
        <div className="mt-6 border-t border-memo-line pt-4">
          <h2 className="display-header text-sm tracking-widest text-aluminum-700">
            Quick rules
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-aluminum-800">
            {QUICK_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Footer small print ─────────────────────────────────────────── */}
      <p className="mt-4 max-w-md text-center text-xs text-aluminum-500">
        Built on Festivus — Seinfeld, &ldquo;The Strike&rdquo; (S9E10, Dec 18
        1997).
      </p>
    </main>
  );
}
