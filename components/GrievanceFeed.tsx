"use client";

/**
 * GrievanceFeed — anonymous dispatches mounted inside a forged archive frame.
 *
 * Parchment is reserved for the grievance payload itself. The server shuffles
 * every item and never stores an author, so there is intentionally nothing to
 * attribute here. Hosts retain the one moderation control: HIDE.
 */

import type { GrievancePub } from "@/lib/realtime/protocol";

interface GrievanceFeedProps {
  items: GrievancePub[];
  /** True on the host screen only. */
  canHide: boolean;
  /** Called with the grievance id when the host clicks HIDE. */
  onHide?: (id: string) => void;
}

export default function GrievanceFeed({ items, canHide, onHide }: GrievanceFeedProps) {
  return (
    <section className="forge-panel p-2.5 sm:p-3" aria-labelledby="grievance-feed-title">
      <header className="relative z-10 flex items-center justify-between gap-3 px-2 pb-2.5">
        <div className="min-w-0">
          <p className="eyebrow">Anonymous archive</p>
          <h2
            id="grievance-feed-title"
            className="display-header truncate text-sm text-aluminum-100 sm:text-base"
          >
            Airing of Grievances
          </h2>
        </div>
        <span className="hud-chip shrink-0" aria-label={`${items.length} grievances logged`}>
          <span
            className="h-1.5 w-1.5 rounded-full bg-grievance shadow-[0_0_10px_rgba(215,71,71,0.8)]"
            aria-hidden="true"
          />
          {items.length} logged
        </span>
      </header>

      <div className="memo-panel relative z-10 overflow-hidden px-4 py-3 sm:px-5 sm:py-4">
        {items.length === 0 ? (
          <p className="py-2 font-serif italic text-aluminum-600">
            The archive is sealed. No grievances have been revealed.
          </p>
        ) : (
          <ul className="divide-y divide-memo-line/70">
            {items.map((grievance, index) => (
              <li
                key={grievance.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 py-3 first:pt-1 last:pb-1"
              >
                <span
                  className="font-mono text-[10px] font-bold tracking-wider text-grievance"
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="font-serif text-[0.98rem] leading-6 italic text-aluminum-900">
                  “{grievance.text}”
                </p>
                {canHide && (
                  <button
                    type="button"
                    aria-label={`Hide grievance ${index + 1}`}
                    onClick={() => onHide?.(grievance.id)}
                    className="min-h-11 min-w-11 shrink-0 rounded border border-grievance/60 bg-grievance/5 px-2 font-mono text-[10px] font-bold uppercase tracking-widest text-grievance transition-colors hover:bg-grievance hover:text-memo"
                  >
                    Hide
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="relative z-10 flex items-center justify-between gap-3 px-2 pt-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-aluminum-500">
        <span>Identity fields: none</span>
        <span>Sequence: shuffled</span>
      </footer>
    </section>
  );
}
