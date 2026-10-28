/** A positive integer id from a query-string value (e.g. `?account=3`), or ""
 * when it's missing or not a usable id, meaning "all". */
export function parseIdParam(value: string | null): number | "" {
  const id = Number(value);
  return value && Number.isInteger(id) && id > 0 ? id : "";
}
