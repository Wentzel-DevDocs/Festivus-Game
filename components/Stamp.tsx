"use client";

/**
 * Stamp — the crooked red "MANDATORY ATTENDANCE" rubber stamp.
 *
 * All the styling lives in the .stamp class in globals.css; this wrapper
 * exists only so pages read nicely: <Stamp>DOUBLE POINTS</Stamp> instead of
 * a bare span with a magic class name.
 */

import type React from "react";

interface StampProps {
  children: React.ReactNode;
}

export default function Stamp({ children }: StampProps) {
  return <span className="stamp">{children}</span>;
}
