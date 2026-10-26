/**
 * Squad planning: a manager's 15 players and the XI they intend to field in
 * each upcoming gameweek.
 *
 * Lineups reference squad *slots*, not player ids. A slot is one of the 15
 * places in the squad, fixed to a position; a transfer swaps the player in a
 * slot and leaves every lineup alone. That is what makes "what if I bring in
 * X?" cheap to try: the new player inherits the old one's place in every
 * gameweek's XI rather than landing on the bench everywhere.
 *
 * Only gameweeks the user has actually edited are stored. Any other gameweek
 * inherits the most recent edited one before it, so the XI carries forward
 * week to week until the user changes it — the same way FPL rolls your team
 * over between deadlines.
 */

import { POSITIONS, type Match, type Player, type Position } from "./fpl";

export interface Slot {
  pos: Position;
  /** Null once the player has been transferred out and nobody chosen yet. */
  playerId: number | null;
  /** The player FPL had in this slot when the squad was loaded. */
  originalId: number;
}

export interface Lineup {
  /** Eleven slot indices. */
  starters: number[];
  /** Four slot indices, in substitution order. */
  bench: number[];
  /** Slot index of the captain; always one of the starters. */
  captain: number | null;
}

export interface SquadState {
  entryId: number;
  teamName: string;
  /** Gameweek the FPL picks were read from. */
  loadedGw: number;
  /** Money in the bank at load, in tenths of a million. */
  bank: number;
  slots: Slot[];
  /** The XI FPL had at load; the root every gameweek inherits from. */
  base: Lineup;
  /** Gameweeks the user has edited, keyed by gameweek. */
  lineups: Record<number, Lineup>;
}

/** What /api/squad/[id] returns: the picks as FPL holds them. */
export interface FplSquad {
  entryId: number;
  teamName: string;
  gw: number;
  bank: number;
  /** In FPL order: 1-11 are the XI, 12-15 the bench in substitution order. */
  picks: { playerId: number; pos: Position; captain: boolean }[];
}

export function squadFromFpl(fpl: FplSquad): SquadState {
  const slots: Slot[] = fpl.picks.map((p) => ({
    pos: p.pos,
    playerId: p.playerId,
    originalId: p.playerId,
  }));
  const captain = fpl.picks.findIndex((p) => p.captain);
  return {
    entryId: fpl.entryId,
    teamName: fpl.teamName,
    loadedGw: fpl.gw,
    bank: fpl.bank,
    slots,
    base: {
      starters: slots.slice(0, 11).map((_, i) => i),
      bench: slots.slice(11).map((_, i) => i + 11),
      captain: captain >= 0 && captain < 11 ? captain : null,
    },
    lineups: {},
  };
}

/** The XI for a gameweek: its own edit, else the nearest edited week before it. */
export function lineupFor(state: SquadState, gw: number): Lineup {
  let best: number | null = null;
  for (const key of Object.keys(state.lineups)) {
    const k = Number(key);
    if (k <= gw && (best == null || k > best)) best = k;
  }
  return best == null ? state.base : state.lineups[best];
}

export function isEdited(state: SquadState, gw: number): boolean {
  return gw in state.lineups;
}

/**
 * Handles a click on `b` while `a` is selected. A starter and a bench player
 * trade places; two bench players swap substitution order. Two starters is not
 * a substitution, so it returns null and the caller just moves the selection.
 */
export function swapSlots(lineup: Lineup, a: number, b: number): Lineup | null {
  const aStarts = lineup.starters.includes(a);
  const bStarts = lineup.starters.includes(b);
  if (aStarts && bStarts) return null;

  const swap = (list: number[]) => list.map((s) => (s === a ? b : s === b ? a : s));
  const starters = swap(lineup.starters);
  const bench = swap(lineup.bench);
  // A benched captain scores nothing, so the armband does not follow them there.
  const captain = lineup.captain != null && starters.includes(lineup.captain) ? lineup.captain : null;
  return { starters, bench, captain };
}

export function withLineup(state: SquadState, gw: number, lineup: Lineup): SquadState {
  return { ...state, lineups: { ...state.lineups, [gw]: lineup } };
}

/** Drops a gameweek's edit so it inherits the week before again. */
export function clearLineup(state: SquadState, gw: number): SquadState {
  const lineups = { ...state.lineups };
  delete lineups[gw];
  return { ...state, lineups };
}

export function setSlotPlayer(state: SquadState, slot: number, playerId: number | null): SquadState {
  const slots = state.slots.map((s, i) => (i === slot ? { ...s, playerId } : s));
  return { ...state, slots };
}

/**
 * Bank after the user's transfers, at current prices. FPL sells at a
 * purchase-price-dependent rate that the public API does not expose, so this
 * is an estimate — close for recent buys, generous for players who have risen.
 */
export function estimatedBank(state: SquadState, playersById: Map<number, Player>): number {
  let bank = state.bank;
  for (const slot of state.slots) {
    if (slot.playerId === slot.originalId) continue;
    bank += playersById.get(slot.originalId)?.cost ?? 0;
    if (slot.playerId != null) bank -= playersById.get(slot.playerId)?.cost ?? 0;
  }
  return bank;
}

