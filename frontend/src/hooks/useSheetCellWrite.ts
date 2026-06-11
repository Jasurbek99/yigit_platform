import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig } from '@/types';
import api from '@/services/api';
import { useShipmentPatch, extractPatchError, applyOptimistic } from './useShipmentPatch';

// When clearing/replacing an FK field the cell still renders from cached
// companion fields (`country_name`, `country_code`, `country_color`, …) until
// the PATCH response reconciles them. Pre-nulling these makes the cell flip
// empty instantly; the authoritative server response overwrites them on success.
const FK_CLEAR_COMPANION_FIELDS: Record<string, readonly (keyof IShipmentSheetItem)[]> = {
  country: ['country_name', 'country_code', 'country_color'],
  city: ['city_name', 'city_color'],
  customer: ['customer_name', 'customer_color'],
  import_firm: ['import_firm_name', 'import_firm_color'],
  variety: ['variety_name', 'variety_code', 'variety_color'],
  border_point: ['border_point_name', 'border_point_color'],
  vehicle_responsible: ['vehicle_responsible_display'],
};

/** Junction-backed sheet fields (live in related tables, saved via POST endpoints). */
export function isJunctionField(rowConfig: IRowConfig): boolean {
  return rowConfig.field_key === 'firm_splits' || rowConfig.field_key === 'block_sources';
}

/** Free-text input types whose value is a plain string (safe for cross-field paste). */
export function isFreeTextType(inputType: string): boolean {
  return inputType === 'text' || inputType === 'phone';
}

/**
 * Whether a cell's value can be cleared/deleted. Excludes the primary identifier
 * and read-only computed flags, plus the bool-backed dropdowns (peregruz /
 * gornushi) which are 0/1 — "no" is picked from the dropdown, not cleared.
 */
export function isClearableField(rowConfig: IRowConfig): boolean {
  const isBoolDropdown =
    rowConfig.options_source === 'peregruz' || rowConfig.options_source === 'gornushi';
  return (
    rowConfig.field_key !== 'cargo_code' &&
    rowConfig.field_key !== 'has_doc_advance' &&
    rowConfig.field_key !== 'has_sales_report' &&
    !isBoolDropdown
  );
}

interface ICustomFieldVars {
  shipmentId: number;
  fieldKey: string;
  value: string;
}

interface IJunctionClearVars {
  shipmentId: number;
  endpoint: string;
  key: string;
  field: 'firm_splits' | 'block_sources';
}

/**
 * Shared cell write/clear engine for the Sheet. Routes a value to the correct
 * typed save path (standard PATCH, custom-field endpoint, junction POST) and
 * exposes a clear() that mirrors the right-click "Clear cell" behaviour. Used by
 * SheetCell (context menu) and useSheetClipboard (cut / paste / Delete) so all
 * write paths stay identical and optimistic.
 */
