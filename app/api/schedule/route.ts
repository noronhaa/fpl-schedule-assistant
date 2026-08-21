import { NextResponse } from "next/server";
import { getSchedule } from "@/lib/schedule";

/** Bypasses the page-level cache so the in-app refresh button gets fresh data. */
export const dynamic = "force-dynamic";

export async function GET() {
  const schedule = await getSchedule(0);
  return NextResponse.json(schedule, {
    headers: { "Cache-Control": "no-store" },
  });
}
