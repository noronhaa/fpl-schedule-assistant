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

### Compare players

A second tab puts up to four players side by side and ranks every stat against others in
**their own position**, so a raw number becomes a decision. "8.5 DC per 90" means nothing on
its own; "64th percentile among defenders" does.

- **Percentile, not raw value** — each rate is ranked against same-position players above a
  minutes floor that scales with the season, so an early-season pool is not diluted by cameos.
- **Defensive Contribution hit-rate** — the share of 60-minute appearances that actually
  cleared the positional DC threshold (10 for defenders, 12 for midfielders and forwards).
  DC points are a per-match cliff, so a season average hides the thing you want: a player
  alternating 16 and 8 scores half as often as one posting 11 every week. Shown per gameweek
  alongside last season's rate, which the current one tends to regress toward.
- **Output vs expected** — goals and assists minus xGI. Well above zero is finishing luck that
  does not repeat; well below is a player owed returns.
- **Team-level stats are marked** — xGC belongs to the club, not the player, so clubmates
  always tie on it. Those rows grey out with a "same club" tag rather than inviting a
  comparison that cannot separate them.
- **Set-piece duty** — corners, free kicks and penalties, which is role value that repeats.

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

Per-gameweek history (the DC hit-rate) is not in `bootstrap-static` — it costs one
`/element-summary/` request per player to derive, so it is crawled offline and committed to
`data/history.json` rather than fetched on the request path. It only changes once a gameweek
is audited:

```bash
npm run refresh:history
```

Note that a gameweek is not final until FPL marks it `data_checked`. Between kickoff and that
flag, bonus is provisional and the whole ICT family reads zero.

## Layout

| Path | Purpose |
| --- | --- |
| `lib/fpl.ts` | FPL API types, fetching, and normalisation into a flat `Match[]` |
| `lib/schedule.ts` | Live-with-snapshot-fallback loader |
| `lib/difficulty.ts` | FDR colour scale, gradient blending, crest URLs |
| `lib/history.ts` | Crawls `/element-summary/` and derives the DC hit-rate |
| `lib/compare.ts` | Comparison metrics and within-position percentile ranking |
| `components/planner.tsx` | Ticker UI — controls, team picker, tab switcher |
| `components/compare.tsx` | Compare UI — player search, percentile table, DC strip |
| `app/api/schedule/route.ts` | Uncached JSON endpoint for the Refresh button |
| `scripts/refresh-snapshot.ts` | Regenerates `data/snapshot.json` |
| `scripts/refresh-history.ts` | Regenerates `data/history.json` (`npm run refresh:history`) |

## Caveats

Underlying stats stabilise slowly. Early in a season a percentile rests on a handful of
appearances, and expected-goal figures in particular need far more shots than a few gameweeks
provide — a large "output vs expected" gap at that point is one big chance, not a trend. New
signings and promoted sides have no prior season to regress toward at all. Note also that
penalties count toward xG at roughly 0.79 each, so a penalty taker's rate overstates their
open-play threat. The app shows sample sizes next to every percentile; treat early-season
readings as a shortlist rather than an answer.
