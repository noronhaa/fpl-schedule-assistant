/**
 * Builds the per-gameweek detail that bootstrap-static does not carry.
 *
 * The metric this exists for is the Defensive Contribution hit-rate: how often a
 * player actually cleared their positional DC threshold, rather than what their
 * season average implies. DC points are a per-match cliff, so an average hides
 * the thing you want to know — 12 DC per 90 earns nothing if it arrives as 16
 * one week and 8 the next.
 *
 * Deriving it costs one /element-summary/ request per player, so it is crawled
 * offline by `npm run refresh:history` and committed to data/history.json,
 * never fetched on the request path.
 *
 * Only gameweeks FPL has audited are stored. A gameweek in progress has played
 * some fixtures and not others, so crawling it would record a hit-rate over a
 * partial round and silently understate every player whose team had not kicked
 * off yet — and, because bonus and the ICT family are provisional until the
 * audit, the numbers can still move afterwards.
 */

import { DC_THRESHOLD, FPL_BASE, fplRequestInit, type Player, type PlayerHistory } from "./fpl.ts";

/** Minutes in an appearance before it counts as a fair DC opportunity. */
const DC_APPEARANCE_MINUTES = 60;

/** Minutes a previous season needs before its DC rate is worth reporting. */
const PREV_SEASON_MINUTES = 450;

export interface HistoryFile {
  generatedAt: string;
  season: string;
  /**
   * Last audited gameweek included. Rows from later, unaudited gameweeks are
   * dropped, so this is a promise about coverage rather than the highest round
   * the API happened to return.
   */
  throughGw: number;
  /** Keyed by player id, as a string because it round-trips through JSON. */
  players: Record<string, PlayerHistory>;
}

interface RawHistoryRow {
  round: number;
  minutes: number;
  defensive_contribution: number;
}

interface RawPastSeason {
  season_name: string;
  minutes: number;
  defensive_contribution: number;
}

interface RawElementSummary {
  history: RawHistoryRow[];
  history_past: RawPastSeason[];
}

/**
 * Reduces one player's raw element-summary into the fields the app stores,
 * keeping only rows from gameweeks in `audited`.
 */
export function summarise(
  summary: RawElementSummary,
  threshold: number | null,
  audited: ReadonlySet<number>,
): PlayerHistory {
  const appearances = (summary.history ?? []).filter(
    (h) => audited.has(h.round) && h.minutes >= DC_APPEARANCE_MINUTES,
  );

  const dcByGw = appearances.map((h) => ({ gw: h.round, dc: h.defensive_contribution }));
  // Keepers have no threshold; their DC always reads 0, so a hit-rate would be a
  // meaningless zero rather than an absent value.
  const dcHits =
    threshold == null ? 0 : appearances.filter((h) => h.defensive_contribution >= threshold).length;

  const past = (summary.history_past ?? []).filter((s) => s.minutes >= PREV_SEASON_MINUTES);
  const prev = past.length > 0 ? past[past.length - 1] : null;

  return {
    apps: appearances.length,
    dcHits,
    dcByGw,
    dcPer90Prev:
      prev && threshold != null ? (prev.defensive_contribution / prev.minutes) * 90 : null,
    prevSeason: prev && threshold != null ? prev.season_name : null,
  };
}

async function fetchSummary(id: number, attempts = 3): Promise<RawElementSummary> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${FPL_BASE}/element-summary/${id}/`, {
        ...fplRequestInit(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`element-summary/${id} returned ${res.status}`);
      return (await res.json()) as RawElementSummary;
    } catch (error) {
      lastError = error;
      // Back off before retrying; the API rate-limits a fast serial crawl.
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface CrawlOptions {
  /** Parallel in-flight requests. Kept low so the API does not rate-limit. */
  concurrency?: number;
  /** Players below this many minutes are skipped — they have nothing to crawl. */
  minMinutes?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Crawls element-summary for every player worth having history on.
 *
 * Individual failures are swallowed rather than aborting the run: a partial
 * history file is more useful than none, and a missing player simply renders
 * without a hit-rate.
 */
export async function crawlHistory(
  players: Player[],
  season: string,
  auditedGws: number[],
  options: CrawlOptions = {},
): Promise<HistoryFile> {
  const { concurrency = 6, minMinutes = 1, onProgress } = options;
  const targets = players.filter((p) => p.minutes >= minMinutes);
  const audited = new Set(auditedGws);

  const out: Record<string, PlayerHistory> = {};
  const throughGw = auditedGws.length > 0 ? Math.max(...auditedGws) : 0;
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const player = targets[cursor++];
      try {
        const summary = await fetchSummary(player.id);
        out[String(player.id)] = summarise(summary, DC_THRESHOLD[player.pos], audited);
      } catch {
        // Leave the player absent; the UI treats that as "no history".
      }
      onProgress?.(++done, targets.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  return { generatedAt: new Date().toISOString(), season, throughGw, players: out };
}

/** Attaches crawled history to players, leaving `null` where the crawl has no row. */
export function mergeHistory(players: Player[], file: HistoryFile | null): Player[] {
  if (!file) return players;
  return players.map((p) => ({ ...p, history: file.players[String(p.id)] ?? null }));
}
