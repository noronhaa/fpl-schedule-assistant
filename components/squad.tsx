"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Gameweek, Match, Player, Position, Team } from "@/lib/fpl";
import { crestUrl, fdrGradient } from "@/lib/difficulty";
import { formatDeadline } from "@/lib/format";
import {
  clearLineup,
  estimatedBank,
  isEdited,
  lineupFor,
  setSlotPlayer,
  squadFromFpl,
  squadStore,
  squadWarnings,
  summariseWeek,
  swapSlots,
  withLineup,
  type FplSquad,
  type SquadState,
  type WeekContext,
  type WeekSummary,
} from "@/lib/squad";
import FixtureChip from "./fixture-chip";

const LAST_GW = 38;
const PITCH_ROWS: Position[] = ["GKP", "DEF", "MID", "FWD"];

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

export default function Squad({
  players,
  teams,
  matches,
  gameweeks,
  nextGw,
  windowGws,
}: {
  players: Player[];
  teams: Team[];
  matches: Match[];
  gameweeks: Gameweek[];
  nextGw: number;
  /** The gameweeks the shared "weeks ahead" controls select; drives the summary strip. */
  windowGws: number[];
}) {
  const state = useSyncExternalStore(
    squadStore.subscribe,
    squadStore.getSnapshot,
    squadStore.getServerSnapshot,
  );

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const gwMeta = useMemo(() => new Map(gameweeks.map((g) => [g.id, g])), [gameweeks]);

  // teamId -> gw -> matches, so a double lands as a 2-element array and a blank
  // as an absent key, exactly like the ticker.
  const fixtures = useMemo(() => {
    const map = new Map<number, Map<number, Match[]>>();
    for (const m of matches) {
      let byGw = map.get(m.teamId);
      if (!byGw) map.set(m.teamId, (byGw = new Map()));
      const list = byGw.get(m.gw);
      if (list) list.push(m);
      else byGw.set(m.gw, [m]);
    }
    return map;
  }, [matches]);

  const ctx = useMemo<WeekContext>(
    () => ({ playersById, fixtures, nextGw }),
    [playersById, fixtures, nextGw],
  );

  if (!state) return <LoadForm />;

  return (
    <Planner
      state={state}
      ctx={ctx}
      players={players}
      teamsById={teamsById}
      gwMeta={gwMeta}
      windowGws={windowGws}
    />
  );
}

