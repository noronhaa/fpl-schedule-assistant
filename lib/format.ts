const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a gameweek deadline as "12 Sep", identically on server and client.
 *
 * Deliberately not toLocaleDateString. With no explicit locale it resolves to
 * whatever each runtime defaults to, so Node rendered "Sep 12" while a browser
 * set to en-GB rendered "12 Sept" — a hydration mismatch that made React throw
 * away the whole ticker and re-render it. Pinning a locale is not enough on its
 * own either: the "Sep" / "Sept" abbreviation depends on the ICU data a given
 * runtime ships, and the local timezone can still put the two on different
 * days. Fixed month names plus UTC parts are the same everywhere.
 */
export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
