/**
 * Regenerates data/snapshot.json — the offline fallback the app serves when the
 * live FPL API is unreachable.
 *
 * Run with:  npm run refresh
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLiveSchedule } from "../lib/fpl.ts";

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "snapshot.json");

const schedule = await fetchLiveSchedule(0);
await writeFile(outPath, JSON.stringify({ ...schedule, source: "snapshot" }, null, 2) + "\n");

console.log(
  `Wrote ${outPath}\n  season ${schedule.season} · ${schedule.teams.length} teams · ` +
    `${schedule.matches.length / 2} fixtures · next GW ${schedule.nextGw}`,
);