/** FPL's legal formations: exactly one keeper, 3-5 DEF, 2-5 MID, 1-3 FWD. */
const FORMATION_LIMITS: Record<Position, [number, number]> = {
  GKP: [1, 1],
  DEF: [3, 5],
  MID: [2, 5],
  FWD: [1, 3],
};

const MAX_PER_CLUB = 3;

export interface Warning {
  /** Slot the warning is about, when it concerns one player. */
  slot?: number;
  message: string;
}

export interface WeekSummary {
  gw: number;
  formation: string;
  /** Starters facing an FDR 4 or 5 opponent, counted once per fixture. */
  hard: number;
  /** Starters with no fixture this gameweek. */
  blanks: number;
  /** Starters with two or more fixtures this gameweek. */
  doubles: number;
  /** Mean FDR across every starter fixture, or null when none play. */
  avgFdr: number | null;
  warnings: Warning[];
}

export interface WeekContext {
  playersById: Map<number, Player>;
  /** teamId -> gw -> matches. */
  fixtures: Map<number, Map<number, Match[]>>;
  /** Availability only means something for the next deadline, so it is only flagged there. */
  nextGw: number;
}

export function summariseWeek(state: SquadState, gw: number, ctx: WeekContext): WeekSummary {
  const lineup = lineupFor(state, gw);
  const counts: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const warnings: Warning[] = [];
  let hard = 0;
  let blanks = 0;
  let doubles = 0;
  let fdrSum = 0;
  let fdrCount = 0;

  for (const slotIndex of lineup.starters) {
    const slot = state.slots[slotIndex];
    counts[slot.pos]++;
    const player = slot.playerId == null ? undefined : ctx.playersById.get(slot.playerId);
    if (!player) {
      warnings.push({ slot: slotIndex, message: `Empty ${slot.pos} slot in the XI` });
      continue;
    }

    const matches = ctx.fixtures.get(player.teamId)?.get(gw) ?? [];
    if (matches.length === 0) {
      blanks++;
      warnings.push({ slot: slotIndex, message: `${player.name} has no fixture` });
    }
    if (matches.length >= 2) doubles++;
    for (const m of matches) {
      if (m.fdr >= 4) hard++;
      fdrSum += m.fdr;
      fdrCount++;
    }

    if (gw === ctx.nextGw && player.status !== "a") {
      const chance = player.chanceNextRound;
      warnings.push({
        slot: slotIndex,
        message: `${player.name} is ${chance == null ? "unavailable" : `${chance}% to play`}`,
      });
    }
  }

  for (const pos of Object.values(POSITIONS)) {
    const [min, max] = FORMATION_LIMITS[pos];
    if (counts[pos] < min || counts[pos] > max) {
      warnings.push({
        message:
          pos === "GKP"
            ? `XI needs exactly one goalkeeper (has ${counts.GKP})`
            : `${counts[pos]} ${pos} is outside the legal ${min}-${max}`,
      });
    }
  }

  return {
    gw,
    formation: `${counts.DEF}-${counts.MID}-${counts.FWD}`,
    hard,
    blanks,
    doubles,
    avgFdr: fdrCount ? fdrSum / fdrCount : null,
    warnings,
  };
}

/** Squad-level rule breaks that do not depend on the gameweek. */
export function squadWarnings(state: SquadState, playersById: Map<number, Player>, teamName: (id: number) => string): string[] {
  const perClub = new Map<number, number>();
  for (const slot of state.slots) {
    const player = slot.playerId == null ? undefined : playersById.get(slot.playerId);
    if (player) perClub.set(player.teamId, (perClub.get(player.teamId) ?? 0) + 1);
  }
  const warnings: string[] = [];
  for (const [teamId, n] of perClub) {
    if (n > MAX_PER_CLUB) warnings.push(`${n} players from ${teamName(teamId)} — FPL allows ${MAX_PER_CLUB}`);
  }
  const empty = state.slots.filter((s) => s.playerId == null).length;
  if (empty > 0) warnings.push(`${empty} empty squad ${empty === 1 ? "slot" : "slots"}`);
  return warnings;
}

const STORAGE_KEY = "fpl-squad-v1";

/**
 * localStorage as an external store for useSyncExternalStore. Reading it in an
 * effect instead would render the empty state on the server and then flash the
 * saved squad in on the client; the store's server snapshot (null) keeps both
 * renders identical and React swaps in the saved state during hydration.
 */
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: SquadState | null = null;
/** Last value written, which stands in for storage when the browser blocks it. */
let memoryRaw: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked site data throw; keep the squad for this visit only.
    return memoryRaw;
  }
}

export const squadStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): SquadState | null {
    const raw = readRaw();
    // Parse only when the stored string changes, so the snapshot stays
    // referentially stable between renders as useSyncExternalStore requires.
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        cachedState = raw ? (JSON.parse(raw) as SquadState) : null;
      } catch {
        cachedState = null;
      }
    }
    return cachedState;
  },
  getServerSnapshot(): SquadState | null {
    return null;
  },
  set(state: SquadState | null) {
    memoryRaw = state ? JSON.stringify(state) : null;
    try {
      if (memoryRaw) window.localStorage.setItem(STORAGE_KEY, memoryRaw);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable; readRaw falls back to memoryRaw.
    }
    for (const listener of listeners) listener();
  },
};