async function loadSquad(entryId: string): Promise<SquadState> {
  const res = await fetch(`/api/squad/${encodeURIComponent(entryId)}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return squadFromFpl(body as FplSquad);
}

function LoadForm() {
  const [entryId, setEntryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      squadStore.set(await loadSquad(entryId.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-6 max-w-xl rounded-xl border border-black/10 p-4 dark:border-white/10"
    >
      <label htmlFor="entry-id" className="text-sm font-semibold">
        Your FPL team ID
      </label>
      <p className="mt-1 text-xs text-black/55 dark:text-white/55">
        On the FPL site, open <em>Points</em> — the number after <code>/entry/</code> in the address
        bar is your ID.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          id="entry-id"
          inputMode="numeric"
          value={entryId}
          onChange={(e) => setEntryId(e.target.value.replace(/\D/g, ""))}
          placeholder="e.g. 1234567"
          className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-black/35 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/35 dark:focus:border-white/40"
        />
        <button
          type="submit"
          disabled={!entryId || loading}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {loading ? "Loading…" : "Load squad"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}

function Planner({
  state,
  ctx,
  players,
  teamsById,
  gwMeta,
  windowGws,
}: {
  state: SquadState;
  ctx: WeekContext;
  players: Player[];
  teamsById: Map<number, Team>;
  gwMeta: Map<number, Gameweek>;
  windowGws: number[];
}) {
  const [gw, setGw] = useState(() => Math.min(Math.max(1, ctx.nextGw), LAST_GW));
  /** Slot picked as the first half of a substitution. */
  const [selected, setSelected] = useState<number | null>(null);
  /** Slot whose replacement is being chosen in the transfer panel. */
  const [filling, setFilling] = useState<number | null>(null);

  const lineup = lineupFor(state, gw);
  const summaries = useMemo(
    () => windowGws.map((w) => summariseWeek(state, w, ctx)),
    [state, windowGws, ctx],
  );
  const current = useMemo(() => summariseWeek(state, gw, ctx), [state, gw, ctx]);
  const squadIssues = squadWarnings(state, ctx.playersById, (id) => teamsById.get(id)?.name ?? "one club");
  const flagged = new Set(current.warnings.map((w) => w.slot));

  const goTo = (next: number) => {
    setGw(Math.min(Math.max(1, next), LAST_GW));
    setSelected(null);
  };

  const clickSlot = (slot: number) => {
    if (selected == null) return setSelected(slot);
    if (selected === slot) return setSelected(null);
    const swapped = swapSlots(lineup, selected, slot);
    if (!swapped) return setSelected(slot);
    squadStore.set(withLineup(state, gw, swapped));
    setSelected(null);
  };

  const toggleCaptain = (slot: number) => {
    const captain = lineup.captain === slot ? null : slot;
    squadStore.set(withLineup(state, gw, { ...lineup, captain }));
  };

  const transferOut = (slot: number) => {
    squadStore.set(setSlotPlayer(state, slot, null));
    setSelected(null);
    setFilling(slot);
  };

  const fill = (slot: number, playerId: number) => {
    squadStore.set(setSlotPlayer(state, slot, playerId));
    setFilling(null);
  };

  const card = (slot: number) => (
    <PlayerCard
      key={slot}
      slot={slot}
      state={state}
      gw={gw}
      ctx={ctx}
      teamsById={teamsById}
      starter={lineup.starters.includes(slot)}
      captain={lineup.captain === slot}
      selected={selected === slot}
      flagged={flagged.has(slot)}
      onSelect={() => clickSlot(slot)}
      onCaptain={() => toggleCaptain(slot)}
      onTransferOut={() => transferOut(slot)}
      onFill={() => setFilling(slot)}
    />
  );

  const edited = isEdited(state, gw);
  const meta = gwMeta.get(gw);

  return (
    <div className="mt-6">
      <SquadHeader state={state} playersById={ctx.playersById} issues={squadIssues} />

      <WeekStrip
        summaries={summaries}
        gwMeta={gwMeta}
        active={gw}
        state={state}
        onPick={goTo}
      />

      <section className="mt-6 rounded-xl border border-black/10 p-3 sm:p-4 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => goTo(gw - 1)}
              disabled={gw <= 1}
              aria-label="Previous gameweek"
              className="h-9 w-9 rounded-lg border border-black/15 text-lg leading-none transition hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
            >
              ‹
            </button>
            <div className="min-w-[96px] text-center">
              <div className="font-semibold">
                GW{gw}
                {gw === ctx.nextGw && (
                  <span className="ml-1 text-xs font-normal text-black/50 dark:text-white/50">(next)</span>
                )}
              </div>
              <div className="text-[11px] text-black/50 dark:text-white/50">
                {meta ? `Deadline ${formatDeadline(meta.deadline)}` : "—"}
              </div>
            </div>
            <button
              onClick={() => goTo(gw + 1)}
              disabled={gw >= LAST_GW}
              aria-label="Next gameweek"
              className="h-9 w-9 rounded-lg border border-black/15 text-lg leading-none transition hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
            >
              ›
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium tabular-nums">{current.formation}</span>
            <span className="text-xs text-black/55 dark:text-white/55">
              {edited ? "Edited for this week" : "Carried over from the week before"}
            </span>
            {edited && (
              <button
                onClick={() => squadStore.set(clearLineup(state, gw))}
                className="text-xs font-medium underline underline-offset-2 text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
              >
                Undo this week&apos;s changes
              </button>
            )}
          </div>
        </div>

        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          {selected == null
            ? "Click a starter, then a bench player, to swap them. Changes carry forward to later weeks you haven't edited."
            : "Now click a bench player to swap in — or another starter to change selection."}
        </p>

        <div className="mt-4 space-y-2 rounded-xl bg-emerald-700/10 p-2 sm:space-y-3 sm:p-4 dark:bg-emerald-400/[0.07]">
          {PITCH_ROWS.map((pos) => {
            const row = lineup.starters.filter((s) => state.slots[s].pos === pos);
            if (row.length === 0) return null;
            return (
              <div key={pos} className="flex justify-center gap-1.5 sm:gap-3">
                {row.map(card)}
              </div>
            );
          })}
        </div>

        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
            Bench
          </div>
          <div className="mt-2 flex justify-center gap-1.5 sm:gap-3">{lineup.bench.map(card)}</div>
        </div>

        {current.warnings.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            {current.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        )}
      </section>

      {filling != null && (
        <TransferPanel
          slot={filling}
          state={state}
          players={players}
          teamsById={teamsById}
          ctx={ctx}
          windowGws={windowGws}
          onPick={(id) => fill(filling, id)}
          onClose={() => setFilling(null)}
        />
      )}
    </div>
  );
}

function SquadHeader({
  state,
  playersById,
  issues,
}: {
  state: SquadState;
  playersById: Map<number, Player>;
  issues: string[];
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = state.slots.reduce(
    (sum, s) => sum + (s.playerId == null ? 0 : (playersById.get(s.playerId)?.cost ?? 0)),
    0,
  );
  const transfers = state.slots.filter((s) => s.playerId !== s.originalId).length;

  const reset = async () => {
    setResetting(true);
    setError(null);
    try {
      squadStore.set(await loadSquad(String(state.entryId)));
      setConfirmReset(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="rounded-xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{state.teamName}</h2>
          <p className="text-xs text-black/55 dark:text-white/55">
            Picks from GW{state.loadedGw} · Squad {money(value)} · Bank ≈{" "}
            {money(estimatedBank(state, playersById))}
            {transfers > 0 && ` · ${transfers} ${transfers === 1 ? "transfer" : "transfers"} planned`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {confirmReset ? (
            <>
              <button
                onClick={reset}
                disabled={resetting}
                className="rounded-md bg-red-600 px-2.5 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {resetting ? "Reloading…" : "Discard my changes"}
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-black/15 px-2.5 py-1.5 font-medium dark:border-white/20"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="rounded-md border border-black/15 px-2.5 py-1.5 font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Reset to my FPL team
            </button>
          )}
          <button
            onClick={() => squadStore.set(null)}
            className="rounded-md border border-black/15 px-2.5 py-1.5 font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Load a different team
          </button>
        </div>
      </div>
      {confirmReset && !error && (
        <p className="mt-2 text-xs text-black/55 dark:text-white/55">
          Reloads your squad from FPL and drops every transfer and lineup change made here.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {issues.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-sm text-amber-700 dark:text-amber-300">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-black/45 dark:text-white/45">
        Bank is estimated at current prices — FPL&apos;s real selling prices aren&apos;t public.
      </p>
    </section>
  );
}

/** One cell per gameweek in the window, so a problem week stands out before you open it. */
function WeekStrip({
  summaries,
  gwMeta,
  active,
  state,
  onPick,
}: {
  summaries: WeekSummary[];
  gwMeta: Map<number, Gameweek>;
  active: number;
  state: SquadState;
  onPick: (gw: number) => void;
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <div className="flex gap-2 pb-1">
        {summaries.map((s) => {
          const avg = s.avgFdr == null ? null : fdrGradient(s.avgFdr);
          const meta = gwMeta.get(s.gw);
          const notes = [
            s.hard > 0 && `${s.hard} hard`,
            s.blanks > 0 && `${s.blanks} blank`,
            s.doubles > 0 && `${s.doubles} double`,
          ].filter(Boolean);
          return (
            <button
              key={s.gw}
              onClick={() => onPick(s.gw)}
              aria-pressed={s.gw === active}
              className={`min-w-[112px] flex-1 rounded-xl border p-2.5 text-left transition ${
                s.gw === active
                  ? "border-black/70 bg-black/[0.05] dark:border-white/70 dark:bg-white/10"
                  : "border-black/10 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">GW{s.gw}</span>
                <span className="text-[10px] text-black/45 dark:text-white/45">
                  {meta ? formatDeadline(meta.deadline) : ""}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums"
                  style={avg ? { backgroundColor: avg.bg, color: avg.fg } : undefined}
                  title="Mean difficulty across your starters' fixtures"
                >
                  {s.avgFdr == null ? "—" : s.avgFdr.toFixed(1)}
                </span>
                <span className="text-xs tabular-nums text-black/60 dark:text-white/60">{s.formation}</span>
              </div>
              <div className="mt-1.5 min-h-[16px] text-[11px] text-black/60 dark:text-white/60">
                {notes.length > 0 ? notes.join(" · ") : "No hard fixtures"}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                {s.warnings.length > 0 ? (
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    ⚠ {s.warnings.length} {s.warnings.length === 1 ? "issue" : "issues"}
                  </span>
                ) : (
                  <span className="text-emerald-700 dark:text-emerald-400">✓ OK</span>
                )}
                {isEdited(state, s.gw) && (
                  <span className="text-black/45 dark:text-white/45">edited</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerCard({
  slot,
  state,
  gw,
  ctx,
  teamsById,
  starter,
  captain,
  selected,
  flagged,
  onSelect,
  onCaptain,
  onTransferOut,
  onFill,
}: {
  slot: number;
  state: SquadState;
  gw: number;
  ctx: WeekContext;
  teamsById: Map<number, Team>;
  starter: boolean;
  captain: boolean;
  selected: boolean;
  flagged: boolean;
  onSelect: () => void;
  onCaptain: () => void;
  onTransferOut: () => void;
  onFill: () => void;
}) {
  const { pos, playerId } = state.slots[slot];
  const player = playerId == null ? undefined : ctx.playersById.get(playerId);
  const base = "relative w-full min-w-0 max-w-[132px] flex-1";

  if (!player) {
    return (
      <div className={base}>
        <button
          onClick={onFill}
          className="flex h-full min-h-[104px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-black/25 bg-white/60 p-1.5 text-xs font-medium text-black/60 hover:border-black/50 dark:border-white/25 dark:bg-black/30 dark:text-white/60"
        >
          <span className="text-lg leading-none">+</span>
          Add {pos}
        </button>
      </div>
    );
  }

  const team = teamsById.get(player.teamId);
  const matches = ctx.fixtures.get(player.teamId)?.get(gw) ?? [];
  const unavailable = player.status !== "a";

  return (
    <div className={base}>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full flex-col items-center rounded-lg border bg-white p-1.5 text-center shadow-sm transition dark:bg-[#161616] ${
          selected
            ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
            : flagged
              ? "border-amber-500"
              : "border-black/10 hover:border-black/40 dark:border-white/10 dark:hover:border-white/40"
        } ${starter ? "" : "opacity-80"}`}
      >
        {team && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={crestUrl(team.code)} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" />
        )}
        <span className="mt-1 w-full truncate text-xs font-semibold">{player.name}</span>
        <span className="text-[10px] text-black/50 dark:text-white/50">
          {pos} · {money(player.cost)}
        </span>
        <div className="mt-1 flex w-full gap-0.5">
          {matches.length === 0 ? (
            <div className="flex-1 rounded-md border border-dashed border-black/25 py-1.5 text-[9px] font-bold uppercase tracking-wide text-black/50 dark:border-white/25 dark:text-white/50">
              Blank
            </div>
          ) : (
            matches.map((m, i) => (
              <div key={i} className="min-w-0 flex-1">
                <FixtureChip match={m} opponent={teamsById.get(m.oppId)} compact />
              </div>
            ))
          )}
        </div>
        {unavailable && (
          <span
            className={`mt-1 rounded px-1 text-[9px] font-semibold ${
              player.chanceNextRound != null && player.chanceNextRound > 0
                ? "bg-amber-400/25 text-amber-800 dark:text-amber-300"
                : "bg-red-500/15 text-red-700 dark:text-red-400"
            }`}
          >
            {player.chanceNextRound == null ? "Unavailable" : `${player.chanceNextRound}% to play`}
          </span>
        )}
      </button>

      {starter && (
        <button
          onClick={onCaptain}
          aria-pressed={captain}
          aria-label={captain ? `Remove captaincy from ${player.name}` : `Make ${player.name} captain`}
          title={captain ? "Captain" : "Make captain"}
          className={`absolute -left-1 -top-1 h-5 w-5 rounded-full text-[10px] font-bold leading-5 transition ${
            captain
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "border border-black/20 bg-white text-black/35 hover:text-black dark:border-white/20 dark:bg-[#161616] dark:text-white/35 dark:hover:text-white"
          }`}
        >
          C
        </button>
      )}
      <button
        onClick={onTransferOut}
        aria-label={`Transfer out ${player.name}`}
        title="Transfer out"
        className="absolute -right-1 -top-1 h-5 w-5 rounded-full border border-black/20 bg-white text-xs leading-none text-black/45 hover:border-red-500 hover:text-red-600 dark:border-white/20 dark:bg-[#161616] dark:text-white/45"
      >
        ×
      </button>
    </div>
  );
}

function TransferPanel({
  slot,
  state,
  players,
  teamsById,
  ctx,
  windowGws,
  onPick,
  onClose,
}: {
  slot: number;
  state: SquadState;
  players: Player[];
  teamsById: Map<number, Team>;
  ctx: WeekContext;
  windowGws: number[];
  onPick: (playerId: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { pos, originalId } = state.slots[slot];
  const original = ctx.playersById.get(originalId);
  const results = useMemo(() => {
    const owned = new Set(state.slots.map((s) => s.playerId));
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => p.pos === pos && !owned.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || teamsById.get(p.teamId)?.name.toLowerCase().includes(q))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);
  }, [query, players, pos, state.slots, teamsById]);

  return (
    <section className="mt-6 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Choose a {pos} to bring in
        </h3>
        <button
          onClick={onClose}
          className="text-xs font-medium text-black/55 underline underline-offset-2 hover:text-black dark:text-white/55 dark:hover:text-white"
        >
          Close
        </button>
      </div>

      {original && !state.slots.some((s) => s.playerId === originalId) && (
        <button
          onClick={() => onPick(originalId)}
          className="mt-2 text-xs font-medium underline underline-offset-2"
        >
          Undo — bring back {original.name}
        </button>
      )}

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${pos} by name or club`}
        className="mt-3 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-black/35 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/35 dark:focus:border-white/40"
      />

      <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-black/[0.03] text-left text-[11px] uppercase tracking-wide text-black/50 dark:bg-white/[0.05] dark:text-white/50">
              <th className="px-3 py-1.5 font-semibold">Player</th>
              <th className="px-2 py-1.5 text-right font-semibold">Price</th>
              <th className="px-2 py-1.5 text-right font-semibold">Pts</th>
              {windowGws.map((w) => (
                <th key={w} className="min-w-[48px] px-0.5 py-1.5 text-center font-semibold">
                  GW{w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((p) => {
              const team = teamsById.get(p.teamId);
              return (
                <tr
                  key={p.id}
                  className="border-t border-black/5 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => onPick(p.id)}
                      className="flex items-center gap-2 text-left font-medium underline-offset-2 hover:underline"
                    >
                      {team && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={crestUrl(team.code)} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
                      )}
                      <span className="whitespace-nowrap">{p.name}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(p.cost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.points}</td>
                  {windowGws.map((w) => {
                    const ms = ctx.fixtures.get(p.teamId)?.get(w) ?? [];
                    return (
                      <td key={w} className="px-0.5 py-1">
                        <div className="flex gap-0.5">
                          {ms.length === 0 ? (
                            <span className="w-full text-center text-[9px] font-bold text-black/40 dark:text-white/40">
                              —
                            </span>
                          ) : (
                            ms.map((m, i) => (
                              <div key={i} className="min-w-0 flex-1">
                                <FixtureChip match={m} opponent={teamsById.get(m.oppId)} compact />
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {results.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-black/50 dark:text-white/50">No {pos} matches.</p>
        )}
      </div>
    </section>
  );
}
