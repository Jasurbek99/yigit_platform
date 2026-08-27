/** Case-insensitive substring match used by every section's search box. */
export function matchesSearch(search: string, ...values: string[]): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(needle));
}
