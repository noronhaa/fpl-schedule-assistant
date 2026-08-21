import snapshot from "@/data/snapshot.json";
import { fetchLiveSchedule, type Schedule } from "./fpl";

export interface LoadedSchedule extends Schedule {
  /** Set when the live API failed and the bundled snapshot was served instead. */
  warning?: string;
}

/**
 * Live FPL data, falling back to the committed snapshot if the API is
 * unreachable (rate limited, offline, or down during a gameweek rollover).
 */
export async function getSchedule(revalidateSeconds = 3600): Promise<LoadedSchedule> {
  try {
    return await fetchLiveSchedule(revalidateSeconds);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const fallback = snapshot as unknown as Schedule;
    return {
      ...fallback,
      source: "snapshot",
      warning: `Live FPL API unavailable (${reason}) — showing the bundled snapshot from ${new Date(
        fallback.generatedAt,
      ).toUTCString()}.`,
    };
  }
}
