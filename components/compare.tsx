"use client";

import { useMemo, useRef, useState } from "react";
import { DC_THRESHOLD, type Match, type Player, type Team } from "@/lib/fpl";
import { compare, poolMinMinutes, setPieceLabel } from "@/lib/compare";
import { crestUrl, fdrGradient } from "@/lib/difficulty";
import FixtureChip from "./fixture-chip";

const MAX_SELECTED = 4;

/** How many gameweeks of upcoming fixtures to show under each player. */
const FIXTURE_WEEKS = 5;

/**
 * Chart colours, chosen per the data-viz method and validated against both app
 * surfaces (#ffffff / #0a0a0a).
 *
 * METER is a sequential blue: the percentile bar encodes magnitude by width, so
 * one hue is correct — a ramp would imply a good/bad reading the row does not
 * always carry. HIT/MISS is a status pair, deliberately green against a neutral
 * grey rather than green/red, because falling short of the threshold is "no
 * points", not an error. That pair sits in the CVD warn band, so colour never
 * carries it alone: every cell prints its DC value and the threshold is stated
 * in the legend.
 */
const METER = { light: "#2a78d6", dark: "#3987e5" };
const HIT = "#0ca30c";

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

export default function Compare({
  players,
  teams,
  matches,
  nextGw,
  currentGw,
  historyThroughGw,
}: {
  players: Player[];
  teams: Team[];
  matches: Match[];
  nextGw: number;
  currentGw: number;
  historyThroughGw: number;
}) {
  const [ids, setIds] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const windowGws = useMemo(
    () => Array.from({ length: FIXTURE_WEEKS }, (_, i) => nextGw + i),
    [nextGw],
  );

  // teamId -> gw -> matches, so a double gameweek lands as a 2-element array and
  // a blank as an absent key, exactly like the ticker.
  const fixtureIndex = useMemo(() => {
    const map = new Map<number, Map<number, Match[]>>();
    for (const m of matches) {
      if (m.gw < nextGw || m.gw >= nextGw + FIXTURE_WEEKS) continue;
      let byGw = map.get(m.teamId);
      if (!byGw) map.set(m.teamId, (byGw = new Map()));
      const list = byGw.get(m.gw);
      if (list) list.push(m);
      else byGw.set(m.gw, [m]);
    }
    return map;
  }, [matches, nextGw]);

  const selected = useMemo(
    () => ids.map((id) => players.find((p) => p.id === id)).filter((p): p is Player => !!p),
    [ids, players],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return players
      .filter((p) => p.name.toLowerCase().includes(q) && !ids.includes(p.id))
      .sort((a, b) => b.points - a.points)
      .slice(0, 8);
  }, [query, players, ids]);

  const rows = useMemo(
    () => (selected.length > 0 ? compare(selected, players, { completedGws: currentGw }) : []),
    [selected, players, currentGw],
  );

  const add = (id: number) => {
    if (ids.length >= MAX_SELECTED) return;
    setIds([...ids, id]);
    setQuery("");
    // Selecting from the result list unmounts it, which drops focus to the
    // document. Put it back so a second player can be typed straight away.
    searchRef.current?.focus();
  };

  const stale = historyThroughGw < currentGw;

  return (
    <div className="mt-6">
      <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <label htmlFor="compare-search" className="text-sm font-semibold">
          Add a player {selected.length > 0 && `(${selected.length}/${MAX_SELECTED})`}
        </label>
        <input
          id="compare-search"
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name — e.g. Hall"
          disabled={ids.length >= MAX_SELECTED}
          className="mt-2 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-black/35 focus:border-black/40 disabled:opacity-40 dark:border-white/15 dark:placeholder:text-white/35 dark:focus:border-white/40"
        />

        {searchResults.length > 0 && (
          <ul className="mt-2 divide-y divide-black/5 overflow-hidden rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {searchResults.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => add(p.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Crest team={teamsById.get(p.teamId)} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-black/45 dark:text-white/45">
                    {p.pos} · {money(p.cost)} · {p.points} pts
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.map((p) => (
              <button
                key={p.id}
                onClick={() => setIds(ids.filter((id) => id !== p.id))}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/15 px-3 py-1 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                {p.name}
                <span aria-hidden className="text-black/40 dark:text-white/40">
                  ×
                </span>
                <span className="sr-only">Remove {p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-black/15 px-4 py-10 text-center text-sm text-black/50 dark:border-white/15 dark:text-white/50">
          Search for two or more players to rank them against others in their position.
        </p>
      ) : (
        <>
          <ProfileCards
            selected={selected}
            teamsById={teamsById}
            fixtureIndex={fixtureIndex}
            windowGws={windowGws}
          />
          <MetricTable rows={rows} selected={selected} />
          <DcStrip selected={selected} />
          <p className="mt-4 text-xs leading-relaxed text-black/50 dark:text-white/50">
            Percentiles rank each player against others in <strong>their own position</strong> with
            at least {poolMinMinutes(currentGw)} minutes, so a defender and a midfielder can sit
            side by side. Rows greyed as <em>same club</em> are team-level stats that cannot
            separate clubmates.
            {stale && (
              <>
                {" "}
                Defensive Contribution history covers gameweeks up to GW{historyThroughGw} — run{" "}
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">
                  npm run refresh:history
                </code>{" "}
                to include GW{currentGw}.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function Crest({ team }: { team?: Team }) {
  if (!team) return null;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={crestUrl(team.code)} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
  );
}

function ProfileCards({
  selected,
  teamsById,
  fixtureIndex,
  windowGws,
}: {
  selected: Player[];
  teamsById: Map<number, Team>;
  fixtureIndex: Map<number, Map<number, Match[]>>;
  windowGws: number[];
}) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {selected.map((p) => {
        const team = teamsById.get(p.teamId);
        return (
          <div key={p.id} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Crest team={team} />
              <span className="font-semibold">{p.name}</span>
            </div>
            <div className="mt-1 text-xs text-black/50 dark:text-white/50">
              {team?.short} · {p.pos} · {money(p.cost)}
            </div>
            <dl className="mt-3 space-y-1 text-xs">
              <Fact label="Points" value={`${p.points} (${p.goals}G ${p.assists}A)`} />
              <Fact label="Minutes" value={`${p.minutes} in ${p.starts} starts`} />
              <Fact label="Owned by" value={`${p.selectedBy}%`} />
              <Fact label="Set pieces" value={setPieceLabel(p)} />
            </dl>
            <FixtureStrip
              byGw={fixtureIndex.get(p.teamId)}
              windowGws={windowGws}
              teamsById={teamsById}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The player's team's next few gameweeks, coloured by FDR.
 *
 * Keyed on gameweeks rather than a flat count of fixtures so blanks and doubles
 * stay visible — a player with a blank in the window is a very different
 * proposition from one with five games, and a flat "next 5 fixtures" list would
 * hide that by silently borrowing a fixture from further out.
 */
function FixtureStrip({
  byGw,
  windowGws,
  teamsById,
}: {
  byGw?: Map<number, Match[]>;
  windowGws: number[];
  teamsById: Map<number, Team>;
}) {
  const all = windowGws.flatMap((gw) => byGw?.get(gw) ?? []);
  const avg = all.length > 0 ? all.reduce((s, m) => s + m.fdr, 0) / all.length : null;
  const avgStyle = avg == null ? null : fdrGradient(avg);

  return (
    <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-black/50 dark:text-white/50">
          Next {windowGws.length} GWs
        </span>
        {avgStyle && avg != null && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ backgroundColor: avgStyle.bg, color: avgStyle.fg }}
            title={`Mean difficulty across ${all.length} ${all.length === 1 ? "fixture" : "fixtures"}`}
          >
            avg {avg.toFixed(2)}
          </span>
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1">
        {windowGws.map((gw) => {
          const ms = byGw?.get(gw) ?? [];
          return (
            <div key={gw}>
              <div className="mb-0.5 text-center text-[8px] font-medium text-black/35 dark:text-white/35">
                {gw}
              </div>
              {ms.length === 0 ? (
                <div
                  title={`GW${gw}: no fixture`}
                  className="rounded-md border border-dashed border-black/15 px-0.5 py-1.5 text-center text-[8px] font-semibold uppercase text-black/30 dark:border-white/15 dark:text-white/30"
                >
                  Blank
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {ms.map((m, j) => (
                    <FixtureChip key={j} match={m} opponent={teamsById.get(m.oppId)} compact />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-black/50 dark:text-white/50">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function MetricTable({
  rows,
  selected,
}: {
  rows: ReturnType<typeof compare>;
  selected: Player[];
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/[0.03] dark:bg-white/[0.05]">
            <th className="min-w-[190px] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
              Metric
            </th>
            {selected.map((p) => (
              <th key={p.id} className="min-w-[130px] px-3 py-2 text-left text-xs font-semibold">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.metric.key}
              className={`border-t border-black/5 align-top dark:border-white/10 ${
                row.tiedByTeam ? "opacity-55" : ""
              }`}
            >
              <th scope="row" className="px-3 py-3 text-left font-medium">
                <div className="flex items-center gap-2">
                  {row.metric.label}
                  {row.tiedByTeam && (
                    <span className="rounded border border-black/15 px-1 text-[10px] font-normal uppercase tracking-wide text-black/50 dark:border-white/15 dark:text-white/50">
                      same club
                    </span>
                  )}
                </div>
                <p className="mt-0.5 max-w-[240px] text-xs font-normal leading-snug text-black/45 dark:text-white/45">
                  {row.metric.hint}
                </p>
              </th>
              {row.cells.map((cell, i) => (
                <td key={selected[i].id} className="px-3 py-3">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`tabular-nums ${
                        row.best.includes(i) ? "font-bold" : "font-medium"
                      }`}
                    >
                      {cell.text}
                    </span>
                    {row.best.includes(i) && (
                      <span
                        title="Best of the compared players"
                        className="text-[10px] font-semibold uppercase text-black/45 dark:text-white/45"
                      >
                        best
                      </span>
                    )}
                  </div>
                  {cell.percentile != null && (
                    <Meter percentile={cell.percentile} poolSize={cell.poolSize} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** English ordinal suffix, so a percentile reads "91st" rather than "91th". */
function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Percentile bar. Width carries the magnitude; the number beside it is the label. */
function Meter({ percentile, poolSize }: { percentile: number; poolSize: number }) {
  const pct = Math.round(percentile);
  return (
    <div className="mt-1.5">
      <div
        aria-hidden
        className="h-1.5 w-full max-w-[110px] overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
      >
        <div
          className="h-full rounded-full bg-[var(--meter)] dark:bg-[var(--meter-dark)]"
          style={
            {
              width: `${Math.max(2, pct)}%`,
              "--meter": METER.light,
              "--meter-dark": METER.dark,
            } as React.CSSProperties
          }
        />
      </div>
      <span className="mt-0.5 block text-[11px] tabular-nums text-black/45 dark:text-white/45">
        {ordinal(pct)} pct of {poolSize}
      </span>
    </div>
  );
}

/**
 * Per-gameweek DC, which is the thing the season average hides. Rendered as a
 * strip of chips rather than a bar chart: the question is binary (did this
 * appearance clear the threshold?), the exact count is secondary, and a chip row
 * stays readable across all 38 gameweeks.
 */
function DcStrip({ selected }: { selected: Player[] }) {
  const shown = selected.filter((p) => DC_THRESHOLD[p.pos] != null && p.history);
  if (shown.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h3 className="text-sm font-semibold">Defensive Contribution by gameweek</h3>
      <p className="mt-1 text-xs text-black/50 dark:text-white/50">
        DC points are a per-match cliff, not an average — a player alternating 16 and 8 scores half
        as often as one posting 11 every week.
      </p>

      <div className="mt-3 space-y-3">
        {shown.map((p) => {
          const threshold = DC_THRESHOLD[p.pos]!;
          const history = p.history!;
          return (
            <div key={p.id}>
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-medium">{p.name}</span>
                <span className="text-black/50 dark:text-white/50">
                  {history.dcHits}/{history.apps} appearances cleared {threshold}
                  {history.dcPer90Prev != null &&
                    ` · ${history.dcPer90Prev.toFixed(1)} per 90 in ${history.prevSeason}`}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {history.dcByGw.length === 0 && (
                  <span className="text-xs text-black/45 dark:text-white/45">
                    No 60-minute appearances yet.
                  </span>
                )}
                {history.dcByGw.map(({ gw, dc }) => {
                  const hit = dc >= threshold;
                  return (
                    <span
                      key={gw}
                      title={`GW${gw}: ${dc} DC${hit ? "" : ` — ${threshold - dc} short`}`}
                      className={`flex min-w-[42px] flex-col items-center rounded px-1.5 py-1 text-[11px] leading-tight tabular-nums ${
                        hit
                          ? "text-white"
                          : "bg-black/[0.07] text-black/60 dark:bg-white/10 dark:text-white/60"
                      }`}
                      style={hit ? { background: HIT } : undefined}
                    >
                      <span className="font-semibold">{dc}</span>
                      <span className={hit ? "opacity-80" : "opacity-70"}>GW{gw}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-black/50 dark:text-white/50">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded" style={{ background: HIT }} />
          Cleared the threshold (+2 pts)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded bg-black/[0.15] dark:bg-white/20" />
          Fell short
        </span>
        <span>Threshold: 10 for defenders, 12 for midfielders and forwards.</span>
      </div>
    </div>
  );
}
