import { useCallback, useEffect, useRef } from 'react';
import { Button, DatePicker, Input, InputNumber, Select } from 'antd';
import dayjs from 'dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useShipmentPatch, useShipmentPatchMulti, extractPatchError } from '@/hooks/useShipmentPatch';
import {
  recordCellEntry,
  recordMultiEntry,
  recordJunctionEntry,
  recordVarietiesEntry,
  setEntryAfter,
  dropEntry,
  reconciledCellValue,
  cascadeFrom,
} from '@/hooks/undoCapture';
import api from '@/services/api';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';
import {
  useCountries,
  useCities,
  useCustomers,
  useAdminFirms,
  useAdminImportFirms,
  useGreenhouseBlocks,
  useTomatoVarieties,
  useBorderPoints,
  useShipmentOptions,
} from '@/hooks/useAdmin';
import { useQuotaFirmBalances } from '@/hooks/useQuotaDashboard';
import { firmHasNoQuota as isFirmBlocked } from '@/utils/quotaFirms';
import { QuotaPageLink } from '@/components/QuotaPageLink';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';
import { parseNumberInput } from './SheetCellEditor.helpers';
import SheetTruckSelectEditor from './SheetTruckSelectEditor';
import SheetDriverSelectEditor from './SheetDriverSelectEditor';
import type { TSheetVariant } from '@/stores/sheetStore';

interface ISheetCellEditorProps {
  shipment: IShipmentSheetItem;
  rowConfig: IRowConfig;
  /**
   * Sheet design variant, for cell sizing only. Passed down by `SheetGrid`;
   * NOT read from the store, because this editor is also rendered outside the
   * Sheet (`SelfBoardShipmentFieldList`), where the `.sheet-grid--ios` skin
   * does not apply — reading the store there would resize the drawer's inputs
   * to match a preference the user set on a different page. Defaults to
   * classic so every non-Sheet call site keeps its current size.
   */
  variant?: TSheetVariant;
}

