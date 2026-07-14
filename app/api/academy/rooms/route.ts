import { NextResponse } from "next/server";
import { ACADEMY_CATALOG, getAcademyRoomSummaries } from "@/lib/academy/catalog";

export function GET() {
  return NextResponse.json(
    {
      schemaVersion: ACADEMY_CATALOG.schemaVersion,
      title: ACADEMY_CATALOG.title,
      teaserPath: ACADEMY_CATALOG.teaserPath,
      rooms: getAcademyRoomSummaries(),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