export function useSheetCellWrite() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const patchMutation = useShipmentPatch();

  // Custom rows (Phase 5c) live outside the Shipment model. One mutation handles
  // both set (paste) and clear (value=''). Optimistic so the cell updates before
  // the request lands; no success refetch (there are no server-computed
  // companions to reconcile, and a sheet refetch would re-introduce edit lag).
  const customFieldMutation = useMutation<unknown, unknown, ICustomFieldVars, { previous: unknown }>({
    mutationFn: async ({ shipmentId, fieldKey, value }) => {
      await api.patch(`/export/shipments/${shipmentId}/custom-fields/`, { field_key: fieldKey, value });
    },
    onMutate: async ({ shipmentId, fieldKey, value }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments', 'sheet'] });
      const previous = queryClient.getQueryData(['shipments', 'sheet']);
      queryClient.setQueryData(['shipments', 'sheet'], (old: unknown) => {
        const cache = old as { shipments?: IShipmentSheetItem[] } | undefined;
        if (!cache || !Array.isArray(cache.shipments)) return old;
        return {
          ...cache,
          shipments: cache.shipments.map((s) =>
            s.id === shipmentId
              ? { ...s, custom_fields: { ...(s.custom_fields ?? {}), [fieldKey]: value } }
              : s,
          ),
        };
      });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['shipments', 'sheet'], ctx.previous);
      }
      toast.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[useSheetCellWrite] custom-field PATCH failed', err);
    },
  });

  // Junction clears (firm_splits / block_sources) POST an empty array. Optimistic
  // wipe with rollback; the junction endpoints return only {status, count} so
  // there is nothing to reconcile.
  const clearJunctionMutation = useMutation<unknown, unknown, IJunctionClearVars, { previous: unknown }>({
    mutationFn: async ({ shipmentId, endpoint, key }) => {
      await api.post(`/export/shipments/${shipmentId}/${endpoint}/`, { [key]: [] });
    },
    onMutate: async ({ shipmentId, field }) => {
      await queryClient.cancelQueries({ queryKey: ['shipments', 'sheet'] });
      const previous = queryClient.getQueryData(['shipments', 'sheet']);
      queryClient.setQueryData(['shipments', 'sheet'], (old: unknown) => {
        const cache = old as { shipments?: IShipmentSheetItem[] } | undefined;
        if (!cache || !Array.isArray(cache.shipments)) return old;
        return {
          ...cache,
          shipments: cache.shipments.map((s) =>
            s.id === shipmentId ? { ...s, [field]: [] } : s,
          ),
        };
      });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['shipments', 'sheet'], ctx.previous);
      }
      toast.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[useSheetCellWrite] clear junction failed', err);
    },
  });

  /**
   * Write a value into a cell via its typed save path. Junction fields are NOT
   * supported here (callers must reject paste into them); use the inline
   * multiselect editor for those.
   */
  const writeCell = useCallback(
    (shipment: IShipmentSheetItem, rowConfig: IRowConfig, value: unknown) => {
      const fieldKey = rowConfig.field_key;
      if (fieldKey.startsWith('custom_')) {
        customFieldMutation.mutate({
          shipmentId: shipment.id,
          fieldKey,
          value: typeof value === 'string' ? value : String(value ?? ''),
        });
        return;
      }
      patchMutation.mutate({ id: shipment.id, field: fieldKey, value });
    },
    [patchMutation, customFieldMutation],
  );

  /** Clear a cell's value, routing by field type (custom / junction / FK / scalar). */
  const clearCell = useCallback(
    (shipment: IShipmentSheetItem, rowConfig: IRowConfig) => {
      const fieldKey = rowConfig.field_key;
      if (fieldKey.startsWith('custom_')) {
        customFieldMutation.mutate({ shipmentId: shipment.id, fieldKey, value: '' });
        return;
      }
      if (rowConfig.input_type === 'multiselect') {
        if (fieldKey === 'firm_splits') {
          clearJunctionMutation.mutate({
            shipmentId: shipment.id,
            endpoint: 'firm-splits',
            key: 'firms',
            field: 'firm_splits',
          });
        } else if (fieldKey === 'block_sources') {
          clearJunctionMutation.mutate({
            shipmentId: shipment.id,
            endpoint: 'block-sources',
            key: 'blocks',
            field: 'block_sources',
          });
        }
        return;
      }
      // FK clears: pre-null the cached companion fields so the cell flips empty on
      // the next render; patchMutation's own optimistic update sets the FK id null
      // and its reconcileFromServer overwrites everything on success.
      const companions = FK_CLEAR_COMPANION_FIELDS[fieldKey];
      if (companions && companions.length) {
        applyOptimistic(
          queryClient,
          shipment.id,
          Object.fromEntries(companions.map((k) => [k, null])),
        );
      }
      patchMutation.mutate({ id: shipment.id, field: fieldKey, value: null });
    },
    [patchMutation, customFieldMutation, clearJunctionMutation, queryClient],
  );

  return { writeCell, clearCell };
}
