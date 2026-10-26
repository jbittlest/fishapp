/* Display formatting shared by the spots feature (lists, cards, saved areas). Pure. */

/** "Oct 25" for this year, "Oct 25, 2025" otherwise — short enough for a list's secondary line. */
export function shortDate(ms: number, now: number = Date.now()): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
