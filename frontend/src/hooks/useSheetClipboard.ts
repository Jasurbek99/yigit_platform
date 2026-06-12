import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ICurrentUser, IRowConfig, IShipmentSheetItem, ISheetRowSettingForUser } from '@/types';
import { useSheetStore, type ISheetClipboardEntry } from '@/stores/sheetStore';
import { useShipmentOptions } from '@/hooks/useAdmin';
import { isCellEditable } from '@/utils/sheetPermissions';
import { getCellValue } from '@/components/sheet/getCellValue';
import {
  useSheetCellWrite,
  isJunctionField,
  isFreeTextType,
  isClearableField,
} from './useSheetCellWrite';

interface IResolvedCell {
  shipment: IShipmentSheetItem;
  rowConfig: IRowConfig;
}

/**
 * Pure paste-routing decision for the in-app-clipboard case (read-only and
 * junction targets are rejected by the caller before this runs):
 *   • same field            → write the stored raw value via the field's save path
 *   • both sides free-text   → write the display text (text↔phone only)
 *   • otherwise              → reject (no FK↔string / code coercion across types)
 * Extracted as a pure function so the matrix is unit-testable.
 */
export type PasteDecision =
  | { kind: 'raw' }
  | { kind: 'text' }
  | { kind: 'reject' };

export function decidePaste(target: IRowConfig, clip: ISheetClipboardEntry): PasteDecision {
  if (clip.fieldKey === target.field_key) return { kind: 'raw' };
  if (isFreeTextType(target.input_type) && isFreeTextType(clip.inputType)) return { kind: 'text' };
  return { kind: 'reject' };
}

/**
 * Google-Sheets-style clipboard for the Sheet's single active cell:
 *   • Ctrl+C  → copy (raw value to internal clipboard + display text to OS clipboard)
 *   • Ctrl+X  → cut  (copy, then clear the source cell)
 *   • Ctrl+V  → paste into the active cell, routed through the typed save path
 *   • Delete  → clear the active cell
 *
 * Paste is type-safe: same-field pastes carry the raw value through the field's
 * own save path; cross-field pastes are limited to free-text↔free-text. Junction
 * and read-only targets are rejected with a toast. (Range selection and Ctrl+Z
 * undo are deliberately out of scope for this pass.)
 */
export function useSheetClipboard(
  shipments: IShipmentSheetItem[],
  rows: IRowConfig[],
  rowSettings: Record<string, ISheetRowSettingForUser>,
  user: ICurrentUser | null,
) {
  const { t } = useTranslation();
  const { data: options } = useShipmentOptions();
  const { writeCell, clearCell } = useSheetCellWrite();
  const setClipboard = useSheetStore((s) => s.setClipboard);
  const setEditingCell = useSheetStore((s) => s.setEditingCell);

  const resolveActiveCell = useCallback((): IResolvedCell | null => {
    const { activeCell } = useSheetStore.getState();
    if (!activeCell) return null;
    const shipment = shipments.find((s) => s.id === activeCell.shipmentId);
    const rowConfig = rows.find((r) => r.field_key === activeCell.rowKey);
    if (!shipment || !rowConfig) return null;
    return { shipment, rowConfig };
  }, [shipments, rows]);

  const readRawValue = useCallback(
    (shipment: IShipmentSheetItem, rowConfig: IRowConfig): unknown => {
      if (rowConfig.field_key.startsWith('custom_')) {
        return shipment.custom_fields?.[rowConfig.field_key] ?? '';
      }
      return shipment[rowConfig.field_key as keyof IShipmentSheetItem];
    },
    [],
  );

  const copyActiveCell = useCallback(() => {
    const ctx = resolveActiveCell();
    if (!ctx) return;
    const { shipment, rowConfig } = ctx;
    const displayText = getCellValue(shipment, rowConfig, options);
    setClipboard({
      fieldKey: rowConfig.field_key,
      inputType: rowConfig.input_type,
      rawValue: readRawValue(shipment, rowConfig),
      displayText,
    });
    // Mirror to the OS clipboard so external paste (Excel, etc.) gets the
    // formatted text. Best-effort: writeText is gesture-gated and can reject.
    void navigator.clipboard
      ?.writeText?.(displayText === '—' ? '' : displayText)
      .catch(() => {});
    toast.success(t('sheet.cell_copied'));
  }, [resolveActiveCell, options, setClipboard, readRawValue, t]);

  const cutActiveCell = useCallback(() => {
    const ctx = resolveActiveCell();
    if (!ctx) return;
    const { shipment, rowConfig } = ctx;
    copyActiveCell();
    // Clear only when the cell is editable and clearable and not already empty.
    if (!isCellEditable(rowConfig, rowSettings, user) || !isClearableField(rowConfig)) return;
    const value = getCellValue(shipment, rowConfig, options);
    if (value && value !== '—') clearCell(shipment, rowConfig);
  }, [resolveActiveCell, copyActiveCell, rowSettings, user, options, clearCell]);

  const deleteActiveCell = useCallback(() => {
    const ctx = resolveActiveCell();
    if (!ctx) return;
    const { shipment, rowConfig } = ctx;
    if (!isCellEditable(rowConfig, rowSettings, user) || !isClearableField(rowConfig)) return;
    const value = getCellValue(shipment, rowConfig, options);
    if (!value || value === '—') return;
    clearCell(shipment, rowConfig);
  }, [resolveActiveCell, rowSettings, user, options, clearCell]);

  const pasteActiveCell = useCallback(async () => {
    const ctx = resolveActiveCell();
    if (!ctx) return;
    const { shipment, rowConfig } = ctx;

    if (!isCellEditable(rowConfig, rowSettings, user)) {
      toast.warning(t('sheet.paste_readonly'));
      return;
    }
    // Junction cells (firm_splits / block_sources) need the inline multiselect
    // editor — pasting a raw array is unreliable, so reject explicitly.
    if (isJunctionField(rowConfig)) {
      toast.warning(t('sheet.paste_unsupported'));
      return;
    }

    const clip = useSheetStore.getState().clipboard;
    if (clip) {
      const decision = decidePaste(rowConfig, clip);
      if (decision.kind === 'raw') {
        writeCell(shipment, rowConfig, clip.rawValue);
      } else if (decision.kind === 'text') {
        writeCell(shipment, rowConfig, clip.displayText === '—' ? '' : clip.displayText);
      } else {
        toast.warning(t('sheet.paste_incompatible'));
      }
      return;
    }

    // No in-app clipboard (e.g. text copied from another app) → try the OS
    // clipboard for a free-text target. `navigator.clipboard.readText` is
    // unavailable in an insecure context (the plain-http beta server) and may
    // be permission-blocked; when it can't deliver text, open the cell editor
    // so the user can paste natively — a native Ctrl+V into the focused input
    // works even when the clipboard API is blocked.
    if (isFreeTextType(rowConfig.input_type)) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          writeCell(shipment, rowConfig, text);
          return;
        }
      } catch {
        // fall through to opening the editor
      }
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.field_key });
      return;
    }
    toast.warning(t('sheet.paste_nothing'));
  }, [resolveActiveCell, rowSettings, user, t, writeCell, setEditingCell]);

  return { copyActiveCell, cutActiveCell, pasteActiveCell, deleteActiveCell };
}
