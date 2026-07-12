"use client";

/**
 * Ticker — a small strip of scrolling flavor text ("MEMO: attendance is
 * mandatory…") for the edge of the boss screen.
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
    <div className="max-h-40 overflow-hidden font-mono text-xs text-aluminum-400">
      <div
        // Speed scales with the number of messages so a long list doesn't
        // whip past unreadably fast. Inline style because the duration is
        // computed — the keyframes themselves come from globals.css.
        style={{
          animation: `ticker-scroll ${Math.max(8, messages.length * 3)}s linear infinite`,
        }}
      >
        <ul>
          {messages.map((msg, i) => (
            <li key={i} className="truncate py-0.5">
              {msg}
            </li>
          ))}
        </ul>
        {/* The duplicate copy exists purely for the seamless loop; hide it
            from screen readers so nothing gets announced twice. */}
        <ul aria-hidden="true">
          {messages.map((msg, i) => (
            <li key={i} className="truncate py-0.5">
              {msg}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
