import { NextResponse, type NextRequest } from "next/server";
import { EntryError, fetchFplSquad } from "@/lib/entry";

/** A manager's squad changes at every deadline, so it is never cached. */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/squad/[id]">) {
  const { id } = await ctx.params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return NextResponse.json({ error: "Team ID must be a positive number" }, { status: 400 });
  }

  try {
    const squad = await fetchFplSquad(entryId);
    return NextResponse.json(squad, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EntryError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status });
  }
}
