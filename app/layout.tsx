/**
 * Root layout — a SERVER component (no "use client").
 *
 * Next.js App Router wraps every page in this file. It is the one place we:
 *  - declare the page <title> and description (Next turns the exported
 *    `metadata` object into <meta> tags for us),
 *  - set a device-width viewport while preserving user zoom for accessibility,
 *  - import the global stylesheet once,
 *  - set the dark aluminum base colors on <body> so every page starts
 *    on-theme.
 */

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.APP_BASE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000",
  ),
  title: "Justin's Feats of Strength — A Festivus All-Hands Raid",
  description:
    "Enter the Aluminum Citadel for an anonymous, multiplayer Festivus raid built for the company all-hands.",
  applicationName: "Justin's Feats of Strength",
  openGraph: {
    title: "Justin's Feats of Strength",
    description:
      "A Festivus all-hands raid. Help or hinder the boss—anonymously.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1672,
        height: 941,
        alt: "The Aluminum Citadel and its ceremonial pole",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Justin's Feats of Strength",
    description: "A Festivus all-hands raid for the company war room.",
    images: ["/og.png"],
  },
};

// Next.js wants viewport settings exported separately from `metadata`.
// `touch-action: manipulation` prevents accidental double-tap zoom on the
// rapid game controls while still allowing intentional pinch zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070a0f",
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
