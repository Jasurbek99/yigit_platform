import { useCallback, useEffect, useRef } from 'react';
import { DatePicker, Input, InputNumber, Select, message } from 'antd';
import dayjs from 'dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useShipmentPatch, extractPatchError } from '@/hooks/useShipmentPatch';
import api from '@/services/api';
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
import { COL_WIDTH_SHIPMENT, ROW_HEIGHT } from '@/constants/sheetRowConfig';

interface ISheetCellEditorProps {
  shipment: IShipmentSheetItem;
  rowConfig: IRowConfig;
}

export function SheetCellEditor({ shipment, rowConfig }: ISheetCellEditorProps) {
  const { t, i18n } = useTranslation();
  const { setEditingCell } = useSheetStore();
  const patchMutation = useShipmentPatch();
  const containerRef = useRef<HTMLDivElement>(null);
  // Multi-select cells (firm_splits, block_sources) defer saving until the
  // dropdown closes — saving on each pick would unmount the editor mid-edit.
  const pendingMultiRef = useRef<number[] | null>(null);

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
      close();
    },
    onError: (err) => {
      message.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[SheetCellEditor] custom-field PATCH failed', err);
      close();
    },
  });

  const save = useCallback(
    (value: unknown) => {
      // Custom rows: dispatch to the dedicated endpoint with a string value.
      if (rowConfig.field_key.startsWith('custom_')) {
        customFieldMutation.mutate({
          field_key: rowConfig.field_key,
          value: typeof value === 'string' ? value : String(value ?? ''),
        });
        return;
      }
      patchMutation.mutate({ id: shipment.id, field: rowConfig.field_key, value });
      close();
    },
    [patchMutation, customFieldMutation, shipment.id, rowConfig.field_key, close],
  );

  const junctionMutation = useMutation({
    mutationFn: async ({ endpoint, body }: { endpoint: string; body: Record<string, unknown> }) => {
      await api.post(`/export/shipments/${shipment.id}/${endpoint}/`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      close();
    },
    onError: (err) => {
      message.error(extractPatchError(err, t('sheet.save_error')));
      console.error('[SheetCellEditor] junction PATCH failed', err);
      close();
    },
  });

  const saveJunction = useCallback(
    (endpoint: string, items: Record<string, unknown>[], key: string) => {
      junctionMutation.mutate({ endpoint, body: { [key]: items } });
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
    }
  }, []);

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

  const renderEditor = () => {
    switch (rowConfig.input_type) {
      case 'text':
      case 'phone':
        return (
          <Input
            size="small"
            defaultValue={(currentValue as string) ?? ''}
            onPressEnter={(e) => save((e.target as HTMLInputElement).value)}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ width: '100%', height: ROW_HEIGHT - 4 }}
          />
        );

      case 'number':
        return (
          <InputNumber
            size="small"
            defaultValue={(currentValue as number | null) ?? undefined}
            onPressEnter={(e) => save(Number((e.target as HTMLInputElement).value))}
            onBlur={(e) => save(Number(e.target.value) || null)}
            onKeyDown={handleKeyDown}
            style={{ width: '100%', height: ROW_HEIGHT - 4 }}
          />
        );

      case 'dropdown': {
        const options = getOptions();
        const isPeregruz = rowConfig.options_source === 'peregruz';
        return (
          <Select
            size="small"
            defaultValue={isPeregruz ? (currentValue ? 1 : 0) : ((currentValue as number | string | null) ?? undefined)}
            options={options}
            onChange={(val) => save(isPeregruz ? Boolean(val) : val)}
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
            : [];

        if (pendingMultiRef.current === null) {
          pendingMultiRef.current = currentIds;
        }

        return (
          <Select
            size="small"
            mode="multiple"
            defaultValue={currentIds}
            options={options}
            onChange={(selectedIds: number[]) => {
              pendingMultiRef.current = selectedIds;
            }}
            onOpenChange={(open) => {
              if (open) return;
              const next = pendingMultiRef.current ?? currentIds;
              const nextSet = new Set(next);
              const unchanged =
                next.length === currentIds.length &&
                currentIds.every((id) => nextSet.has(id));
              if (unchanged) {
                close();
                return;
              }
              // Send IDs only — backend auto-fills weight_kg.
              // R8 blocks → splits real shipment.weight_net evenly across N blocks.
              // R9 firms  → uses TruckSplitDefault[N] (official kg per firm).
              if (isBlocks) {
                saveJunction('block-sources', next.map((id) => ({ block_id: id })), 'blocks');
              } else if (isFirms) {
                saveJunction('firm-splits', next.map((id) => ({ export_firm_id: id })), 'firms');
              } else {
                close();
              }
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
          />
        );
      }

      case 'date':
        return (
          <DatePicker
            size="small"
            defaultValue={currentValue ? dayjs(currentValue as string) : undefined}
            onChange={(date) => save(date ? date.format('YYYY-MM-DD') : null)}
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
            showTime
            defaultValue={currentValue ? dayjs(currentValue as string) : undefined}
            onChange={(date) => save(date ? date.toISOString() : null)}
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
