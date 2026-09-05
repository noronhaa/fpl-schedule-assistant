/**
 * Builds head-to-head comparison rows for a handful of players.
 *
 * The whole point of this module is the percentile. A raw "8.5 DC per 90" is
 * not a decision — it becomes one only once you know it is the 55th percentile
 * among defenders. So every rate is ranked against a pool of same-position
 * players, and the UI renders the rank rather than asking the reader to hold
 * league-wide baselines in their head.
 *
 * Percentiles are always computed within the player's own position, which is
 * what makes it valid to put a defender and a midfielder side by side.
 */

import { DC_THRESHOLD, perNinety, type Player, type Position } from "./fpl";

export interface Metric {
  key: string;
  label: string;
  /** One line explaining what the number is, shown under the label. */
  hint: string;
  /** Drives both the percentile direction and which cell is highlighted. */
  higherIsBetter: boolean;
  /**
   * True for stats that belong to the team rather than the player. Two players
   * from the same club always tie on these, so the UI greys them out instead of
   * inviting a comparison that cannot separate them.
   */
  teamLevel?: boolean;
  /** Positions the metric means anything for. Undefined means all of them. */
  positions?: Position[];
  /** Shown as a signed gap rather than ranked — direction is not "good"/"bad". */
  diverging?: boolean;
  value: (p: Player) => number | null;
  format: (v: number) => string;
}

const OUTFIELD: Position[] = ["DEF", "MID", "FWD"];

