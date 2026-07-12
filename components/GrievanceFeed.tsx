"use client";

/**
 * GrievanceFeed — the Airing of Grievances, rendered as a memo page.
 *
 * Each grievance is one ruled line: "— I got a lot of problems with you
 * people…" in an italic serif, like someone scrawled it on the office memo.
 * Grievances are anonymous by construction — the server shuffles them and
 * never stores an author — so there is nothing to attribute here.
 *
 * The host (boss screen) gets a HIDE button per line to yank anything that
 * crosses from "festive gripe" into "HR incident".
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
    <div className="memo-panel px-5 py-4">
      {items.length === 0 ? (
        <p className="font-serif italic text-aluminum-600">
          No grievances yet. Surely you have SOME problems with these people.
        </p>
      ) : (
        <ul>
          {items.map((g) => (
            <li
              key={g.id}
              // leading-[28px] matches the memo-panel's 28px ruled lines, so
              // every grievance sits neatly on its own rule like handwriting.
              className="flex items-baseline justify-between gap-3 font-serif italic leading-[28px]"
            >
              <span>— {g.text}</span>
              {canHide && (
                <button
                  type="button"
                  aria-label="Hide grievance"
                  onClick={() => onHide?.(g.id)}
                  // min-h/min-w 48px keeps this a comfortable touch target
                  // even though the visible text is small.
                  className="display-header min-h-12 min-w-12 shrink-0 rounded border border-grievance px-2 text-xs not-italic text-grievance hover:bg-grievance hover:text-memo"
                >
                  Hide
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