export function SheetCellEditor({ shipment, rowConfig, variant = 'classic' }: ISheetCellEditorProps) {
  const { t, i18n } = useTranslation();
  const setEditingCell = useSheetStore((s) => s.setEditingCell);
  // Google-Sheets type-to-edit: the character that opened this editor (null if
  // opened via Enter/click). Text/phone/number seed their initial value with
  // it, replacing the cell's current content.
  const editSeed = useSheetStore((s) => s.editSeed);
  // Type-to-edit commit-and-hop: when seeded, an arrow key commits the value
  // and moves the selection one cell in that direction (Google Sheets parity).
  const setPendingNav = useSheetStore((s) => s.setPendingNav);
  const sheetZoom = useSheetStore((s) => s.sheetZoom);
  const { colShipment: COL_WIDTH_SHIPMENT, rowHeight: ROW_HEIGHT } = scaleSheetLayout(sheetZoom, variant);
  const patchMutation = useShipmentPatch();
  const patchMultiMutation = useShipmentPatchMulti();
  const containerRef = useRef<HTMLDivElement>(null);
  // Multi-select cells (firm_splits, block_sources) defer saving until the
  // dropdown closes — saving on each pick would unmount the editor mid-edit.
  const pendingMultiRef = useRef<number[] | null>(null);
  // Guards against a double save when the "Done" button blurs the Select and
  // also triggers the click-outside (onOpenChange) commit path.
  const multiCommittedRef = useRef(false);

  // Reference data hooks
  const { data: countries } = useCountries();
  const { data: cities } = useCities(shipment.country);
  const { data: customers } = useCustomers();
  const { data: exportFirms } = useAdminFirms();
  const { data: importFirms } = useAdminImportFirms();
  const { data: blocks } = useGreenhouseBlocks();
  const { data: varieties } = useTomatoVarieties();
  const { data: borderPoints } = useBorderPoints();
  // Fetch all shipment options at once (cached, 5 categories)
  const { data: allOptions } = useShipmentOptions();

  // Per-firm remaining quota — only fetched when editing the firm_splits cell
  // (the only roles that can edit it also hold quota_issuance view). Drives the
  // non-blocking "no quota" warning. Defaults to 'tomato' because product_type
  // isn't on the sheet payload; pepper is a rare separate quota domain.
  // The hook reads the GLOBAL season switcher while the server blocks against
  // `shipment.season` (D11) — safe only because every surface that renders this
  // editor is scoped by that same switcher: the sheet list sends `?season=` and
  // the task drawer's `/me/tasks/` is scoped on `shipment__season`. A surface
  // that opens a shipment outside the selected season (the `?shipment=` sheet
  // branch bypasses season scoping on its own) would make the ⚠ tags and the
  // 400 from firm-splits disagree — thread the row's season in if that happens.
  const isFirmsCell = rowConfig.field_key === 'firm_splits';
  const { data: firmBalances } = useQuotaFirmBalances('tomato', { enabled: isFirmsCell });
  const firmHasNoQuota = useCallback(
    (firmId: number): boolean => isFirmBlocked(firmBalances, firmId),
    [firmBalances],
  );

  const close = useCallback(() => {
    setEditingCell(null);
  }, [setEditingCell]);

  const queryClient = useQueryClient();

  // Phase 5c — custom rows live outside the Shipment model. Saves go to a
  // dedicated endpoint that writes ShipmentCustomFieldValue. Reuses the same
  // ['shipments','sheet'] invalidation so the new value appears next render.
  const customFieldMutation = useMutation({
    mutationFn: async ({ field_key, value }: { field_key: string; value: string }) => {
      await api.patch(`/export/shipments/${shipment.id}/custom-fields/`, { field_key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // The task drawer's progress bar reads the shipment DETAIL cache, not the
      // sheet cache — without this it stays stale until the drawer remounts.
      queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(shipment.id) });
      close();
    },
    onError: (err) => {
      toast.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[SheetCellEditor] custom-field PATCH failed', err);
      close();
    },
  });

  const save = useCallback(
    (value: unknown) => {
      // Custom rows: dispatch to the dedicated endpoint with a string value.
      if (rowConfig.field_key.startsWith('custom_')) {
        const strValue = typeof value === 'string' ? value : String(value ?? '');
        const before = shipment.custom_fields?.[rowConfig.field_key] ?? '';
        const undoId = recordCellEntry(shipment.id, rowConfig.field_key, before, strValue);
        customFieldMutation.mutate(
          { field_key: rowConfig.field_key, value: strValue },
          undoId === -1 ? undefined : { onError: () => dropEntry(undoId) },
        );
        return;
      }
      const before = shipment[rowConfig.field_key as keyof IShipmentSheetItem];
      const undoId = recordCellEntry(shipment.id, rowConfig.field_key, before, value);
      patchMutation.mutate(
        { id: shipment.id, field: rowConfig.field_key, value },
        undoId === -1
          ? undefined
          : {
              onError: () => dropEntry(undoId),
              onSuccess: (data) => {
                const d = data as Record<string, unknown>;
                setEntryAfter(undoId, reconciledCellValue(d, rowConfig), cascadeFrom(shipment, d));
              },
            },
      );
      close();
    },
    [patchMutation, customFieldMutation, shipment, rowConfig, close],
  );

  const junctionMutation = useMutation({
    mutationFn: async ({ endpoint, body }: { endpoint: string; body: Record<string, unknown> }) => {
      await api.post(`/export/shipments/${shipment.id}/${endpoint}/`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // firm_splits / block_sources are target_fields on seeded task rules, so
      // the drawer's progress bar depends on the detail cache refreshing here.
      queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(shipment.id) });
      close();
    },
    onError: (err) => {
      toast.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[SheetCellEditor] junction PATCH failed', err);
      close();
    },
  });

  const saveJunction = useCallback(
    (
      endpoint: string,
      items: Record<string, unknown>[],
      key: string,
      options?: { onError?: () => void },
    ) => {
      junctionMutation.mutate({ endpoint, body: { [key]: items } }, options);
    },
    [junctionMutation],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    },
    [close],
  );

  // Auto-focus on mount
  useEffect(() => {
    const el = containerRef.current?.querySelector('input, .ant-select-selector');
    if (el instanceof HTMLElement) {
      el.focus();
      // When seeded (type-to-edit), drop the caret at the end of the seeded
      // glyph so the next keystroke appends instead of overwriting.
      if (editSeed && el instanceof HTMLInputElement) {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }
  }, [editSeed]);

  // Phase 5c: custom rows store values in shipment.custom_fields, NOT on the
  // Shipment model. Resolve the editor's seed value from there for custom_*.
  const currentValue = rowConfig.field_key.startsWith('custom_')
    ? shipment.custom_fields?.[rowConfig.field_key] ?? ''
    : shipment[rowConfig.field_key as keyof IShipmentSheetItem];
  const lang = i18n.language;

  /** Get the right name for the current language */
  function countryLabel(c: { name_tk: string; name_ru: string | null; name_en: string | null }): string {
    if (lang.startsWith('ru') && c.name_ru) return c.name_ru;
    if (lang.startsWith('en') && c.name_en) return c.name_en;
    return c.name_tk;
  }

  function firmLabel(f: { code: string; name_tk: string; name_en: string | null }): string {
    return `${f.code} — ${f.name_en ?? f.name_tk}`;
  }

  /** Build options from ShipmentOptionType by category */
  function optionsByCategory(cat: string): { value: string; label: string }[] {
    return (allOptions ?? [])
      .filter((o) => o.category === cat && o.is_active)
      .map((o) => {
        const label = lang.startsWith('ru') && o.label_ru ? o.label_ru
          : lang.startsWith('en') && o.label_en ? o.label_en
          : o.label_tk;
        const display = o.icon ? `${o.icon} ${label}` : label;
        return { value: o.code, label: display };
      });
  }

  /** Build options for a Select based on the field */
  function getOptions(): { value: number | string; label: string }[] {
    const { field_key: fieldKey, options_source: optionsSource } = rowConfig;

    switch (optionsSource ?? fieldKey) {
      case 'countries':
      case 'country':
        return (countries ?? []).map((c) => ({ value: c.id, label: countryLabel(c) }));

      case 'cities':
      case 'city':
        return (cities ?? []).map((c) => ({ value: c.id, label: c.name }));

      case 'customers':
      case 'customer':
        return (customers ?? []).map((c) => ({ value: c.id, label: c.name }));

      case 'exportFirms':
      case 'firm_splits':
        return (exportFirms ?? []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: firmLabel(f) }));

      case 'importFirms':
      case 'import_firm':
        return (importFirms ?? []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: f.name_short ?? f.name_company }));

      case 'blocks':
      case 'block_sources':
        return (blocks ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.code }));

      case 'varieties':
      case 'variety':
        return (varieties ?? []).map((v) => ({ value: v.id, label: v.name }));

      case 'borderPoints':
      case 'border_point':
        return (borderPoints ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name }));

      case 'transportUsers':
      case 'vehicle_responsible':
        return optionsByCategory('transport_responsible');

      case 'vehicleCondition':
      case 'vehicle_condition':
        return optionsByCategory('vehicle_condition');

      case 'peregruz':
      case 'has_peregruz':
        return [
          { value: 0, label: '—' },
          { value: 1, label: t('sheet.has_peregruz_yes') },
        ];

      case 'gornushi':
      case 'is_gapy_satys':
        return [
          { value: 0, label: t('sheet.gornushi.adaty') },
          { value: 1, label: t('sheet.gornushi.gapy_satys') },
        ];

      case 'weekdays':
      case 'customs_clearance_planned_day':
        return (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => ({
          value: day,
          label: t(`weekday.${day}`),
        }));

      default:
        return [];
    }
  }

  // Virtual combined cell R26: one text input edits BOTH transit_days and
  // transport_temp_c. User types two numbers in any common form ("5 4",
  // "5d 4°C", "5/4"); the first matched number becomes transit_days, the
  // second transport_temp_c. Empty input clears both. One PATCH covers both
  // real fields. Special-cased here because input_type='text' would otherwise
  // PATCH the virtual field_key which has no backing column.
  const saveTransitTemp = useCallback(
    (raw: string) => {
      const matches = raw.match(/-?\d+(\.\d+)?/g) ?? [];
      const newDays = matches[0] != null ? Number(matches[0]) : null;
      const newTemp = matches[1] != null ? Number(matches[1]) : null;
      const fields = { transit_days: newDays, transport_temp_c: newTemp };
      const before = {
        transit_days: shipment.transit_days,
        transport_temp_c: shipment.transport_temp_c,
      };
      const undoId = recordMultiEntry(shipment.id, before, fields);
      patchMultiMutation.mutate(
        { id: shipment.id, fields },
        undoId === -1
          ? undefined
          : {
              onError: () => dropEntry(undoId),
              onSuccess: (data) => {
                const d = data as Record<string, unknown>;
                // Fall back to the sent value when the response omits a subfield,
                // so `after` never carries `undefined` (which would make the next
                // undo's concurrent guard false-positive "cell changed").
                setEntryAfter(
                  undoId,
                  {
                    transit_days: d.transit_days !== undefined ? d.transit_days : fields.transit_days,
                    transport_temp_c:
                      d.transport_temp_c !== undefined ? d.transport_temp_c : fields.transport_temp_c,
                  },
                  cascadeFrom(shipment, d),
                );
              },
            },
      );
      close();
    },
    [patchMultiMutation, shipment, close],
  );

  // Virtual combined cell: the truck_plate cell's overlay (SheetTruckSelectEditor)
  // resolves a fleet head + trailer and the derived plate string, all committed
  // in one PATCH — mirrors saveTransitTemp above. Gapy-Satys shipments never
  // reach this (renderEditor's gapy branch keeps the plain text input instead).
  const saveTruck = useCallback(
    (fields: { truck_head_id: number | null; trailer_id: number | null; truck_plate: string }) => {
      const before = {
        truck_head_id: shipment.truck_head_id,
        trailer_id: shipment.trailer_id,
        truck_plate: shipment.truck_plate,
      };
      const undoId = recordMultiEntry(shipment.id, before, fields);
      patchMultiMutation.mutate(
        { id: shipment.id, fields },
        undoId === -1
          ? undefined
          : {
              onError: () => dropEntry(undoId),
              onSuccess: (data) => {
                const d = data as Record<string, unknown>;
                setEntryAfter(
                  undoId,
                  {
                    truck_head_id: d.truck_head_id !== undefined ? d.truck_head_id : fields.truck_head_id,
                    trailer_id: d.trailer_id !== undefined ? d.trailer_id : fields.trailer_id,
                    truck_plate: d.truck_plate !== undefined ? d.truck_plate : fields.truck_plate,
                  },
                  cascadeFrom(shipment, d),
                );
              },
            },
      );
      close();
    },
    [patchMultiMutation, shipment, close],
  );

  // Virtual combined cell: the driver_name cell's overlay
  // (SheetDriverSelectEditor) resolves a registry driver and commits the id and
  // the display name in one PATCH — same shape as saveTruck. `driver_phone`
  // (R28) is intentionally absent: it is its own cell with its own history and
  // was typed by operators, so picking a driver must not overwrite it.
  const saveDriver = useCallback(
    (fields: { driver_id: number | null; driver_name: string; driver_phone?: string }) => {
      // Snapshot only what is actually being written — driver_phone rides along
      // just when the registry supplied one, and undo must not restore a field
      // the PATCH never touched.
      const before: Record<string, unknown> = {
        driver_id: shipment.driver_id,
        driver_name: shipment.driver_name,
      };
      if (fields.driver_phone !== undefined) {
        before.driver_phone = shipment.driver_phone;
      }
      const undoId = recordMultiEntry(shipment.id, before, fields);
      patchMultiMutation.mutate(
        { id: shipment.id, fields },
        undoId === -1
          ? undefined
          : {
              onError: () => dropEntry(undoId),
              onSuccess: (data) => {
                const d = data as Record<string, unknown>;
                setEntryAfter(
                  undoId,
                  {
                    driver_id: d.driver_id !== undefined ? d.driver_id : fields.driver_id,
                    driver_name: d.driver_name !== undefined ? d.driver_name : fields.driver_name,
                    ...(fields.driver_phone !== undefined
                      ? {
                          driver_phone:
                            d.driver_phone !== undefined ? d.driver_phone : fields.driver_phone,
                        }
                      : {}),
                  },
                  cascadeFrom(shipment, d),
                );
              },
            },
      );
      close();
    },
    [patchMultiMutation, shipment, close],
  );

  // Type-to-edit commit-and-hop for text-like inputs (text / phone / number /
  // the R26 combined cell). While seeded, an arrow key commits the current
  // value and moves the selection one cell over (via setPendingNav, consumed by
  // SheetGrid). Enter-opened edits (editSeed null) keep the native caret move so
  // operators can correct a typo mid-value. Escape always cancels.
  const handleSeededKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (editSeed == null) return;
      const isArrow =
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight';
      if (!isArrow) return;
      // preventDefault suppresses the text caret move. (antd InputNumber's own
      // up/down step may still fire depending on rc-input-number version, but
      // we read the raw value *now*, before any step re-renders, so the value
      // we commit is exactly what the operator typed.)
      e.preventDefault();
      e.stopPropagation();
      const raw = (e.target as HTMLInputElement).value;
      if (rowConfig.field_key === 'transit_days_temp') {
        saveTransitTemp(raw);
      } else if (rowConfig.input_type === 'number') {
        save(parseNumberInput(raw));
      } else {
        save(raw);
      }
      setPendingNav(e.key);
    },
    [editSeed, close, rowConfig.field_key, rowConfig.input_type, save, saveTransitTemp, setPendingNav],
  );

  const renderEditor = () => {
    // Virtual combined cell: truck_plate picks a fleet head + trailer for
    // non-Gapy-Satys shipments (auto-GPS). Gapy shipments have no fleet
    // linkage — HARD RULE — and fall through to the plain input_type='text'
    // path below (no selects, no GPS).
    if (rowConfig.field_key === 'truck_plate' && !shipment.is_gapy_satys) {
      return (
        <SheetTruckSelectEditor
          initialHeadId={shipment.truck_head_id}
          initialTrailerId={shipment.trailer_id}
          onCommit={saveTruck}
          onClose={close}
        />
      );
    }

    // Same shape one row down: driver_name picks from the Z_TIRWEB driver
    // registry, writing driver_id alongside the name. Gapy shipments are local
    // buyers' own trucks and own drivers — same HARD RULE as truck_plate — and
    // fall through to the plain text input below.
    if (rowConfig.field_key === 'driver_name' && !shipment.is_gapy_satys) {
      return (
        <SheetDriverSelectEditor
          initialDriverId={shipment.driver_id}
          onCommit={saveDriver}
          onClose={close}
        />
      );
    }

    if (rowConfig.field_key === 'transit_days_temp') {
      const days = shipment.transit_days;
      const temp = shipment.transport_temp_c;
      const defaultText =
        days != null || temp != null
          ? `${days ?? ''} ${temp ?? ''}`.trim()
          : '';
      return (
        <Input
          size="small"
          defaultValue={editSeed ?? defaultText}
          placeholder="5 4"
          onPressEnter={(e) => saveTransitTemp((e.target as HTMLInputElement).value)}
          onBlur={(e) => saveTransitTemp(e.target.value)}
          onKeyDown={handleSeededKeyDown}
          style={{ width: '100%', height: ROW_HEIGHT - 4 }}
        />
      );
    }

    switch (rowConfig.input_type) {
      case 'text':
      case 'phone':
        return (
          <Input
            size="small"
            defaultValue={editSeed ?? ((currentValue as string) ?? '')}
            onPressEnter={(e) => save((e.target as HTMLInputElement).value)}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={handleSeededKeyDown}
            style={{ width: '100%', height: ROW_HEIGHT - 4 }}
          />
        );

      case 'number':
        return (
          <InputNumber
            size="small"
            defaultValue={
              editSeed != null
                ? (parseNumberInput(editSeed) ?? undefined)
                : ((currentValue as number | null) ?? undefined)
            }
            onPressEnter={(e) => save(parseNumberInput((e.target as HTMLInputElement).value))}
            onBlur={(e) => save(parseNumberInput(e.target.value))}
            onKeyDown={handleSeededKeyDown}
            style={{ width: '100%', height: ROW_HEIGHT - 4 }}
          />
        );

      case 'dropdown': {
        const options = getOptions();
        // Bool-backed dropdowns map 0/1 ⇄ false/true on the wire.
        const isBoolDropdown =
          rowConfig.options_source === 'peregruz' ||
          rowConfig.options_source === 'gornushi';
        return (
          <Select
            size="small"
            defaultValue={isBoolDropdown ? (currentValue ? 1 : 0) : ((currentValue as number | string | null) ?? undefined)}
            options={options}
            onChange={(val) => save(isBoolDropdown ? Boolean(val) : val)}
            onOpenChange={(open) => { if (!open) close(); }}
            style={{ width: '100%' }}
            showSearch
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
            allowClear
            autoFocus
            defaultOpen
            popupMatchSelectWidth={false}
            popupStyle={{ minWidth: 200 }}
          />
        );
      }

      case 'multiselect': {
        const options = getOptions();
        const isBlocks = rowConfig.field_key === 'block_sources';
        const isFirms = rowConfig.field_key === 'firm_splits';
        // R38 — varieties_dominant M2M, written via /shipments/{id}/varieties/override/.
        // Distinct from junction-table cells: payload is {variety_ids: [int]} (not
        // objects with weight_kg), and the endpoint enforces 1-4 entries.
        const isVarieties = rowConfig.field_key === 'variety';

        // Current selected IDs from junction table data
        const currentIds = isBlocks
          ? shipment.block_sources.map((b) => {
              const match = (blocks ?? []).find((bl) => bl.code === b.block_code);
              return match?.id;
            }).filter((id): id is number => id != null)
          : isFirms
            ? shipment.firm_splits.map((f) => {
                const match = (exportFirms ?? []).find((ef) => ef.code === f.firm_code);
                return match?.id;
              }).filter((id): id is number => id != null)
            : isVarieties
              ? (shipment.varieties_dominant ?? []).map((v) => v.id)
              : [];

        if (pendingMultiRef.current === null) {
          pendingMultiRef.current = currentIds;
        }

        // Commit the pending selection (or close if unchanged). Shared by the
        // explicit "Done" button and the click-outside path so operators don't
        // have to click another cell — which would open that cell's editor —
        // just to dismiss this dropdown.
        const commitMulti = () => {
          if (multiCommittedRef.current) return;
          const next = pendingMultiRef.current ?? currentIds;
          const nextSet = new Set(next);
          const unchanged =
            next.length === currentIds.length &&
            currentIds.every((id) => nextSet.has(id));
          if (unchanged) {
            close();
            return;
          }
          multiCommittedRef.current = true;
          // Send IDs only — backend auto-fills weight_kg.
          // R8 blocks → splits real shipment.weight_net evenly across N blocks.
          // R9 firms  → uses TruckSplitDefault[N] (official kg per firm).
          // R38 varieties → POST varieties/override with {variety_ids:[int,...]}
          // (1-4 entries enforced server-side; empty selection no-ops to avoid 400).
          if (isBlocks) {
            const undoId = recordJunctionEntry(shipment.id, 'block_sources', shipment.block_sources);
            saveJunction(
              'block-sources',
              next.map((id) => ({ block_id: id })),
              'blocks',
              undoId === -1 ? undefined : { onError: () => dropEntry(undoId) },
            );
          } else if (isFirms) {
            // Hard block: a firm with no remaining quota may not be added.
            // No-quota firms are disabled in the dropdown; strip any that
            // slipped through, show an error, and save only the allowed firms.
            const previousIds = new Set(currentIds);
            const blocked = next.filter((id) => !previousIds.has(id) && firmHasNoQuota(id));
            if (blocked.length > 0) {
              const names = blocked.map(
                (id) => options.find((o) => o.value === id)?.label ?? String(id),
              );
              toast.error(t('sheet.firm_no_quota_error', { firms: names.join(', ') }));
            }
            const allowed = blocked.length ? next.filter((id) => !blocked.includes(id)) : next;
            // Nothing left to change after stripping blocked firms → just close.
            const allowedSet = new Set(allowed);
            if (
              allowed.length === currentIds.length &&
              currentIds.every((id) => allowedSet.has(id))
            ) {
              close();
              return;
            }
            const undoId = recordJunctionEntry(shipment.id, 'firm_splits', shipment.firm_splits);
            saveJunction(
              'firm-splits',
              allowed.map((id) => ({ export_firm_id: id })),
              'firms',
              undoId === -1 ? undefined : { onError: () => dropEntry(undoId) },
            );
          } else if (isVarieties) {
            if (next.length === 0) {
              close();
              return;
            }
            const undoId = recordVarietiesEntry(shipment.id, shipment.varieties_dominant ?? []);
            junctionMutation.mutate(
              { endpoint: 'varieties/override', body: { variety_ids: next } },
              undoId === -1 ? undefined : { onError: () => dropEntry(undoId) },
            );
          } else {
            close();
          }
        };

        // Firms with no quota left are disabled in the list — a dead end unless
        // the operator can go top the quota up. Only shown when the dropdown
        // actually holds such a firm.
        const showQuotaLink =
          isFirms && options.some((o) => firmHasNoQuota(o.value as number));

        return (
          <Select
            size="small"
            mode="multiple"
            defaultValue={currentIds}
            options={
              isFirms
                ? options.map((o) =>
                    firmHasNoQuota(o.value as number)
                      ? {
                          ...o,
                          label: `${o.label} ⚠ ${t('sheet.firm_no_quota_tag')}`,
                          // Hard block: a no-quota firm cannot be chosen. Only
                          // disable ones not already on the split so an existing
                          // (over-committed) firm can still be removed.
                          disabled: !currentIds.includes(o.value as number),
                        }
                      : o,
                  )
                : options
            }
            onChange={(selectedIds: number[]) => {
              pendingMultiRef.current = selectedIds;
            }}
            onOpenChange={(open) => {
              if (open) return;
              commitMulti();
            }}
            style={{ width: '100%' }}
            showSearch
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
            autoFocus
            defaultOpen
            popupMatchSelectWidth={false}
            popupStyle={{ minWidth: 220 }}
            dropdownRender={(menu) => (
              <>
                {menu}
                <div
                  style={{
                    borderTop: '1px solid #f0f0f0',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 8,
                  }}
                  // Prevent the mousedown from blurring the Select (which would
                  // fire onOpenChange before our click handler runs).
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {showQuotaLink && <QuotaPageLink style={{ marginRight: 'auto' }} />}
                  <Button size="small" type="primary" onClick={commitMulti}>
                    {t('sheet.multiselect_done')}
                  </Button>
                </div>
              </>
            )}
          />
        );
      }

      case 'date':
        return (
          <DatePicker
            size="small"
            defaultValue={currentValue ? dayjs(currentValue as string) : dayjs()}
            // allowClear={false}: the picker's X button silently sent the field
            // to null on click — operators kept accidentally erasing saved
            // values. The only way to clear now is via the model admin.
            allowClear={false}
            onChange={(date) => { if (date) save(date.format('YYYY-MM-DD')); }}
            onOpenChange={(open) => { if (!open) close(); }}
            style={{ width: '100%' }}
            autoFocus
            open
          />
        );

      case 'datetime':
        return (
          <DatePicker
            size="small"
            showTime={{ format: 'HH:mm' }}
            format="DD.MM.YYYY HH:mm"
            defaultValue={currentValue ? dayjs(currentValue as string) : dayjs()}
            // allowClear={false}: see 'date' case — same accidental-clear bug.
            allowClear={false}
            onChange={(date) => { if (date) save(date.startOf('minute').toISOString()); }}
            // onOk fires when the operator presses the picker's "OK" button
            // without scrolling the time wheels — without this, the default
            // value (now) is silently dropped on close.
            onOk={(date) => { if (date) save(date.startOf('minute').toISOString()); }}
            onOpenChange={(open) => { if (!open) close(); }}
            style={{ width: '100%' }}
            autoFocus
            open
          />
        );

      case 'status': {
        // Status fields pull options from ShipmentOptionType API by category
        const statusOptions = optionsByCategory(rowConfig.field_key);
        return (
          <Select
            size="small"
            defaultValue={(currentValue as string) ?? undefined}
            options={statusOptions}
            onChange={(val) => save(val)}
            onOpenChange={(open) => { if (!open) close(); }}
            style={{ width: '100%' }}
            autoFocus
            defaultOpen
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="sheet-cell sheet-cell--editing"
      style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT, padding: 1 }}
      onKeyDown={handleKeyDown}
    >
      {renderEditor()}
    </div>
  );
}
