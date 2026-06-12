import type { IRowConfig, IShipmentSheetItem, ISheetFirmSplit, ISheetBlockSource } from '@/types';
import { useUndoStore, type IUndoCascade } from '@/stores/undoStore';

// Capture helpers for the Sheet undo stack. Plain functions (not a hook) — they
// operate on the undo store singleton, so they can be called from any write site
// (the inline editor, the clipboard write engine) without prop-drilling.

/** Normalize a cell value for equality checks (FK ids, decimals-as-strings, null). */
function normalize(value: unknown): string {
  return value == null ? '' : String(value);
}

/** The reconciled `after` value for a scalar cell, read from the PATCH response. */
export function reconciledCellValue(data: Record<string, unknown>, rowConfig: IRowConfig): unknown {
  return data[rowConfig.field_key];
}

/**
 * Build a cascade descriptor when an edit advanced the shipment's lifecycle
 * status. Compares the pre-edit `status_code` to the PATCH response's. Returns
 * undefined when the status is unchanged (the common case).
 */
export function cascadeFrom(
  before: Pick<IShipmentSheetItem, 'status_code' | 'status_display'>,
  data: Record<string, unknown>,
): IUndoCascade | undefined {
  const afterCode = data.status_code;
  if (typeof afterCode === 'string' && afterCode && afterCode !== before.status_code) {
    return {
      from: before.status_display ?? null,
      to: typeof data.status_display === 'string' ? data.status_display : null,
    };
  }
  return undefined;
}

/**
 * Record a scalar / custom_* / FK cell edit. `before` is the pre-edit cached
 * value, `sentValue` what the edit is writing. Skips no-op saves (before ===
 * sent) and bails during undo. Returns the entry id, or -1 when not recorded.
 */
export function recordCellEntry(
  shipmentId: number,
  rowKey: string,
  before: unknown,
  sentValue: unknown,
): number {
  if (normalize(before) === normalize(sentValue)) return -1;
  return useUndoStore.getState().pushUndo({
    kind: 'cell',
    shipmentId,
    rowKey,
    before,
    after: sentValue, // provisional; overwritten with the reconciled value onSuccess
  });
}

/** Record the R26 transit_days_temp multi-field edit. */
export function recordMultiEntry(
  shipmentId: number,
  before: Record<string, unknown>,
  sentFields: Record<string, unknown>,
): number {
  return useUndoStore.getState().pushUndo({
    kind: 'multi',
    shipmentId,
    before,
    after: sentFields,
  });
}

/**
 * Record a junction (firm_splits / block_sources) edit; before is the cached
 * array. Callers pass the matching cached array (`shipment.firm_splits` for
 * 'firm_splits', `shipment.block_sources` for 'block_sources').
 */
export function recordJunctionEntry(
  shipmentId: number,
  field: 'firm_splits' | 'block_sources',
  before: ISheetFirmSplit[] | ISheetBlockSource[],
): number {
  return useUndoStore.getState().pushUndo({ kind: 'junction', shipmentId, field, before });
}

/** Record a varieties_dominant (R38) edit; before is the cached {id,name} list. */
export function recordVarietiesEntry(
  shipmentId: number,
  before: Array<{ id: number; name: string }>,
): number {
  return useUndoStore.getState().pushUndo({ kind: 'varieties', shipmentId, before });
}

/** Install the reconciled `after` + optional cascade once the PATCH resolves. */
export function setEntryAfter(id: number, after: unknown, cascade?: IUndoCascade): void {
  if (id === -1) return;
  useUndoStore.getState().patchAfter(id, after, cascade);
}

/** Drop an entry whose write rolled back (per-call onError). */
export function dropEntry(id: number): void {
  if (id === -1) return;
  useUndoStore.getState().removeUndo(id);
}
