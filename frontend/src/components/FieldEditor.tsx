import { DatePicker, Input, InputNumber, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  useCountries,
  useCities,
  useCustomers,
  useAdminImportFirms,
  useTomatoVarieties,
  useBorderPoints,
  useShipmentOptions,
} from '@/hooks/useAdmin';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import { OPTION_CATEGORY_BY_FIELD } from '@/constants/shipmentEditConfig';

interface IFieldEditorProps {
  config: IEditFieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Used by city dropdown to filter by country. */
  countryId?: number | null;
  disabled?: boolean;
}

/**
 * Renders the right input control for a given field config.
 * Self-fetches reference data via the same hooks the SheetCellEditor uses,
 * so the Edit drawer doesn't need to plumb options through props.
 */
export function FieldEditor({ config, value, onChange, countryId, disabled }: IFieldEditorProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  // Reference-data hooks. TanStack Query dedupes by queryKey, so multiple
  // FieldEditor instances on the same page share a single fetch per resource.
  const { data: countries } = useCountries();
  const { data: cities } = useCities(countryId ?? null);
  const { data: customers } = useCustomers();
  const { data: importFirms } = useAdminImportFirms();
  const { data: varieties } = useTomatoVarieties();
  const { data: borderPoints } = useBorderPoints();
  const { data: allOptions } = useShipmentOptions();

  function countryLabel(c: { name_tk: string; name_ru: string | null; name_en: string | null }): string {
    if (lang.startsWith('ru') && c.name_ru) return c.name_ru;
    if (lang.startsWith('en') && c.name_en) return c.name_en;
    return c.name_tk;
  }

  function getOptions(): { value: number | string; label: string }[] {
    switch (config.optionsSource) {
      case 'countries':
        return (countries ?? []).map((c) => ({ value: c.id, label: countryLabel(c) }));
      case 'cities':
        return (cities ?? []).map((c) => ({ value: c.id, label: c.name }));
      case 'customers':
        return (customers ?? []).map((c) => ({ value: c.id, label: c.name }));
      case 'importFirms':
        return (importFirms ?? [])
          .filter((f) => f.is_active)
          .map((f) => ({ value: f.id, label: f.name_short ?? f.name_company }));
      case 'varieties':
        return (varieties ?? []).map((v) => ({ value: v.id, label: v.name }));
      case 'borderPoints':
        return (borderPoints ?? [])
          .filter((b) => b.is_active)
          .map((b) => ({ value: b.id, label: b.name }));
      default:
        // option_select fields read from ShipmentOptionType by category
        if (config.inputType === 'option_select') {
          const category = OPTION_CATEGORY_BY_FIELD[config.key];
          if (!category) return [];
          return (allOptions ?? [])
            .filter((o) => o.category === category && o.is_active)
            .map((o) => {
              const label = lang.startsWith('ru') && o.label_ru
                ? o.label_ru
                : lang.startsWith('en') && o.label_en
                  ? o.label_en
                  : o.label_tk;
              return { value: o.code, label: o.icon ? `${o.icon} ${label}` : label };
            });
        }
        return [];
    }
  }

  switch (config.inputType) {
    case 'text':
      return (
        <Input
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          allowClear
        />
      );

    case 'textarea':
      return (
        <Input.TextArea
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          autoSize={{ minRows: 2, maxRows: 5 }}
          allowClear
        />
      );

    case 'number':
      return (
        <InputNumber
          value={(value as number | null) ?? undefined}
          onChange={(v) => onChange(v ?? null)}
          disabled={disabled}
          min={config.min}
          style={{ width: '100%' }}
          addonAfter={config.suffix}
        />
      );

    case 'date':
      return (
        <DatePicker
          value={value ? dayjs(value as string) : undefined}
          onChange={(date) => onChange(date ? date.format('YYYY-MM-DD') : null)}
          disabled={disabled}
          style={{ width: '100%' }}
        />
      );

    case 'datetime':
      return (
        <DatePicker
          showTime
          value={value ? dayjs(value as string) : undefined}
          onChange={(date) => onChange(date ? date.toISOString() : null)}
          disabled={disabled}
          style={{ width: '100%' }}
        />
      );

    case 'select':
    case 'option_select':
      return (
        <Select
          value={(value as number | string | null) ?? undefined}
          onChange={(v) => onChange(v ?? null)}
          options={getOptions()}
          disabled={disabled}
          showSearch
          allowClear
          filterOption={(input, option) =>
            (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
          }
          style={{ width: '100%' }}
        />
      );

    case 'boolean':
      return (
        <Switch
          checked={Boolean(value)}
          onChange={(checked) => onChange(checked)}
          disabled={disabled}
        />
      );

    default:
      return null;
  }
}
