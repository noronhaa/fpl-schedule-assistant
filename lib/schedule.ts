import snapshot from "@/data/snapshot.json";
import history from "@/data/history.json";
import { fetchLiveSchedule, type Schedule } from "./fpl";
import { mergeHistory, type HistoryFile } from "./history";

export interface LoadedSchedule extends Schedule {
  /** Set when the live API failed and the bundled snapshot was served instead. */
  warning?: string;
  /**
   * Last gameweek the committed history covers. Lower than `currentGw` means
   * `npm run refresh:history` has not been run since the latest results.
   */
  historyThroughGw: number;
}

const historyFile = history as unknown as HistoryFile;

/**
 * Live FPL data, falling back to the committed snapshot if the API is
 * unreachable (rate limited, offline, or down during a gameweek rollover).
 *
 * Per-gameweek history is always read from disk rather than the API. It costs
 * one request per player to derive and only changes when a gameweek is audited,
 * so crawling it per request would be both slow and pointless.
 */
export async function getSchedule(revalidateSeconds = 3600): Promise<LoadedSchedule> {
  try {
    const live = await fetchLiveSchedule(revalidateSeconds);
    return {
      ...live,
      players: mergeHistory(live.players, historyFile),
      historyThroughGw: historyFile.throughGw,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const fallback = snapshot as unknown as Schedule;
    return {
      ...fallback,
      players: mergeHistory(fallback.players, historyFile),
      historyThroughGw: historyFile.throughGw,
      source: "snapshot",
      warning: `Live FPL API unavailable (${reason}) — showing the bundled snapshot from ${new Date(
        fallback.generatedAt,
      ).toUTCString()}.`,
    };
  }
}
