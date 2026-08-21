# FPL Schedule Assistant

A local fixture-difficulty planner for Fantasy Premier League **2026/27**. Pick the teams
you care about, choose how many gameweeks ahead to look, and read the run off a colour-coded
ticker so you can plan subs and transfers.

## Features

- **Team filter** — toggle any subset of the 20 teams (select all / clear).
- **Weeks slider** — 1 to 12 gameweeks ahead.
- **Start gameweek control** — defaults to the next open gameweek, steppable to any GW.
- **Official FPL difficulty** — the same 1–5 FDR values and green→red colours the
  official fixture ticker uses, shown as both a number and a colour.
- **Home / away** — uppercase opponent = home, lowercase + outline = away, with an `H`/`A` label.
- **Sort by easiest or hardest run** — teams ordered by mean FDR across the selected window.
- **Doubles and blanks** — two chips in a cell for a double gameweek, `BLANK` for no fixture,
  plus a match count when a team's fixture total differs from the window length.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

## Data

Fixtures and difficulty ratings come from the public FPL API:

- `https://fantasy.premierleague.com/api/bootstrap-static/` — teams and gameweek deadlines
- `https://fantasy.premierleague.com/api/fixtures/` — all 380 fixtures with per-side FDR

The page fetches live data and caches the render for an hour; the **Refresh** button hits
`/api/schedule` for uncached data on demand. If the API is unreachable, the app falls back to
the committed snapshot in `data/snapshot.json` and shows an amber banner saying so.

Refresh that snapshot with:

```bash
npm run refresh
```

## Layout

| Path | Purpose |
| --- | --- |
| `lib/fpl.ts` | FPL API types, fetching, and normalisation into a flat `Match[]` |
| `lib/schedule.ts` | Live-with-snapshot-fallback loader |
| `lib/difficulty.ts` | FDR colour scale, gradient blending, crest URLs |
| `components/planner.tsx` | All client UI — controls, team picker, ticker |
| `app/api/schedule/route.ts` | Uncached JSON endpoint for the Refresh button |
| `scripts/refresh-snapshot.ts` | Regenerates `data/snapshot.json` |
