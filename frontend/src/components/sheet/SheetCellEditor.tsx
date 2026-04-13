import { useCallback, useEffect, useRef } from 'react';
import { DatePicker, Input, InputNumber, Select, message } from 'antd';
import dayjs from 'dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useShipmentPatch } from '@/hooks/useShipmentPatch';
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

  const save = useCallback(
    (value: unknown) => {
      patchMutation.mutate({ id: shipment.id, field: rowConfig.fieldKey, value });
      close();
    },
    [patchMutation, shipment.id, rowConfig.fieldKey, close],
  );

  const queryClient = useQueryClient();
  const junctionMutation = useMutation({
    mutationFn: async ({ endpoint, body }: { endpoint: string; body: Record<string, unknown> }) => {
      await api.post(`/export/shipments/${shipment.id}/${endpoint}/`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      close();
    },
    onError: () => {
      message.error(t('sheet.save_error'));
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

  const currentValue = shipment[rowConfig.fieldKey as keyof IShipmentSheetItem];
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
    const { fieldKey, optionsSource } = rowConfig;

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
          { value: 1, label: 'Boldy' },
        ];

      default:
        return [];
    }
  }

  const renderEditor = () => {
    switch (rowConfig.inputType) {
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
        const isPeregruz = rowConfig.optionsSource === 'peregruz';
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
        const isBlocks = rowConfig.fieldKey === 'block_sources';
        const isFirms = rowConfig.fieldKey === 'firm_splits';

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

        return (
          <Select
            size="small"
            mode="multiple"
            defaultValue={currentIds}
            options={options}
            onChange={(selectedIds: number[]) => {
              if (isBlocks) {
                saveJunction('block-sources', selectedIds.map((id) => ({ block_id: id, weight_kg: 0 })), 'blocks');
              } else if (isFirms) {
                saveJunction('firm-splits', selectedIds.map((id) => ({ export_firm_id: id, weight_kg: 0 })), 'firms');
              }
            }}
            onOpenChange={(open) => { if (!open) close(); }}
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
        const statusOptions = optionsByCategory(rowConfig.fieldKey);
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
