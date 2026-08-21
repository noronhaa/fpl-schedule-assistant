/**
 * The five-step colour scale the official FPL fixture ticker uses for FDR.
 * Kept as raw hex so the cells look identical in light and dark mode — these
 * are saturated enough to hold their own against either background.
 */
export const FDR_COLORS: Record<number, { bg: string; fg: string; label: string }> = {
  1: { bg: "#375523", fg: "#ffffff", label: "Very easy" },
  2: { bg: "#01fc7a", fg: "#08170f", label: "Easy" },
  3: { bg: "#e7e7e7", fg: "#1d1d1d", label: "Average" },
  4: { bg: "#ff1751", fg: "#ffffff", label: "Hard" },
  5: { bg: "#80072d", fg: "#ffffff", label: "Very hard" },
};

const NEUTRAL = { bg: "#9ca3af", fg: "#ffffff", label: "Unknown" };

export function fdrStyle(fdr: number) {
  return FDR_COLORS[Math.min(5, Math.max(1, Math.round(fdr)))] ?? NEUTRAL;
}

/**
 * Blends between the five ticker colours so an averaged run (e.g. 2.4) gets a
 * colour that sits between "easy" and "average" rather than snapping to one.
 */
export function fdrGradient(avg: number): { bg: string; fg: string } {
  const clamped = Math.min(5, Math.max(1, avg));
  const lower = Math.floor(clamped);
  const upper = Math.min(5, lower + 1);
  const t = clamped - lower;
  const a = FDR_COLORS[lower];
  const b = FDR_COLORS[upper];
  const mix = (x: string, y: string) => {
    const px = parseInt(x.slice(1), 16);
    const py = parseInt(y.slice(1), 16);
    const c = (shift: number) => {
      const v = Math.round((((px >> shift) & 255) * (1 - t)) + (((py >> shift) & 255) * t));
      return v.toString(16).padStart(2, "0");
    };
    return `#${c(16)}${c(8)}${c(0)}`;
  };
  return {
    bg: mix(a.bg, b.bg),
    // Pick the text colour of whichever end of the blend we're closest to.
    fg: t < 0.5 ? a.fg : b.fg,
  };
}

export function crestUrl(teamCode: number): string {
  return `https://resources.premierleague.com/premierleague/badges/70/t${teamCode}.png`;
}
