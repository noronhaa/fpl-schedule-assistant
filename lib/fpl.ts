/**
 * Fetches and normalises Premier League fixture data from the public FPL API.
 *
 * Two endpoints are used:
 *   /api/bootstrap-static/  -> teams + gameweek (event) metadata
 *   /api/fixtures/          -> all 380 fixtures with per-side difficulty ratings
 *
 * The API is the same one the official FPL fixture ticker uses, so the
 * difficulty ratings here are the official FDR values (1 = easiest, 5 = hardest).
 */

export interface Team {
  id: number;
  name: string;
  short: string;
  /** Team code used by the FPL CDN for crest images. */
  code: number;
}

export interface Match {
  gw: number;
  teamId: number;
  oppId: number;
  home: boolean;
  /** Official FPL fixture difficulty rating, 1-5. */
  fdr: number;
  kickoff: string | null;
  finished: boolean;
}

export interface Gameweek {
  id: number;
  name: string;
  deadline: string;
  finished: boolean;
}

export interface Schedule {
  season: string;
  generatedAt: string;
  source: "live" | "snapshot";
  /** Gameweek currently in progress, or the most recently finished one. */
  currentGw: number;
  /** Next gameweek with an open deadline — the natural place to start planning. */
  nextGw: number;
  teams: Team[];
  gameweeks: Gameweek[];
  matches: Match[];
}

interface BootstrapTeam {
  id: number;
  name: string;
  short_name: string;
  code: number;
}

interface BootstrapEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

interface RawFixture {
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  kickoff_time: string | null;
  finished: boolean;
}

const FPL_BASE = "https://fantasy.premierleague.com/api";

/** Derives a "2026/27" style label from the first gameweek's deadline. */
function seasonLabel(events: BootstrapEvent[]): string {
  const first = events[0];
  const year = first ? new Date(first.deadline_time).getUTCFullYear() : new Date().getUTCFullYear();
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

export function buildSchedule(
  bootstrap: { teams: BootstrapTeam[]; events: BootstrapEvent[] },
  fixtures: RawFixture[],
  source: Schedule["source"],
): Schedule {
  const teams: Team[] = bootstrap.teams
    .map((t) => ({ id: t.id, name: t.name, short: t.short_name, code: t.code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const gameweeks: Gameweek[] = bootstrap.events.map((e) => ({
    id: e.id,
    name: e.name,
    deadline: e.deadline_time,
    finished: e.finished,
  }));

  // Each fixture becomes two rows, one from each team's point of view.
  const matches: Match[] = [];
  for (const f of fixtures) {
    if (f.event == null) continue; // unscheduled (postponed, awaiting a rearranged date)
    matches.push({
      gw: f.event,
      teamId: f.team_h,
      oppId: f.team_a,
      home: true,
      fdr: f.team_h_difficulty,
      kickoff: f.kickoff_time,
      finished: f.finished,
    });
    matches.push({
      gw: f.event,
      teamId: f.team_a,
      oppId: f.team_h,
      home: false,
      fdr: f.team_a_difficulty,
      kickoff: f.kickoff_time,
      finished: f.finished,
    });
  }

  const current = bootstrap.events.find((e) => e.is_current);
  const next = bootstrap.events.find((e) => e.is_next);
  const lastFinished = [...bootstrap.events].reverse().find((e) => e.finished);

  const nextGw = next?.id ?? current?.id ?? (lastFinished ? lastFinished.id : 1);

  return {
    season: seasonLabel(bootstrap.events),
    generatedAt: new Date().toISOString(),
    source,
    currentGw: current?.id ?? lastFinished?.id ?? 0,
    nextGw,
    teams,
    gameweeks,
    matches,
  };
}

/** Fetches both endpoints in parallel. Throws if either call fails. */
export async function fetchLiveSchedule(revalidateSeconds = 3600): Promise<Schedule> {
  const base: RequestInit = {
    headers: {
      // The FPL API rejects requests without a browser-ish user agent.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  };

  const [bootstrapRes, fixturesRes] = await Promise.all([
    // bootstrap-static is ~2MB (it carries every player), which is over Next's
    // data-cache entry limit, so it is fetched fresh and the page's own ISR
    // window does the caching instead.
    fetch(`${FPL_BASE}/bootstrap-static/`, { ...base, cache: "no-store" }),
    fetch(`${FPL_BASE}/fixtures/`, {
      ...base,
      ...(revalidateSeconds > 0
        ? { next: { revalidate: revalidateSeconds } }
        : { cache: "no-store" as RequestCache }),
    }),
  ]);

  if (!bootstrapRes.ok) throw new Error(`bootstrap-static returned ${bootstrapRes.status}`);
  if (!fixturesRes.ok) throw new Error(`fixtures returned ${fixturesRes.status}`);

  const [bootstrap, fixtures] = await Promise.all([bootstrapRes.json(), fixturesRes.json()]);
  return buildSchedule(bootstrap, fixtures, "live");
}
