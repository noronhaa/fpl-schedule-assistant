"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { Match, Team } from "@/lib/fpl";
import type { LoadedSchedule } from "@/lib/schedule";
import { FDR_COLORS, crestUrl, fdrGradient, fdrStyle } from "@/lib/difficulty";

const MAX_WEEKS = 12;
const LAST_GW = 38;

type SortMode = "easiest" | "hardest" | "name";

interface TeamRow {
  team: Team;
  /** One entry per gameweek in the window; each holds 0 (blank), 1, or 2+ (double) matches. */
  cells: Match[][];
  avg: number | null;
  matchCount: number;
}

export default function Planner({ initial }: { initial: LoadedSchedule }) {
  const [schedule, setSchedule] = useState(initial);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initial.teams.map((t) => t.id)),
  );
  const [startGw, setStartGw] = useState(() => Math.min(initial.nextGw || 1, LAST_GW));
  const [weeks, setWeeks] = useState(5);
  const [sort, setSort] = useState<SortMode>("easiest");
  const [refreshing, startRefresh] = useTransition();

  const maxWeeks = Math.min(MAX_WEEKS, LAST_GW - startGw + 1);
  const activeWeeks = Math.min(weeks, maxWeeks);
  const windowGws = useMemo(
    () => Array.from({ length: activeWeeks }, (_, i) => startGw + i),
    [startGw, activeWeeks],
  );

  // teamId -> gw -> matches, so a double gameweek naturally lands as a 2-element array.
  const index = useMemo(() => {
    const map = new Map<number, Map<number, Match[]>>();
    for (const m of schedule.matches) {
      let byGw = map.get(m.teamId);
      if (!byGw) map.set(m.teamId, (byGw = new Map()));
      const list = byGw.get(m.gw);
      if (list) list.push(m);
      else byGw.set(m.gw, [m]);
    }
    return map;
  }, [schedule.matches]);

  const teamsById = useMemo(
    () => new Map(schedule.teams.map((t) => [t.id, t])),
    [schedule.teams],
  );

  const rows = useMemo<TeamRow[]>(() => {
    const built = schedule.teams
      .filter((team) => selected.has(team.id))
      .map((team) => {
        const byGw = index.get(team.id);
        const cells = windowGws.map((gw) => byGw?.get(gw) ?? []);
        const all = cells.flat();
        const avg = all.length ? all.reduce((sum, m) => sum + m.fdr, 0) / all.length : null;
        return { team, cells, avg, matchCount: all.length };
      });

    const byAvg = (a: TeamRow, b: TeamRow) => {
      if (a.avg == null) return 1;
      if (b.avg == null) return -1;
      return a.avg - b.avg;
    };

    if (sort === "easiest") built.sort(byAvg);
    else if (sort === "hardest") built.sort((a, b) => byAvg(b, a));
    else built.sort((a, b) => a.team.name.localeCompare(b.team.name));

    return built;
  }, [schedule.teams, selected, index, windowGws, sort]);

  const toggleTeam = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const refresh = () => {
    startRefresh(async () => {
      try {
        const res = await fetch("/api/schedule", { cache: "no-store" });
        if (res.ok) setSchedule(await res.json());
      } catch {
        // Keep whatever is already on screen — the banner still shows the source.
      }
    });
  };

  const gwMeta = useMemo(
    () => new Map(schedule.gameweeks.map((g) => [g.id, g])),
    [schedule.gameweeks],
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6">
      <Header schedule={schedule} onRefresh={refresh} refreshing={refreshing} />

      {schedule.warning && (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {schedule.warning}
        </p>
      )}

      <Controls
        startGw={startGw}
        setStartGw={(gw) => setStartGw(Math.min(Math.max(1, gw), LAST_GW))}
        weeks={activeWeeks}
        maxWeeks={maxWeeks}
        setWeeks={setWeeks}
        sort={sort}
        setSort={setSort}
        nextGw={schedule.nextGw}
      />

      <TeamPicker
        teams={schedule.teams}
        selected={selected}
        onToggle={toggleTeam}
        onAll={() => setSelected(new Set(schedule.teams.map((t) => t.id)))}
        onNone={() => setSelected(new Set())}
      />

      <Ticker rows={rows} gws={windowGws} gwMeta={gwMeta} teamsById={teamsById} />

      <Legend />
    </div>
  );
}