export const METRICS: Metric[] = [
  {
    key: "dcHitRate",
    label: "DC hit-rate",
    hint: "Share of 60+ minute appearances that cleared the DC threshold",
    higherIsBetter: true,
    positions: OUTFIELD,
    value: (p) => (p.history && p.history.apps > 0 ? p.history.dcHits / p.history.apps : null),
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "dcPer90",
    label: "DC per 90",
    hint: "Season average — an average can clear the threshold while the player rarely does",
    higherIsBetter: true,
    positions: OUTFIELD,
    value: (p) => perNinety(p.dc, p.minutes),
    format: (v) => v.toFixed(1),
  },
  {
    key: "dcPer90Prev",
    label: "DC per 90, last season",
    hint: "What this season's rate is likely to regress toward",
    higherIsBetter: true,
    positions: OUTFIELD,
    value: (p) => p.history?.dcPer90Prev ?? null,
    format: (v) => v.toFixed(1),
  },
  {
    key: "xgiPer90",
    label: "xGI per 90",
    hint: "Expected goals plus expected assists — the attacking return the chances deserved",
    higherIsBetter: true,
    value: (p) => perNinety(p.xgi, p.minutes),
    format: (v) => v.toFixed(2),
  },
  {
    key: "gaVsXgi",
    label: "Output vs expected",
    hint: "Goals and assists minus xGI. Well above zero is luck that tends not to repeat",
    higherIsBetter: true,
    diverging: true,
    value: (p) => (p.minutes > 0 ? p.goals + p.assists - p.xgi : null),
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`,
  },
  {
    key: "bpsPer90",
    label: "BPS per 90",
    hint: "Bonus Points System rate — what actually decides the 3/2/1 bonus",
    higherIsBetter: true,
    value: (p) => perNinety(p.bps, p.minutes),
    format: (v) => v.toFixed(1),
  },
  {
    key: "xgcPer90",
    label: "xGC per 90",
    hint: "Expected goals conceded while on the pitch — a team stat, not a player one",
    higherIsBetter: false,
    teamLevel: true,
    value: (p) => perNinety(p.xgc, p.minutes),
    format: (v) => v.toFixed(2),
  },
  {
    key: "ppg",
    label: "Points per game",
    hint: "Points divided by appearances — an outcome, so the noisiest row here",
    higherIsBetter: true,
    value: (p) => (p.minutes > 0 ? p.ppg : null),
    format: (v) => v.toFixed(1),
  },
  {
    key: "minutesPerStart",
    label: "Minutes per start",
    hint: "How close to nailed the player is when picked",
    higherIsBetter: true,
    value: (p) => (p.starts > 0 ? p.minutes / p.starts : null),
    format: (v) => Math.round(v).toString(),
  },
];

export interface CompareCell {
  raw: number | null;
  text: string;
  /** 0-100 within the player's own position. Null when unranked or unavailable. */
  percentile: number | null;
  /** Pool size the percentile was computed against, for honesty about sample. */
  poolSize: number;
}

export interface CompareRow {
  metric: Metric;
  cells: CompareCell[];
  /** Indices of the leading cell(s). Empty for diverging or fully tied rows. */
  best: number[];
  /** Team-level metric where every compared player shares a club. */
  tiedByTeam: boolean;
}

/**
 * Mid-rank percentile, so a cluster of identical values shares a rank rather
 * than all reading 100.
 */
export function percentileRank(pool: number[], v: number, higherIsBetter: boolean): number | null {
  if (pool.length < 2) return null;
  let below = 0;
  let equal = 0;
  for (const x of pool) {
    if (x === v) equal++;
    else if (higherIsBetter ? x < v : x > v) below++;
  }
  return ((below + equal / 2) / pool.length) * 100;
}

/**
 * Minutes a player needs before entering the ranking pool: half of every minute
 * available so far. It scales with the season, so an early-season pool is not
 * diluted by cameos and a late-season one still excludes bit-part players.
 */
export function poolMinMinutes(completedGws: number): number {
  return Math.max(90, 45 * completedGws);
}

export interface CompareOptions {
  /** Completed gameweeks, used to size the ranking pool. */
  completedGws: number;
}

export function compare(
  selected: Player[],
  allPlayers: Player[],
  { completedGws }: CompareOptions,
): CompareRow[] {
  const floor = poolMinMinutes(completedGws);
  const eligible = allPlayers.filter((p) => p.minutes >= floor);

  // One pool per position, built once and reused across every metric.
  const byPosition = new Map<Position, Player[]>();
  for (const p of eligible) {
    const list = byPosition.get(p.pos);
    if (list) list.push(p);
    else byPosition.set(p.pos, [p]);
  }

  const sameTeam =
    selected.length > 1 && selected.every((p) => p.teamId === selected[0].teamId);

  const rows: CompareRow[] = [];

  for (const metric of METRICS) {
    // Drop rows that mean nothing for every player on screen, e.g. DC for a
    // pair of keepers.
    const applies = selected.some((p) => !metric.positions || metric.positions.includes(p.pos));
    if (!applies) continue;

    const cells: CompareCell[] = selected.map((p) => {
      const relevant = !metric.positions || metric.positions.includes(p.pos);
      const raw = relevant ? metric.value(p) : null;
      if (raw == null) return { raw: null, text: "—", percentile: null, poolSize: 0 };

      const pool = (byPosition.get(p.pos) ?? [])
        .map(metric.value)
        .filter((v): v is number => v != null);

      return {
        raw,
        text: metric.format(raw),
        percentile: metric.diverging ? null : percentileRank(pool, raw, metric.higherIsBetter),
        poolSize: pool.length,
      };
    });

    const values = cells.map((c) => c.raw).filter((v): v is number => v != null);
    let best: number[] = [];
    if (!metric.diverging && values.length > 1) {
      const target = metric.higherIsBetter ? Math.max(...values) : Math.min(...values);
      // A row where everyone ties has no winner worth highlighting.
      if (values.some((v) => v !== target)) {
        best = cells.flatMap((c, i) => (c.raw === target ? [i] : []));
      }
    }

    rows.push({ metric, cells, best, tiedByTeam: sameTeam && metric.teamLevel === true });
  }

  return rows;
}

/** Set-piece duties as a short label, e.g. "Corners, free kicks". */
export function setPieceLabel(p: Player): string {
  const duties: string[] = [];
  if (p.corners != null) duties.push(p.corners === 1 ? "corners" : `corners (#${p.corners})`);
  if (p.freeKicks != null) duties.push(p.freeKicks === 1 ? "free kicks" : `free kicks (#${p.freeKicks})`);
  if (p.penalties != null) duties.push(p.penalties === 1 ? "penalties" : `penalties (#${p.penalties})`);
  if (duties.length === 0) return "None";
  return duties.join(", ").replace(/^./, (c) => c.toUpperCase());
}

export { DC_THRESHOLD };
