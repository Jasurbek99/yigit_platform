/**
 * Plate search for the gate guard. Guards type on phones with a Russian
 * keyboard, so Cyrillic letters that look like Latin plate letters are folded,
 * along with case, spaces and dashes.
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
};

export function normalizePlate(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[АВЕКМНОРСТХ]/g, (ch) => LOOKALIKES[ch] ?? ch);
}

export function plateMatches(query: string, ...plates: (string | null | undefined)[]): boolean {
  const needle = normalizePlate(query);
  if (!needle) return true;
  return plates.some((plate) => plate != null && normalizePlate(plate).includes(needle));
}
