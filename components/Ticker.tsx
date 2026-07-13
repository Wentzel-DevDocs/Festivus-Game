"use client";

/**
 * Ticker — a compact operational strip for room notices and revealed text.
 *
 * How the seamless loop works: we render the message list TWICE, stacked
 * vertically, and animate the whole stack upward by exactly 50% of its own
 * height (the `ticker-scroll` keyframes live in globals.css). When the
 * animation wraps back to 0%, the second copy is standing precisely where
 * the first copy started — the eye can't see the seam.
 *
 * Reduced motion: globals.css collapses all animation durations to ~0 under
 * prefers-reduced-motion, so this strip simply holds still (showing the top
 * of the list) for those users. No JS needed.
 */

interface TickerProps {
  messages: string[];
}

export default function Ticker({ messages }: TickerProps) {
  // Nothing to scroll → render nothing (an empty animated box looks broken).
  if (messages.length === 0) return null;

  return (
    <aside
      className="flex h-9 min-w-0 overflow-hidden rounded-lg border border-aluminum-700/80 bg-aluminum-950/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      aria-label="Citadel operations ticker"
    >
      <div className="relative z-10 flex shrink-0 items-center gap-2 border-r border-aluminum-700/80 bg-aluminum-900 px-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-grease sm:px-3 sm:text-[10px]">
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-support shadow-[0_0_9px_rgba(67,199,122,0.75)]"
          aria-hidden="true"
        />
        <span className="hidden sm:inline">Citadel ops</span>
        <span className="sm:hidden">Ops</span>
      </div>

      <div className="h-8 min-w-0 flex-1 overflow-hidden px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-aluminum-400">
        <div
          // Speed scales with the number of messages so a long list doesn't
          // whip past unreadably fast. Inline style because the duration is
          // computed — the keyframes themselves come from globals.css.
          style={{
            animation: `ticker-scroll ${Math.max(8, messages.length * 3)}s linear infinite`,
          }}
        >
          <ul>
            {messages.map((message, index) => (
              <li
                key={`${message}-${index}`}
                className="flex h-8 min-w-0 items-center gap-2 truncate"
              >
                <span className="text-aluminum-600" aria-hidden="true">
                  //
                </span>
                <span className="truncate">{message}</span>
              </li>
            ))}
          </ul>
          {/* The duplicate copy exists purely for the seamless loop; hide it
              from screen readers so nothing gets announced twice. */}
          <ul aria-hidden="true">
            {messages.map((message, index) => (
              <li
                key={`${message}-${index}-duplicate`}
                className="flex h-8 min-w-0 items-center gap-2 truncate"
              >
                <span className="text-aluminum-600" aria-hidden="true">
                  //
                </span>
                <span className="truncate">{message}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
