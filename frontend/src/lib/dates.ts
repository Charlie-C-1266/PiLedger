/**
 * A calendar day as `YYYY-MM-DD` in the user's own timezone — what a date
 * input shows. Never via `toISOString()`, which reads the day in UTC and so
 * gives yesterday between midnight and the UTC offset (00:00–01:00 in a UK
 * summer, say).
 */
export function localIsoDate(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