function Header({
  schedule,
  onRefresh,
  refreshing,
}: {
  schedule: LoadedSchedule;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-5 dark:border-white/10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          FPL Schedule Assistant
        </h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Premier League {schedule.season} fixture difficulty — plan your subs and transfers.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            schedule.source === "live"
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
          }`}
        >
          {schedule.source === "live" ? "Live FPL data" : "Snapshot"}
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium transition hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}

function Controls({
  startGw,
  setStartGw,
  weeks,
  maxWeeks,
  setWeeks,
  sort,
  setSort,
  nextGw,
}: {
  startGw: number;
  setStartGw: (gw: number) => void;
  weeks: number;
  maxWeeks: number;
  setWeeks: (n: number) => void;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  nextGw: number;
}) {
  return (
    <section className="mt-5 grid gap-5 rounded-xl border border-black/10 bg-black/[0.02] p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto] dark:border-white/10 dark:bg-white/[0.03]">
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="weeks" className="text-sm font-semibold">
            Weeks ahead
          </label>
          <span className="text-sm tabular-nums text-black/60 dark:text-white/60">
            GW{startGw}–GW{startGw + weeks - 1} · {weeks} {weeks === 1 ? "week" : "weeks"}
          </span>
        </div>
        <input
          id="weeks"
          type="range"
          min={1}
          max={maxWeeks}
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          className="mt-3 w-full accent-[#00ff87]"
        />
        <div className="mt-1 flex justify-between text-[10px] text-black/40 dark:text-white/40">
          <span>1</span>
          <span>{maxWeeks}</span>
        </div>
      </div>

      <div>
        <span className="text-sm font-semibold">Start gameweek</span>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setStartGw(startGw - 1)}
            disabled={startGw <= 1}
            className="h-9 w-9 rounded-lg border border-black/15 text-lg leading-none transition hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
            aria-label="Previous gameweek"
          >
            −
          </button>
          <select
            value={startGw}
            onChange={(e) => setStartGw(Number(e.target.value))}
            className="h-9 rounded-lg border border-black/15 bg-transparent px-2 text-sm font-medium dark:border-white/20"
            aria-label="Start gameweek"
          >
            {Array.from({ length: LAST_GW }, (_, i) => i + 1).map((gw) => (
              <option key={gw} value={gw} className="text-black">
                GW{gw}
                {gw === nextGw ? " (next)" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => setStartGw(startGw + 1)}
            disabled={startGw >= LAST_GW}
            className="h-9 w-9 rounded-lg border border-black/15 text-lg leading-none transition hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
            aria-label="Next gameweek"
          >
            +
          </button>
          {startGw !== nextGw && (
            <button
              onClick={() => setStartGw(nextGw)}
              className="text-xs font-medium text-black/50 underline underline-offset-2 hover:text-black dark:text-white/50 dark:hover:text-white"
            >
              Jump to next
            </button>
          )}
        </div>
      </div>

      <div>
        <span className="text-sm font-semibold">Sort by</span>
        <div className="mt-3 inline-flex rounded-lg border border-black/15 p-0.5 dark:border-white/20">
          {(
            [
              ["easiest", "Easiest run"],
              ["hardest", "Hardest run"],
              ["name", "A–Z"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSort(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                sort === value
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamPicker({
  teams,
  selected,
  onToggle,
  onAll,
  onNone,
}: {
  teams: Team[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Teams{" "}
          <span className="font-normal text-black/50 dark:text-white/50">
            ({selected.size} of {teams.length} selected)
          </span>
        </h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={onAll}
            className="rounded-md border border-black/15 px-2 py-1 font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Select all
          </button>
          <button
            onClick={onNone}
            className="rounded-md border border-black/15 px-2 py-1 font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {teams.map((team) => {
          const on = selected.has(team.id);
          return (
            <button
              key={team.id}
              onClick={() => onToggle(team.id)}
              aria-pressed={on}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition ${
                on
                  ? "border-black/70 bg-black/[0.06] font-semibold dark:border-white/70 dark:bg-white/10"
                  : "border-black/10 text-black/45 hover:border-black/30 dark:border-white/10 dark:text-white/40 dark:hover:border-white/30"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={crestUrl(team.code)}
                alt=""
                width={20}
                height={20}
                className={`h-5 w-5 shrink-0 object-contain transition ${on ? "" : "opacity-40 grayscale"}`}
                loading="lazy"
              />
              <span className="truncate">{team.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Ticker({
  rows,
  gws,
  gwMeta,
  teamsById,
}: {
  rows: TeamRow[];
  gws: number[];
  gwMeta: Map<number, { name: string; deadline: string }>;
  teamsById: Map<number, Team>;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-black/15 px-4 py-10 text-center text-sm text-black/50 dark:border-white/15 dark:text-white/50">
        Select at least one team to see its fixture run.
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/[0.03] dark:bg-white/[0.05]">
            <th className="sticky left-0 z-20 min-w-[150px] bg-[#f7f7f7] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide dark:bg-[#141414]">
              Team
            </th>
            <th className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide">
              Avg
            </th>
            {gws.map((gw) => {
              const meta = gwMeta.get(gw);
              return (
                <th key={gw} className="min-w-[76px] px-1 py-2 text-center">
                  <div className="text-xs font-semibold">GW{gw}</div>
                  <div className="text-[10px] font-normal text-black/45 dark:text-white/45">
                    {meta
                      ? new Date(meta.deadline).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const avgStyle = row.avg == null ? null : fdrGradient(row.avg);
            return (
              <tr
                key={row.team.id}
                className="border-t border-black/5 dark:border-white/10"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-[#fbfbfb] px-3 py-1.5 text-left font-medium dark:bg-[#0f0f0f]"
                >
                  <span className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={crestUrl(row.team.code)}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] shrink-0 object-contain"
                      loading="lazy"
                    />
                    <span className="truncate">{row.team.name}</span>
                  </span>
                </th>
                <td className="px-2 py-1.5 text-center">
                  {avgStyle ? (
                    <span
                      className="inline-block min-w-[38px] rounded-md px-1.5 py-1 text-xs font-bold tabular-nums"
                      style={{ backgroundColor: avgStyle.bg, color: avgStyle.fg }}
                      title={`${row.matchCount} ${row.matchCount === 1 ? "match" : "matches"} over ${gws.length} GW${gws.length === 1 ? "" : "s"}`}
                    >
                      {row.avg!.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-xs text-black/30 dark:text-white/30">—</span>
                  )}
                  {row.matchCount !== gws.length && (
                    <div className="mt-0.5 text-[9px] font-medium text-black/45 dark:text-white/45">
                      {row.matchCount} {row.matchCount === 1 ? "match" : "matches"}
                    </div>
                  )}
                </td>
                {row.cells.map((matches, i) => (
                  <td key={gws[i]} className="px-1 py-1.5 align-middle">
                    {matches.length === 0 ? (
                      <div className="rounded-md border border-dashed border-black/15 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-black/30 dark:border-white/15 dark:text-white/30">
                        Blank
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {matches.map((m, j) => (
                          <FixtureChip
                            key={j}
                            match={m}
                            opponent={teamsById.get(m.oppId)}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FixtureChip({ match, opponent }: { match: Match; opponent?: Team }) {
  const style = fdrStyle(match.fdr);
  const short = opponent?.short ?? "???";
  return (
    <div
      className={`rounded-md px-1 py-1 text-center leading-none ${
        match.home ? "" : "ring-1 ring-inset ring-black/25"
      }`}
      style={{ backgroundColor: style.bg, color: style.fg }}
      title={`${opponent?.name ?? "Unknown"} (${match.home ? "home" : "away"}) — difficulty ${match.fdr}: ${style.label}`}
    >
      <div className="text-[11px] font-extrabold tracking-wide">
        {match.home ? short.toUpperCase() : short.toLowerCase()}
      </div>
      <div className="mt-0.5 text-[9px] font-semibold opacity-75">
        {match.home ? "H" : "A"} · {match.fdr}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-black/60 dark:text-white/60">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-black dark:text-white">Difficulty</span>
        {[1, 2, 3, 4, 5].map((n) => {
          const s = FDR_COLORS[n];
          return (
            <span
              key={n}
              className="rounded px-1.5 py-0.5 text-[11px] font-bold"
              style={{ backgroundColor: s.bg, color: s.fg }}
              title={s.label}
            >
              {n}
            </span>
          );
        })}
      </div>
      <span>
        <strong className="text-black dark:text-white">ARS</strong> = home ·{" "}
        <strong className="text-black dark:text-white">ars</strong> = away (outlined)
      </span>
      <span>Two chips in a cell = double gameweek · &ldquo;Blank&rdquo; = no fixture</span>
      <span>Avg = mean FDR across every fixture in the selected window</span>
    </div>
  );
}
