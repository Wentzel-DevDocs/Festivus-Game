import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AcademyMissionPlayer from "@/components/academy/AcademyMissionPlayer";
import { ACADEMY_CATALOG, getAcademyRoom } from "@/lib/academy/catalog";

export function generateStaticParams() {
  return ACADEMY_CATALOG.rooms.map((room) => ({ track: room.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ track: string }>;
}): Promise<Metadata> {
  const { track } = await params;
  const room = getAcademyRoom(track);
  if (!room) return {};
  return {
    title: `${room.title} | Developer Academy`,
    description: room.subtitle,
  };
}

export default async function AcademyTrackPage({
  params,
}: {
  params: Promise<{ track: string }>;
}) {
  const { track } = await params;
  const room = getAcademyRoom(track);
  if (!room) notFound();

  return (
    <main className="academy-room-shell safe-viewport mx-auto min-h-dvh w-full max-w-[1920px] px-3 py-4 md:px-6 md:py-6">
      <header className="academy-room-header mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/academy"
            className="inline-flex min-h-11 items-center rounded-lg border border-aluminum-600 px-4 text-sm text-aluminum-300 hover:border-grease hover:text-grease"
          >
            ← Academy map
          </Link>
          <div>
            <p className="eyebrow">Room {String(room.order).padStart(2, "0")}</p>
            <h1 className="display-header mt-1 text-xl text-aluminum-100 md:text-3xl">
              {room.title}
            </h1>
          </div>
        </div>
        <span
          className="hud-chip"
          style={{ borderColor: room.accent, color: room.accent }}
        >
          {room.shortTitle}
        </span>
      </header>

      {room.status === "playable" ? (
        <AcademyMissionPlayer room={room} />
      ) : (
        <section
          className="academy-preview forge-panel mx-auto max-w-6xl p-5 md:p-10"
          style={{ "--room-accent": room.accent } as React.CSSProperties}
        >
          <p className="eyebrow">Room systems charging</p>
          <h2 className="display-header mt-3 text-3xl md:text-6xl">{room.title}</h2>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-aluminum-300">{room.subtitle}</p>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-aluminum-700 bg-aluminum-950/65 p-5">
              <h3 className="display-header text-lg text-[var(--room-accent)]">Mission sequence</h3>
              <ol className="mt-4 space-y-3">
                {room.plannedModules.map((module, index) => (
                  <li key={module} className="flex gap-3 text-aluminum-300">
                    <span className="font-mono text-[var(--room-accent)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{module}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl border border-aluminum-700 bg-aluminum-950/65 p-5">
              <h3 className="display-header text-lg text-[var(--room-accent)]">Graduation outcomes</h3>
              <ul className="mt-4 space-y-3">
                {room.learningOutcomes.map((outcome) => (
                  <li key={outcome} className="flex gap-3 text-aluminum-300">
                    <span className="text-[var(--room-accent)]" aria-hidden="true">◆</span>
                    <span>{outcome}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-aluminum-700 pt-5 text-sm leading-6 text-aluminum-500">
                Native app packaging remains intentionally deferred. This syllabus
                is sequenced now so content can be authored against the same mission contract.
              </p>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
