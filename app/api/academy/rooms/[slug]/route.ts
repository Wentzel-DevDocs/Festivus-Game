import { NextResponse } from "next/server";
import { getAcademyRoom } from "@/lib/academy/catalog";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const room = getAcademyRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Academy room not found" }, { status: 404 });
  }

  return NextResponse.json(room, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
