"use client";

/** Public assignment card used only by the Tug-of-War team event. */
export default function TeamAssignment({ team }: { team: 0 | 1 | null }) {
  const teamName = team === 0 ? "TEAM A" : team === 1 ? "TEAM B" : null;

  return (
    <div
      className={`action-plate display-header border px-4 py-4 text-center text-xl ${
        team === 0
          ? "border-support/70 text-support"
          : team === 1
            ? "border-grease/70 text-grease"
            : "border-aluminum-600 text-aluminum-300"
      }`}
      role="status"
    >
      {teamName ? `You're on ${teamName} — PULL!` : "Teams are being assigned…"}
    </div>
  );
}
