import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { IRowConfig, IShipmentSheetItem } from '@/types';
import api from '@/services/api';
import { useUndoStore, type IUndoEntry } from '@/stores/undoStore';
import { useSheetCellWrite } from './useSheetCellWrite';
import { useShipmentPatchMulti, extractPatchError } from './useShipmentPatch';
import { useAdminFirms, useGreenhouseBlocks } from './useAdmin';

interface IUndoRefData {
  firms: Array<{ id: number; code: string }>;
  blocks: Array<{ id: number; code: string }>;
}

export type IUndoPlan =
  | { action: 'cell'; before: unknown }
  | { action: 'multi'; fields: Record<string, unknown> }
  | { action: 'junction'; endpoint: string; key: string; items: Array<Record<string, number>> }
  | { action: 'varieties'; varietyIds: number[] }
  | { action: 'skip'; reason: 'gone' | 'changed' | 'unsupported' };

function normalize(value: unknown): string {
  return value == null ? '' : String(value);
}

function rawCurrentValue(shipment: IShipmentSheetItem, rowConfig: IRowConfig): unknown {
  if (rowConfig.field_key.startsWith('custom_')) {
    return shipment.custom_fields?.[rowConfig.field_key] ?? '';
  }
  return shipment[rowConfig.field_key as keyof IShipmentSheetItem];
}

/**
 * Pure decision for how to reverse one undo entry. Resolves the concurrent-edit
 * guard (current value vs the entry's reconciled `after`), junction code→id, and
 * the unrecoverable cases (missing shipment, deactivated firm/block, empty
 * varieties). Extracted from applyUndo so the matrix is unit-testable.
 */
export function planUndo(
  entry: IUndoEntry,
  liveShipment: IShipmentSheetItem | undefined,
  rowConfig: IRowConfig | undefined,
  refData: IUndoRefData,
): IUndoPlan {
  if (!liveShipment) return { action: 'skip', reason: 'gone' };

  switch (entry.kind) {
    case 'cell': {
      if (!rowConfig) return { action: 'skip', reason: 'unsupported' };
      const current = rawCurrentValue(liveShipment, rowConfig);
      // Concurrent guard: the cell changed since the recorded edit — don't clobber.
      if (normalize(current) !== normalize(entry.after)) {
        return { action: 'skip', reason: 'changed' };
      }
      return { action: 'cell', before: entry.before };
    }
    case 'multi': {
      const after = entry.after;
      if (
        normalize(liveShipment.transit_days) !== normalize(after.transit_days) ||
        normalize(liveShipment.transport_temp_c) !== normalize(after.transport_temp_c)
      ) {
        return { action: 'skip', reason: 'changed' };
      }
      return { action: 'multi', fields: entry.before };
    }
    case 'junction': {
      // NOTE: junctions carry no reconciled `after`, so (unlike cell/multi)
      // there is no concurrent-edit guard here — a junction undo re-POSTs the
      // recorded membership even if someone changed it since. This is a separate
      // gap from the cascade limitation (the POST endpoints echo no status).
      const isFirms = entry.field === 'firm_splits';
      const refs = isFirms ? refData.firms : refData.blocks;
      const idKey = isFirms ? 'export_firm_id' : 'block_id';
      const items: Array<Record<string, number>> = [];
      for (const row of entry.before) {
        const code = isFirms ? row.firm_code : row.block_code;
        const ref = refs.find((r) => r.code === code);
        // Deactivated/removed firm or block → can't rebuild the POST body.
        if (!ref) return { action: 'skip', reason: 'unsupported' };
        items.push({ [idKey]: ref.id });
      }
      return {
        action: 'junction',
        endpoint: isFirms ? 'firm-splits' : 'block-sources',
        key: isFirms ? 'firms' : 'blocks',
        items,
      };
    }
    case 'varieties': {
      // varieties/override no-ops on empty, so "was empty" can't be restored.
      if (entry.before.length === 0) return { action: 'skip', reason: 'unsupported' };
      return { action: 'varieties', varietyIds: entry.before.map((v) => v.id) };
    }
  }
}

