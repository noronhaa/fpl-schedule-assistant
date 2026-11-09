/**
 * Reads a manager's squad from the public FPL API. Server-only: the FPL API
 * sends no CORS headers, so the browser cannot call it directly.
 *
 *   /api/entry/{id}/                    -> team name + latest gameweek played
 *   /api/entry/{id}/event/{gw}/picks/   -> the 15 picks for that gameweek
 *
 * Picks reflect the last deadline that has passed. Transfers made since then
 * are invisible until the next deadline, which is why the squad view lets the
 * user edit the squad after loading it.
 */

import { FPL_BASE, POSITIONS, fplRequestInit } from "./fpl";
import type { FplSquad } from "./squad";

interface RawEntry {
  id: number;
  name: string;
  /** Null for an entry created after the latest deadline: it has no picks yet. */
  current_event: number | null;
}

interface RawPicks {
  entry_history: { bank: number };
  picks: { element: number; position: number; is_captain: boolean; element_type: number }[];
}

export class EntryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchFplSquad(entryId: number): Promise<FplSquad> {
  const init = { ...fplRequestInit(), cache: "no-store" as RequestCache };

  const entryRes = await fetch(`${FPL_BASE}/entry/${entryId}/`, init);
  if (entryRes.status === 404) throw new EntryError(`No FPL team with ID ${entryId}`, 404);
  if (!entryRes.ok) throw new EntryError(`FPL entry lookup returned ${entryRes.status}`, 502);
  const entry: RawEntry = await entryRes.json();
  if (entry.current_event == null) {
    throw new EntryError(`${entry.name} has not played a gameweek yet, so FPL has no picks to show`, 404);
  }

  const picksRes = await fetch(`${FPL_BASE}/entry/${entryId}/event/${entry.current_event}/picks/`, init);
  if (!picksRes.ok) throw new EntryError(`FPL picks lookup returned ${picksRes.status}`, 502);
  const raw: RawPicks = await picksRes.json();

  return {
    entryId,
    teamName: entry.name,
    gw: entry.current_event,
    bank: raw.entry_history.bank,
    picks: [...raw.picks]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        playerId: p.element,
        pos: POSITIONS[p.element_type] ?? "MID",
        captain: p.is_captain,
      })),
  };
}
