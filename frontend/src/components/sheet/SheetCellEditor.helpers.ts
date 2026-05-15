// Empty input → null (clears the cell). Non-finite parse → null (rejects garbage).
// Crucially, a literal `0` must round-trip as `0` and not become null —
// rejected_weight_kg=0 means "no rejection" which is distinct from "not measured yet".
export function parseNumberInput(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
