"use client";

/**
 * SplashCard — a compact after-action report: verdict, aggregate alignment,
 * and the champion. Background lore stays available in a native disclosure.
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
  beloved: { headline: "JUSTIN STANDS BELOVED", className: "text-support" },
  greased: {
    headline: "JUSTIN HAS BEEN GREASED",
    className: "text-grease",
  },
  divided: { headline: "THE CITADEL IS DIVIDED", className: "text-aluminum-200" },
};

export default function SplashCard({ summary }: SplashCardProps) {
  const verdict = summary ? VERDICT_LINES[summary.verdict] : null;
  const totalApproval = summary
    ? summary.approvalSupport + summary.approvalHinder
    : 0;
  const supportPercent =
    summary && totalApproval > 0
      ? Math.round((summary.approvalSupport / totalApproval) * 100)
      : 0;
  const hinderPercent = totalApproval > 0 ? 100 - supportPercent : 0;

  return (
    <section
      className="forge-panel mx-auto w-full max-w-2xl p-4 sm:p-6"
      aria-labelledby="after-action-title"
    >
      {summary && verdict ? (
        <>
          <header className="relative z-10 text-center">
            <p className="eyebrow">After-action report // match sealed</p>
            <h2
              id="after-action-title"
              className={`display-header mt-1 text-2xl sm:text-4xl ${verdict.className}`}
            >
              {verdict.headline}
            </h2>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-aluminum-500">
              Aggregate headcounts only // individual allegiance classified
            </p>
          </header>

          <div className="hud-rule relative z-10 my-4" />

          <dl className="relative z-10 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.35fr]">
            <div className="rounded-lg border border-support/25 bg-support/5 p-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-support">
                Support
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold tabular-nums text-aluminum-100">
                {summary.approvalSupport}
              </dd>
              <dd className="font-mono text-[10px] text-aluminum-500">
                {supportPercent}% alignment
              </dd>
            </div>

            <div className="rounded-lg border border-grease/25 bg-grease/5 p-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-grease">
                Hinder
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold tabular-nums text-aluminum-100">
                {summary.approvalHinder}
              </dd>
              <dd className="font-mono text-[10px] text-aluminum-500">
                {hinderPercent}% alignment
              </dd>
            </div>

            <div className="col-span-2 rounded-lg border border-aluminum-600/60 bg-aluminum-950/55 p-3 sm:col-span-1">
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-aluminum-400">
                Strength champion
              </dt>
              <dd className="display-header mt-1 truncate text-lg text-aluminum-100">
                {summary.championName ?? "No champion"}
              </dd>
              <dd className="font-mono text-[10px] text-grease">
                {summary.championMashes} mashes // next Head of Household
              </dd>
            </div>
          </dl>

          <div
            className="relative z-10 mt-3 flex h-2 overflow-hidden rounded-full border border-aluminum-700 bg-aluminum-950"
            role="progressbar"
            aria-label="Support alignment"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={supportPercent}
            aria-valuetext={`${supportPercent}% support and ${hinderPercent}% hinder`}
          >
            <span
              className="h-full bg-support shadow-[0_0_12px_rgba(67,199,122,0.45)]"
              style={{ width: `${supportPercent}%` }}
            />
            <span
              className="h-full bg-grease shadow-[0_0_12px_rgba(232,169,65,0.4)]"
              style={{ width: `${hinderPercent}%` }}
            />
          </div>
        </>
      ) : (
        <div className="relative z-10 py-4 text-center">
          <p className="eyebrow">After-action report</p>
          <h2 id="after-action-title" className="display-header mt-1 text-xl text-aluminum-200">
            Verdict remains sealed
          </h2>
          <p className="mt-2 font-mono text-xs text-aluminum-500">
            Match telemetry is still being reconciled.
          </p>
        </div>
      )}

      <details className="relative z-10 mt-4 border-t border-aluminum-700/80 pt-3 text-sm text-aluminum-300">
        <summary className="cursor-pointer select-none font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-aluminum-400 hover:text-grease">
          Report details &amp; Festivus protocol
        </summary>
        <div className="mt-3 space-y-3 border-l border-grease/40 pl-3 leading-6">
          <p>
            Support and hinder totals are aggregate weighted headcounts. No
            report, roster field, or database row links a person to a side.
          </p>
          <p>
            The operation adapts the aluminum pole, Airing of Grievances, and
            Feats of Strength from Festivus, introduced in Seinfeld&apos;s
            &ldquo;The Strike.&rdquo; Swim Sprint and Tug-of-War remain unauthorized
            field exercises.
          </p>
        </div>
      </details>
    </section>
  );
}