interface IJunctionRevVars {
  shipmentId: number;
  endpoint: string;
  body: Record<string, unknown>;
}

/**
 * Returns `applyUndo` — pops the most-recent Sheet cell write and replays its
 * reverse. Restores the VALUE only; when the original edit advanced the status,
 * a toast warns that the status advance was not reverted. Sets `isUndoing` so
 * the reverse write (which goes through writeCell) doesn't re-capture itself.
 */
export function useApplyUndo(
  shipments: IShipmentSheetItem[],
  rows: IRowConfig[],
): () => Promise<void> {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { writeCell } = useSheetCellWrite();
  const patchMulti = useShipmentPatchMulti();
  const { data: firms } = useAdminFirms();
  const { data: blocks } = useGreenhouseBlocks();

  // Junction / varieties reverse: re-POST the prior membership. These endpoints
  // recompute weight_kg, so invalidate the sheet (unlike the optimistic clears).
  const junctionRev = useMutation<unknown, unknown, IJunctionRevVars>({
    mutationFn: async ({ shipmentId, endpoint, body }) => {
      await api.post(`/export/shipments/${shipmentId}/${endpoint}/`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
    onError: (err) => {
      toast.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[useApplyUndo] junction reverse failed', err);
    },
  });

  return useCallback(
    async () => {
      const entry = useUndoStore.getState().popUndo();
      if (!entry) {
        toast.warning(t('sheet.undo_nothing'));
        return;
      }

      const liveShipment = shipments.find((s) => s.id === entry.shipmentId);
      const rowConfig =
        entry.kind === 'cell' ? rows.find((r) => r.field_key === entry.rowKey) : undefined;
      const refData: IUndoRefData = {
        firms: (firms ?? []).map((f) => ({ id: f.id, code: f.code })),
        blocks: (blocks ?? []).map((b) => ({ id: b.id, code: b.code })),
      };
      const plan = planUndo(entry, liveShipment, rowConfig, refData);

      if (plan.action === 'skip') {
        // The entry is intentionally consumed (already popped): an informative
        // toast tells the user why, and keeping an un-undoable entry on top
        // would block undo of every older edit beneath it.
        const key =
          plan.reason === 'gone'
            ? 'sheet.undo_cell_gone'
            : plan.reason === 'changed'
              ? 'sheet.undo_cell_changed'
              : 'sheet.undo_unsupported';
        toast.warning(t(key));
        return;
      }

      useUndoStore.getState().setUndoing(true);
      try {
        if (plan.action === 'cell') {
          // liveShipment + rowConfig are guaranteed defined for a 'cell' plan.
          writeCell(liveShipment as IShipmentSheetItem, rowConfig as IRowConfig, plan.before);
        } else if (plan.action === 'multi') {
          patchMulti.mutate({ id: entry.shipmentId, fields: plan.fields });
        } else if (plan.action === 'junction') {
          junctionRev.mutate({
            shipmentId: entry.shipmentId,
            endpoint: plan.endpoint,
            body: { [plan.key]: plan.items },
          });
        } else {
          junctionRev.mutate({
            shipmentId: entry.shipmentId,
            endpoint: 'varieties/override',
            body: { variety_ids: plan.varietyIds },
          });
        }
      } finally {
        // Clear after the synchronous recordCellEntry inside writeCell has run.
        queueMicrotask(() => useUndoStore.getState().setUndoing(false));
      }

      if ((entry.kind === 'cell' || entry.kind === 'multi') && entry.cascade) {
        toast.warning(
          t('sheet.undo_cascade_warning', {
            from: entry.cascade.from ?? '',
            to: entry.cascade.to ?? '',
          }),
        );
      }
    },
    // Stable .mutate refs (see useSheetCellWrite note) so SheetGrid's keydown
    // listener isn't re-bound every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shipments, rows, firms, blocks, writeCell, patchMulti.mutate, junctionRev.mutate, t],
  );
}
