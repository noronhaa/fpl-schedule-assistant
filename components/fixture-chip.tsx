import type { Match, Team } from "@/lib/fpl";
import { fdrStyle } from "@/lib/difficulty";

/**
 * A single fixture, coloured by FDR. Shared by the ticker and the compare view
 * so both read the same way: uppercase opponent = home, lowercase + ring = away.
 */
export default function FixtureChip({
  match,
  opponent,
  compact = false,
}: {
  match: Match;
  opponent?: Team;
  /** Tighter type for the narrow player cards in the compare view. */
  compact?: boolean;
}) {
  const style = fdrStyle(match.fdr);
  const short = opponent?.short ?? "???";
  return (
    <div
      className={`rounded-md text-center leading-none ${compact ? "px-0.5 py-1" : "px-1 py-1"} ${
        match.home ? "" : "ring-1 ring-inset ring-black/25"
      }`}
      style={{ backgroundColor: style.bg, color: style.fg }}
      title={`${opponent?.name ?? "Unknown"} (${match.home ? "home" : "away"}) — difficulty ${match.fdr}: ${style.label}`}
    >
      <div className={`font-extrabold tracking-wide ${compact ? "text-[10px]" : "text-[11px]"}`}>
        {match.home ? short.toUpperCase() : short.toLowerCase()}
      </div>
      <div className={`mt-0.5 font-semibold opacity-75 ${compact ? "text-[8px]" : "text-[9px]"}`}>
        {match.home ? "H" : "A"} · {match.fdr}
      </div>
    </div>
  );
}
