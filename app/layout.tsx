/**
 * Root layout — a SERVER component (no "use client").
 *
 * Next.js App Router wraps every page in this file. It is the one place we:
 *  - declare the page <title> and description (Next turns the exported
 *    `metadata` object into <meta> tags for us),
 *  - pin the viewport so phones can NOT pinch/double-tap zoom — critical,
 *    because the mash button gets tapped very fast and an accidental zoom
 *    would ruin the game,
 *  - import the global stylesheet once,
 *  - set the dark aluminum base colors on <body> so every page starts
 *    on-theme.
 */

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Justin's Feats of Strength",
  description: "A Festivus party game: help or hinder the boss. Anonymously.",
};

// Next.js 15 wants viewport settings exported separately from `metadata`.
// maximumScale: 1 disables pinch-zoom; combined with the CSS
// `touch-action: manipulation` in globals.css, rapid mash taps never
// trigger the browser's double-tap-to-zoom gesture.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-aluminum-950 text-aluminum-100 min-h-dvh font-sans">
        {children}
      </body>
    </html>
  );
}
