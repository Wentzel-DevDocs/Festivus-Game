import Link from "next/link";
import { getAcademyRoomSummaries } from "@/lib/academy/catalog";

export const metadata = {
  title: "Developer Academy | Justin's Feats of Strength",
  description:
    "A cinematic, room-based coding academy for Next.js, React, Node, SwiftUI, Android, and Expo.",
};

export default function AcademyPage() {
  const rooms = getAcademyRoomSummaries();

  return (
    <main className="academy-hub safe-viewport mx-auto min-h-dvh w-full max-w-[1920px] px-4 py-6 md:px-8 md:py-10">
      <header className="academy-hero forge-panel relative overflow-hidden p-5 md:p-10">
        <div className="academy-grid-glow" aria-hidden="true" />
        <div className="relative z-10 max-w-5xl">
          <p className="eyebrow">The feats were only the entrance exam</p>
          <h1 className="display-header mt-3 text-4xl leading-none text-aluminum-100 md:text-7xl">
            Justin&apos;s
            <span className="block text-support">Developer Academy</span>
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-aluminum-300 md:text-xl md:leading-8">
            Walk through a cinematic software company, repair failing systems,
            and learn the engineering decisions behind a production SaaS game.
            Every technology is its own room. Every lesson is a mission.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/academy/nextjs-react-node"
              className="display-header inline-flex min-h-12 items-center rounded-lg bg-support px-5 text-sm text-aluminum-950 transition-transform hover:-translate-y-0.5"
            >
              Enter the first room
            </Link>
            <Link
              href="/"
              className="display-header aluminum-panel inline-flex min-h-12 items-center px-5 text-sm text-grease"
            >
              Play the cinematic teaser
            </Link>
          </div>
        </div>
      </header>

      <section className="mt-8" aria-labelledby="academy-room-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Curriculum map</p>
            <h2 id="academy-room-heading" className="display-header mt-2 text-3xl md:text-5xl">
              Technology rooms
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-aluminum-400">
            Finish the web foundation first, then carry the same architecture
            and product thinking into Apple, Android, and cross-platform rooms.
          </p>
        </div>

        <div className="academy-room-grid mt-5">
          {rooms.map((room) => (
            <article
              key={room.slug}
              className="academy-room-card forge-panel"
              style={{ "--room-accent": room.accent } as React.CSSProperties}
            >
              <div className="academy-room-beacon" aria-hidden="true" />
              <div className="relative z-10 flex h-full flex-col p-5 md:p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs uppercase tracking-[0.18em] text-aluminum-400">
                    Room {String(room.order).padStart(2, "0")}
                  </span>
                  <span className={`academy-status ${room.status}`}>
                    {room.status === "playable" ? "Open" : "Sequenced"}
                  </span>
                </div>
                <h3 className="display-header mt-6 text-2xl text-aluminum-100 md:text-3xl">
                  {room.title}
                </h3>
                <p className="mt-1 font-mono text-xs uppercase tracking-widest text-[var(--room-accent)]">
                  {room.shortTitle}
                </p>
                <p className="mt-4 text-sm leading-6 text-aluminum-300">{room.subtitle}</p>

                <ul className="mt-5 space-y-2 text-sm text-aluminum-400">
                  {room.plannedModules.slice(0, 4).map((module) => (
                    <li key={module} className="flex gap-2">
                      <span className="text-[var(--room-accent)]" aria-hidden="true">◆</span>
                      <span>{module}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-6">
                  <div className="mb-3 flex justify-between font-mono text-xs text-aluminum-500">
                    <span>{room.missionCount || room.plannedModules.length} missions</span>
                    <span>~{room.estimatedMinutes} min</span>
                  </div>
                  <Link
                    href={`/academy/${room.slug}`}
                    className="display-header flex min-h-12 w-full items-center justify-center rounded-lg border border-[var(--room-accent)] bg-aluminum-950/60 px-4 text-sm text-[var(--room-accent)] hover:bg-aluminum-950"
                  >
                    {room.status === "playable" ? "Enter room" : "Inspect syllabus"}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
