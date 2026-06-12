import { describe, it, expect } from 'vitest';
import type { IRowConfig, IShipmentSheetItem, SheetInputType } from '@/types';
import type { IUndoEntry } from '@/stores/undoStore';
import { planUndo } from './useApplyUndo';

const REF = {
  firms: [{ id: 7, code: 'YGT' }, { id: 9, code: 'HJ' }],
  blocks: [{ id: 3, code: 'A' }, { id: 4, code: 'B' }],
};

function row(field_key: string, input_type: SheetInputType = 'text'): IRowConfig {
  return { row_number: 1, field_key, default_who_key: '', label_key: '', input_type, style: 'base' };
}

function ship(overrides: Partial<IShipmentSheetItem>): IShipmentSheetItem {
  return { id: 1, ...overrides } as IShipmentSheetItem;
}

describe('planUndo', () => {
  it('skips when the shipment is no longer on the sheet', () => {
    const entry: IUndoEntry = { id: 1, kind: 'cell', shipmentId: 1, rowKey: 'notes', before: 'a', after: 'b' };
    expect(planUndo(entry, undefined, row('notes'), REF)).toEqual({ action: 'skip', reason: 'gone' });
  });

  it('skips a cell entry with no resolvable rowConfig', () => {
    const entry: IUndoEntry = { id: 1, kind: 'cell', shipmentId: 1, rowKey: 'gone_row', before: 'a', after: 'b' };
    expect(planUndo(entry, ship({ notes: 'b' } as never), undefined, REF)).toEqual({
      action: 'skip',
      reason: 'unsupported',
    });
  });

  it('skips (changed) when the current value differs from the recorded after', () => {
    const entry: IUndoEntry = { id: 1, kind: 'cell', shipmentId: 1, rowKey: 'notes', before: 'old', after: 'mine' };
    // Someone (or a later edit) left a different value in the cell.
    const live = ship({ notes: 'theirs' } as never);
    expect(planUndo(entry, live, row('notes'), REF)).toEqual({ action: 'skip', reason: 'changed' });
  });

  it('plans a cell restore when the current value still matches after', () => {
    const entry: IUndoEntry = { id: 1, kind: 'cell', shipmentId: 1, rowKey: 'notes', before: 'old', after: 'mine' };
    const live = ship({ notes: 'mine' } as never);
    expect(planUndo(entry, live, row('notes'), REF)).toEqual({ action: 'cell', before: 'old' });
  });

  it('treats null/empty equivalently in the concurrent guard (FK cleared cell)', () => {
    const entry: IUndoEntry = { id: 1, kind: 'cell', shipmentId: 1, rowKey: 'country', before: 5, after: null };
    const live = ship({ country: null } as never);
    expect(planUndo(entry, live, row('country', 'dropdown'), REF)).toEqual({ action: 'cell', before: 5 });
  });

  it('reads custom_* current value from custom_fields', () => {
    const entry: IUndoEntry = { id: 1, kind: 'cell', shipmentId: 1, rowKey: 'custom_x', before: 'old', after: 'mine' };
    const live = ship({ custom_fields: { custom_x: 'mine' } } as never);
    expect(planUndo(entry, live, row('custom_x'), REF)).toEqual({ action: 'cell', before: 'old' });
  });

  it('plans a multi restore when both fields still match', () => {
    const entry: IUndoEntry = {
      id: 1, kind: 'multi', shipmentId: 1,
      before: { transit_days: 3, transport_temp_c: 6 },
      after: { transit_days: 5, transport_temp_c: 4 },
    };
    const live = ship({ transit_days: 5, transport_temp_c: 4 } as never);
    expect(planUndo(entry, live, undefined, REF)).toEqual({
      action: 'multi',
      fields: { transit_days: 3, transport_temp_c: 6 },
    });
  });

  it('skips a multi restore when either field changed', () => {
    const entry: IUndoEntry = {
      id: 1, kind: 'multi', shipmentId: 1,
      before: { transit_days: 3, transport_temp_c: 6 },
      after: { transit_days: 5, transport_temp_c: 4 },
    };
    const live = ship({ transit_days: 5, transport_temp_c: 9 } as never);
    expect(planUndo(entry, live, undefined, REF)).toEqual({ action: 'skip', reason: 'changed' });
  });

  it('resolves junction codes to ids for the reverse POST body', () => {
    const entry: IUndoEntry = {
      id: 1, kind: 'junction', shipmentId: 1, field: 'block_sources',
      before: [{ block_code: 'A' }, { block_code: 'B' }],
    };
    expect(planUndo(entry, ship({}), undefined, REF)).toEqual({
      action: 'junction', endpoint: 'block-sources', key: 'blocks',
      items: [{ block_id: 3 }, { block_id: 4 }],
    });
  });

  it('uses export_firm_id for firm_splits', () => {
    const entry: IUndoEntry = {
      id: 1, kind: 'junction', shipmentId: 1, field: 'firm_splits',
      before: [{ firm_code: 'YGT' }],
    };
    expect(planUndo(entry, ship({}), undefined, REF)).toEqual({
      action: 'junction', endpoint: 'firm-splits', key: 'firms', items: [{ export_firm_id: 7 }],
    });
  });

  it('skips a junction restore when a code no longer resolves (deactivated firm/block)', () => {
    const entry: IUndoEntry = {
      id: 1, kind: 'junction', shipmentId: 1, field: 'block_sources',
      before: [{ block_code: 'GONE' }],
    };
    expect(planUndo(entry, ship({}), undefined, REF)).toEqual({ action: 'skip', reason: 'unsupported' });
  });

  it('plans an empty junction restore (reverting an add back to empty)', () => {
    const entry: IUndoEntry = { id: 1, kind: 'junction', shipmentId: 1, field: 'firm_splits', before: [] };
    expect(planUndo(entry, ship({}), undefined, REF)).toEqual({
      action: 'junction', endpoint: 'firm-splits', key: 'firms', items: [],
    });
  });

  it('plans a varieties restore from the recorded ids', () => {
    const entry: IUndoEntry = {
      id: 1, kind: 'varieties', shipmentId: 1,
      before: [{ id: 11, name: 'X' }, { id: 12, name: 'Y' }],
    };
    expect(planUndo(entry, ship({}), undefined, REF)).toEqual({ action: 'varieties', varietyIds: [11, 12] });
  });

  it('skips a varieties restore that would clear to empty (override no-ops on empty)', () => {
    const entry: IUndoEntry = { id: 1, kind: 'varieties', shipmentId: 1, before: [] };
    expect(planUndo(entry, ship({}), undefined, REF)).toEqual({ action: 'skip', reason: 'unsupported' });
  });
});
