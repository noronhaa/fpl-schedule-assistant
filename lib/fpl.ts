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

/** Squad positions, keyed by the FPL `element_type` id. */
export type Position = "GKP" | "DEF" | "MID" | "FWD";

export const POSITIONS: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/**
 * Defensive Contribution points are awarded per match, once a player's DC count
 * clears this threshold. It is a cliff, not a rate: a defender who alternates 16
 * and 8 scores half as often as one who posts 11 every week, despite the same
 * average. Keepers are outside the scheme entirely and always report DC 0.
 */
export const DC_THRESHOLD: Record<Position, number | null> = {
  GKP: null,
  DEF: 10,
  MID: 12,
  FWD: 12,
};

/**
 * Per-gameweek detail merged in from data/history.json. It is absent from
 * bootstrap-static and costs one request per player to derive, so it is
 * crawled offline rather than fetched on the request path.
 */
export interface PlayerHistory {
  /** Appearances of 60+ minutes — the ones that were a fair DC opportunity. */
  apps: number;
  /** Of those appearances, how many cleared the positional DC threshold. */
  dcHits: number;
  /** DC in each qualifying appearance, oldest first. */
  dcByGw: { gw: number; dc: number }[];
  /** Previous season's DC per 90, which the current season regresses toward. */
  dcPer90Prev: number | null;
  /** Label of the season dcPer90Prev came from, e.g. "2025/26". */
  prevSeason: string | null;
}

export interface Player {
  id: number;
  name: string;
  pos: Position;
  teamId: number;
  /** Price in tenths of a million, matching the FPL API (55 = £5.5m). */
  cost: number;
  /** Season points per appearance, as FPL reports it. */
  ppg: number;
  /** FPL's own form figure: mean points over the last 30 days. */
  form: number;
  minutes: number;
  starts: number;
  /** "a" = available; anything else is injured, suspended, or unregistered. */
  status: string;
  /** Percentage, or null when FPL has no doubt recorded. */
  chanceNextRound: number | null;
  /** Total points scored this season. */
  points: number;
  goals: number;
  assists: number;
  /** Bonus Points System total — the tally that decides the 3/2/1 bonus. */
  bps: number;
  /**
   * Defensive Contribution: clearances + blocks + interceptions + tackles for
   * defenders, plus recoveries for midfielders and forwards. Always 0 for
   * keepers.
   */
  dc: number;
  /** Expected goal involvements: xG + xA. */
  xgi: number;
  /**
   * Expected goals conceded while on the pitch. This is a property of the team,
   * not the player — two clubmates playing the same minutes always tie on it.
   */
  xgc: number;
  /** Share of managers owning the player, as a percentage. */
  selectedBy: number;
  /** Progress toward the next price change, as a percentage. */
  priceChangePercent: number;
  /** Set-piece order, 1 = first choice. Null when not on duty. */
  corners: number | null;
  freeKicks: number | null;
  penalties: number | null;
  /** Null until the history crawl has run, and for players it found no rows for. */
  history: PlayerHistory | null;
}

export interface Gameweek {
  id: number;
  name: string;
  deadline: string;
  finished: boolean;
  /**
   * True once FPL has audited the gameweek. Between kickoff and this flag,
   * bonus is provisional and the whole ICT family reads 0, so anything derived
   * from an unchecked gameweek is still liable to move.
   */
  dataChecked: boolean;
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
  players: Player[];
}

interface BootstrapTeam {
  id: number;
  name: string;
  short_name: string;
  code: number;
}

interface BootstrapElement {
  id: number;
  web_name: string;
  element_type: number;
  team: number;
  now_cost: number;
  points_per_game: string;
  form: string;
  minutes: number;
  starts: number;
  status: string;
  chance_of_playing_next_round: number | null;
  total_points: number;
  goals_scored: number;
  assists: number;
  bps: number;
  defensive_contribution: number;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
  selected_by_percent: string;
  price_change_percent: string;
  corners_and_indirect_freekicks_order: number | null;
  direct_freekicks_order: number | null;
  penalties_order: number | null;
}

interface BootstrapEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  data_checked: boolean;
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

export const FPL_BASE = "https://fantasy.premierleague.com/api";

/**
 * The FPL API rejects requests without a browser-ish user agent, so every call
 * in the app shares this base.
 */
export function fplRequestInit(): RequestInit {
  return {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  };
}

/**
 * Per-90 rate for a season total. Returns null below a minutes floor, because a
 * player with 30 minutes can otherwise post a rate that outranks the league on
 * a single action.
 */
export function perNinety(total: number, minutes: number, floor = 90): number | null {
  if (minutes < floor) return null;
  return (total / minutes) * 90;
}

/** Derives a "2026/27" style label from the first gameweek's deadline. */
function seasonLabel(events: BootstrapEvent[]): string {
  const first = events[0];
  const year = first ? new Date(first.deadline_time).getUTCFullYear() : new Date().getUTCFullYear();
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

export function buildSchedule(
  bootstrap: { teams: BootstrapTeam[]; events: BootstrapEvent[]; elements: BootstrapElement[] },
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
    dataChecked: e.data_checked ?? e.finished,
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

  // bootstrap-static carries ~90 fields per player. Keep the identity and
  // availability fields the ticker needs plus the underlying stats the compare
  // view ranks on, and store raw totals rather than the API's per-90 columns so
  // every rate in the app comes from one definition (see perNinety).
  const players: Player[] = bootstrap.elements.map((e) => ({
    id: e.id,
    name: e.web_name,
    pos: POSITIONS[e.element_type] ?? "MID",
    teamId: e.team,
    cost: e.now_cost,
    ppg: Number(e.points_per_game) || 0,
    form: Number(e.form) || 0,
    minutes: e.minutes,
    starts: e.starts,
    status: e.status,
    chanceNextRound: e.chance_of_playing_next_round,
    points: e.total_points,
    goals: e.goals_scored,
    assists: e.assists,
    bps: e.bps,
    dc: e.defensive_contribution,
    xgi: Number(e.expected_goal_involvements) || 0,
    xgc: Number(e.expected_goals_conceded) || 0,
    selectedBy: Number(e.selected_by_percent) || 0,
    priceChangePercent: Number(e.price_change_percent) || 0,
    corners: e.corners_and_indirect_freekicks_order,
    freeKicks: e.direct_freekicks_order,
    penalties: e.penalties_order,
    history: null,
  }));

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
    players,
  };
}

/** Fetches both endpoints in parallel. Throws if either call fails. */
export async function fetchLiveSchedule(revalidateSeconds = 3600): Promise<Schedule> {
  const base = fplRequestInit();

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
