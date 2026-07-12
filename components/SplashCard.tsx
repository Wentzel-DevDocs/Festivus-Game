"use client";

/**
 * SplashCard — the end-of-match memo: the verdict on Justin, the champion,
 * and the "what even was that" explainer crediting Festivus properly.
 *
 * The verdict comes from AGGREGATE weighted headcounts only — the memo says
 * so out loud, because the whole game is built on nobody ever learning who
 * helped and who greased.
 */

import type { MatchSummary } from "@/lib/realtime/protocol";

interface SplashCardProps {
  /** Null while the match is still running (e.g. someone peeks early). */
  summary: MatchSummary | null;
}

/** Headline + color per verdict, in one lookup so the JSX stays tidy. */
const VERDICT_LINES: Record<
  MatchSummary["verdict"],
  { headline: string; className: string }
> = {
  beloved: { headline: "JUSTIN IS BELOVED", className: "text-support" },
  greased: {
    headline: "THE PEOPLE HAVE GREASED JUSTIN",
    className: "text-grease",
  },
  divided: { headline: "A DIVIDED OFFICE", className: "text-aluminum-600" },
};

export default function SplashCard({ summary }: SplashCardProps) {
  const verdict = summary ? VERDICT_LINES[summary.verdict] : null;

  return (
    <div className="memo-panel mx-auto max-w-2xl px-6 py-6 sm:px-8">
      {/* ── Verdict block (or a placeholder if the match isn't over) ──────── */}
      {summary && verdict ? (
        <>
          <h2 className={`display-header text-3xl sm:text-4xl ${verdict.className}`}>
            {verdict.headline}
          </h2>
          <p className="mt-2 font-mono text-sm text-aluminum-700">
            Approval: {summary.approvalSupport} supported ·{" "}
            {summary.approvalHinder} hindered (aggregate headcounts only —
            your pick stays secret)
          </p>
          {summary.championName !== null && (
            <p className="display-header mt-3 text-lg text-aluminum-900">
              CHAMPION: {summary.championName} ({summary.championMashes} mashes)
              — next Head of Household
            </p>
          )}
        </>
      ) : (
        <p className="font-mono text-sm text-aluminum-600">
          Match still in progress — the verdict memo is typed up at the end.
        </p>
      )}

      {/* ── The explainer memo (always shown) ─────────────────────────────── */}
      <hr className="my-5 border-memo-line" />

      <h3 className="display-header text-xl text-aluminum-900">
        HAPPY FESTIVUS — AND BACK TO WORK
      </h3>

      <p className="mt-3 leading-7 text-aluminum-800">
        {
          'Justin\'s Feats of Strength is built on Festivus, the anti-holiday Frank Costanza invented on Seinfeld — episode "The Strike," Season 9, Episode 10, first aired December 18, 1997. A Festivus for the rest of us.'
        }
      </p>

      <p className="mt-4 font-semibold text-aluminum-900">
        The traditions, as we butchered them:
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-6 leading-7 text-aluminum-800">
        <li>The bare aluminum pole → Pole Raise &amp; Greased Climb</li>
        <li>The Airing of Grievances → your anonymous gripes</li>
        <li>
          The Feats of Strength (pin the head of household) → Pin the Boss
        </li>
        <li>
          Plus a water-gun swim sprint and a tug-of-war, which Frank never
          authorized
        </li>
      </ul>

      <p className="mt-4 font-semibold text-aluminum-900">How it works:</p>
      <ul className="mt-1 list-disc space-y-1 pl-6 leading-7 text-aluminum-800">
        <li>Each round, secretly pick a side — help Justin or hinder him</li>
        <li>Mash to pump your side; pace yourself or you overheat</li>
        <li>The team&apos;s net effort decides how far Justin gets</li>
        <li>
          Hardest masher tops the leaderboard — your side stays secret
        </li>
        <li>
          Pin the Boss is double points: it crowns the champion and decides
          whether Justin&apos;s beloved or greased
        </li>
      </ul>
    </div>
  );
}
