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
  "Secretly choose whether this release helps Justin or hinders him",
  "Mash to ship force; pace yourself or the controller overheats",
  "Aggregate effort moves the shared arena—individual allegiance never leaves your phone",
  "Raw output drives the leaderboard, regardless of which side you picked",
  "The final feat is a 2× production deploy that crowns the champion",
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
    <main className="landing-shell safe-viewport mx-auto flex min-h-dvh w-full max-w-[1920px] items-center p-4 md:p-8">
      <section className="landing-grid grid w-full items-center gap-4 md:gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="landing-hero relative overflow-hidden rounded-2xl border border-aluminum-600/50 bg-aluminum-950/70 p-5 shadow-2xl backdrop-blur-sm md:p-10">
          <div className="landing-arena absolute inset-0 -z-10" />
          <div className="landing-brand brand-lockup mb-6 md:mb-10">
            <span className="brand-sigil" aria-hidden="true" />
            <div>
              <p className="eyebrow">The Aluminum Citadel awaits</p>
              <p className="font-mono text-xs text-aluminum-400">Live multiplayer · one shared arena</p>
            </div>
          </div>

          <p className="eyebrow">A live all-hands incident in five acts</p>
          <h1 className="display-header mt-3 max-w-3xl text-4xl leading-[0.96] text-aluminum-100 md:text-7xl">
            Justin&apos;s
            <span className="block text-grease">Feats of Strength</span>
          </h1>
          <p className="landing-copy mt-4 max-w-xl text-sm leading-6 text-aluminum-300 md:mt-5 md:text-lg md:leading-7">
            Choose an allegiance in secret. Power the boss—or grease his downfall.
            Every phone controls the same living arena. No install. No accounts.
          </p>

          <div className="landing-chips mt-5 flex flex-wrap gap-2 md:mt-8">
            <span className="hud-chip">No install</span>
            <span className="hud-chip">Anonymous sides</span>
            <span className="hud-chip">One live arena</span>
          </div>
        </div>

        <div className="landing-entry forge-panel p-4 md:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Enter the arena</p>
              <h2 className="display-header mt-1 text-2xl">Choose your station</h2>
            </div>
            <Stamp>Mandatory</Stamp>
          </div>

          <div className="flex flex-col gap-3">
            <label htmlFor="player-name" className="eyebrow text-aluminum-400">
              Competitor name
            </label>
            <input
              id="player-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              autoComplete="off"
              placeholder="e.g. Frank"
              onKeyDown={(e) => {
                if (e.key === "Enter") joinAsPlayer();
              }}
              className="min-h-14 w-full rounded-lg border border-aluminum-600 bg-aluminum-950/80 px-4 text-lg text-aluminum-100 shadow-inner outline-none placeholder:text-aluminum-500 focus:border-grease"
            />

            <button
              type="button"
              onClick={joinAsPlayer}
              disabled={!trimmedName}
              className="display-header min-h-14 w-full rounded-lg border border-grievance bg-grievance/15 px-4 text-lg text-grievance transition-all hover:bg-grievance hover:text-white disabled:cursor-not-allowed disabled:border-aluminum-700 disabled:bg-transparent disabled:text-aluminum-600"
            >
              Join as player
            </button>

            <button
              type="button"
              onClick={joinAsBoss}
              className="display-header aluminum-panel min-h-14 w-full px-4 text-lg text-aluminum-100 transition-colors hover:border-grease/60 hover:text-grease"
            >
              Open boss broadcast
            </button>
          </div>

          <div className="hud-rule my-6" />
          <details>
            <summary className="display-header cursor-pointer text-sm text-aluminum-300">
              Rules of the citadel
            </summary>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-aluminum-400">
              {QUICK_RULES.map((rule, index) => (
                <li key={rule} className="flex gap-3">
                  <span className="font-mono text-grease">{String(index + 1).padStart(2, "0")}</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      </section>
    </main>
  );
}
