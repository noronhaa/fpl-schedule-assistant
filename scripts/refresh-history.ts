/**
 * Regenerates data/history.json — the per-gameweek detail behind the DC
 * hit-rate, which costs one request per player and so is never fetched on the
 * request path.
 *
 * Run with:  npm run refresh:history
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLiveSchedule } from "../lib/fpl.ts";
import { crawlHistory } from "../lib/history.ts";

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "history.json");

const schedule = await fetchLiveSchedule(0);

// Only audited gameweeks are stored. A gameweek in progress has played some
// fixtures and not others, so including it would record a hit-rate over a
// partial round for every player whose team had not kicked off yet.
const auditedGws = schedule.gameweeks.filter((g) => g.dataChecked).map((g) => g.id);

let lastLogged = 0;
const history = await crawlHistory(schedule.players, schedule.season, auditedGws, {
  onProgress: (done, total) => {
    // One line per 10% so a several-hundred-request crawl shows progress
    // without flooding the terminal.
    const step = Math.max(1, Math.floor(total / 10));
    if (done === total || done - lastLogged >= step) {
      lastLogged = done;
      process.stdout.write(`  ${done}/${total} players\n`);
    }
  },
});

await writeFile(outPath, JSON.stringify(history, null, 2) + "\n");

const rows = Object.values(history.players);
const withHits = rows.filter((r) => r.dcHits > 0).length;
const pending = schedule.currentGw > history.throughGw ? schedule.currentGw : null;
console.log(
  `Wrote ${outPath}\n  season ${history.season} · audited through GW ${history.throughGw} · ` +
    `${rows.length} players crawled · ${withHits} with at least one DC hit` +
    (pending ? `\n  GW${pending} is not audited yet and was excluded; re-run once it is.` : ""),
);
